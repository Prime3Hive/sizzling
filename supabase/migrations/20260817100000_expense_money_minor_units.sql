-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 — money as integer minor units (kobo).
--
-- Fixes E-01. Amounts were numeric and were read out of the browser with
-- parseFloat() on an <input type="number"> value the browser had already
-- localised, so "922,340" typed on a comma-decimal device was stored as 922.34.
--
-- Strategy (agreed): amount_minor BIGINT becomes the source of truth and
-- `amount` becomes a GENERATED column derived from it, so the ~15 existing
-- readers and the four posting functions keep working untouched while every
-- writer moves to amount_minor.
--
-- NOTE FOR DEPLOYMENT: once `amount` is generated it can no longer be written.
-- Ship this together with the application changes in the same release; an old
-- client inserting `amount` will get "cannot insert into generated column".
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 0. Preconditions ────────────────────────────────────────────────────────
-- This migration sits on top of several earlier ones. The live database has
-- been observed to be BEHIND this folder (running the M-02 diagnostic failed
-- with "column e.cancelled_at does not exist"), and these files are applied by
-- hand in the SQL editor, so drift is likely.
--
-- Rather than half-apply and leave the schema in a state nobody can reason
-- about, stop immediately and name exactly what is missing. Run
-- sql/M-00-schema-probe.sql to see the full picture, apply the migrations it
-- reports as MISSING in filename order, then run this again.

DO $precheck$
DECLARE
  missing text[] := '{}';
BEGIN
  -- Columns this file reads or filters on.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'status'
  ) THEN
    missing := missing || 'expenses.status — apply 20260723110000_phase2_wht_vat_expense_approval.sql';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'expenses' AND column_name = 'cancelled_at'
  ) THEN
    missing := missing || 'expenses.cancelled_at — apply 20260816130000_phase1_no_delete_financial_records.sql';
  END IF;

  -- Tables this migration set depends on.
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'payables') THEN
    missing := missing || 'table payables — apply 20260616120000_staff_reports.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'staff_reports') THEN
    missing := missing || 'table staff_reports — apply 20260616120000_staff_reports.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'chart_of_accounts') THEN
    missing := missing || 'table chart_of_accounts — apply 20260608120000_double_entry_accounting.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'period_locks') THEN
    missing := missing || 'table period_locks — apply 20260723102000_period_locks_audit_log.sql';
  END IF;

  -- Functions the posting migration calls or replaces.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'fn_post_entry') THEN
    missing := missing || 'function fn_post_entry — apply 20260609120000_auto_post_journals.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'fn_books_locked') THEN
    missing := missing || 'function fn_books_locked — apply 20260723102000_period_locks_audit_log.sql';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'is_admin') THEN
    missing := missing || 'function is_admin — required by the RLS policies in 20260817110000';
  END IF;

  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION E'The database is behind this migration folder. Nothing has been changed.\n\nMissing:\n  - %\n\nRun sql/M-00-schema-probe.sql for the full picture, apply the files named above in filename order, then re-run this migration.',
      array_to_string(missing, E'\n  - ');
  END IF;
END
$precheck$;

-- ── 1. expenses ─────────────────────────────────────────────────────────────

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS amount_minor bigint;

-- Backfill from the existing numeric column, rounding to the nearest kobo.
-- This preserves whatever is currently stored, including the corrupted rows —
-- correcting those is migration M-03 and is a human job against the receipts,
-- not something to guess at here (the factor is not always 1000).
UPDATE public.expenses
   SET amount_minor = round(amount * 100)::bigint
 WHERE amount_minor IS NULL;

ALTER TABLE public.expenses ALTER COLUMN amount_minor SET NOT NULL;

-- NOT VALID is deliberate. These constraints must bind every NEW write, but
-- the existing rows are the corrupted ones this whole exercise is about — a
-- zero or absurdly large amount already in the table is a finding for M-03,
-- not a reason for the migration to abort.
--
-- Once M-03 has re-captured the flagged records, run:
--   ALTER TABLE public.expenses VALIDATE CONSTRAINT expenses_amount_minor_positive;
--   ALTER TABLE public.expenses VALIDATE CONSTRAINT expenses_amount_minor_ceiling;
-- Each will name the first row that still violates it.
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_amount_minor_positive CHECK (amount_minor > 0) NOT VALID,
  -- Ceiling for review, ₦50,000,000 (section 12 default).
  ADD CONSTRAINT expenses_amount_minor_ceiling CHECK (amount_minor <= 5000000000) NOT VALID;

-- Report what would have failed, so the number is known now rather than at
-- VALIDATE time.
DO $report$
DECLARE n_zero bigint; n_big bigint;
BEGIN
  SELECT COUNT(*) INTO n_zero FROM public.expenses WHERE amount_minor <= 0;
  SELECT COUNT(*) INTO n_big  FROM public.expenses WHERE amount_minor > 5000000000;
  IF n_zero > 0 OR n_big > 0 THEN
    RAISE NOTICE 'Grandfathered rows: % with a non-positive amount, % above the ₦50,000,000 ceiling. These need M-03 before the constraints can be validated.', n_zero, n_big;
  END IF;
END
$report$;

-- The view below reads e.amount, so it has to come down before the column
-- can be swapped, and go back up afterwards.
DROP VIEW IF EXISTS public.budget_summary;

ALTER TABLE public.expenses DROP COLUMN amount;
ALTER TABLE public.expenses
  ADD COLUMN amount numeric GENERATED ALWAYS AS (amount_minor / 100.0) STORED;

COMMENT ON COLUMN public.expenses.amount_minor IS
  'Authoritative amount, in kobo. Write this, never `amount`.';
COMMENT ON COLUMN public.expenses.amount IS
  'Read-only naira view of amount_minor, kept for existing readers. Generated.';

-- Rebuild budget_summary. Two corrections while it is down: a cancelled
-- expense and a rejected one must not count towards a budget's spend.
CREATE VIEW public.budget_summary WITH (security_invoker = true) AS
SELECT
  b.id,
  b.title,
  b.type,
  b.total_budget,
  b.start_date,
  b.end_date,
  b.created_at,
  b.updated_at,
  b.user_id,
  COALESCE(SUM(e.amount), 0) AS total_spent,
  COUNT(e.id) AS expense_count,
  b.total_budget - COALESCE(SUM(e.amount), 0) AS remaining_budget,
  CASE WHEN b.total_budget > 0
       THEN ROUND((COALESCE(SUM(e.amount), 0) / b.total_budget) * 100, 2)
       ELSE 0 END AS percentage_used,
  CASE WHEN COALESCE(SUM(e.amount), 0) > b.total_budget THEN true ELSE false END AS is_overspent
FROM public.budgets b
LEFT JOIN public.expenses e
       ON e.budget_id = b.id
      AND e.cancelled_at IS NULL
      AND COALESCE(e.status, 'approved') = 'approved'
GROUP BY b.id, b.title, b.type, b.total_budget, b.start_date, b.end_date,
         b.created_at, b.updated_at, b.user_id;

GRANT SELECT ON public.budget_summary TO authenticated;

-- ── 2. payables ─────────────────────────────────────────────────────────────
-- The credit register carries the same corruption risk and the same readers.

ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS amount_minor bigint;

UPDATE public.payables
   SET amount_minor = round(amount * 100)::bigint
 WHERE amount_minor IS NULL;

ALTER TABLE public.payables ALTER COLUMN amount_minor SET NOT NULL;

-- NOT VALID for the same reason as above; validate after M-03.
ALTER TABLE public.payables
  ADD CONSTRAINT payables_amount_minor_positive CHECK (amount_minor > 0) NOT VALID;

ALTER TABLE public.payables DROP CONSTRAINT IF EXISTS payables_amount_check;
ALTER TABLE public.payables DROP COLUMN amount;
ALTER TABLE public.payables
  ADD COLUMN amount numeric GENERATED ALWAYS AS (amount_minor / 100.0) STORED;

COMMENT ON COLUMN public.payables.amount_minor IS
  'Authoritative amount, in kobo. Write this, never `amount`.';

-- ── 3. staff_reports ────────────────────────────────────────────────────────
-- A staff report carries a headline amount and JSON expense lines. The
-- headline gets a minor-unit column; the JSON lines are restructured into
-- expense_line rows by the next migration.

ALTER TABLE public.staff_reports ADD COLUMN IF NOT EXISTS amount_minor bigint;

UPDATE public.staff_reports
   SET amount_minor = round(amount * 100)::bigint
 WHERE amount_minor IS NULL AND amount IS NOT NULL;

COMMENT ON COLUMN public.staff_reports.amount_minor IS
  'Authoritative amount, in kobo. `amount` is retained for legacy readers.';

-- ── 4. Flag the records that need human re-capture (migration M-02) ─────────
-- Identified, never auto-corrected. See sql/M-02-suspect-amounts.sql for the
-- report, and the correction screen for M-03.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS amount_suspect boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS amount_corrected_from bigint,
  ADD COLUMN IF NOT EXISTS amount_corrected_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS amount_corrected_at timestamptz;

COMMENT ON COLUMN public.expenses.amount_suspect IS
  'Set by the M-02 sweep: the description mentions a figure at least 100x the '
  'stored amount, so the amount is probably the parser defect (E-01).';

-- Mark them. Uses the same 100x rule as the application-side implausibility
-- check so the two never disagree.
UPDATE public.expenses e
   SET amount_suspect = true
 WHERE e.cancelled_at IS NULL
   AND EXISTS (
     SELECT 1
       FROM regexp_matches(COALESCE(e.description, ''), '\d[\d,]*(?:\.\d+)?', 'g') AS m(tok)
      WHERE replace(tok[1], ',', '')::numeric >= (e.amount_minor / 100.0) * 100
   );

COMMIT;
