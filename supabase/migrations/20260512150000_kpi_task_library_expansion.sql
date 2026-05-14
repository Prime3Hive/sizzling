-- ─────────────────────────────────────────────────────────────────────────────
-- KPI Task Library Expansion
-- • Adds weight + sort_order to kpi_categories
-- • Creates kpi_task_templates (reusable task definitions)
-- • Seeds the 6 OM KPI categories and their 18 task templates
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend kpi_categories ─────────────────────────────────────────────────

ALTER TABLE kpi_categories
  ADD COLUMN IF NOT EXISTS weight     integer NOT NULL DEFAULT 0
    CHECK (weight >= 0 AND weight <= 100),
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Unique constraint so ON CONFLICT works for the seed inserts below
ALTER TABLE kpi_categories
  ADD CONSTRAINT IF NOT EXISTS kpi_categories_name_unique UNIQUE (name);

-- ── 2. Task Templates table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kpi_task_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid        NOT NULL REFERENCES kpi_categories(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  description text,                        -- scoring criteria / guidance
  target      text,                        -- target from the manual
  weight      integer     NOT NULL DEFAULT 25
                CHECK (weight >= 0 AND weight <= 100),
  max_score   integer     NOT NULL DEFAULT 100
                CHECK (max_score >= 1 AND max_score <= 100),
  sort_order  integer     NOT NULL DEFAULT 0,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_task_templates_category
  ON kpi_task_templates(category_id);

ALTER TABLE kpi_task_templates
  ADD CONSTRAINT IF NOT EXISTS kpi_task_templates_cat_title_unique UNIQUE (category_id, title);

-- ── 3. RLS for kpi_task_templates ────────────────────────────────────────────

ALTER TABLE kpi_task_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kpi_task_templates_read"  ON kpi_task_templates;
DROP POLICY IF EXISTS "kpi_task_templates_write" ON kpi_task_templates;

CREATE POLICY "kpi_task_templates_read"
  ON kpi_task_templates FOR SELECT TO authenticated USING (true);

CREATE POLICY "kpi_task_templates_write"
  ON kpi_task_templates FOR ALL TO authenticated
  USING (is_manager_or_admin()) WITH CHECK (is_manager_or_admin());

-- Align kpi_task_assignments.weight to 0-100 (was 1-10) so it matches templates
ALTER TABLE kpi_task_assignments DROP CONSTRAINT IF EXISTS kpi_task_assignments_weight_check;
ALTER TABLE kpi_task_assignments ADD CONSTRAINT kpi_task_assignments_weight_check
  CHECK (weight >= 0 AND weight <= 100);

-- Push generic seeded categories to the back so OM categories lead in sort order
UPDATE kpi_categories SET sort_order = 99
WHERE name IN ('Quality','Timeliness','Teamwork','Initiative','Communication')
  AND sort_order = 0;

-- ── 4. Seed OM KPI Categories + Task Templates ───────────────────────────────

DO $$
DECLARE
  cat1 uuid; cat2 uuid; cat3 uuid;
  cat4 uuid; cat5 uuid; cat6 uuid;
BEGIN

  -- ── Categories ──────────────────────────────────────────────────────────────

  INSERT INTO kpi_categories (name, description, color, weight, sort_order)
  VALUES (
    'Operational Leadership & Systems Management',
    'Keeping all departments running to standard every day — from opening through closing.',
    '#6366f1', 25, 1
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO kpi_categories (name, description, color, weight, sort_order)
  VALUES (
    'People Leadership & Department Management',
    'Actively developing and managing all direct reports to the standard the business requires.',
    '#10b981', 20, 2
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO kpi_categories (name, description, color, weight, sort_order)
  VALUES (
    'Financial & Commercial Management',
    'Managing the business''s money responsibly and driving commercial performance.',
    '#f59e0b', 20, 3
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO kpi_categories (name, description, color, weight, sort_order)
  VALUES (
    'Food Safety, Compliance & Quality Assurance',
    'Zero-tolerance category. A single unaddressed breach triggers an automatic category fail.',
    '#ef4444', 15, 4
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO kpi_categories (name, description, color, weight, sort_order)
  VALUES (
    'Customer Experience & Service Standards',
    'Actively managing and improving the customer experience across all channels.',
    '#0ea5e9', 10, 5
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO kpi_categories (name, description, color, weight, sort_order)
  VALUES (
    'Reporting & Strategic Contribution',
    'Keeping ownership fully and accurately informed — and contributing meaningfully to business decisions.',
    '#8b5cf6', 10, 6
  )
  ON CONFLICT DO NOTHING;

  -- ── Resolve IDs ─────────────────────────────────────────────────────────────

  SELECT id INTO cat1 FROM kpi_categories WHERE name = 'Operational Leadership & Systems Management';
  SELECT id INTO cat2 FROM kpi_categories WHERE name = 'People Leadership & Department Management';
  SELECT id INTO cat3 FROM kpi_categories WHERE name = 'Financial & Commercial Management';
  SELECT id INTO cat4 FROM kpi_categories WHERE name = 'Food Safety, Compliance & Quality Assurance';
  SELECT id INTO cat5 FROM kpi_categories WHERE name = 'Customer Experience & Service Standards';
  SELECT id INTO cat6 FROM kpi_categories WHERE name = 'Reporting & Strategic Contribution';

  -- ── Category 1 Tasks (weights sum to 100) ───────────────────────────────────

  IF cat1 IS NOT NULL THEN
    INSERT INTO kpi_task_templates (category_id, title, description, target, weight, max_score, sort_order) VALUES
      (cat1,
       'Daily walk-through completed (opening & closing)',
       '100% = completed daily with log entry | 60% = most days, some gaps | 0% = rarely or not documented',
       'Every operational day',
       30, 100, 1),
      (cat1,
       'SOP compliance audit rate across all departments',
       '100% = ≥95% compliance confirmed | 80% = 90–94% | 60% = 85–89% | 0% = <85% or no audit conducted',
       '≥ 95% across all departments',
       30, 100, 2),
      (cat1,
       'Cross-departmental briefings conducted (opening & handover)',
       '100% = conducted daily, all DMs present and briefed | 60% = most days | 0% = infrequent or undocumented',
       'Every service day — all DMs aligned',
       20, 100, 3),
      (cat1,
       'Operational systems functioning & used correctly (POS, inventory, comms)',
       '100% = all systems running, issues escalated and resolved same day | 60% = some gaps in utilisation | 0% = persistent system failures unaddressed',
       'All systems operational and fully utilised',
       20, 100, 4)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ── Category 2 Tasks (weights sum to 100) ───────────────────────────────────

  IF cat2 IS NOT NULL THEN
    INSERT INTO kpi_task_templates (category_id, title, description, target, weight, max_score, sort_order) VALUES
      (cat2,
       'Weekly 1:1 meetings with all direct reports completed',
       '100% = all 1:1s held and logged weekly | 80% = 1 missed in period | 60% = 2–3 missed | 0% = not conducted regularly',
       '100% — every week',
       30, 100, 1),
      (cat2,
       'Performance reviews completed on schedule',
       '100% = all reviews completed on schedule | 60% = late but completed | 0% = missed or not conducted',
       '100% on time per review cycle',
       25, 100, 2),
      (cat2,
       'Structured development / coaching activity for each direct report',
       '100% = documented coaching conversations, growth evidence per DM | 60% = some activity but inconsistent | 0% = no development activity',
       'Active development visible for every DM',
       25, 100, 3),
      (cat2,
       'Disciplinary / people issues addressed within policy timelines',
       '100% = all cases resolved within policy | 60% = minor delays | 0% = cases unresolved or handled outside process',
       'Within defined policy timelines',
       20, 100, 4)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ── Category 3 Tasks (weights sum to 100) ───────────────────────────────────

  IF cat3 IS NOT NULL THEN
    INSERT INTO kpi_task_templates (category_id, title, description, target, weight, max_score, sort_order) VALUES
      (cat3,
       'Total operational budget variance',
       '100% = within 5% | 80% = 5–8% | 60% = 8–12% | 0% = >12% or no tracking',
       '≤ 5% over approved budget',
       30, 100, 1),
      (cat3,
       'Waste as % of total stock',
       '100% = ≤3% | 80% = 3–5% | 60% = 5–7% | 0% = >7% or not tracked',
       '≤ 3%',
       25, 100, 2),
      (cat3,
       'Purchase order approval turnaround',
       '100% = 100% within 24hrs | 80% = occasional delays | 60% = frequent delays | 0% = no consistent process',
       'Within 24 hours of submission',
       25, 100, 3),
      (cat3,
       'Monthly variance report submitted to GM',
       '100% = submitted on time, accurate, variance explained | 60% = late or incomplete | 0% = not submitted',
       'Accurate and on time monthly',
       20, 100, 4)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ── Category 4 Tasks (weights sum to 100) ───────────────────────────────────

  IF cat4 IS NOT NULL THEN
    INSERT INTO kpi_task_templates (category_id, title, description, target, weight, max_score, sort_order) VALUES
      (cat4,
       'Monthly food safety audit conducted and filed',
       '100% = conducted, scored, filed, corrective actions documented | 60% = conducted but incomplete documentation | 0% = not conducted',
       '100% — every month, documented',
       35, 100, 1),
      (cat4,
       'Food safety audit score',
       '100% = ≥90% | 80% = 85–89% | 60% = 80–84% | 0% = <80% or audit not completed',
       '≥ 90% compliance rating',
       30, 100, 2),
      (cat4,
       'Food safety incident rate — zero unaddressed breaches',
       '100% = no breaches OR all breaches investigated + corrective action within 24hrs | 60% = breach addressed but delayed | 0% = unaddressed breach (AUTOMATIC CATEGORY FAIL)',
       'Zero unaddressed breaches',
       35, 100, 3)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ── Category 5 Tasks (weights sum to 100) ───────────────────────────────────

  IF cat5 IS NOT NULL THEN
    INSERT INTO kpi_task_templates (category_id, title, description, target, weight, max_score, sort_order) VALUES
      (cat5,
       'Customer satisfaction score',
       '100% = ≥4.5 | 80% = 4.2–4.4 | 60% = 4.0–4.1 | 0% = <4.0 or not tracked',
       '≥ 4.5 / 5.0 across all channels',
       35, 100, 1),
      (cat5,
       'Customer complaint review conducted weekly',
       '100% = weekly review conducted, root causes identified, actions taken | 60% = irregular reviews | 0% = not conducted',
       '100% — every week, with documented root cause',
       35, 100, 2),
      (cat5,
       'Complaint trend reduction month-on-month',
       '100% = complaints reduced vs prior month | 80% = stable (no increase) | 60% = marginal increase | 0% = significant increase or no tracking',
       'Reduction over prior month',
       30, 100, 3)
    ON CONFLICT DO NOTHING;
  END IF;

  -- ── Category 6 Tasks (weights sum to 100) ───────────────────────────────────

  IF cat6 IS NOT NULL THEN
    INSERT INTO kpi_task_templates (category_id, title, description, target, weight, max_score, sort_order) VALUES
      (cat6,
       'Weekly Operations Report submitted on time',
       '100% = all reports submitted by deadline | 80% = 1 late | 60% = 2 late | 0% = 3+ missed or consistently late',
       '100% by deadline — every week',
       35, 100, 1),
      (cat6,
       'Monthly Business Performance Report submitted accurately and on time',
       '100% = accurate, on time, variance explained | 60% = late or incomplete | 0% = not submitted',
       '100% — monthly',
       30, 100, 2),
      (cat6,
       'Operational Risk Register maintained and reviewed with GM',
       '100% = current, reviewed with GM monthly | 60% = exists but not regularly updated | 0% = not maintained',
       'Updated monthly; reviewed with GM',
       20, 100, 3),
      (cat6,
       'Supplier performance reviews conducted quarterly',
       '100% = conducted on schedule with scorecards filed | 60% = conducted but undocumented | 0% = not conducted',
       'Quarterly — all active suppliers scored',
       15, 100, 4)
    ON CONFLICT DO NOTHING;
  END IF;

END $$;
