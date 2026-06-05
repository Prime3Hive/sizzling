-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: kpi_task_assignments weight check + confirm multi-task per period
--
-- The original table (20260418130000) created the weight column as:
--     weight integer ... CHECK (weight BETWEEN 1 AND 10)
-- A later migration (20260512150000) tried to widen this to 0–100 so that
-- percentage-based weights from the task library (e.g. 25%, 40%) would be valid,
-- but that statement never took effect on the live database — assignments still
-- fail with "violates check constraint kpi_task_assignments_weight_check".
--
-- This migration re-applies the widening idempotently, and explicitly ensures
-- there is NO unique constraint blocking more than one task per staff per period.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Weight: allow 0–100 (percentage share of the category), matching templates
ALTER TABLE kpi_task_assignments
  DROP CONSTRAINT IF EXISTS kpi_task_assignments_weight_check;

ALTER TABLE kpi_task_assignments
  ADD CONSTRAINT kpi_task_assignments_weight_check
  CHECK (weight >= 0 AND weight <= 100);

-- 2. Multiple tasks per (period, staff) must be allowed. There should be no
--    unique constraint here (that uniqueness belongs to kpi_staff_scores, the
--    one-row-per-period summary). Drop it defensively if one ever got added.
ALTER TABLE kpi_task_assignments
  DROP CONSTRAINT IF EXISTS kpi_task_assignments_period_id_staff_profile_id_key;

-- 3. Same safety for max_score: ensure it permits the full 1–100 range used by
--    the form and templates (original allowed 1–100 already; reassert it).
ALTER TABLE kpi_task_assignments
  DROP CONSTRAINT IF EXISTS kpi_task_assignments_max_score_check;

ALTER TABLE kpi_task_assignments
  ADD CONSTRAINT kpi_task_assignments_max_score_check
  CHECK (max_score >= 1 AND max_score <= 100);
