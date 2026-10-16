-- ═════════════════════════════════════════════════════════════════════════════
-- STAFF SALES COMMISSION
--
-- Sales reports that staff submit (staff_reports, report_type 'sales') are the
-- commission base. Once an admin approves a report it becomes a `sales` row;
-- only those approved (converted) reports count, and a report whose sale was
-- later cancelled drops out again.
--
-- The model, per week (Monday–Sunday):
--   sales <  weekly target  → nothing
--   sales >= weekly target  → flat_rate % of the target
--                            + excess_rate % of every naira above it
-- Per month:
--   if the month's sales reach weekly target × weeks in the month, the pool is
--   lifted by escalator_rate %.
-- A week belongs to the month its Sunday falls in, so a month has 4 or 5 whole
-- weeks and no week is ever counted twice.
--
-- The pool is split between department groups by share, then equally among
-- the ACTIVE staff in each group. Departments map to groups in settings;
-- unmapped departments are not eligible.
--
-- Accounting:
--   approve   Dr 5120 Staff Sales Commission  / Cr 2350 Commission Payable
--             (accrual, dated to the period's last Sunday — the cost belongs
--             to the month it was earned, not the month it is paid)
--   payroll   commission is carried on payroll_records.commission and paid
--             with salary, so PAYE is withheld on it. When the payroll row is
--             paid its journal DEBITS 2350 for the commission, clearing the
--             liability — the cost is never recognised twice.
--   void      reverses the accrual (only while no payroll run carries it).
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Accounts ──────────────────────────────────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, normal_balance, sort_order) VALUES
  ('2350', 'Commission Payable',     'liability', 'credit', 69),
  ('5120', 'Staff Sales Commission', 'expense',   'debit',  146)
ON CONFLICT (code) DO NOTHING;

-- ── 2. Criteria (one row) ────────────────────────────────────────────────────
-- Rates are stored as percentages (1 = 1%). group_shares must total 100.
-- department_groups maps departments.id → 'sales' | 'management' | 'kitchen'
-- | 'operations'; anything else (or missing) is not eligible.
CREATE TABLE IF NOT EXISTS public.commission_settings (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Exactly one row: the unique, always-true flag forbids a second.
  singleton         boolean      NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  weekly_target     numeric(14,2) NOT NULL DEFAULT 5000000 CHECK (weekly_target > 0),
  flat_rate         numeric(7,4)  NOT NULL DEFAULT 1  CHECK (flat_rate   BETWEEN 0 AND 100),
  excess_rate       numeric(7,4)  NOT NULL DEFAULT 3  CHECK (excess_rate BETWEEN 0 AND 100),
  escalator_rate    numeric(7,4)  NOT NULL DEFAULT 20 CHECK (escalator_rate BETWEEN 0 AND 100),
  group_shares      jsonb        NOT NULL
                      DEFAULT '{"sales":20,"management":20,"kitchen":40,"operations":20}'::jsonb,
  department_groups jsonb        NOT NULL DEFAULT '{}'::jsonb,
  updated_by        uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

-- Seed the row, guessing each existing department's group from its name so
-- the first month works out of the box. Admins can change it on the page.
INSERT INTO public.commission_settings (singleton, department_groups)
SELECT true, COALESCE(jsonb_object_agg(d.id::text, g.grp) FILTER (WHERE g.grp IS NOT NULL), '{}'::jsonb)
FROM public.departments d
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN d.name ~* '(sales|csr|customer)'                        THEN 'sales'
    WHEN d.name ~* '(manage|admin)'                               THEN 'management'
    WHEN d.name ~* '(kitchen|chef|cook|culinary)'                 THEN 'kitchen'
    WHEN d.name ~* '(operation|logistic|inventory|store|driver)'  THEN 'operations'
  END AS grp
) g
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.commission_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commission_settings_admin_all" ON public.commission_settings;
CREATE POLICY "commission_settings_admin_all" ON public.commission_settings
  FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

GRANT SELECT, UPDATE ON public.commission_settings TO authenticated;

-- ── 3. Approved periods and their payouts ────────────────────────────────────
-- Rows are written only by fn_approve_commission_period, which recomputes
-- everything server-side. They are a snapshot: later edits to the criteria
-- never change a month that has been approved.
CREATE TABLE IF NOT EXISTS public.commission_periods (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month     date         NOT NULL CHECK (extract(day FROM period_month) = 1),
  period_start     date         NOT NULL,
  period_end       date         NOT NULL,
  status           text         NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'void')),
  settings         jsonb        NOT NULL,
  weeks            jsonb        NOT NULL,
  total_sales      numeric(14,2) NOT NULL DEFAULT 0,
  base_pool        numeric(14,2) NOT NULL DEFAULT 0,
  escalator_bonus  numeric(14,2) NOT NULL DEFAULT 0,
  total_pool       numeric(14,2) NOT NULL DEFAULT 0,
  -- What was actually paid out to people (what the ledger accrues). Less than
  -- total_pool when a group has nobody in it, or by kobo rounding.
  total_allocated  numeric(14,2) NOT NULL DEFAULT 0,
  approved_by      uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at      timestamptz  NOT NULL DEFAULT now(),
  voided_by        uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at        timestamptz,
  void_reason      text,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_period_live
  ON public.commission_periods (period_month) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_commission_periods_end ON public.commission_periods (period_end);

CREATE TABLE IF NOT EXISTS public.commission_payouts (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id         uuid         NOT NULL REFERENCES public.commission_periods(id) ON DELETE RESTRICT,
  staff_profile_id  uuid         NOT NULL REFERENCES public.staff_profiles(id) ON DELETE RESTRICT,
  staff_name        text         NOT NULL,
  department        text,
  commission_group  text         NOT NULL,
  amount            numeric(14,2) NOT NULL CHECK (amount > 0),
  -- Set when a payroll run picks the commission up; cleared again if that
  -- payroll record is cancelled.
  payroll_record_id uuid         REFERENCES public.payroll_records(id) ON DELETE SET NULL,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_payouts_period  ON public.commission_payouts (period_id);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_staff   ON public.commission_payouts (staff_profile_id);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_payroll ON public.commission_payouts (payroll_record_id);

ALTER TABLE public.commission_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "commission_periods_admin_read" ON public.commission_periods;
CREATE POLICY "commission_periods_admin_read" ON public.commission_periods
  FOR SELECT TO authenticated USING (is_admin(auth.uid()));

-- Admins see every payout; staff see their own.
DROP POLICY IF EXISTS "commission_payouts_read" ON public.commission_payouts;
CREATE POLICY "commission_payouts_read" ON public.commission_payouts
  FOR SELECT TO authenticated
  USING (
    is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.staff_profiles sp
               WHERE sp.id = staff_profile_id AND sp.linked_user_id = auth.uid())
  );

-- Writes go through the SECURITY DEFINER functions below only.
REVOKE INSERT, UPDATE, DELETE ON public.commission_periods FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.commission_payouts FROM authenticated, anon;
GRANT SELECT ON public.commission_periods TO authenticated;
GRANT SELECT ON public.commission_payouts TO authenticated;

-- ── 4. Audit trail ───────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commission_settings', 'commission_periods', 'commission_payouts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_row()', t, t);
  END LOOP;
END $$;

-- ── 5. Calendar and sales helpers ────────────────────────────────────────────
-- The Monday–Sunday weeks whose Sunday falls in the month of p_month.
CREATE OR REPLACE FUNCTION public.fn_commission_weeks(p_month date)
RETURNS TABLE (week_no int, week_start date, week_end date)
LANGUAGE sql IMMUTABLE AS $$
  WITH m AS (
    SELECT date_trunc('month', p_month)::date AS ms,
           (date_trunc('month', p_month) + interval '1 month - 1 day')::date AS me
  ), f AS (
    SELECT me, ms + ((7 - extract(isodow FROM ms)::int) % 7) AS first_sun FROM m
  )
  SELECT (row_number() OVER (ORDER BY g))::int, (g::date - 6), g::date
  FROM f, generate_series(f.first_sun::timestamp, f.me::timestamp, interval '7 days') AS g;
$$;

-- Approved staff sales reports in a date range, excluding any whose sale was
-- later cancelled.
CREATE OR REPLACE FUNCTION public.fn_commission_sales(p_from date, p_to date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(sr.amount), 0)
  FROM public.staff_reports sr
  LEFT JOIN public.sales s ON s.id = sr.converted_ref
  WHERE sr.report_type = 'sales'
    AND sr.status = 'converted'
    AND sr.report_date BETWEEN p_from AND p_to
    AND (s.id IS NULL OR (s.status IS DISTINCT FROM 'cancelled' AND s.cancelled_at IS NULL));
$$;

REVOKE ALL ON FUNCTION public.fn_commission_sales(date, date) FROM PUBLIC, anon, authenticated;

-- ── 6. Journal ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_post_commission(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.commission_periods WHERE id = p_id;
  IF NOT FOUND OR c.status <> 'approved' OR COALESCE(c.total_allocated, 0) <= 0 THEN
    PERFORM public.fn_unpost('commission', p_id); RETURN;
  END IF;
  PERFORM public.fn_post_entry(
    c.period_end,
    'Sales commission accrued — ' || to_char(c.period_month, 'FMMonth YYYY'),
    'commission', c.id,
    jsonb_build_array(
      jsonb_build_object('code', '5120', 'debit', c.total_allocated, 'credit', 0, 'desc', 'Staff sales commission'),
      jsonb_build_object('code', '2350', 'debit', 0, 'credit', c.total_allocated, 'desc', 'Commission payable')
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_post_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fn_post_commission(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_post_commission ON public.commission_periods;
CREATE TRIGGER trg_auto_post_commission
  AFTER INSERT OR UPDATE ON public.commission_periods
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_commission();

-- ── 7. Approve a month ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_approve_commission_period(p_month date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg           public.commission_settings%ROWTYPE;
  v_ms          date := date_trunc('month', p_month)::date;
  v_start       date;
  v_end         date;
  v_n           int;
  w             record;
  g             record;
  v_sales       numeric;
  v_flat        numeric;
  v_excess      numeric;
  v_weeks       jsonb   := '[]'::jsonb;
  v_total_sales numeric := 0;
  v_base        numeric := 0;
  v_esc         numeric := 0;
  v_pool        numeric;
  v_alloc       numeric := 0;
  v_pending     int;
  v_share_total numeric;
  v_staff       int;
  v_each        numeric;
  v_id          uuid;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin can approve commission.';
  END IF;

  SELECT * INTO cfg FROM public.commission_settings WHERE singleton;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commission criteria have not been set up.'; END IF;

  SELECT min(week_start), max(week_end), count(*) INTO v_start, v_end, v_n
  FROM public.fn_commission_weeks(v_ms);

  IF v_end >= current_date THEN
    RAISE EXCEPTION 'The last commission week of % ends on %. Approve it once that week has closed.',
      to_char(v_ms, 'FMMonth YYYY'), to_char(v_end, 'DD Mon YYYY');
  END IF;

  IF EXISTS (SELECT 1 FROM public.commission_periods WHERE period_month = v_ms AND status = 'approved') THEN
    RAISE EXCEPTION 'Commission for % is already approved.', to_char(v_ms, 'FMMonth YYYY');
  END IF;

  SELECT count(*) INTO v_pending
  FROM public.staff_reports
  WHERE report_type = 'sales' AND status = 'submitted'
    AND report_date BETWEEN v_start AND v_end;
  IF v_pending > 0 THEN
    RAISE EXCEPTION '% sales report(s) in this period are still awaiting review. Approve or reject them first, so the commission is worked out on final figures.', v_pending;
  END IF;

  SELECT COALESCE(sum(value::numeric), 0) INTO v_share_total FROM jsonb_each_text(cfg.group_shares);
  IF abs(v_share_total - 100) > 0.01 THEN
    RAISE EXCEPTION 'Department pool shares add up to % percent, not 100. Fix the criteria first.', v_share_total;
  END IF;

  FOR w IN SELECT * FROM public.fn_commission_weeks(v_ms) ORDER BY week_no LOOP
    v_sales := public.fn_commission_sales(w.week_start, w.week_end);
    IF v_sales >= cfg.weekly_target THEN
      v_flat   := round(cfg.weekly_target * cfg.flat_rate / 100, 2);
      v_excess := round((v_sales - cfg.weekly_target) * cfg.excess_rate / 100, 2);
    ELSE
      v_flat := 0; v_excess := 0;
    END IF;
    v_weeks := v_weeks || jsonb_build_array(jsonb_build_object(
      'week', w.week_no, 'start', w.week_start, 'end', w.week_end,
      'sales', v_sales, 'flat', v_flat, 'excess', v_excess, 'total', v_flat + v_excess));
    v_total_sales := v_total_sales + v_sales;
    v_base        := v_base + v_flat + v_excess;
  END LOOP;

  IF v_total_sales >= cfg.weekly_target * v_n THEN
    v_esc := round(v_base * cfg.escalator_rate / 100, 2);
  END IF;
  v_pool := v_base + v_esc;

  INSERT INTO public.commission_periods (
    period_month, period_start, period_end, status, settings, weeks,
    total_sales, base_pool, escalator_bonus, total_pool, total_allocated, approved_by
  ) VALUES (
    v_ms, v_start, v_end, 'approved',
    jsonb_build_object(
      'weekly_target', cfg.weekly_target, 'flat_rate', cfg.flat_rate,
      'excess_rate', cfg.excess_rate, 'escalator_rate', cfg.escalator_rate,
      'group_shares', cfg.group_shares, 'department_groups', cfg.department_groups),
    v_weeks, v_total_sales, v_base, v_esc, v_pool, 0, auth.uid()
  ) RETURNING id INTO v_id;

  -- Split: group share of the pool, equally across that group's active staff,
  -- rounded DOWN to the kobo so the total paid never exceeds the pool.
  IF v_pool > 0 THEN
    FOR g IN SELECT key, value::numeric AS share FROM jsonb_each_text(cfg.group_shares) LOOP
      CONTINUE WHEN g.share <= 0;
      SELECT count(*) INTO v_staff
      FROM public.staff_profiles sp
      WHERE sp.employment_status = 'active'
        AND cfg.department_groups ->> sp.department_id::text = g.key;
      CONTINUE WHEN v_staff = 0;

      v_each := floor(v_pool * g.share / 100 / v_staff * 100) / 100;
      CONTINUE WHEN v_each <= 0;

      INSERT INTO public.commission_payouts (period_id, staff_profile_id, staff_name, department, commission_group, amount)
      SELECT v_id, sp.id, sp.full_name, d.name, g.key, v_each
      FROM public.staff_profiles sp
      LEFT JOIN public.departments d ON d.id = sp.department_id
      WHERE sp.employment_status = 'active'
        AND cfg.department_groups ->> sp.department_id::text = g.key;

      v_alloc := v_alloc + v_each * v_staff;
    END LOOP;
  END IF;

  -- Fires trg_auto_post_commission → Dr 5120 / Cr 2350.
  UPDATE public.commission_periods SET total_allocated = v_alloc WHERE id = v_id;
  RETURN v_id;
END;
$$;

-- ── 8. Void a month ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_void_commission_period(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin can void commission.';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Give a reason for voiding this commission.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commission_payouts cp
    JOIN public.payroll_records pr ON pr.id = cp.payroll_record_id
    WHERE cp.period_id = p_id AND pr.cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Commission from this month is already on a payroll run. Cancel those payroll records first.';
  END IF;

  -- Fires trg_auto_post_commission → the accrual is reversed.
  UPDATE public.commission_periods
  SET status = 'void', voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason)
  WHERE id = p_id AND status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'That commission period is not open to voiding.'; END IF;
END;
$$;

-- ── 9. Payroll carries commission ────────────────────────────────────────────
ALTER TABLE public.payroll_records
  ADD COLUMN IF NOT EXISTS commission numeric(14,2) NOT NULL DEFAULT 0 CHECK (commission >= 0);

-- Link payouts to the payroll record that pays them. Every id must be this
-- staff member's, from an approved month, and not already on a payroll; the
-- amounts must add up to what the payroll record says it pays.
CREATE OR REPLACE FUNCTION public.fn_attach_commission(p_payroll_id uuid, p_payout_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pr      record;
  v_count int;
  v_sum   numeric;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin can attach commission to payroll.';
  END IF;
  SELECT * INTO pr FROM public.payroll_records WHERE id = p_payroll_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll record not found.'; END IF;

  WITH upd AS (
    UPDATE public.commission_payouts cp
    SET payroll_record_id = p_payroll_id
    FROM public.commission_periods c
    WHERE cp.id = ANY(p_payout_ids)
      AND c.id = cp.period_id AND c.status = 'approved'
      AND cp.staff_profile_id = pr.staff_profile_id
      AND cp.payroll_record_id IS NULL
    RETURNING cp.amount
  )
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_count, v_sum FROM upd;

  IF v_count <> COALESCE(array_length(p_payout_ids, 1), 0) OR abs(v_sum - COALESCE(pr.commission, 0)) > 0.005 THEN
    RAISE EXCEPTION 'Commission for % changed while payroll was being generated. Cancel this payroll record and generate it again.', pr.staff_name;
  END IF;
END;
$$;

-- A payroll row may only be paid when its commission matches the payouts
-- linked to it — otherwise 2350 would be cleared by the wrong amount.
CREATE OR REPLACE FUNCTION public.fn_guard_payroll_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sum numeric;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    SELECT COALESCE(sum(amount), 0) INTO v_sum
    FROM public.commission_payouts WHERE payroll_record_id = NEW.id;
    IF abs(v_sum - COALESCE(NEW.commission, 0)) > 0.005 THEN
      RAISE EXCEPTION 'Payroll for % shows commission of %, but % is linked to it. Cancel and regenerate this record.',
        NEW.staff_name, NEW.commission, v_sum;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payroll_commission ON public.payroll_records;
CREATE TRIGGER trg_guard_payroll_commission
  BEFORE UPDATE ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_payroll_commission();

-- Cancelling a payroll record hands its commission back, ready for the next run.
CREATE OR REPLACE FUNCTION public.fn_release_payroll_commission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL THEN
    UPDATE public.commission_payouts SET payroll_record_id = NULL WHERE payroll_record_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_payroll_commission ON public.payroll_records;
CREATE TRIGGER trg_release_payroll_commission
  AFTER UPDATE ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_release_payroll_commission();

-- ── 10. Payroll journal settles the commission liability ─────────────────────
--   Dr 5100 Salaries & Wages            basic + allowances
--   Dr 5110 Employer Pension            pension_employer
--   Dr 2350 Commission Payable          commission  (already expensed at accrual)
--   Cr 2300 / 2310 / 2320 / 2340        statutory + other deductions
--   Cr 1010 Bank                        net_pay (includes commission after tax)
CREATE OR REPLACE FUNCTION public.fn_post_payroll(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p        record;
  gross    numeric;
  v_comm   numeric;
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
  v_comm   := COALESCE(p.commission, 0);
  v_paye   := COALESCE(p.paye, 0);
  v_pen_e  := COALESCE(p.pension_employee, 0);
  v_pen_er := COALESCE(p.pension_employer, 0);
  v_nhf    := COALESCE(p.nhf, 0);
  v_other  := COALESCE(p.deductions, 0) - v_paye - v_pen_e - v_nhf;
  IF v_other < 0 THEN
    RAISE EXCEPTION 'Payroll record % is inconsistent: deductions (%) are less than statutory components (PAYE % + pension % + NHF %)',
      p_id, p.deductions, v_paye, v_pen_e, v_nhf;
  END IF;

  lines := '[]'::jsonb;
  IF gross > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '5100', 'debit', gross, 'credit', 0, 'desc', 'Gross salary'));
  END IF;
  IF v_comm > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2350', 'debit', v_comm, 'credit', 0, 'desc', 'Commission paid'));
  END IF;
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

GRANT EXECUTE ON FUNCTION public.fn_approve_commission_period(date)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_void_commission_period(uuid, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_attach_commission(uuid, uuid[])       TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_commission_weeks(date)                TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
