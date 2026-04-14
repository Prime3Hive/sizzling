
-- Leave requests table
CREATE TABLE public.staff_leave_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  staff_profile_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  leave_type varchar NOT NULL DEFAULT 'annual',
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text,
  status varchar NOT NULL DEFAULT 'pending',
  admin_response text,
  responded_by uuid,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_leave_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view own leave requests" ON public.staff_leave_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Staff can create own leave requests" ON public.staff_leave_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all leave requests" ON public.staff_leave_requests FOR SELECT TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "HR can view all leave requests" ON public.staff_leave_requests FOR SELECT TO authenticated USING (has_role(auth.uid(), 'hr'::app_role));
CREATE POLICY "Admins can update leave requests" ON public.staff_leave_requests FOR UPDATE TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "HR can update leave requests" ON public.staff_leave_requests FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'hr'::app_role));

CREATE TRIGGER update_staff_leave_requests_updated_at BEFORE UPDATE ON public.staff_leave_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Complaints table
CREATE TABLE public.staff_complaints (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  staff_profile_id uuid REFERENCES public.staff_profiles(id) ON DELETE CASCADE,
  subject varchar NOT NULL,
  description text NOT NULL,
  priority varchar NOT NULL DEFAULT 'medium',
  status varchar NOT NULL DEFAULT 'open',
  admin_response text,
  responded_by uuid,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view own complaints" ON public.staff_complaints FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Staff can create own complaints" ON public.staff_complaints FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all complaints" ON public.staff_complaints FOR SELECT TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "HR can view all complaints" ON public.staff_complaints FOR SELECT TO authenticated USING (has_role(auth.uid(), 'hr'::app_role));
CREATE POLICY "Admins can update complaints" ON public.staff_complaints FOR UPDATE TO authenticated USING (is_admin(auth.uid()));
CREATE POLICY "HR can update complaints" ON public.staff_complaints FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'hr'::app_role));

CREATE TRIGGER update_staff_complaints_updated_at BEFORE UPDATE ON public.staff_complaints FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Staff messages table
CREATE TABLE public.staff_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  subject varchar NOT NULL,
  message text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  related_type varchar,
  related_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view received messages" ON public.staff_messages FOR SELECT USING (auth.uid() = recipient_id);
CREATE POLICY "Users can view sent messages" ON public.staff_messages FOR SELECT USING (auth.uid() = sender_id);
CREATE POLICY "Authenticated users can send messages" ON public.staff_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Recipients can update messages (mark read)" ON public.staff_messages FOR UPDATE USING (auth.uid() = recipient_id);
