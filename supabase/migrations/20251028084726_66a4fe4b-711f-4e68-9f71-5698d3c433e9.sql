-- Fix RLS policies for njc_supplies table to allow updates with proper checks

-- Drop the existing update policy
DROP POLICY IF EXISTS "Users can update their own NJC supplies" ON public.njc_supplies;

-- Recreate the update policy with both USING and WITH CHECK clauses
CREATE POLICY "Users can update their own NJC supplies"
ON public.njc_supplies
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);