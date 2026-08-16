-- ─────────────────────────────────────────────────────────────────────────────
-- M-03 — Reverse the duplicate goods-receipt postings found by M-02
--
-- PRECONDITIONS, all of them:
--   1. A full database backup has been taken and its restore tested.
--   2. 20260816120000_phase1_append_only_journal.sql has been applied
--      (this script depends on fn_reverse_entry).
--   3. The Phase 1 application fix is deployed, so no NEW duplicates are being
--      created while this runs.
--   4. M-02 has been run and its section 4 total signed off by the finance lead.
--
-- This script posts REVERSING entries. It deletes nothing and amends nothing.
-- Each reversal references the entry it reverses via reversal_of_id, so the
-- original posting, the correction, and the reason all remain readable.
--
-- It is safe to re-run: fn_reverse_entry returns without acting on an entry
-- that is already reversed, and the driving view excludes reversed entries.
--
-- ROLLBACK: there is none, by design. See the note at the foot of this file.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Guard: refuse to run if the application fix is not yet deployed ──────────
-- If receipts are still creating expense rows, reversing now just means doing
-- this again next week. This checks for a receipt-linked expense created in the
-- last 24 hours, which should be impossible post-fix.
DO $$
DECLARE recent int;
BEGIN
  SELECT count(*) INTO recent
  FROM public.lpo_receipts r
  JOIN public.expenses e ON e.id = r.expense_id
  WHERE e.created_at > now() - interval '24 hours';

  IF recent > 0 THEN
    RAISE EXCEPTION
      'Refusing to run M-03: % receipt-linked expense row(s) were created in the last 24 hours, so the application is still generating duplicates. Deploy the Phase 1 fix to ReceiveGoodsDialog first.', recent;
  END IF;
END $$;

-- ── Before ───────────────────────────────────────────────────────────────────
DO $$
DECLARE d numeric; c numeric; n int; amt numeric;
BEGIN
  SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO d, c FROM public.journal_lines;
  SELECT count(*), COALESCE(sum(amount),0) INTO n, amt FROM public.v_m02_duplicate_receipt_postings;
  RAISE NOTICE 'BEFORE  ledger debits=% credits=% difference=%', d, c, d - c;
  RAISE NOTICE 'BEFORE  entries to reverse=% totalling=%', n, amt;
END $$;

-- ── Reverse ──────────────────────────────────────────────────────────────────
DO $$
DECLARE r record; rid uuid; n int := 0;
BEGIN
  FOR r IN SELECT entry_id, entry_no, receipt_number FROM public.v_m02_duplicate_receipt_postings ORDER BY entry_no
  LOOP
    rid := public.fn_reverse_entry(
      r.entry_id,
      'M-03: duplicate posting on goods receipt ' || COALESCE(r.receipt_number, '?') ||
      ' — purchase was already capitalised to inventory and had not been paid'
    );
    IF rid IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RAISE NOTICE 'REVERSED % entries', n;
END $$;

-- ── Sever the link that caused it ────────────────────────────────────────────
-- The expense rows themselves are NOT deleted — they are financial records and
-- some may carry notes or attachments. They are flagged and unlinked so they
-- cannot be mistaken for live purchase costs, and so that re-running M-02 shows
-- a clean list.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS voided_at     timestamptz,
  ADD COLUMN IF NOT EXISTS voided_reason text;

UPDATE public.expenses e
SET voided_at = now(),
    voided_reason = 'M-03: duplicate of a capitalised goods receipt; reversed, not a cost'
FROM public.lpo_receipts r
WHERE r.expense_id = e.id
  AND e.voided_at IS NULL;

-- ── After ────────────────────────────────────────────────────────────────────
DO $$
DECLARE d numeric; c numeric;
BEGIN
  SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO d, c FROM public.journal_lines;
  RAISE NOTICE 'AFTER   ledger debits=% credits=% difference=%', d, c, d - c;
  RAISE NOTICE 'NOTE    the ledger difference is NOT expected to reach zero here.';
  RAISE NOTICE 'NOTE    reversals are balanced, so they move account balances, not the';
  RAISE NOTICE 'NOTE    debit/credit totals. The trial balance difference is closed by';
  RAISE NOTICE 'NOTE    M-06 (opening equity) once M-04 and M-05 have been agreed.';
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- On rollback
--
-- There is deliberately no down script. Every row this wrote is a journal entry
-- or a flag on an expense. Deleting a posted reversal is the exact act the
-- append-only migration exists to prevent, and it would leave the ledger
-- asserting a set of transactions that did not occur.
--
-- If this script reversed something it should not have, correct it forward:
-- reverse the reversal, which restores the original's effect and leaves all
-- three postings on the record.
--
--   SELECT public.fn_reverse_entry(
--     '<the reversing entry id>',
--     'M-03 reversed this in error — restoring original effect'
--   );
--
-- The backup taken in precondition 1 is the only route back to the prior state,
-- and using it discards everything posted since. That is a finance decision,
-- not an engineering one.
-- ─────────────────────────────────────────────────────────────────────────────
