-- ═════════════════════════════════════════════════════════════════════════════
-- M-00b — which of the four expense migrations have actually applied?
--
-- READ-ONLY, one statement, catalogue views only. Run it whole.
--
-- Use this after a partial failure to see exactly where the chain stopped, so
-- you resume from the right file instead of re-running one that already ran.
-- ═════════════════════════════════════════════════════════════════════════════

WITH checks(step, migration, marker, applied) AS (
  VALUES
    (1, '20260817100000_expense_money_minor_units',
        'expenses.amount is a generated column',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'expenses'
                   AND column_name = 'amount' AND is_generated = 'ALWAYS')),

    (2, '20260817110000_expense_claims_and_lines',
        'table expense_line exists',
        EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'expense_line')),

    (3, '20260817120000_expense_posting_rules',
        'function fn_expense_credit_code exists',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'fn_expense_credit_code')),

    (4, '20260817130000_expense_server_validation',
        'table expense_settings exists',
        EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'expense_settings'))
)
SELECT
  step,
  migration,
  CASE WHEN applied THEN 'APPLIED' ELSE 'not applied' END AS state,
  marker AS checked_by,
  CASE
    WHEN applied THEN 'skip this file'
    ELSE 'run this file'
  END AS action
FROM checks
ORDER BY step;
