-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 — Stop the loss: the journal becomes append-only
--
-- Closes R-01, R-02, R-05, R-24 (posting half) and the Rule 1 violation that
-- sits underneath all of them.
--
-- The problem this fixes
-- ─────────────────────
-- Every auto-posted journal in this system was written by fn_post_entry, and
-- fn_post_entry opened with:
--
--     DELETE FROM public.journal_entries WHERE source_type = ... AND source_id = ...;
--
-- So editing an invoice destroyed its journal and wrote a new one in its place.
-- The ledger held no record that the first entry had ever existed, which means
-- the audit trail was reconstructed from whatever the operational tables happen
-- to say today. That is the opposite of a ledger. It also makes the corrective
-- reversals in M-03 impossible to build, because the thing being corrected can
-- simply be erased.
--
-- What replaces it
-- ────────────────
-- fn_post_entry now compares what is already posted against what the source
-- document now says:
--
--   • nothing posted, nothing to post   → no-op
--   • nothing posted, lines to post     → post them
--   • posted, and unchanged             → no-op (idempotent; safe to re-run)
--   • posted, and changed               → post a REVERSAL of the live entry,
--                                         then post the corrected entry
--
-- Nothing is ever deleted or amended. A correction is two new entries: the
-- mirror image of what was wrong, and what is right. Both carry the same
-- source document, so the history of a document reads in posting order.
--
-- DELETE is then blocked outright on journal_entries and journal_lines, for
-- every caller including this application's own service role.
--
-- Ordering: run AFTER 20260723102000_period_locks_audit_log.sql (it depends on
-- audit_log and the period guards) and after the double-entry foundation.
--
-- ROLLBACK: see the paired file 20260816120000_phase1_append_only_journal.down.sql.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Attribution and reversal lineage ──────────────────────────────────────
-- created_by already exists but was never populated by the auto-posters, so
-- every machine-posted entry in the ledger is anonymous. posted_by/posted_at
-- are the columns the statements and the Journal view actually display; they
-- are populated on every write from here on (R-24).
ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS posted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reversal_of_id uuid REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS is_reversed    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reversed_at    timestamptz;

COMMENT ON COLUMN public.journal_entries.reversal_of_id IS
  'Set on a reversing entry: the id of the entry it reverses. Never set on an original.';
COMMENT ON COLUMN public.journal_entries.is_reversed IS
  'True once this entry has been reversed. A reversed entry stays in the ledger; it is simply no longer live.';

CREATE INDEX IF NOT EXISTS idx_journal_entries_source
  ON public.journal_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_reversal_of
  ON public.journal_entries(reversal_of_id);

-- Backfill attribution from what we already know. Entries posted before this
-- migration keep an honest NULL where no user was ever recorded — inventing an
-- actor would be worse than admitting the gap.
UPDATE public.journal_entries
SET posted_by = created_by
WHERE posted_by IS NULL AND created_by IS NOT NULL;

UPDATE public.journal_entries
SET posted_at = created_at
WHERE posted_at IS DISTINCT FROM created_at AND created_at IS NOT NULL;

-- ── 2. One live journal per business event (R-05) ─────────────────────────────
-- A source document may accumulate a long history of entries — an original, its
-- reversal, a correction, that correction's reversal — but exactly one of them
-- may be live at a time. This is the constraint that makes it structurally
-- impossible for one goods receipt to post two competing entries.
--
-- Reversals are excluded (they are bound to their original, not to the source
-- document's live position) as are manual entries, which have no source doc.
--
-- Pre-flight: the index cannot be built if the condition it forbids is already
-- present. Fail here, with the offending documents named, rather than half way
-- through a migration with a bare "could not create unique index".
DO $$
DECLARE bad int; sample text;
BEGIN
  SELECT count(*), string_agg(DISTINCT source_type || ':' || source_id::text, ', ')
  INTO bad, sample
  FROM (
    SELECT source_type, source_id
    FROM public.journal_entries
    WHERE source_id IS NOT NULL
      AND source_type <> 'manual'
      AND reversal_of_id IS NULL      -- predicate must match the index below,
      AND is_reversed = false         -- or this fails on every re-run post-M-03
    GROUP BY source_type, source_id
    HAVING count(*) > 1
  ) d;

  IF bad > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce one-live-journal-per-source: % source document(s) already carry more than one entry. Resolve these with M-02/M-03 first. Offenders: %',
      bad, left(sample, 2000);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_live_entry_per_source
  ON public.journal_entries (source_type, source_id)
  WHERE source_id IS NOT NULL
    AND source_type <> 'manual'
    AND reversal_of_id IS NULL
    AND is_reversed = false;

-- ── 3. Reverse an entry ──────────────────────────────────────────────────────
-- Posts the mirror image of p_entry_id and marks the original reversed.
-- Returns the id of the reversing entry.
CREATE OR REPLACE FUNCTION public.fn_reverse_entry(p_entry_id uuid, p_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  orig record;
  rid  uuid;
BEGIN
  SELECT * INTO orig FROM public.journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot reverse journal entry %: no such entry.', p_entry_id;
  END IF;
  IF orig.is_reversed THEN
    -- Already reversed. Reversing twice would double the correction.
    RETURN NULL;
  END IF;

  -- Mark first: the unique index in section 2 admits only one live entry per
  -- source document, and the correcting entry is usually posted immediately
  -- after this call.
  UPDATE public.journal_entries
  SET is_reversed = true, reversed_at = now()
  WHERE id = p_entry_id;

  INSERT INTO public.journal_entries
    (entry_date, memo, source_type, source_id, reversal_of_id, posted_by, created_by)
  VALUES (
    -- Reversals are dated today, not back-dated onto the original. Back-dating
    -- would silently reopen a closed period and restate a signed-off month.
    current_date,
    'Reversal of entry #' || orig.entry_no || COALESCE(' — ' || p_reason, '') ||
      COALESCE(' [' || orig.memo || ']', ''),
    orig.source_type,
    orig.source_id,
    p_entry_id,
    auth.uid(),
    auth.uid()
  )
  RETURNING id INTO rid;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT rid, l.account_id, l.credit, l.debit,
         'Reversal: ' || COALESCE(l.description, '')
  FROM public.journal_lines l
  WHERE l.entry_id = p_entry_id;

  RETURN rid;
END;
$$;

-- ── 4. fn_post_entry, rewritten to never destroy ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_post_entry(
  p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  live_id   uuid;
  eid       uuid;
  ln        jsonb;
  want_fp   text;
  have_fp   text;
  want_n    int := 0;
BEGIN
  -- The live entry for this source document, if any.
  SELECT id INTO live_id
  FROM public.journal_entries
  WHERE source_type = p_source_type
    AND source_id   = p_source_id
    AND reversal_of_id IS NULL
    AND is_reversed = false
  LIMIT 1;

  IF p_lines IS NOT NULL THEN
    want_n := jsonb_array_length(p_lines);
  END IF;

  -- Nothing to post. If something is live, the source document has ceased to
  -- qualify (cancelled, zeroed, status moved back) and the posting is reversed.
  IF want_n = 0 THEN
    IF live_id IS NOT NULL THEN
      PERFORM public.fn_reverse_entry(live_id, 'source document no longer posts');
    END IF;
    RETURN;
  END IF;

  -- Fingerprint of what we are being asked to post, ordered so that line order
  -- alone never counts as a change.
  SELECT string_agg(f, '|' ORDER BY f) INTO want_fp
  FROM (
    SELECT (x->>'code') || ':' ||
           to_char(COALESCE((x->>'debit')::numeric,  0), 'FM9999999999990.00') || ':' ||
           to_char(COALESCE((x->>'credit')::numeric, 0), 'FM9999999999990.00') AS f
    FROM jsonb_array_elements(p_lines) x
  ) s;

  IF live_id IS NOT NULL THEN
    SELECT string_agg(f, '|' ORDER BY f) INTO have_fp
    FROM (
      SELECT a.code || ':' ||
             to_char(l.debit,  'FM9999999999990.00') || ':' ||
             to_char(l.credit, 'FM9999999999990.00') AS f
      FROM public.journal_lines l
      JOIN public.chart_of_accounts a ON a.id = l.account_id
      WHERE l.entry_id = live_id
    ) s;

    -- Unchanged: posting is idempotent, so re-running a backfill or firing the
    -- trigger twice costs nothing and writes nothing.
    IF have_fp IS NOT DISTINCT FROM want_fp
       AND (SELECT entry_date FROM public.journal_entries WHERE id = live_id) = p_date THEN
      RETURN;
    END IF;

    -- Changed: correct it the only way a ledger permits.
    PERFORM public.fn_reverse_entry(live_id, 'restated from source document');
  END IF;

  INSERT INTO public.journal_entries
    (entry_date, memo, source_type, source_id, posted_by, created_by)
  VALUES (p_date, p_memo, p_source_type, p_source_id, auth.uid(), auth.uid())
  RETURNING id INTO eid;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (
      eid,
      public.fn_acct(ln->>'code'),
      COALESCE((ln->>'debit')::numeric, 0),
      COALESCE((ln->>'credit')::numeric, 0),
      ln->>'desc'
    );
  END LOOP;
END;
$$;

-- ── 5. fn_unpost reverses instead of deleting ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_unpost(p_source_type text, p_source_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE live_id uuid;
BEGIN
  SELECT id INTO live_id
  FROM public.journal_entries
  WHERE source_type = p_source_type
    AND source_id   = p_source_id
    AND reversal_of_id IS NULL
    AND is_reversed = false
  LIMIT 1;

  IF live_id IS NOT NULL THEN
    PERFORM public.fn_reverse_entry(live_id, 'unposted');
  END IF;
END;
$$;

-- ── 6. The ledger refuses to forget ──────────────────────────────────────────
-- Belt and braces over the two functions above: even a direct DELETE from the
-- SQL editor, a service-role script or a future trigger is refused. The only
-- way a posting leaves the live ledger is by being reversed.
CREATE OR REPLACE FUNCTION public.fn_block_journal_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Journal records cannot be deleted. Reverse the entry instead: SELECT public.fn_reverse_entry(''%s'', ''reason''). (attempted on %)',
    COALESCE(OLD.id::text, '?'), TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_journal_entry_delete ON public.journal_entries;
CREATE TRIGGER trg_block_journal_entry_delete
  BEFORE DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_journal_delete();

DROP TRIGGER IF EXISTS trg_block_journal_line_delete ON public.journal_lines;
CREATE TRIGGER trg_block_journal_line_delete
  BEFORE DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_journal_delete();

-- The cascade from journal_entries would otherwise try to delete lines and hit
-- the guard above with a confusing message. Deletes are blocked at the header
-- anyway, so the cascade is dead weight; drop it to NO ACTION.
ALTER TABLE public.journal_lines
  DROP CONSTRAINT IF EXISTS journal_lines_entry_id_fkey;
ALTER TABLE public.journal_lines
  ADD CONSTRAINT journal_lines_entry_id_fkey
  FOREIGN KEY (entry_id) REFERENCES public.journal_entries(id);

-- ── 7. Attribution on stock movements (R-24, stock half) ─────────────────────
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.fn_stamp_movement_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.posted_by IS NULL THEN NEW.posted_by := auth.uid(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_movement_actor ON public.inventory_movements;
CREATE TRIGGER trg_stamp_movement_actor
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_movement_actor();

COMMIT;
