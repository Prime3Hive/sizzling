-- ═════════════════════════════════════════════════════════════════════════════
-- M-00 — what is actually in the database?
--
-- READ-ONLY, and it touches no application table at all — only catalogue views.
--
-- ⚠ THE SUPABASE SQL EDITOR ONLY SHOWS THE LAST STATEMENT IN A SCRIPT.
-- This file holds four queries (A-D), so running it whole displays Query D
-- only. To see A, B or C, select that query'''s text with the mouse and run just
-- the selection.
--
-- Why this exists: `sql/M-02-suspect-amounts.sql` failed with
--   ERROR: column e.cancelled_at does not exist
-- That column is added by 20260816130000_phase1_no_delete_financial_records.sql,
-- so the live database is behind the repository's migration folder. The four
-- 20260817* expense migrations sit on top of that one, so we need to know
-- exactly which of the earlier ones have actually been applied before running
-- anything.
-- ═════════════════════════════════════════════════════════════════════════════


-- ── Query A. Which columns exist on the money tables ────────────────────────
-- Each row names a column a migration was supposed to add, and says whether it
-- is there. "MISSING" means the migration in the last column has not run.

WITH expected(tbl, col, added_by) AS (
  VALUES
    -- 20260723110000_phase2_wht_vat_expense_approval.sql
    ('expenses',      'status',                'phase2 maker-checker (20260723110000)'),
    ('expenses',      'approved_by',           'phase2 maker-checker (20260723110000)'),
    ('expenses',      'approved_at',           'phase2 maker-checker (20260723110000)'),
    -- 20260816130000_phase1_no_delete_financial_records.sql
    -- Note: that migration covers expenses, sales, payroll_records and
    -- njc_supplies. It does NOT touch payables.
    ('expenses',        'cancelled_at',        'no-delete records (20260816130000)'),
    ('expenses',        'cancelled_by',        'no-delete records (20260816130000)'),
    ('expenses',        'cancellation_reason', 'no-delete records (20260816130000)'),
    ('sales',           'cancelled_at',        'no-delete records (20260816130000)'),
    ('payroll_records', 'cancelled_at',        'no-delete records (20260816130000)'),
    ('njc_supplies',    'cancelled_at',        'no-delete records (20260816130000)'),
    -- 20260817100000_expense_money_minor_units.sql  (this delivery)
    ('expenses',      'amount_minor',          'money in kobo (20260817100000)'),
    ('expenses',      'amount_suspect',        'money in kobo (20260817100000)'),
    ('payables',      'amount_minor',          'money in kobo (20260817100000)'),
    ('staff_reports', 'amount_minor',          'money in kobo (20260817100000)'),
    -- 20260817110000_expense_claims_and_lines.sql   (this delivery)
    ('expenses',      'category_id',           'claims and lines (20260817110000)'),
    ('expenses',      'payee_id',              'claims and lines (20260817110000)'),
    ('expenses',      'expense_account_code',  'claims and lines (20260817110000)'),
    ('expenses',      'vat_minor',             'claims and lines (20260817110000)'),
    ('expenses',      'submitted_by',          'claims and lines (20260817110000)')
)
SELECT
  e.tbl                AS table_name,
  e.col                AS column_name,
  CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE 'present' END AS state,
  c.data_type,
  c.is_generated,
  e.added_by
FROM expected e
LEFT JOIN information_schema.columns c
       ON c.table_schema = 'public'
      AND c.table_name   = e.tbl
      AND c.column_name  = e.col
ORDER BY e.added_by, e.tbl, e.col;


-- ── Query B. Which of the expected tables exist ─────────────────────────────

WITH expected(tbl, added_by) AS (
  VALUES
    ('expenses',                   'original schema'),
    ('budgets',                    'original schema'),
    ('chart_of_accounts',          'double-entry (20260608120000)'),
    ('journal_entries',            'double-entry (20260608120000)'),
    ('journal_lines',              'double-entry (20260608120000)'),
    ('bank_accounts',              'bank accounts (20260602100000)'),
    ('staff_reports',              'staff reports (20260616120000)'),
    ('payables',                   'staff reports (20260616120000)'),
    ('period_locks',               'period locks (20260723102000)'),
    ('audit_log',                  'period locks (20260723102000)'),
    ('expense_categories',         'claims and lines (20260817110000)'),
    ('cost_centres',               'claims and lines (20260817110000)'),
    ('payees',                     'claims and lines (20260817110000)'),
    ('expense_receipts',           'claims and lines (20260817110000)'),
    ('expense_claim',              'claims and lines (20260817110000)'),
    ('expense_line',               'claims and lines (20260817110000)'),
    ('expense_category_migration', 'claims and lines (20260817110000)'),
    ('expense_settings',           'server validation (20260817130000)')
)
SELECT
  e.tbl AS table_name,
  CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'present' END AS state,
  e.added_by
FROM expected e
LEFT JOIN information_schema.tables t
       ON t.table_schema = 'public'
      AND t.table_name   = e.tbl
ORDER BY e.added_by, e.tbl;


-- ── Query C. Which functions exist ─────────────────────────────────────────
-- Confirms whether the posting and guard layers are in place.

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'fn_post_expense', 'fn_post_entry', 'fn_unpost', 'fn_cash_acct',
    'fn_books_locked', 'is_admin',
    'fn_expense_credit_code', 'fn_post_payable_settlement',
    'fn_validate_expense_amounts', 'fn_clean_text', 'fn_post_expense_claim'
  )
ORDER BY p.proname;


-- ── Query D. Every column on `expenses`, for the avoidance of doubt ─────────

SELECT ordinal_position, column_name, data_type, is_nullable, is_generated, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'expenses'
ORDER BY ordinal_position;
