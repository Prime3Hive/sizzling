-- ════════════════════════════════════════════════════════════════════════════
-- Kitchen & Operations reports + Daily Checklists
--   • Extend staff report types with 'kitchen' (food prep / wastage) and
--     'operations' (the general report: activities, challenges, observations,
--     suggestions). Neither converts to a financial record — they are graded.
--   • Daily checklists: admin defines a checklist template (a type + its items),
--     assigns it to a staff member (cadence + due time), and the staff completes
--     and is graded on completion + timeliness + quality.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Extend report-type CHECK constraints ─────────────────────────────────────
ALTER TABLE public.report_assignments DROP CONSTRAINT IF EXISTS report_assignments_report_type_check;
ALTER TABLE public.report_assignments
  ADD CONSTRAINT report_assignments_report_type_check
  CHECK (report_type IN ('sales','inventory','expense','credit','kitchen','operations'));

ALTER TABLE public.staff_reports DROP CONSTRAINT IF EXISTS staff_reports_report_type_check;
ALTER TABLE public.staff_reports
  ADD CONSTRAINT staff_reports_report_type_check
  CHECK (report_type IN ('sales','inventory','expense','credit','kitchen','operations'));

-- ── Checklist templates ──────────────────────────────────────────────────────
--   items: jsonb array of { id, label, required }
CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  checklist_type text NOT NULL DEFAULT 'opening',  -- opening/closing/kitchen/cleaning/safety/custom
  description    text,
  items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  active         boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checklist_templates_admin_all" ON public.checklist_templates;
CREATE POLICY "checklist_templates_admin_all" ON public.checklist_templates
  FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

-- Any authenticated staff may read templates (needed to render assigned items)
DROP POLICY IF EXISTS "checklist_templates_read" ON public.checklist_templates;
CREATE POLICY "checklist_templates_read" ON public.checklist_templates
  FOR SELECT TO authenticated USING (true);

-- ── Checklist assignments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checklist_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cadence     text NOT NULL DEFAULT 'daily' CHECK (cadence IN ('daily','weekly','monthly')),
  due_time    time,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, user_id)
);

ALTER TABLE public.checklist_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checklist_assignments_admin_all" ON public.checklist_assignments;
CREATE POLICY "checklist_assignments_admin_all" ON public.checklist_assignments
  FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS "checklist_assignments_self_read" ON public.checklist_assignments;
CREATE POLICY "checklist_assignments_self_read" ON public.checklist_assignments
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_admin(auth.uid()));

-- ── Checklist submissions ────────────────────────────────────────────────────
--   results: jsonb array of { id, label, done, note }
CREATE TABLE IF NOT EXISTS public.checklist_submissions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id     uuid REFERENCES public.checklist_assignments(id) ON DELETE SET NULL,
  template_id       uuid REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checklist_date    date NOT NULL DEFAULT current_date,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  status            text NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('submitted','approved','rejected')),
  title             text,
  results           jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes             text,
  completion_score  numeric,             -- % of items marked done
  timeliness_score  numeric,             -- auto 0–100 (on-time vs due)
  quality_score     numeric,             -- admin 0–100
  performance_score numeric,             -- combined 0–100
  grade             text,                -- A / B / C / D / F
  reviewed_by       uuid REFERENCES auth.users(id),
  reviewed_at       timestamptz,
  review_note       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checklist_subs_user   ON public.checklist_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_checklist_subs_status ON public.checklist_submissions(status);
CREATE INDEX IF NOT EXISTS idx_checklist_subs_date   ON public.checklist_submissions(checklist_date);

ALTER TABLE public.checklist_submissions ENABLE ROW LEVEL SECURITY;

-- Staff see & submit their own; admins see all
DROP POLICY IF EXISTS "checklist_subs_select" ON public.checklist_submissions;
CREATE POLICY "checklist_subs_select" ON public.checklist_submissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_admin(auth.uid()));

DROP POLICY IF EXISTS "checklist_subs_insert" ON public.checklist_submissions;
CREATE POLICY "checklist_subs_insert" ON public.checklist_submissions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Staff may edit only while still 'submitted'; admins always (for grading)
DROP POLICY IF EXISTS "checklist_subs_update" ON public.checklist_submissions;
CREATE POLICY "checklist_subs_update" ON public.checklist_submissions
  FOR UPDATE TO authenticated
  USING (is_admin(auth.uid()) OR (user_id = auth.uid() AND status = 'submitted'))
  WITH CHECK (is_admin(auth.uid()) OR (user_id = auth.uid() AND status = 'submitted'));

DROP POLICY IF EXISTS "checklist_subs_delete" ON public.checklist_submissions;
CREATE POLICY "checklist_subs_delete" ON public.checklist_submissions
  FOR DELETE TO authenticated
  USING (is_admin(auth.uid()) OR (user_id = auth.uid() AND status = 'submitted'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_templates   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_submissions TO authenticated;
