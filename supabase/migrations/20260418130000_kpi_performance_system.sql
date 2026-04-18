-- ─────────────────────────────────────────────────────────────────────────────
-- KPI Performance System
-- Tables: kpi_periods, kpi_categories, kpi_task_assignments, kpi_staff_scores
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Review Periods ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_periods (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  period_type   text NOT NULL CHECK (period_type IN ('monthly','quarterly','annual','custom')),
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
  description   text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_periods_dates_check CHECK (end_date >= start_date)
);

-- ── 2. Task Categories ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  color       text NOT NULL DEFAULT '#6366f1',
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed default categories
INSERT INTO kpi_categories (name, description, color) VALUES
  ('Quality',        'Accuracy and quality of work delivered',           '#10b981'),
  ('Timeliness',     'Completing tasks on time and meeting deadlines',   '#f59e0b'),
  ('Teamwork',       'Collaboration and support for colleagues',         '#6366f1'),
  ('Initiative',     'Proactive contributions and problem-solving',      '#ec4899'),
  ('Communication',  'Clarity, responsiveness, and professional conduct','#0ea5e9')
ON CONFLICT DO NOTHING;

-- ── 3. Task Assignments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_task_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id        uuid NOT NULL REFERENCES kpi_periods(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  category_id      uuid REFERENCES kpi_categories(id) ON DELETE SET NULL,
  title            text NOT NULL,
  description      text,
  target_value     text,
  weight           integer NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 10),
  due_date         date,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','in_progress','submitted','scored')),
  max_score        integer NOT NULL DEFAULT 10 CHECK (max_score BETWEEN 1 AND 100),
  score            numeric(5,2),
  score_comment    text,
  assigned_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  scored_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at      timestamptz NOT NULL DEFAULT now(),
  scored_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Staff KPI Summary Scores ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_staff_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id           uuid NOT NULL REFERENCES kpi_periods(id) ON DELETE CASCADE,
  staff_profile_id    uuid NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  total_score         numeric(8,2) NOT NULL DEFAULT 0,
  max_possible_score  numeric(8,2) NOT NULL DEFAULT 0,
  percentage          numeric(5,2) GENERATED ALWAYS AS (
                        CASE WHEN max_possible_score > 0
                          THEN ROUND((total_score / max_possible_score) * 100, 2)
                          ELSE 0
                        END
                      ) STORED,
  grade               text GENERATED ALWAYS AS (
                        CASE
                          WHEN max_possible_score = 0 THEN 'N/A'
                          WHEN (total_score / max_possible_score) * 100 >= 90 THEN 'A'
                          WHEN (total_score / max_possible_score) * 100 >= 75 THEN 'B'
                          WHEN (total_score / max_possible_score) * 100 >= 60 THEN 'C'
                          WHEN (total_score / max_possible_score) * 100 >= 40 THEN 'D'
                          ELSE 'F'
                        END
                      ) STORED,
  notes               text,
  finalized           boolean NOT NULL DEFAULT false,
  finalized_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  finalized_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_id, staff_profile_id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kpi_task_assignments_period   ON kpi_task_assignments(period_id);
CREATE INDEX IF NOT EXISTS idx_kpi_task_assignments_staff    ON kpi_task_assignments(staff_profile_id);
CREATE INDEX IF NOT EXISTS idx_kpi_task_assignments_status   ON kpi_task_assignments(status);
CREATE INDEX IF NOT EXISTS idx_kpi_staff_scores_period       ON kpi_staff_scores(period_id);
CREATE INDEX IF NOT EXISTS idx_kpi_staff_scores_staff        ON kpi_staff_scores(staff_profile_id);

-- ── Enable RLS ───────────────────────────────────────────────────────────────
ALTER TABLE kpi_periods          ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_staff_scores     ENABLE ROW LEVEL SECURITY;

-- ── Helper function ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_manager_or_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND role IN ('admin','manager')
      AND role_status = 'approved'
  );
$$;

-- ── RLS: kpi_periods ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "kpi_periods_read_authenticated"    ON kpi_periods;
DROP POLICY IF EXISTS "kpi_periods_write_admin_manager"   ON kpi_periods;

CREATE POLICY "kpi_periods_read_authenticated"
  ON kpi_periods FOR SELECT TO authenticated USING (true);

CREATE POLICY "kpi_periods_write_admin_manager"
  ON kpi_periods FOR ALL TO authenticated
  USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

-- ── RLS: kpi_categories ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "kpi_categories_read_authenticated"   ON kpi_categories;
DROP POLICY IF EXISTS "kpi_categories_write_admin_manager"  ON kpi_categories;

CREATE POLICY "kpi_categories_read_authenticated"
  ON kpi_categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "kpi_categories_write_admin_manager"
  ON kpi_categories FOR ALL TO authenticated
  USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

-- ── RLS: kpi_task_assignments ────────────────────────────────────────────────
DROP POLICY IF EXISTS "kpi_tasks_admin_manager_all"   ON kpi_task_assignments;
DROP POLICY IF EXISTS "kpi_tasks_staff_read_own"      ON kpi_task_assignments;
DROP POLICY IF EXISTS "kpi_tasks_staff_update_status" ON kpi_task_assignments;

CREATE POLICY "kpi_tasks_admin_manager_all"
  ON kpi_task_assignments FOR ALL TO authenticated
  USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

CREATE POLICY "kpi_tasks_staff_read_own"
  ON kpi_task_assignments FOR SELECT TO authenticated
  USING (
    staff_profile_id IN (
      SELECT id FROM staff_profiles WHERE linked_user_id = auth.uid()
    )
  );

CREATE POLICY "kpi_tasks_staff_update_status"
  ON kpi_task_assignments FOR UPDATE TO authenticated
  USING (
    staff_profile_id IN (
      SELECT id FROM staff_profiles WHERE linked_user_id = auth.uid()
    )
  )
  WITH CHECK (
    staff_profile_id IN (
      SELECT id FROM staff_profiles WHERE linked_user_id = auth.uid()
    )
  );

-- ── RLS: kpi_staff_scores ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "kpi_scores_admin_manager_hr_all" ON kpi_staff_scores;
DROP POLICY IF EXISTS "kpi_scores_staff_read_own"       ON kpi_staff_scores;

CREATE POLICY "kpi_scores_admin_manager_hr_all"
  ON kpi_staff_scores FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin','manager','hr')
        AND role_status = 'approved'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin','manager','hr')
        AND role_status = 'approved'
    )
  );

CREATE POLICY "kpi_scores_staff_read_own"
  ON kpi_staff_scores FOR SELECT TO authenticated
  USING (
    staff_profile_id IN (
      SELECT id FROM staff_profiles WHERE linked_user_id = auth.uid()
    )
  );
