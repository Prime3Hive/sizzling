
-- Drop manager RLS policies added previously (safe if not yet applied)
DROP POLICY IF EXISTS "Managers can view all leave requests" ON public.staff_leave_requests;
DROP POLICY IF EXISTS "Managers can update leave requests" ON public.staff_leave_requests;
DROP POLICY IF EXISTS "Managers can view all complaints" ON public.staff_complaints;
DROP POLICY IF EXISTS "Managers can update complaints" ON public.staff_complaints;

-- Admin can view ALL staff messages (not just their own sent/received)
DROP POLICY IF EXISTS "Admins can view all messages" ON public.staff_messages;
CREATE POLICY "Admins can view all messages"
  ON public.staff_messages
  FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));

-- Only Admin can approve/reject leave requests (drop HR update permission)
DROP POLICY IF EXISTS "HR can update leave requests" ON public.staff_leave_requests;
