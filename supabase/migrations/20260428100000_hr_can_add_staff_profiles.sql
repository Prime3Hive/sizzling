-- ================================================================
-- ALLOW HR TO CREATE STAFF PROFILES (SALARY REMAINS ADMIN-ONLY)
-- Changes:
--   1. Add HR INSERT policy on staff_profiles
--   2. Extend sensitive-fields guard trigger to fire on INSERT
--      so HR can never set salary even if they bypass the UI
-- ================================================================

-- ── 1. HR INSERT POLICY ───────────────────────────────────────────
DROP POLICY IF EXISTS "HR can insert staff profiles" ON public.staff_profiles;
CREATE POLICY "HR can insert staff profiles"
  ON public.staff_profiles FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'hr'::app_role));

-- ── 2. EXTEND TRIGGER TO COVER INSERT ────────────────────────────
-- On INSERT by non-admin: force salary to NULL regardless of submitted value.
-- On UPDATE: existing behaviour (overwrite with OLD values).
-- Bank/NIN on INSERT: HR can set them (they are creating the record).

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

    -- Bank details + NIN: Admin and HR only
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

-- Re-create trigger to fire on BOTH INSERT and UPDATE
DROP TRIGGER IF EXISTS staff_profile_sensitive_guard ON public.staff_profiles;
CREATE TRIGGER staff_profile_sensitive_guard
  BEFORE INSERT OR UPDATE ON public.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_profile_sensitive_fields();
