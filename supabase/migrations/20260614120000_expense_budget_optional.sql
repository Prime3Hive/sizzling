-- Expenses no longer require a budget. Bulk entry and approved expense-reports
-- can record an expense without forcing a budget allocation; a budget can still
-- be chosen when relevant.
ALTER TABLE public.expenses ALTER COLUMN budget_id DROP NOT NULL;
