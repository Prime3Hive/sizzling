-- Drop the existing restrictive update policy
DROP POLICY IF EXISTS "Users can update their own NJC supplies" ON public.njc_supplies;

-- Create new update policy that allows owners AND admins to update
CREATE POLICY "Users can update their own NJC supplies or admin" 
ON public.njc_supplies 
FOR UPDATE 
USING (auth.uid() = user_id OR is_admin(auth.uid()))
WITH CHECK (auth.uid() = user_id OR is_admin(auth.uid()));