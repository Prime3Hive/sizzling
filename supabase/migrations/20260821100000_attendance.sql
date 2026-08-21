-- ─────────────────────────────────────────────────────────────────────────────
-- Attendance
--
-- Who says what
-- ─────────────
--   HR / admin   mark each staff member's day, with a note where one is needed
--   HR           submit the week as a report, with a comment on the week
--   admin        approve or reject that weekly report
--   staff        see their own days — but only once the week is approved
--   staff        ask for a day to be reviewed; admin decides
--
-- Nobody else marks attendance. A staff member never writes to their own
-- record; the only thing they can create is a review request, and the only
-- thing that changes a marked day afterwards is an admin approving one.
--
-- Three tables
-- ────────────
--   attendance_weeks            one row per Monday — the weekly report itself
--   attendance_records          one row per staff member per day
--   attendance_review_requests  a staff member's challenge to one of those days
--
-- Two windows close over a day, and both are enforced here rather than in the
-- UI, because a correction window only the UI knows about is not a control:
--
--   the month   a review can only be RAISED while the day still falls in the
--               current month. Come the 1st, last month is settled.
--   payroll     once payroll covering the day is processed (status 'paid',
--               not cancelled) the day is SEALED: no marking, no correction,
--               no deletion, by anyone. Closing the books through a date seals
--               it too — same rule, same function.
--
-- A review left undecided when payroll seals the period lapses with it. That is
-- deliberate: the alternative is a correction landing after the money moved.
--
-- Ordering: run AFTER 20260723102000_period_locks_audit_log.sql (fn_books_locked)
--           and AFTER 20260816130000_phase1_no_delete_financial_records.sql
--               (payroll_records.cancelled_at).
-- ROLLBACK: 20260821100000_attendance.down.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 0. Preflight ─────────────────────────────────────────────────────────────
DO $preflight$
DECLARE missing text := '';
BEGIN
  IF to_regprocedure('public.fn_books_locked(date)') IS NULL THEN
    missing := missing || E'\n  - fn_books_locked: apply 20260723102000_period_locks_audit_log.sql';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payroll_records'
      AND column_name = 'cancelled_at'
  ) THEN
    missing := missing || E'\n  - payroll_records.cancelled_at: apply 20260816130000_phase1_no_delete_financial_records.sql';
  END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION 'Attendance migration cannot run, prerequisites missing:%', missing;
  END IF;
END $preflight$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Windows — when is a day still open?
-- ═════════════════════════════════════════════════════════════════════════════

-- Monday of the week a date falls in. date_trunc('week', …) is Monday-based in
-- Postgres, which matches the "This Week" range the finance report already uses.
CREATE OR REPLACE FUNCTION public.fn_attendance_week_start(p_date date)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT (date_trunc('week', p_date::timestamp))::date;
$$;

-- Sealed = the money for this day has gone out, or the books are shut.
CREATE OR REPLACE FUNCTION public.fn_attendance_sealed(p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_books_locked(p_date)
      OR EXISTS (
           SELECT 1 FROM public.payroll_records pr
           WHERE pr.status IN ('paid', 'processed')
             AND pr.cancelled_at IS NULL
             AND p_date BETWEEN pr.period_start AND pr.period_end
         );
$$;

-- A review may only be raised while the day is still in the running month.
CREATE OR REPLACE FUNCTION public.fn_attendance_review_open(p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT date_trunc('month', p_date::timestamp) = date_trunc('month', current_date::timestamp)
     AND NOT public.fn_attendance_sealed(p_date);
$$;

-- Marking rights. HR and admin only — never the staff member themselves.
CREATE OR REPLACE FUNCTION public.fn_can_mark_attendance(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin(_user_id) OR public.has_role(_user_id, 'hr'::app_role);
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Tables
-- ═════════════════════════════════════════════════════════════════════════════

-- ── The weekly report ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_weeks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start   date NOT NULL UNIQUE,          -- Monday
  week_end     date NOT NULL,                 -- Sunday
  status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  hr_comment   text,                          -- HR's comment on the week as a whole
  prepared_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  review_note  text,                          -- admin's note on approval / rejection
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (week_end = week_start + 6)
);

CREATE INDEX IF NOT EXISTS idx_attendance_weeks_status ON public.attendance_weeks(status);

-- ── The marked days ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id          uuid NOT NULL REFERENCES public.attendance_weeks(id) ON DELETE CASCADE,
  staff_profile_id uuid NOT NULL REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  -- Denormalised from staff_profiles.linked_user_id so "show me my attendance"
  -- is one indexed predicate in RLS rather than a join on every row read.
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  work_date        date NOT NULL,
  status           text NOT NULL
                     CHECK (status IN ('present', 'late', 'half_day', 'absent',
                                       'excused', 'on_leave', 'holiday', 'off_day')),
  check_in         time,
  check_out        time,
  hr_note          text,                      -- "where necessary": why this day is what it is
  marked_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_at        timestamptz NOT NULL DEFAULT now(),
  -- Set when an approved review changes the day. The original mark stays
  -- readable: a correction is a second statement, not an erasure.
  corrected_from   text,
  corrected_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  corrected_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_profile_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_week  ON public.attendance_records(week_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_user  ON public.attendance_records(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_staff ON public.attendance_records(staff_profile_id, work_date);

-- ── Staff challenges ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_review_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id      uuid NOT NULL REFERENCES public.attendance_records(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_status text CHECK (claimed_status IN ('present', 'late', 'half_day', 'absent',
                                                'excused', 'on_leave', 'holiday', 'off_day')),
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  decision_note  text,
  decided_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_reviews_status ON public.attendance_review_requests(status);
CREATE INDEX IF NOT EXISTS idx_attendance_reviews_user   ON public.attendance_review_requests(user_id);

-- One open challenge per day. Someone with more to say adds it to the reason;
-- two parallel requests would be two answers to one question.
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_reviews_one_open
  ON public.attendance_review_requests(record_id) WHERE status = 'pending';

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Guards — the rules, in the database
-- ═════════════════════════════════════════════════════════════════════════════

-- The week report. Status moves one way through the mill:
--   draft ⇄ submitted → approved (final)
--                    ↘ rejected → back to draft
CREATE OR REPLACE FUNCTION public.fn_guard_attendance_week()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_start date;
BEGIN
  -- NEW is unassigned on DELETE, so the delete path is answered before any
  -- expression touches it.
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Week of % has been %; a submitted or approved attendance week is a record and cannot be deleted.',
        OLD.week_start, OLD.status USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only an admin can delete an attendance week.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  row_start := CASE WHEN TG_OP = 'INSERT'
                    THEN public.fn_attendance_week_start(NEW.week_start)
                    ELSE OLD.week_start END;

  -- A week that payroll has settled is closed to everyone.
  IF public.fn_attendance_sealed(row_start) THEN
    RAISE EXCEPTION 'The week of % is sealed — payroll for that period has been processed (or the books are closed).',
      row_start USING ERRCODE = 'restrict_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.week_start := public.fn_attendance_week_start(NEW.week_start);
    NEW.week_end   := NEW.week_start + 6;
    NEW.prepared_by := COALESCE(NEW.prepared_by, auth.uid());
    NEW.status := COALESCE(NEW.status, 'draft');
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'A new attendance week starts as a draft.' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  NEW.week_start := OLD.week_start;   -- a week cannot be moved onto other dates
  NEW.week_end   := OLD.week_end;
  NEW.updated_at := now();

  IF OLD.status = 'approved' AND NEW.status <> 'approved' THEN
    RAISE EXCEPTION 'The week of % is approved. Reopening it would rewrite attendance staff have already seen; correct a day through a review instead.',
      OLD.week_start USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('approved', 'rejected') THEN
      IF NOT public.is_admin(auth.uid()) THEN
        RAISE EXCEPTION 'Only an admin approves or rejects the weekly attendance report.'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF OLD.status <> 'submitted' THEN
        RAISE EXCEPTION 'The week of % has not been submitted yet.', OLD.week_start
          USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    ELSIF NEW.status = 'submitted' THEN
      IF NOT EXISTS (SELECT 1 FROM public.attendance_records WHERE week_id = NEW.id) THEN
        RAISE EXCEPTION 'There is nothing to submit for the week of % — no attendance has been marked.',
          OLD.week_start USING ERRCODE = 'restrict_violation';
      END IF;
      NEW.submitted_by := auth.uid();
      NEW.submitted_at := now();
    ELSIF NEW.status = 'draft' THEN
      -- Recalled by HR, or sent back by an admin's rejection.
      NEW.submitted_by := NULL;
      NEW.submitted_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_attendance_week ON public.attendance_weeks;
CREATE TRIGGER trg_guard_attendance_week
  BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_weeks
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_attendance_week();

-- The marked days. Editable while the week is a draft or was rejected; frozen
-- once submitted; after approval only an approved review can move one, which it
-- does with app.attendance_correction set — see fn_decide_attendance_review.
CREATE OR REPLACE FUNCTION public.fn_guard_attendance_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r          record;
  wk         record;
  correcting boolean := COALESCE(current_setting('app.attendance_correction', true), '') = '1';
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;

  -- The correction flag relaxes the week-state rules below, so it may only ever
  -- be honoured for an admin. fn_decide_attendance_review is the one caller
  -- that sets it, and it already refuses anyone else.
  IF correcting THEN
    IF NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only an admin can correct a marked attendance day.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT public.fn_can_mark_attendance(auth.uid()) THEN
    RAISE EXCEPTION 'Attendance is marked by HR or an admin only.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.fn_attendance_sealed(r.work_date) THEN
    RAISE EXCEPTION 'Attendance for % is sealed — payroll for that period has been processed (or the books are closed).',
      r.work_date USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND public.fn_attendance_sealed(OLD.work_date) THEN
    RAISE EXCEPTION 'Attendance for % is sealed and cannot be moved.', OLD.work_date
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT * INTO wk FROM public.attendance_weeks WHERE id = r.week_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'An attendance day must belong to a week.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF r.work_date < wk.week_start OR r.work_date > wk.week_end THEN
    RAISE EXCEPTION '% does not fall in the week of % to %.', r.work_date, wk.week_start, wk.week_end
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT correcting THEN
    IF wk.status = 'approved' THEN
      RAISE EXCEPTION 'The week of % is approved. Change a day through an approved review request, not by re-marking it.',
        wk.week_start USING ERRCODE = 'restrict_violation';
    ELSIF wk.status = 'submitted' THEN
      RAISE EXCEPTION 'The week of % is with the admin for approval. Recall it to draft before changing a day.',
        wk.week_start USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  -- The staff member's login, taken from their profile — never from the caller.
  SELECT sp.linked_user_id INTO NEW.user_id
  FROM public.staff_profiles sp WHERE sp.id = NEW.staff_profile_id;

  IF TG_OP = 'INSERT' THEN
    NEW.marked_by := COALESCE(NEW.marked_by, auth.uid());
    NEW.marked_at := now();
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.marked_at := now();
    IF NOT correcting THEN NEW.marked_by := auth.uid(); END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_attendance_record ON public.attendance_records;
CREATE TRIGGER trg_guard_attendance_record
  BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_attendance_record();

-- Review requests. A staff member raises one on their own approved day, inside
-- the month, and may withdraw it while it is still pending. Everything else —
-- approving, rejecting, changing the day — goes through the RPC below.
CREATE OR REPLACE FUNCTION public.fn_guard_attendance_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A review request is a record. Withdraw it instead — the request and its answer stay on the file.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT ar.*, aw.status AS week_status INTO rec
  FROM public.attendance_records ar
  JOIN public.attendance_weeks aw ON aw.id = ar.week_id
  WHERE ar.id = NEW.record_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That attendance day no longer exists.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF rec.week_status <> 'approved' THEN
      RAISE EXCEPTION 'That week has not been approved yet, so there is nothing to review.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF rec.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'You can only ask for a review of your own attendance.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT public.fn_attendance_review_open(rec.work_date) THEN
      RAISE EXCEPTION 'The window for % has closed. Attendance can only be reviewed within the month it falls in, and never once payroll for the period has been processed.',
        rec.work_date USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.claimed_status IS NOT NULL AND NEW.claimed_status = rec.status THEN
      RAISE EXCEPTION 'That day is already marked %.', rec.status USING ERRCODE = 'check_violation';
    END IF;
    NEW.user_id := auth.uid();
    NEW.status  := 'pending';
    NEW.decided_by := NULL; NEW.decided_at := NULL; NEW.decision_note := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE. The owner may only withdraw a pending request; decisions are the
  -- RPC's job and arrive with app.attendance_correction set.
  IF COALESCE(current_setting('app.attendance_correction', true), '') <> '1' THEN
    IF NOT (OLD.status = 'pending' AND NEW.status = 'withdrawn' AND NEW.user_id = auth.uid()) THEN
      RAISE EXCEPTION 'A review request is answered by an admin. You can withdraw yours while it is still pending.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.record_id := OLD.record_id;
    NEW.reason    := OLD.reason;
    NEW.claimed_status := OLD.claimed_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_attendance_review ON public.attendance_review_requests;
CREATE TRIGGER trg_guard_attendance_review
  BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_review_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_attendance_review();

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. The two operations that need more than a row write
-- ═════════════════════════════════════════════════════════════════════════════

-- Open (or find) the week a date belongs to. HR calls this before marking; it
-- is idempotent, so two people opening the same week get the same week.
CREATE OR REPLACE FUNCTION public.fn_open_attendance_week(p_any_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ws     date := public.fn_attendance_week_start(p_any_date);
  v_week uuid;
BEGIN
  IF NOT public.fn_can_mark_attendance(auth.uid()) THEN
    RAISE EXCEPTION 'Attendance is marked by HR or an admin only.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT w.id INTO v_week FROM public.attendance_weeks w WHERE w.week_start = ws;
  IF FOUND THEN RETURN v_week; END IF;

  IF public.fn_attendance_sealed(ws) THEN
    RAISE EXCEPTION 'The week of % is sealed — payroll for that period has been processed (or the books are closed).',
      ws USING ERRCODE = 'restrict_violation';
  END IF;

  INSERT INTO public.attendance_weeks (week_start, week_end, prepared_by)
  VALUES (ws, ws + 6, auth.uid())
  ON CONFLICT (week_start) DO UPDATE SET updated_at = now()
  RETURNING attendance_weeks.id INTO v_week;

  RETURN v_week;
END;
$$;

-- Answer a review request. Approving is the only path that moves an approved
-- day, and it records what the day used to say.
CREATE OR REPLACE FUNCTION public.fn_decide_attendance_review(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  req record;
  rec record;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin decides an attendance review.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO req FROM public.attendance_review_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That review request no longer exists.';
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'That request has already been %.', req.status USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT * INTO rec FROM public.attendance_records WHERE id = req.record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The day this request refers to no longer exists.';
  END IF;

  -- The month rule bounds the request; the seal bounds the answer. A request
  -- that outlives payroll lapses rather than landing after the money moved.
  IF public.fn_attendance_sealed(rec.work_date) THEN
    RAISE EXCEPTION 'Attendance for % is sealed — payroll for that period has been processed. This request can no longer be actioned.',
      rec.work_date USING ERRCODE = 'restrict_violation';
  END IF;

  PERFORM set_config('app.attendance_correction', '1', true);

  IF p_approve AND req.claimed_status IS NOT NULL AND req.claimed_status <> rec.status THEN
    UPDATE public.attendance_records
    SET status         = req.claimed_status,
        corrected_from = rec.status,
        corrected_by   = auth.uid(),
        corrected_at   = now()
    WHERE id = rec.id;
  END IF;

  UPDATE public.attendance_review_requests
  SET status        = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
      decision_note = p_note,
      decided_by    = auth.uid(),
      decided_at    = now()
  WHERE id = p_request_id;

  PERFORM set_config('app.attendance_correction', '0', true);
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Row level security
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.attendance_weeks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_review_requests ENABLE ROW LEVEL SECURITY;

-- Weeks. Everyone reads the status — a staff member has to be able to tell
-- "not marked yet" from "marked but not approved". Only HR and admin write,
-- and the trigger above decides which transitions they may make.
DROP POLICY IF EXISTS "attendance_weeks_read" ON public.attendance_weeks;
CREATE POLICY "attendance_weeks_read" ON public.attendance_weeks
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "attendance_weeks_write" ON public.attendance_weeks;
CREATE POLICY "attendance_weeks_write" ON public.attendance_weeks
  FOR INSERT TO authenticated WITH CHECK (public.fn_can_mark_attendance(auth.uid()));

DROP POLICY IF EXISTS "attendance_weeks_update" ON public.attendance_weeks;
CREATE POLICY "attendance_weeks_update" ON public.attendance_weeks
  FOR UPDATE TO authenticated
  USING     (public.fn_can_mark_attendance(auth.uid()))
  WITH CHECK (public.fn_can_mark_attendance(auth.uid()));

DROP POLICY IF EXISTS "attendance_weeks_delete" ON public.attendance_weeks;
CREATE POLICY "attendance_weeks_delete" ON public.attendance_weeks
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- Days. HR and admin see everything. A staff member sees their own days, and
-- only once the week carrying them has been approved — an unapproved mark is
-- HR's working paper, not a statement about the staff member yet.
DROP POLICY IF EXISTS "attendance_records_read" ON public.attendance_records;
CREATE POLICY "attendance_records_read" ON public.attendance_records
  FOR SELECT TO authenticated
  USING (
    public.fn_can_mark_attendance(auth.uid())
    OR (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.attendance_weeks w
        WHERE w.id = attendance_records.week_id AND w.status = 'approved'
      )
    )
  );

DROP POLICY IF EXISTS "attendance_records_write" ON public.attendance_records;
CREATE POLICY "attendance_records_write" ON public.attendance_records
  FOR INSERT TO authenticated WITH CHECK (public.fn_can_mark_attendance(auth.uid()));

DROP POLICY IF EXISTS "attendance_records_update" ON public.attendance_records;
CREATE POLICY "attendance_records_update" ON public.attendance_records
  FOR UPDATE TO authenticated
  USING     (public.fn_can_mark_attendance(auth.uid()))
  WITH CHECK (public.fn_can_mark_attendance(auth.uid()));

DROP POLICY IF EXISTS "attendance_records_delete" ON public.attendance_records;
CREATE POLICY "attendance_records_delete" ON public.attendance_records
  FOR DELETE TO authenticated USING (public.fn_can_mark_attendance(auth.uid()));

-- Review requests. Yours, or all of them if you are HR or an admin.
DROP POLICY IF EXISTS "attendance_reviews_read" ON public.attendance_review_requests;
CREATE POLICY "attendance_reviews_read" ON public.attendance_review_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.fn_can_mark_attendance(auth.uid()));

DROP POLICY IF EXISTS "attendance_reviews_insert" ON public.attendance_review_requests;
CREATE POLICY "attendance_reviews_insert" ON public.attendance_review_requests
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Withdrawal only; every other change is refused by the trigger.
DROP POLICY IF EXISTS "attendance_reviews_update" ON public.attendance_review_requests;
CREATE POLICY "attendance_reviews_update" ON public.attendance_review_requests
  FOR UPDATE TO authenticated
  USING     (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_weeks           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_records         TO authenticated;
GRANT SELECT, INSERT, UPDATE          ON public.attendance_review_requests TO authenticated;

GRANT EXECUTE ON FUNCTION public.fn_open_attendance_week(date)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_decide_attendance_review(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_attendance_sealed(date)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_attendance_review_open(date)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_attendance_week_start(date)                   TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Audit trail
-- ═════════════════════════════════════════════════════════════════════════════
-- Attendance drives pay, so it is audited on the same terms as the tables that
-- pay is calculated from — who marked what, and what it used to say.
DO $audit$
DECLARE t text;
BEGIN
  IF to_regprocedure('public.fn_audit_row()') IS NULL THEN RETURN; END IF;
  FOREACH t IN ARRAY ARRAY['attendance_weeks', 'attendance_records', 'attendance_review_requests'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.fn_audit_row()', t, t);
  END LOOP;
END $audit$;

COMMIT;
