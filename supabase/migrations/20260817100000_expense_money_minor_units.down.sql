-- Reverse of 20260817100000_expense_money_minor_units.sql.
-- Restores `amount` as a plain writable numeric column and drops the minor-unit
-- columns. No data is lost: amount is regenerated from amount_minor first.

BEGIN;

DROP VIEW IF EXISTS public.budget_summary;

-- ── expenses ────────────────────────────────────────────────────────────────
ALTER TABLE public.expenses DROP COLUMN IF EXISTS amount;
ALTER TABLE public.expenses ADD COLUMN amount numeric;
UPDATE public.expenses SET amount = amount_minor / 100.0;
ALTER TABLE public.expenses ALTER COLUMN amount SET NOT NULL;

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_amount_minor_positive,
  DROP CONSTRAINT IF EXISTS expenses_amount_minor_ceiling;

ALTER TABLE public.expenses
  DROP COLUMN IF EXISTS amount_minor,
  DROP COLUMN IF EXISTS amount_suspect,
  DROP COLUMN IF EXISTS amount_corrected_from,
  DROP COLUMN IF EXISTS amount_corrected_by,
  DROP COLUMN IF EXISTS amount_corrected_at;

-- ── payables ────────────────────────────────────────────────────────────────
ALTER TABLE public.payables DROP COLUMN IF EXISTS amount;
ALTER TABLE public.payables ADD COLUMN amount numeric;
UPDATE public.payables SET amount = amount_minor / 100.0;
ALTER TABLE public.payables ALTER COLUMN amount SET NOT NULL;
ALTER TABLE public.payables ADD CONSTRAINT payables_amount_check CHECK (amount > 0);

ALTER TABLE public.payables
  DROP CONSTRAINT IF EXISTS payables_amount_minor_positive;
ALTER TABLE public.payables DROP COLUMN IF EXISTS amount_minor;

-- ── staff_reports ───────────────────────────────────────────────────────────
ALTER TABLE public.staff_reports DROP COLUMN IF EXISTS amount_minor;

-- ── budget_summary, as it was ───────────────────────────────────────────────
CREATE VIEW public.budget_summary WITH (security_invoker = true) AS
SELECT
  b.id, b.title, b.type, b.total_budget, b.start_date, b.end_date,
  b.created_at, b.updated_at, b.user_id,
  COALESCE(SUM(e.amount), 0) AS total_spent,
  COUNT(e.id) AS expense_count,
  b.total_budget - COALESCE(SUM(e.amount), 0) AS remaining_budget,
  CASE WHEN b.total_budget > 0
       THEN ROUND((COALESCE(SUM(e.amount), 0) / b.total_budget) * 100, 2)
       ELSE 0 END AS percentage_used,
  CASE WHEN COALESCE(SUM(e.amount), 0) > b.total_budget THEN true ELSE false END AS is_overspent
FROM public.budgets b
LEFT JOIN public.expenses e ON e.budget_id = b.id
GROUP BY b.id, b.title, b.type, b.total_budget, b.start_date, b.end_date,
         b.created_at, b.updated_at, b.user_id;

GRANT SELECT ON public.budget_summary TO authenticated;

COMMIT;
