
-- Managers can view all leave requests
CREATE POLICY "Managers can view all leave requests"
  ON public.staff_leave_requests
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- Managers can update leave requests (approve/reject)
CREATE POLICY "Managers can update leave requests"
  ON public.staff_leave_requests
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- Managers can view all complaints
CREATE POLICY "Managers can view all complaints"
  ON public.staff_complaints
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- Managers can update complaints (respond/resolve)
CREATE POLICY "Managers can update complaints"
  ON public.staff_complaints
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));
