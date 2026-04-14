-- Create role for current logged-in user so they can access the system
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role
FROM auth.users
WHERE email = 'sizzlingspicesng@gmail.com'
ON CONFLICT (user_id) DO UPDATE SET
  role = 'admin'::app_role,
  updated_at = now();