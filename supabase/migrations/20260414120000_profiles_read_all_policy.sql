-- Allow all authenticated users to read profiles (user_id + full_name only, non-sensitive)
-- Required so staff can see admin profiles in the messaging recipient list
CREATE POLICY "Authenticated users can view all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);
