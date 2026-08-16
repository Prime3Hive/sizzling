-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK for 20260816120000_phase1_append_only_journal.sql
--
-- Read this before running it.
--
-- This rollback restores the ability to post journals, and restores the old
-- delete-and-recreate behaviour of fn_post_entry. It does NOT and CANNOT undo
-- the reversing entries that were posted while the forward migration was in
-- force. Those are real postings. Removing them would be the precise thing the
-- forward migration exists to prevent, and would leave the ledger stating
-- something that never happened.
--
-- So: rolling back returns the CODE to its previous state. It does not return
-- the DATA to its previous state, because the data is a ledger. If reversals
-- were posted in error, correct them forward with fn_reverse_entry before
-- rolling back, and agree the resulting balances.
--
-- The added columns are left in place. They hold real attribution that would
-- otherwise be lost, they are additive, and nothing breaks by their presence.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Stop refusing deletes.
DROP TRIGGER IF EXISTS trg_block_journal_entry_delete ON public.journal_entries;
DROP TRIGGER IF EXISTS trg_block_journal_line_delete  ON public.journal_lines;
DROP FUNCTION IF EXISTS public.fn_block_journal_delete();

-- 2. Restore the cascade the forward migration relaxed.
ALTER TABLE public.journal_lines
  DROP CONSTRAINT IF EXISTS journal_lines_entry_id_fkey;
ALTER TABLE public.journal_lines
  ADD CONSTRAINT journal_lines_entry_id_fkey
  FOREIGN KEY (entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;

-- 3. Release the one-live-entry-per-source constraint.
DROP INDEX IF EXISTS public.uq_journal_live_entry_per_source;

-- 4. Restore the previous, destructive posters verbatim.
CREATE OR REPLACE FUNCTION public.fn_unpost(p_source_type text, p_source_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.journal_entries WHERE source_type = p_source_type AND source_id = p_source_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_post_entry(
  p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eid uuid; ln jsonb;
BEGIN
  DELETE FROM public.journal_entries WHERE source_type = p_source_type AND source_id = p_source_id;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN RETURN; END IF;

  INSERT INTO public.journal_entries (entry_date, memo, source_type, source_id)
  VALUES (p_date, p_memo, p_source_type, p_source_id)
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

-- 5. Stock movement attribution trigger.
DROP TRIGGER IF EXISTS trg_stamp_movement_actor ON public.inventory_movements;
DROP FUNCTION IF EXISTS public.fn_stamp_movement_actor();

-- fn_reverse_entry is left in place: it is additive, harmless when unused, and
-- is the tool you need if you are rolling back because something went wrong.

COMMIT;
