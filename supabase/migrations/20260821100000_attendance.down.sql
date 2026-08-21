-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK of 20260821100000_attendance.sql
--
-- This DROPS the attendance tables and everything marked in them. There is no
-- other copy of who was present on which day, so take a dump first if the data
-- has been used for a single payroll run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP TRIGGER IF EXISTS trg_audit_attendance_review_requests ON public.attendance_review_requests;
DROP TRIGGER IF EXISTS trg_audit_attendance_records         ON public.attendance_records;
DROP TRIGGER IF EXISTS trg_audit_attendance_weeks           ON public.attendance_weeks;

DROP TRIGGER IF EXISTS trg_guard_attendance_review ON public.attendance_review_requests;
DROP TRIGGER IF EXISTS trg_guard_attendance_record ON public.attendance_records;
DROP TRIGGER IF EXISTS trg_guard_attendance_week   ON public.attendance_weeks;

DROP FUNCTION IF EXISTS public.fn_decide_attendance_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.fn_open_attendance_week(date);
DROP FUNCTION IF EXISTS public.fn_guard_attendance_review();
DROP FUNCTION IF EXISTS public.fn_guard_attendance_record();
DROP FUNCTION IF EXISTS public.fn_guard_attendance_week();

DROP TABLE IF EXISTS public.attendance_review_requests;
DROP TABLE IF EXISTS public.attendance_records;
DROP TABLE IF EXISTS public.attendance_weeks;

DROP FUNCTION IF EXISTS public.fn_can_mark_attendance(uuid);
DROP FUNCTION IF EXISTS public.fn_attendance_review_open(date);
DROP FUNCTION IF EXISTS public.fn_attendance_sealed(date);
DROP FUNCTION IF EXISTS public.fn_attendance_week_start(date);

COMMIT;
