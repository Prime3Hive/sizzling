-- ================================================================
-- STAFF PROFILES RLS FIX
-- Problem: hardening migration removed open SELECT policy but only
-- added admin SELECT. Staff cannot view their own profile; HR
-- cannot view any profiles.
--
-- Changes:
--   1. Add HR SELECT policy (all profiles)
--   2. Add staff own-row SELECT policy (via linked_user_id)
--   3. Add HR UPDATE policy (all profiles, trigger guards salary)
--   4. Add staff own-row UPDATE policy (trigger guards sensitive fields)
--   5. Update guard trigger: only Admin may change salary;
--      Admin + HR may change bank/NIN fields; staff cannot touch either
-- ================================================================

-- ── 1. HR CAN READ ALL STAFF PROFILES ────────────────────────────
DROP POLICY IF EXISTS "HR can view all staff profiles" ON public.staff_profiles;
CREATE POLICY "HR can view all staff profiles"
  ON public.staff_profiles FOR SELECT
  USING (has_role(auth.uid(), 'hr'::app_role));

-- ── 2. STAFF CAN READ THEIR OWN PROFILE ROW ──────────────────────
DROP POLICY IF EXISTS "Staff can view own profile" ON public.staff_profiles;
CREATE POLICY "Staff can view own profile"
  ON public.staff_profiles FOR SELECT
  USING (linked_user_id = auth.uid());

-- ── 3. HR CAN UPDATE ALL PROFILES ────────────────────────────────
-- The trigger below blocks HR from changing salary.
DROP POLICY IF EXISTS "HR can update staff profiles" ON public.staff_profiles;
CREATE POLICY "HR can update staff profiles"
  ON public.staff_profiles FOR UPDATE
  USING  (has_role(auth.uid(), 'hr'::app_role))
  WITH CHECK (has_role(auth.uid(), 'hr'::app_role));

-- ── 4. STAFF CAN UPDATE THEIR OWN PROFILE ────────────────────────
-- The trigger blocks salary / bank / NIN changes from non-admin/HR.
DROP POLICY IF EXISTS "Staff can update own profile" ON public.staff_profiles;
CREATE POLICY "Staff can update own profile"
  ON public.staff_profiles FOR UPDATE
  USING  (linked_user_id = auth.uid())
  WITH CHECK (linked_user_id = auth.uid());

-- ── 5. UPDATE SENSITIVE-FIELD GUARD TRIGGER ──────────────────────
-- Previous version: admin + HR could change all sensitive fields.
-- New rules:
--   • Salary        → Admin only (HR cannot change salary)
--   • Bank / NIN    → Admin + HR (staff cannot change)
CREATE OR REPLACE FUNCTION public.guard_staff_profile_sensitive_fields()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Salary: Admin-only
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

  RETURN NEW;
END;
$$;
