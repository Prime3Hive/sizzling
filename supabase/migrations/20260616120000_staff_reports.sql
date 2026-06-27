-- ════════════════════════════════════════════════════════════════════════════
-- Staff Reports module
--   • report_assignments — admin sets which report types a staff must submit
--     and how often (cadence + due time). Timing drives performance.
--   • staff_reports — submissions (sales / inventory / expense / credit), each
--     timed and graded (auto timeliness + admin quality score).
--   • payables — credit register (unpaid purchases); becomes an expense on pay.
-- Sales reports convert to finance_ledger revenue; expense reports convert to
-- expenses; credit reports convert to a payable. Conversions happen on approval.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Assignments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN ('sales','inventory','expense','credit')),
  cadence     text NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily','weekly','monthly')),
  due_time    time,                       -- expected submission time (daily cadence)
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, report_type)
);

ALTER TABLE public.report_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report_assignments_admin_all" ON public.report_assignments;
CREATE POLICY "report_assignments_admin_all" ON public.report_assignments
  FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "report_assignments_self_read" ON public.report_assignments;
CREATE POLICY "report_assignments_self_read" ON public.report_assignments
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_admin(auth.uid()));

-- ── Submissions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staff_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assignment_id     uuid REFERENCES public.report_assignments(id) ON DELETE SET NULL,
  report_type       text NOT NULL CHECK (report_type IN ('sales','inventory','expense','credit')),
  report_date       date NOT NULL DEFAULT current_date,   -- the day the report is FOR
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('submitted','approved','rejected','converted')),
  title             text,
  summary           text,
  amount            numeric,              -- sales total / expense total / credit amount
  payment_method    text,                 -- 'cash' | 'transfer' (sales)
  details           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- line items, counts, supplier…
  -- grading
  timeliness_score  numeric,             -- auto 0–100 (on-time vs due)
  quality_score     numeric,             -- admin 0–100
  performance_score numeric,             -- combined 0–100
  grade             text,                -- A / B / C / D / F
  reviewed_by       uuid REFERENCES auth.users(id),
  reviewed_at       timestamptz,
  review_note       text,
  converted_ref     uuid,                -- id of created expense / ledger / payable
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_reports_user   ON public.staff_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_reports_status ON public.staff_reports(status);
CREATE INDEX IF NOT EXISTS idx_staff_reports_date   ON public.staff_reports(report_date);

ALTER TABLE public.staff_reports ENABLE ROW LEVEL SECURITY;

-- Staff: see & submit their own; may edit only while still 'submitted'
DROP POLICY IF EXISTS "staff_reports_select" ON public.staff_reports;
CREATE POLICY "staff_reports_select" ON public.staff_reports
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin(auth.uid()));

DROP POLICY IF EXISTS "staff_reports_insert" ON public.staff_reports;
CREATE POLICY "staff_reports_insert" ON public.staff_reports
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "staff_reports_update" ON public.staff_reports;
CREATE POLICY "staff_reports_update" ON public.staff_reports
  FOR UPDATE TO authenticated
  USING (
    is_admin(auth.uid())
    OR (user_id = auth.uid() AND status = 'submitted')
  )
  WITH CHECK (
    is_admin(auth.uid())
    OR (user_id = auth.uid() AND status = 'submitted')
  );

DROP POLICY IF EXISTS "staff_reports_delete" ON public.staff_reports;
CREATE POLICY "staff_reports_delete" ON public.staff_reports
  FOR DELETE TO authenticated
  USING (is_admin(auth.uid()) OR (user_id = auth.uid() AND status = 'submitted'));

-- ── Payables (credit register) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payables (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier         text NOT NULL,
  description      text,
  category         text,
  amount           numeric NOT NULL CHECK (amount > 0),
  incurred_date    date NOT NULL DEFAULT current_date,
  due_date         date,
  status           text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid')),
  paid_at          timestamptz,
  payment_method   text,
  expense_id       uuid REFERENCES public.expenses(id) ON DELETE SET NULL,  -- set when paid
  source_report_id uuid REFERENCES public.staff_reports(id) ON DELETE SET NULL,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payables_status ON public.payables(status);

ALTER TABLE public.payables ENABLE ROW LEVEL SECURITY;

-- Admins manage payables; managers may read
DROP POLICY IF EXISTS "payables_admin_all" ON public.payables;
CREATE POLICY "payables_admin_all" ON public.payables
  FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "payables_manager_read" ON public.payables;
CREATE POLICY "payables_manager_read" ON public.payables
  FOR SELECT TO authenticated
  USING (
    is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('manager','hr') AND role_status = 'approved'
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payables TO authenticated;
