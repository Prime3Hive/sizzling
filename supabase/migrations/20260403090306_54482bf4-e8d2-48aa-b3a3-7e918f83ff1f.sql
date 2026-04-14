
-- 1. Create trigger on auth.users to auto-create profile
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 2. Create trigger on profiles to auto-assign employee role
CREATE OR REPLACE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();

-- 3. HR can insert staff profiles
CREATE POLICY "HR can insert staff profiles"
  ON public.staff_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'hr'::app_role));

-- 4. HR can delete staff profiles (but not admin-linked ones, enforced in app)
CREATE POLICY "HR can delete staff profiles"
  ON public.staff_profiles
  FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'hr'::app_role));

-- 5. Allow any authenticated user to insert notifications (for payroll system)
DROP POLICY IF EXISTS "Admins can insert notifications" ON public.notifications;
CREATE POLICY "Authenticated users can insert notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 6. Admin can view all profiles in profiles table
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- 7. HR can view all profiles in profiles table
CREATE POLICY "HR can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'hr'::app_role));

-- 8. HR can view departments
CREATE POLICY "HR can view all departments"
  ON public.departments
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'hr'::app_role));
