-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK for 20260816130000_phase1_no_delete_financial_records.sql
--
-- Restores the ability to hard-delete expenses, sales, payroll records and NJC
-- invoices. Understand what that means before running it: it is the finding the
-- migration was written to close.
--
-- The cancellation columns are LEFT IN PLACE. They hold who cancelled what and
-- why — real information, recorded by people, that exists nowhere else. Dropping
-- them to tidy up a rollback would destroy it.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses', 'sales', 'payroll_records', 'njc_supplies']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_block_delete_%s    ON public.%I', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_stamp_canceller_%s ON public.%I', t, t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_unpost_expense_on_cancel ON public.expenses;
DROP TRIGGER IF EXISTS trg_unpost_sale_on_cancel    ON public.sales;
DROP TRIGGER IF EXISTS trg_unpost_payroll_on_cancel ON public.payroll_records;

DROP FUNCTION IF EXISTS public.fn_block_financial_delete();
DROP FUNCTION IF EXISTS public.fn_unpost_on_cancel();
DROP FUNCTION IF EXISTS public.fn_stamp_canceller();

-- The "cancellation must state a reason" constraint goes with the feature.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses', 'sales', 'payroll_records', 'njc_supplies']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
                   t, t || '_cancellation_complete');
  END LOOP;
END $$;

COMMIT;
