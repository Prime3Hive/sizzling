-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK of 20260930100000_staff_commission.sql
--
-- Reverses every commission accrual (the ledger keeps the reversals — journals
-- are append-only), restores the pre-commission payroll journal, and drops the
-- commission tables and payroll_records.commission.
--
-- REFUSES if any PAID payroll record carries commission: its journal debits
-- 2350 and its net pay includes the commission, so dropping the column would
-- leave those postings unexplained. Cancel/re-issue those records first.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payroll_records
             WHERE commission > 0 AND status = 'paid' AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'Paid payroll records include commission — rollback refused.';
  END IF;
END $$;

-- Reverse live accruals.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.commission_periods LOOP
    PERFORM public.fn_unpost('commission', r.id);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_guard_payroll_commission   ON public.payroll_records;
DROP TRIGGER IF EXISTS trg_release_payroll_commission ON public.payroll_records;
DROP FUNCTION IF EXISTS public.fn_guard_payroll_commission();
DROP FUNCTION IF EXISTS public.fn_release_payroll_commission();
DROP FUNCTION IF EXISTS public.fn_attach_commission(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.fn_void_commission_period(uuid, text);
DROP FUNCTION IF EXISTS public.fn_approve_commission_period(date);
DROP TRIGGER IF EXISTS trg_auto_post_commission ON public.commission_periods;
DROP FUNCTION IF EXISTS public.trg_post_commission();
DROP FUNCTION IF EXISTS public.fn_post_commission(uuid);
DROP FUNCTION IF EXISTS public.fn_commission_sales(date, date);
DROP FUNCTION IF EXISTS public.fn_commission_weeks(date);

DROP TABLE IF EXISTS public.commission_payouts;
DROP TABLE IF EXISTS public.commission_periods;
DROP TABLE IF EXISTS public.commission_settings;

ALTER TABLE public.payroll_records DROP COLUMN IF EXISTS commission;

-- Payroll journal as of 20260723100000 (plus the cancelled guard).
CREATE OR REPLACE FUNCTION public.fn_post_payroll(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p        record;
  gross    numeric;
  v_paye   numeric;
  v_pen_e  numeric;
  v_pen_er numeric;
  v_nhf    numeric;
  v_other  numeric;
  lines    jsonb;
BEGIN
  SELECT * INTO p FROM public.payroll_records WHERE id = p_id;
  IF NOT FOUND OR p.status <> 'paid' OR p.cancelled_at IS NOT NULL OR COALESCE(p.net_pay, 0) <= 0 THEN
    PERFORM public.fn_unpost('payroll', p_id); RETURN;
  END IF;

  gross    := COALESCE(p.basic_salary, 0) + COALESCE(p.allowances, 0);
  v_paye   := COALESCE(p.paye, 0);
  v_pen_e  := COALESCE(p.pension_employee, 0);
  v_pen_er := COALESCE(p.pension_employer, 0);
  v_nhf    := COALESCE(p.nhf, 0);
  v_other  := COALESCE(p.deductions, 0) - v_paye - v_pen_e - v_nhf;
  IF v_other < 0 THEN
    RAISE EXCEPTION 'Payroll record % is inconsistent: deductions (%) are less than statutory components (PAYE % + pension % + NHF %)',
      p_id, p.deductions, v_paye, v_pen_e, v_nhf;
  END IF;

  lines := jsonb_build_array(
    jsonb_build_object('code', '5100', 'debit', gross, 'credit', 0, 'desc', 'Gross salary')
  );
  IF v_pen_er > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '5110', 'debit', v_pen_er, 'credit', 0, 'desc', 'Employer pension (10%)'));
  END IF;
  IF v_paye > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2300', 'debit', 0, 'credit', v_paye, 'desc', 'PAYE withheld'));
  END IF;
  IF v_pen_e + v_pen_er > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2310', 'debit', 0, 'credit', v_pen_e + v_pen_er, 'desc', 'Pension (employee + employer)'));
  END IF;
  IF v_nhf > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2320', 'debit', 0, 'credit', v_nhf, 'desc', 'NHF withheld'));
  END IF;
  IF v_other > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2340', 'debit', 0, 'credit', v_other, 'desc', 'Other deductions'));
  END IF;
  lines := lines || jsonb_build_array(
    jsonb_build_object('code', '1010', 'debit', 0, 'credit', p.net_pay, 'desc', 'Net pay')
  );

  PERFORM public.fn_post_entry(
    COALESCE(p.paid_at::date, p.period_end, p.period_start, p.created_at::date),
    'Payroll — ' || COALESCE(p.staff_name, ''), 'payroll', p.id, lines
  );
END;
$$;

-- Accounts 2350 / 5120 are left in the chart: their reversed postings still
-- reference them.

COMMIT;

NOTIFY pgrst, 'reload schema';
