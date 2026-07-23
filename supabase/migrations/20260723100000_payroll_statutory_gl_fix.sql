-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION (1/3): Payroll — statutory deductions & correct GL posting
--
-- Fixes from the 2026-07 financial audit:
--   A1  Salaries double-counted: marking payroll paid also inserted a net-pay
--       expense row, so staff cost hit the books twice (5100 payroll journal
--       + 5400 expense journal, and payroll + expenses in every report).
--       → the app no longer writes that expense; this migration deletes the
--       historical auto-created "Salary payment — …" rows (their journals
--       unpost via the existing expense trigger).
--   A3  Payroll journal posted net pay only, so PAYE / pension / NHF withheld
--       from staff existed nowhere in the ledger.
--       → payroll_records now carries a statutory breakdown and fn_post_payroll
--       posts a gross-based compound entry with statutory liability accounts.
--   B9  Duplicate payroll guard was a client-side read (race-prone).
--       → real UNIQUE constraint per staff/period.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Statutory liability / expense accounts ────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, normal_balance, sort_order) VALUES
  ('2300', 'PAYE Payable',                    'liability', 'credit', 62),
  ('2310', 'Pension Payable',                 'liability', 'credit', 64),
  ('2320', 'NHF Payable',                     'liability', 'credit', 66),
  ('2340', 'Other Payroll Deductions Payable','liability', 'credit', 68),
  ('5110', 'Employer Pension Contribution',   'expense',   'debit',  145)
ON CONFLICT (code) DO NOTHING;

-- ── 2. Statutory breakdown on payroll records ────────────────────────────────
ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS paye             numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pension_employee numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pension_employer numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nhf              numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_deductions numeric(14,2) NOT NULL DEFAULT 0;

-- One payroll row per staff member per period (B9). Unpaid duplicates from the
-- old race-prone client check are dropped (keeping the oldest row); if paid
-- duplicates exist they need human review, so the index is skipped with a
-- warning instead of failing the migration.
DELETE FROM public.payroll_records pr
USING public.payroll_records keep
WHERE pr.staff_profile_id = keep.staff_profile_id
  AND pr.period_start     = keep.period_start
  AND pr.period_end       = keep.period_end
  AND pr.id <> keep.id
  AND pr.status <> 'paid'
  AND keep.created_at < pr.created_at;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_staff_period
    ON public.payroll_records (staff_profile_id, period_start, period_end);
EXCEPTION WHEN unique_violation OR others THEN
  RAISE WARNING 'uq_payroll_staff_period not created — duplicate PAID payroll rows exist and need manual review: %', SQLERRM;
END $$;

-- ── 3. Gross-based payroll posting ───────────────────────────────────────────
-- Entry for a paid payroll record (all amounts per record):
--   Dr 5100 Salaries & Wages            gross (basic + allowances)
--   Dr 5110 Employer Pension            pension_employer
--   Cr 2300 PAYE Payable                paye
--   Cr 2310 Pension Payable             pension_employee + pension_employer
--   Cr 2320 NHF Payable                 nhf
--   Cr 2340 Other Deductions Payable    deductions − (paye + pension_employee + nhf)
--   Cr 1010 Bank                        net_pay
-- Legacy rows (statutory columns all 0) degrade to:
--   Dr 5100 gross / Cr 2340 deductions / Cr 1010 net — still balanced, and the
-- lump-sum deduction is at least visible as a liability instead of vanishing.
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
  IF NOT FOUND OR p.status <> 'paid' OR COALESCE(p.net_pay, 0) <= 0 THEN
    PERFORM public.fn_unpost('payroll', p_id); RETURN;
  END IF;

  gross    := COALESCE(p.basic_salary, 0) + COALESCE(p.allowances, 0);
  v_paye   := COALESCE(p.paye, 0);
  v_pen_e  := COALESCE(p.pension_employee, 0);
  v_pen_er := COALESCE(p.pension_employer, 0);
  v_nhf    := COALESCE(p.nhf, 0);
  -- Whatever part of total deductions is not statutory. Derived (rather than
  -- read from other_deductions) so the entry always balances even if the
  -- columns drift; a negative residue means the record itself is inconsistent.
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

-- ── 4. Remove the historical double-count (A1) ───────────────────────────────
-- Every "mark paid" since the feature shipped inserted a mirror expense row.
-- Deleting it fires trg_auto_post_expense → fn_unpost, removing its journal.
DELETE FROM public.expenses
WHERE category = 'Salaries & Wages'
  AND description LIKE 'Salary payment — %';

-- ── 5. Re-post all paid payroll under the corrected shape ────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.payroll_records WHERE status = 'paid' LOOP
    PERFORM public.fn_post_payroll(r.id);
  END LOOP;
END $$;
