-- Allow staff to read their own payroll records via linked staff profile
-- Admin, HR, and Manager can read all records

ALTER TABLE public.payroll_records ENABLE ROW LEVEL SECURITY;

-- Drop any conflicting policy
DROP POLICY IF EXISTS "Payroll records access" ON public.payroll_records;

CREATE POLICY "Payroll records access"
  ON public.payroll_records
  FOR SELECT
  USING (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'hr'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.staff_profiles sp
      WHERE sp.id = payroll_records.staff_profile_id
        AND sp.linked_user_id = auth.uid()
    )
  );
