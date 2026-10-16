-- ═════════════════════════════════════════════════════════════════════════════
-- STAFF EXIT: archive a staff member who has left instead of deleting them
--
-- Deleting a staff_profiles row cascades into attendance, payroll history, KPI
-- scores and documents, so "they left" had no safe way to be recorded. This
-- adds an employment status plus the exit details HR needs, and keeps former
-- staff out of the birthday calendar.
--
--   employment_status   'active' | 'inactive'  (default active, so every
--                       existing row stays exactly as it is)
--   exit_date           last working day
--   exit_reason         resigned | terminated | retired | contract_ended |
--                       deceased | other
--   exit_note           free text
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Columns ──────────────────────────────────────────────────────────────

ALTER TABLE public.staff_profiles
  ADD COLUMN IF NOT EXISTS employment_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS exit_date   date,
  ADD COLUMN IF NOT EXISTS exit_reason text,
  ADD COLUMN IF NOT EXISTS exit_note   text;

ALTER TABLE public.staff_profiles
  DROP CONSTRAINT IF EXISTS staff_profiles_employment_status_check,
  ADD  CONSTRAINT staff_profiles_employment_status_check
       CHECK (employment_status IN ('active', 'inactive'));

ALTER TABLE public.staff_profiles
  DROP CONSTRAINT IF EXISTS staff_profiles_exit_reason_check,
  ADD  CONSTRAINT staff_profiles_exit_reason_check
       CHECK (exit_reason IS NULL OR exit_reason IN
         ('resigned', 'terminated', 'retired', 'contract_ended', 'deceased', 'other'));

-- An inactive profile must say when the person left.
ALTER TABLE public.staff_profiles
  DROP CONSTRAINT IF EXISTS staff_profiles_exit_date_required,
  ADD  CONSTRAINT staff_profiles_exit_date_required
       CHECK (employment_status = 'active' OR exit_date IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_employment_status
  ON public.staff_profiles(employment_status);

-- ── 2. Only Admin/HR may change the exit fields ─────────────────────────────
-- Same trigger as 20260428100000, with the exit fields added to the Admin/HR
-- block so a linked staff member editing their own profile cannot reinstate
-- or archive themselves.

CREATE OR REPLACE FUNCTION public.guard_staff_profile_sensitive_fields()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Salary: only Admin may set it on creation
    IF NOT is_admin(auth.uid()) THEN
      NEW.salary := NULL;
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Salary: Admin-only — all other roles keep the existing value
    IF NOT is_admin(auth.uid()) THEN
      NEW.salary := OLD.salary;
    END IF;

    -- Bank details, NIN and employment status: Admin and HR only
    IF NOT (is_admin(auth.uid()) OR has_role(auth.uid(), 'hr'::app_role)) THEN
      NEW.bank_name         := OLD.bank_name;
      NEW.account_number    := OLD.account_number;
      NEW.account_name      := OLD.account_name;
      NEW.nin               := OLD.nin;
      NEW.employment_status := OLD.employment_status;
      NEW.exit_date         := OLD.exit_date;
      NEW.exit_reason       := OLD.exit_reason;
      NEW.exit_note         := OLD.exit_note;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Birthday calendar shows current staff only ───────────────────────────

CREATE OR REPLACE FUNCTION public.get_birthday_profiles()
RETURNS TABLE(
  id              uuid,
  full_name       text,
  date_of_birth   date,
  "position"      text,
  passport_path   text,
  department_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    sp.id,
    sp.full_name::text,
    sp.date_of_birth,
    sp.position::text,
    sp.passport_path,
    d.name::text AS department_name
  FROM public.staff_profiles sp
  LEFT JOIN public.departments d ON d.id = sp.department_id
  WHERE sp.date_of_birth IS NOT NULL
    AND sp.employment_status = 'active';
$$;

COMMIT;
