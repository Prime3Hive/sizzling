-- ─────────────────────────────────────────────────────────────────────────────
-- KPI Task Library → Department-based remodel
-- Model becomes: Department → Category → Task
--   • Each kpi_category now belongs to a department
--   • All existing categories (the Operations-Manager framework) move to Operations
--   • Category names become unique per-department (not globally)
-- Tasks (kpi_task_templates) stay under categories, so the weighted grading
-- rollup is unchanged. Assignment is scoped to staff within the department.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add department_id to kpi_categories ───────────────────────────────────

ALTER TABLE kpi_categories
  ADD COLUMN IF NOT EXISTS department_id uuid
    REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kpi_categories_department
  ON kpi_categories(department_id);

-- ── 2. Backfill: move every existing category to the Operations department ────

UPDATE kpi_categories
SET department_id = (
  SELECT id FROM departments WHERE name = 'Operations' LIMIT 1
)
WHERE department_id IS NULL;

-- ── 3. Category names: unique per department, not globally ────────────────────
-- The old global unique blocked two departments from re-using a category name
-- (e.g. both Sales and Operations having a "Quality" category).

ALTER TABLE kpi_categories
  DROP CONSTRAINT IF EXISTS kpi_categories_name_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kpi_categories_dept_name_unique'
  ) THEN
    ALTER TABLE kpi_categories
      ADD CONSTRAINT kpi_categories_dept_name_unique UNIQUE (department_id, name);
  END IF;
END $$;
