-- ─────────────────────────────────────────────────────────────────────────────
-- Link an expense back to the staff report that produced it.
--
-- The Amount Corrections screen shows a corrupted row and its narrative, but
-- there was no way to reach the report behind it — so an approver could see
-- that ₦1.54 was wrong without being able to open what the staff member
-- actually submitted, or the receipts attached to it.
--
-- New approvals record the link. Historical rows are backfilled only where the
-- match is unambiguous; a guessed link on a financial record is worse than no
-- link, because it looks like evidence.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source_report_id uuid
    REFERENCES public.staff_reports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_source_report
  ON public.expenses (source_report_id);

COMMENT ON COLUMN public.expenses.source_report_id IS
  'The staff report this expense was posted from, where known. NULL for '
  'directly captured expenses and for historical rows whose report could not '
  'be identified unambiguously.';

-- ── Backfill 1: the exact link the approval already recorded ────────────────
-- staff_reports.converted_ref holds the id of the FIRST expense created from
-- the report, so this is certain but only ever matches one row per report.

UPDATE public.expenses e
   SET source_report_id = r.id
  FROM public.staff_reports r
 WHERE e.source_report_id IS NULL
   AND r.report_type = 'expense'
   AND r.converted_ref IS NOT NULL
   AND r.converted_ref::text = e.id::text;

-- ── Backfill 2: the siblings of an exact match ──────────────────────────────
-- An approval wrote all of a report's lines in one statement, so the rows
-- share a created_at to the microsecond and a date. Where an exact match above
-- has already anchored one row, its identical siblings belong to the same
-- report. This is tight enough to be evidence rather than a guess.

UPDATE public.expenses e
   SET source_report_id = anchor.source_report_id
  FROM (
    SELECT source_report_id, date, created_at, created_by
      FROM public.expenses
     WHERE source_report_id IS NOT NULL
  ) AS anchor
 WHERE e.source_report_id IS NULL
   AND e.date          = anchor.date
   AND e.created_at    = anchor.created_at
   AND e.created_by IS NOT DISTINCT FROM anchor.created_by;

-- Deliberately NOT attempted: matching by date alone. Two reports approved on
-- the same day would be linked to each other's rows, and a wrong link here
-- would send someone to correct the wrong figures.

COMMIT;
