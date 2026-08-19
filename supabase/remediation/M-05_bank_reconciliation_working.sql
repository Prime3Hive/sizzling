-- ─────────────────────────────────────────────────────────────────────────────
-- M-05 — Bank (1010) reconciliation working
--
-- READ-ONLY. Changes nothing.
--
-- Run AFTER M-03. Produces the working that explains how account 1010 got to a
-- credit balance of 71,829,649.47, and how much of that the M-03 reversals
-- account for.
--
-- The expectation going in: the duplicate receipt postings each credited Bank
-- for a purchase that had not been paid, so a large share of that credit
-- balance is not an overdraft at all — it is money the ledger said had left the
-- bank when it never did. Section 3 is where that expectation gets tested.
--
-- This DIAGNOSES F-14. It does not close it. F-14 closes in Phase 4, when the
-- balance below has been agreed to an actual bank statement.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Where Bank stands now ─────────────────────────────────────────────────
SELECT
  a.code,
  a.name,
  SUM(jl.debit)               AS total_receipts,
  SUM(jl.credit)              AS total_payments,
  SUM(jl.debit - jl.credit)   AS closing_balance,
  CASE WHEN SUM(jl.debit - jl.credit) < 0
       THEN 'CREDIT — overdrawn per the ledger'
       ELSE 'DEBIT — funds per the ledger' END AS position
FROM public.journal_lines jl
JOIN public.chart_of_accounts a ON a.id = jl.account_id
WHERE a.code = '1010'
GROUP BY a.code, a.name;

-- ── 2. What moves Bank, by source ────────────────────────────────────────────
SELECT
  je.source_type,
  count(*)                    AS entries,
  SUM(jl.debit)               AS debits,
  SUM(jl.credit)              AS credits,
  SUM(jl.debit - jl.credit)   AS net
FROM public.journal_lines jl
JOIN public.chart_of_accounts a ON a.id = jl.account_id
JOIN public.journal_entries  je ON je.id = jl.entry_id
WHERE a.code = '1010'
GROUP BY je.source_type
ORDER BY abs(SUM(jl.debit - jl.credit)) DESC;

-- ── 3. The reconciling working ───────────────────────────────────────────────
-- Balance before the M-03 reversals, the effect of those reversals, and what
-- remains to be explained by a bank statement.
WITH bank AS (
  SELECT jl.debit, jl.credit, je.reversal_of_id, je.entry_date
  FROM public.journal_lines jl
  JOIN public.chart_of_accounts a ON a.id = jl.account_id
  JOIN public.journal_entries  je ON je.id = jl.entry_id
  WHERE a.code = '1010'
)
SELECT
  SUM(CASE WHEN reversal_of_id IS NULL THEN debit - credit ELSE 0 END)
    AS balance_before_reversals,
  SUM(CASE WHEN reversal_of_id IS NOT NULL THEN debit - credit ELSE 0 END)
    AS effect_of_m03_reversals,
  SUM(debit - credit)
    AS balance_after_reversals
FROM bank;

-- ── 4. Unreconciled bank lines ───────────────────────────────────────────────
-- Everything never ticked against a statement. This is the population that has
-- to be worked through before F-14 can be closed in Phase 4.
SELECT
  count(*)                                        AS unreconciled_lines,
  SUM(jl.debit)                                   AS unreconciled_debits,
  SUM(jl.credit)                                  AS unreconciled_credits,
  min(je.entry_date)                              AS oldest,
  max(je.entry_date)                              AS newest
FROM public.journal_lines jl
JOIN public.chart_of_accounts a ON a.id = jl.account_id
JOIN public.journal_entries  je ON je.id = jl.entry_id
WHERE a.code = '1010' AND jl.reconciled_at IS NULL;

-- ── 5. The largest unreconciled payments, biggest first ──────────────────────
-- Work this list top-down; the balance is usually explained by a handful of
-- large items long before the tail matters.
SELECT
  je.entry_no,
  je.entry_date,
  je.source_type,
  je.memo,
  jl.debit,
  jl.credit,
  je.posted_by
FROM public.journal_lines jl
JOIN public.chart_of_accounts a ON a.id = jl.account_id
JOIN public.journal_entries  je ON je.id = jl.entry_id
WHERE a.code = '1010'
  AND jl.reconciled_at IS NULL
ORDER BY GREATEST(jl.debit, jl.credit) DESC
LIMIT 100;

-- ── 6. Monthly movement, for a cash-flow sanity check ────────────────────────
SELECT
  date_trunc('month', je.entry_date)::date AS month,
  SUM(jl.debit)                            AS in_,
  SUM(jl.credit)                           AS out_,
  SUM(jl.debit - jl.credit)                AS net,
  SUM(SUM(jl.debit - jl.credit)) OVER (ORDER BY date_trunc('month', je.entry_date)) AS running_balance
FROM public.journal_lines jl
JOIN public.chart_of_accounts a ON a.id = jl.account_id
JOIN public.journal_entries  je ON je.id = jl.entry_id
WHERE a.code = '1010'
GROUP BY date_trunc('month', je.entry_date)
ORDER BY month;
