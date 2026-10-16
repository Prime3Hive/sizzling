-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK of 20260926100000_staff_exit_status.sql
--
-- Drops the exit columns — every archived staff member becomes indistinguishable
-- from an active one again, and their exit date/reason/note are lost.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

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
  WHERE sp.date_of_birth IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.guard_staff_profile_sensitive_fields()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT is_admin(auth.uid()) THEN
      NEW.salary := NULL;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT is_admin(auth.uid()) THEN
      NEW.salary := OLD.salary;
    END IF;
    IF NOT (is_admin(auth.uid()) OR has_role(auth.uid(), 'hr'::app_role)) THEN
      NEW.bank_name      := OLD.bank_name;
      NEW.account_number := OLD.account_number;
      NEW.account_name   := OLD.account_name;
      NEW.nin            := OLD.nin;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS public.idx_staff_profiles_employment_status;

ALTER TABLE public.staff_profiles
  DROP CONSTRAINT IF EXISTS staff_profiles_exit_date_required,
  DROP CONSTRAINT IF EXISTS staff_profiles_exit_reason_check,
  DROP CONSTRAINT IF EXISTS staff_profiles_employment_status_check,
  DROP COLUMN IF EXISTS exit_note,
  DROP COLUMN IF EXISTS exit_reason,
  DROP COLUMN IF EXISTS exit_date,
  DROP COLUMN IF EXISTS employment_status;

COMMIT;
