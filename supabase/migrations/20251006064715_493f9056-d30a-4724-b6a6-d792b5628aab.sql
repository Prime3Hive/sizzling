-- Create enum for staff positions
CREATE TYPE public.staff_position AS ENUM (
  'managing_director',
  'general_manager', 
  'kitchen_manager',
  'event_manager',
  'supervisor',
  'staff'
);

-- Create staff_profiles table
CREATE TABLE public.staff_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  full_name VARCHAR NOT NULL,
  phone_number VARCHAR,
  date_of_birth DATE,
  year_of_joining INTEGER,
  department_id UUID REFERENCES public.departments(id),
  salary NUMERIC(10, 2),
  passport_path TEXT,
  skills_experience TEXT,
  position staff_position NOT NULL DEFAULT 'staff',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Admin only access
CREATE POLICY "Admins can view all staff profiles"
ON public.staff_profiles
FOR SELECT
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can insert staff profiles"
ON public.staff_profiles
FOR INSERT
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Admins can update staff profiles"
ON public.staff_profiles
FOR UPDATE
USING (is_admin(auth.uid()));

CREATE POLICY "Admins can delete staff profiles"
ON public.staff_profiles
FOR DELETE
USING (is_admin(auth.uid()));

-- Create storage bucket for passports
INSERT INTO storage.buckets (id, name, public)
VALUES ('passports', 'passports', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for passports - Admin only
CREATE POLICY "Admins can view all passports"
ON storage.objects
FOR SELECT
USING (bucket_id = 'passports' AND is_admin(auth.uid()));

CREATE POLICY "Admins can upload passports"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'passports' AND is_admin(auth.uid()));

CREATE POLICY "Admins can update passports"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'passports' AND is_admin(auth.uid()));

CREATE POLICY "Admins can delete passports"
ON storage.objects
FOR DELETE
USING (bucket_id = 'passports' AND is_admin(auth.uid()));

-- Create trigger for updated_at
CREATE TRIGGER update_staff_profiles_updated_at
BEFORE UPDATE ON public.staff_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();