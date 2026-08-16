-- ─────────────────────────────────────────────────────────────────────────────
-- M-02 — Identify duplicate goods-receipt postings
--
-- READ-ONLY. This script changes nothing. It exists so that the list of
-- corrupt entries is agreed and printed BEFORE M-03 reverses anything.
--
-- Run it, export every result set, and have the finance lead sign the totals.
-- M-03 reverses exactly what section 4 returns and nothing else.
--
-- Background
-- ──────────
-- A goods receipt should raise one entry: Dr 1200 Inventory / Cr 2000 AP.
-- Until the Phase 1 application fix, ReceiveGoodsDialog also inserted a row
-- into `expenses` for the same receipt. That row tripped the expense
-- auto-poster, which raised a second entry — Dr 5000 COGS / Cr 1010 Bank —
-- charging the purchase to profit and crediting the bank for money that had
-- not been paid. Entry #792 against GRN-2026-3946 is the known example.
--
-- These duplicates are identifiable because the expense row that caused them
-- is still linked to its receipt through lpo_receipts.expense_id.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Scale of the problem ──────────────────────────────────────────────────
SELECT
  count(*)                                   AS receipts_with_expense,
  count(DISTINCT r.lpo_id)                   AS lpos_affected,
  min(r.received_date)                        AS earliest,
  max(r.received_date)                        AS latest,
  sum(e.amount)                               AS total_wrongly_expensed
FROM public.lpo_receipts r
JOIN public.expenses e ON e.id = r.expense_id
WHERE r.expense_id IS NOT NULL;

-- ── 2. The duplicate journal entries themselves ──────────────────────────────
-- One row per bogus entry, with the receipt that caused it.
SELECT
  je.entry_no,
  je.id                AS entry_id,
  je.entry_date,
  je.memo,
  r.receipt_number,
  l.lpo_number,
  r.received_date,
  e.amount             AS expense_amount,
  je.is_reversed,
  je.posted_by
FROM public.lpo_receipts r
JOIN public.expenses       e  ON e.id  = r.expense_id
JOIN public.journal_entries je ON je.source_type = 'expense' AND je.source_id = e.id
LEFT JOIN public.lpos      l  ON l.id  = r.lpo_id
WHERE r.expense_id IS NOT NULL
  AND je.reversal_of_id IS NULL
ORDER BY je.entry_no;

-- ── 3. Confirm the account signature before trusting the list ────────────────
-- Every entry in section 2 should debit 5000 and credit 1010. Anything with a
-- different shape is NOT a receipt duplicate and must be excluded from M-03 by
-- hand — investigate it separately rather than reversing it blind.
SELECT
  je.entry_no,
  a.code,
  a.name,
  jl.debit,
  jl.credit
FROM public.lpo_receipts r
JOIN public.expenses       e  ON e.id  = r.expense_id
JOIN public.journal_entries je ON je.source_type = 'expense' AND je.source_id = e.id
JOIN public.journal_lines  jl ON jl.entry_id = je.id
JOIN public.chart_of_accounts a ON a.id = jl.account_id
WHERE r.expense_id IS NOT NULL
  AND je.reversal_of_id IS NULL
ORDER BY je.entry_no, a.code;

-- ── 4. The reversal set — this is what M-03 will act on ──────────────────────
-- Restricted to entries with the exact Dr 5000 / Cr 1010 signature, still live.
-- Agree this total with the finance lead and keep the export.
CREATE OR REPLACE VIEW public.v_m02_duplicate_receipt_postings AS
SELECT DISTINCT
  je.id        AS entry_id,
  je.entry_no,
  je.entry_date,
  je.memo,
  r.receipt_number,
  e.amount
FROM public.lpo_receipts r
JOIN public.expenses       e  ON e.id  = r.expense_id
JOIN public.journal_entries je ON je.source_type = 'expense' AND je.source_id = e.id
WHERE r.expense_id IS NOT NULL
  AND je.reversal_of_id IS NULL
  AND je.is_reversed = false
  AND EXISTS (
    SELECT 1 FROM public.journal_lines jl
    JOIN public.chart_of_accounts a ON a.id = jl.account_id
    WHERE jl.entry_id = je.id AND a.code = '5000' AND jl.debit > 0
  )
  AND EXISTS (
    SELECT 1 FROM public.journal_lines jl
    JOIN public.chart_of_accounts a ON a.id = jl.account_id
    WHERE jl.entry_id = je.id AND a.code = '1010' AND jl.credit > 0
  );

SELECT count(*) AS entries_to_reverse, sum(amount) AS total_to_reverse
FROM public.v_m02_duplicate_receipt_postings;

SELECT * FROM public.v_m02_duplicate_receipt_postings ORDER BY entry_no;

-- ── 5. Anything that looks like a receipt duplicate but is not linked ────────
-- Expenses whose description carries a GRN reference but which no receipt
-- points at. These will NOT be picked up by M-03 and need eyes on them.
SELECT
  e.id, e.date, e.amount, e.description, e.category
FROM public.expenses e
WHERE e.description ILIKE '%GRN-%'
  AND NOT EXISTS (SELECT 1 FROM public.lpo_receipts r WHERE r.expense_id = e.id)
ORDER BY e.date;
