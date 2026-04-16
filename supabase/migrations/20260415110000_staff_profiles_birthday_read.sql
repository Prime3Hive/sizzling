-- Allow all authenticated users to read name + birthday from staff_profiles
-- (required for birthday calendar visible to all staff)
CREATE POLICY "All staff can view birthdays"
  ON public.staff_profiles
  FOR SELECT
  TO authenticated
  USING (true);
