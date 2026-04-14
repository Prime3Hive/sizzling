
-- Add linked_user_id to staff_profiles
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS linked_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_profiles_linked_user ON public.staff_profiles(linked_user_id) WHERE linked_user_id IS NOT NULL;

-- Create notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info',
  read boolean NOT NULL DEFAULT false,
  related_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can insert notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (is_admin(auth.uid()));

CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_read ON public.notifications(user_id, read);

-- HR can view all staff profiles
CREATE POLICY "HR can view all staff profiles"
  ON public.staff_profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'hr'));

-- HR can update staff profiles (salary restriction enforced in app)
CREATE POLICY "HR can update staff profiles"
  ON public.staff_profiles FOR UPDATE
  USING (public.has_role(auth.uid(), 'hr'));

-- Staff can view their own profile via linked_user_id
CREATE POLICY "Staff can view own profile"
  ON public.staff_profiles FOR SELECT
  USING (linked_user_id = auth.uid());

-- Staff can update their own profile via linked_user_id
CREATE POLICY "Staff can update own profile"
  ON public.staff_profiles FOR UPDATE
  USING (linked_user_id = auth.uid());
