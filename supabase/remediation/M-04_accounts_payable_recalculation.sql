-- ─────────────────────────────────────────────────────────────────────────────
-- M-04 — Recalculate Accounts Payable (2000) from the corrected journal
--
-- READ-ONLY. Changes nothing.
--
-- Run AFTER M-03. The output is for manual agreement against a supplier
-- statement listing. Do not accept the balance because the query produced it —
-- accept it because a supplier agrees with it.
--
-- Why this needs doing at all: until Phase 1, a goods receipt credited 2000 and
-- a separate manual journal debited it back out, so 2000 routinely netted to
-- zero and was dropped from the trial balance entirely. The balance below is
-- the first one computed from a journal that only credits AP where a real
-- liability was incurred.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The headline balance ──────────────────────────────────────────────────
SELECT
  a.code,
  a.name,
  SUM(jl.credit)              AS total_credited,
  SUM(jl.debit)               AS total_debited,
  SUM(jl.credit - jl.debit)   AS closing_balance
FROM public.journal_lines jl
JOIN public.chart_of_accounts a ON a.id = jl.account_id
JOIN public.journal_entries  je ON je.id = jl.entry_id
WHERE a.code = '2000'
GROUP BY a.code, a.name;

-- ── 2. Movement by source, so the balance can be explained ───────────────────
SELECT
  je.source_type,
  count(*)                    AS entries,
  SUM(jl.credit)              AS credited,
  SUM(jl.debit)               AS debited,
  SUM(jl.credit - jl.debit)   AS net
FROM public.journal_lines jl
JOIN public.chart_of_accounts a ON a.id = jl.account_id
JOIN public.journal_entries  je ON je.id = jl.entry_id
WHERE a.code = '2000'
GROUP BY je.source_type
ORDER BY abs(SUM(jl.credit - jl.debit)) DESC;

-- ── 3. Open payables by supplier ─────────────────────────────────────────────
-- This is the listing to send out for agreement. A supplier whose balance here
-- disagrees with their own statement is the point of the exercise.
SELECT
  COALESCE(l.supplier_name, '(no supplier on the order)') AS supplier,
  count(DISTINCT r.id)                                     AS receipts,
  SUM(jl.credit - jl.debit)                                AS balance_owed
FROM public.journal_lines jl
JOIN public.chart_of_accounts a  ON a.id = jl.account_id
JOIN public.journal_entries  je  ON je.id = jl.entry_id
LEFT JOIN public.lpo_receipt_items ri ON ri.id = je.source_id AND je.source_type = 'inventory_purchase'
LEFT JOIN public.lpo_receipts      r  ON r.id  = ri.receipt_id
LEFT JOIN public.lpos              l  ON l.id  = r.lpo_id
WHERE a.code = '2000'
GROUP BY COALESCE(l.supplier_name, '(no supplier on the order)')
HAVING abs(SUM(jl.credit - jl.debit)) > 0.005
ORDER BY SUM(jl.credit - jl.debit) DESC;

-- ── 4. Entries that touch 2000 but are not receipts or payments ──────────────
-- Anything appearing here was posted by hand. Entry #795 in the audit was of
-- this kind: a manual Dr 2000 / Cr 1010 that settled a payable no one had paid.
-- Each one needs an explanation before the balance is signed off.
SELECT
  je.entry_no,
  je.entry_date,
  je.source_type,
  je.memo,
  je.posted_by,
  jl.debit,
  jl.credit,
  je.is_reversed
FROM public.journal_lines jl
JOIN public.chart_of_accounts a ON a.id = jl.account_id
JOIN public.journal_entries  je ON je.id = jl.entry_id
WHERE a.code = '2000'
  AND je.source_type NOT IN ('inventory_purchase', 'expense', 'payable_settlement')
ORDER BY je.entry_date, je.entry_no;

-- ── 5. Receipts with no matching payable ─────────────────────────────────────
-- A receipt that capitalised stock but raised no liability means someone was
-- never going to be paid for goods this business took delivery of.
SELECT
  r.receipt_number,
  r.received_date,
  l.supplier_name,
  r.total_received_amount
FROM public.lpo_receipts r
LEFT JOIN public.lpos l ON l.id = r.lpo_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.lpo_receipt_items ri
  JOIN public.journal_entries je ON je.source_type = 'inventory_purchase' AND je.source_id = ri.id
  WHERE ri.receipt_id = r.id
)
ORDER BY r.received_date;
