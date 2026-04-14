
-- Add role_status to user_roles
ALTER TABLE public.user_roles 
ADD COLUMN IF NOT EXISTS role_status varchar NOT NULL DEFAULT 'approved';

-- Update handle_new_user to store department from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (
    NEW.id, 
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$;

-- Update handle_new_user_role to assign department from user metadata
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _dept_id uuid;
BEGIN
  -- Get department_id from the auth.users metadata
  SELECT (raw_user_meta_data ->> 'department_id')::uuid INTO _dept_id
  FROM auth.users WHERE id = NEW.user_id;

  INSERT INTO public.user_roles (user_id, role, department_id, role_status)
  VALUES (NEW.user_id, 'employee', _dept_id, 'approved');
  RETURN NEW;
END;
$$;
