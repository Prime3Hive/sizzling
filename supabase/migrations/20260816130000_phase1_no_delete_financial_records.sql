-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 — Financial records cannot be deleted (R-23)
--
-- Four screens could erase a financial record outright:
--
--   Expenses          expenses.delete()          — including approved expenses
--   Weekly Sales      sales.delete()             — including posted revenue
--   Payroll           payroll_records.delete()   — including paid salaries
--   NJC Supplies      njc_supplies.delete()      — including settled invoices
--
-- The NJC one is the sharpest: a settled invoice, with payments recorded
-- against it, could be removed and its receivable would simply cease to exist.
--
-- Deletion is replaced by cancellation. The record stays, marked with who
-- cancelled it, when, and why. Its journal is reversed rather than vanishing
-- (the auto-posters already reverse on unpost since the append-only migration).
--
-- The block is a trigger, not a convention, so it holds for the UI, the API,
-- a service-role script and the SQL editor alike.
--
-- Ordering: run AFTER 20260816120000_phase1_append_only_journal.sql.
-- ROLLBACK: 20260816130000_phase1_no_delete_financial_records.down.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Cancellation columns ──────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses', 'sales', 'payroll_records', 'njc_supplies']
  LOOP
    EXECUTE format($f$
      ALTER TABLE public.%I
        ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz,
        ADD COLUMN IF NOT EXISTS cancelled_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS cancellation_reason text
    $f$, t);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_cancelled ON public.%I(cancelled_at)', t, t);
  END LOOP;
END $$;

-- A cancellation must say why. A blank reason is how an audit trail becomes
-- decoration.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses', 'sales', 'payroll_records', 'njc_supplies']
  LOOP
    EXECUTE format($f$
      ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I
    $f$, t, t || '_cancellation_complete');

    EXECUTE format($f$
      ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        cancelled_at IS NULL
        OR (cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')
      )
    $f$, t, t || '_cancellation_complete');
  END LOOP;
END $$;

-- ── 2. Refuse the delete ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_block_financial_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'A % record cannot be deleted. Cancel it instead: set cancelled_at, cancelled_by and cancellation_reason, so the record and the reason survive.',
    TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses', 'sales', 'payroll_records', 'njc_supplies']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_block_delete_%s ON public.%I', t, t);
    EXECUTE format($f$
      CREATE TRIGGER trg_block_delete_%s
        BEFORE DELETE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.fn_block_financial_delete()
    $f$, t, t);
  END LOOP;
END $$;

-- ── 3. Cancelling reverses the posting ───────────────────────────────────────
-- The auto-posters key off status and amount. A cancelled record must stop
-- contributing to the ledger, and the way it stops is a reversal, not a gap.
CREATE OR REPLACE FUNCTION public.fn_unpost_on_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL THEN
    PERFORM public.fn_unpost(TG_ARGV[0], NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unpost_expense_on_cancel ON public.expenses;
CREATE TRIGGER trg_unpost_expense_on_cancel
  AFTER UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_unpost_on_cancel('expense');

DROP TRIGGER IF EXISTS trg_unpost_sale_on_cancel ON public.sales;
CREATE TRIGGER trg_unpost_sale_on_cancel
  AFTER UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.fn_unpost_on_cancel('sale');

DROP TRIGGER IF EXISTS trg_unpost_payroll_on_cancel ON public.payroll_records;
CREATE TRIGGER trg_unpost_payroll_on_cancel
  AFTER UPDATE ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_unpost_on_cancel('payroll');

-- ── 4. Stamp the canceller ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_stamp_canceller()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL AND NEW.cancelled_by IS NULL THEN
    NEW.cancelled_by := auth.uid();
  END IF;
  -- Un-cancelling is not a correction, it is a cover-up. Post a fresh record.
  IF OLD.cancelled_at IS NOT NULL AND NEW.cancelled_at IS NULL THEN
    RAISE EXCEPTION
      'A cancelled % cannot be reinstated. Raise a new record instead.', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses', 'sales', 'payroll_records', 'njc_supplies']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_stamp_canceller_%s ON public.%I', t, t);
    EXECUTE format($f$
      CREATE TRIGGER trg_stamp_canceller_%s
        BEFORE UPDATE ON public.%I
        FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_canceller()
    $f$, t, t);
  END LOOP;
END $$;

COMMIT;
