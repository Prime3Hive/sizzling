-- Make user with email yhungt.st@gmail.com an admin
-- First, delete any existing role for this user
DELETE FROM public.user_roles 
WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'yhungt.st@gmail.com'
);

-- Then insert the admin role
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role
FROM auth.users
WHERE email = 'yhungt.st@gmail.com';