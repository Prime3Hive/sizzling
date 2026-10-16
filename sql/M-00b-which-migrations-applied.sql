-- ═════════════════════════════════════════════════════════════════════════════
-- M-00b — which migrations have actually applied?
--
-- READ-ONLY, one statement, catalogue views only. Run it whole.
--
-- Every row tells you APPLIED or not, and the `action` column tells you what to
-- do. Work down the list in `step` order and run whatever says "RUN THIS".
--
-- Covers everything from 2026-08-16 onward: the two records-integrity
-- migrations, the four expense migrations, the two expense fixes, the
-- stock-issue costing migration, attendance, the two security migrations,
-- staff exit, and staff sales commission.
-- ═════════════════════════════════════════════════════════════════════════════

WITH checks(step, migration, what_it_does, marker, applied) AS (
  VALUES
    (1, '20260816120000_phase1_append_only_journal',
        'Journals are appended and reversed, never rewritten',
        'function fn_reverse_entry',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'fn_reverse_entry')),

    (2, '20260816130000_phase1_no_delete_financial_records',
        'Financial records are cancelled, never deleted',
        'expenses.cancelled_at',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'expenses'
                   AND column_name = 'cancelled_at')),

    (3, '20260817100000_expense_money_minor_units',
        'Money stored as integer kobo; amount becomes derived',
        'expenses.amount is a generated column',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'expenses'
                   AND column_name = 'amount' AND is_generated = 'ALWAYS')),

    (4, '20260817110000_expense_claims_and_lines',
        'One purchase is one row; controlled categories and payees',
        'table expense_line',
        EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'expense_line')),

    (5, '20260817120000_expense_posting_rules',
        'Credit leg follows the payment method; account per line',
        'function fn_expense_credit_code',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'fn_expense_credit_code')),

    (6, '20260817130000_expense_server_validation',
        'Server-side validation triggers',
        'table expense_settings',
        EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'expense_settings')),

    (7, '20260818100000_expense_capture_rules_by_source',
        'FIXES the blocked approvals: capture rules apply only to typed rows',
        'expenses.source',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'expenses'
                   AND column_name = 'source')),

    (8, '20260818110000_expense_source_report_link',
        'Corrections screen can open the report behind a row',
        'expenses.source_report_id',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'expenses'
                   AND column_name = 'source_report_id')),

    (9, '20260819100000_phase1_cogs_on_stock_issue',
        'Cost recognised when stock is issued, not only when invoiced',
        'function fn_post_stock_movement',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'fn_post_stock_movement')),

    (10, '20260821100000_attendance',
        'HR marks attendance weekly; admin approves it onto the staff portal',
        'table attendance_records',
        EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'attendance_records')),

    (11, '20260922100000_revoke_anon_table_access',
        'Signed-out visitors can no longer read or call anything in public',
        'anon cannot SELECT staff_profiles',
        NOT has_table_privilege('anon', 'public.staff_profiles', 'SELECT')),

    (12, '20260922110000_public_form_rate_limit',
        'Rate limit on the public contact form',
        'table public_form_hits',
        EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'public_form_hits')),

    (13, '20260926100000_staff_exit_status',
        'Archive staff who have left instead of deleting them',
        'staff_profiles.employment_status',
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'staff_profiles'
                   AND column_name = 'employment_status')),

    (14, '20260930100000_staff_commission',
        'Sales commission from staff sales reports; accrued to 5120/2350, paid via payroll (needs step 13)',
        'table commission_settings',
        EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'commission_settings')),

    (15, '20261016100000_inventory_negative_stock',
        'Inventory setup: negative-stock toggle + alert, multi-item stock movements',
        'table inventory_settings',
        EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'inventory_settings')),

    (16, '20261017100000_inventory_finance_fixes',
        'Inventory/finance audit fixes: invoice cancel, stock-in reclass, moving-average cost (needs step 15)',
        'function set_product_cost',
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'set_product_cost'))
)
SELECT
  step,
  CASE WHEN applied THEN 'APPLIED' ELSE '>>> RUN THIS' END AS action,
  migration,
  what_it_does,
  marker AS checked_by
FROM checks
ORDER BY step;
