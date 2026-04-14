-- Create departments table
CREATE TABLE public.departments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create app roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'employee');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  role app_role NOT NULL DEFAULT 'employee',
  department_id UUID REFERENCES public.departments(id),
  assigned_by UUID,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Add department access permissions table
CREATE TABLE public.department_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES public.departments(id),
  module_name VARCHAR NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT false,
  can_create BOOLEAN NOT NULL DEFAULT false,
  can_update BOOLEAN NOT NULL DEFAULT false,
  can_delete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(department_id, module_name)
);

-- Add created_by fields to existing tables
ALTER TABLE public.sales ADD COLUMN created_by UUID;
ALTER TABLE public.inventory_requests ADD COLUMN created_by UUID;
ALTER TABLE public.expenses ADD COLUMN created_by UUID;
ALTER TABLE public.products ADD COLUMN created_by UUID;
ALTER TABLE public.warehouses ADD COLUMN created_by UUID;
ALTER TABLE public.budgets ADD COLUMN created_by UUID;

-- Update existing records to have created_by as user_id where available
UPDATE public.sales SET created_by = user_id;
UPDATE public.inventory_requests SET created_by = user_id;
UPDATE public.products SET created_by = user_id;
UPDATE public.warehouses SET created_by = user_id;
UPDATE public.budgets SET created_by = user_id;

-- Enable RLS on new tables
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_permissions ENABLE ROW LEVEL SECURITY;

-- Create security definer function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_roles.user_id = $1;
$$;

-- Create security definer function to check if user has role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

-- Create security definer function to check admin access
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin');
$$;

-- RLS Policies for departments
CREATE POLICY "Admins can manage all departments" 
ON public.departments 
FOR ALL 
USING (public.is_admin(auth.uid()));

CREATE POLICY "Users can view their department" 
ON public.departments 
FOR SELECT 
USING (
  id IN (
    SELECT department_id 
    FROM public.user_roles 
    WHERE user_id = auth.uid()
  )
);

-- RLS Policies for user_roles
CREATE POLICY "Admins can manage all user roles" 
ON public.user_roles 
FOR ALL 
USING (public.is_admin(auth.uid()));

CREATE POLICY "Users can view their own role" 
ON public.user_roles 
FOR SELECT 
USING (user_id = auth.uid());

-- RLS Policies for department_permissions
CREATE POLICY "Admins can manage all department permissions" 
ON public.department_permissions 
FOR ALL 
USING (public.is_admin(auth.uid()));

CREATE POLICY "Users can view their department permissions" 
ON public.department_permissions 
FOR SELECT 
USING (
  department_id IN (
    SELECT department_id 
    FROM public.user_roles 
    WHERE user_id = auth.uid()
  )
);

-- Create triggers for updated_at
CREATE TRIGGER update_departments_updated_at
BEFORE UPDATE ON public.departments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_roles_updated_at
BEFORE UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default departments
INSERT INTO public.departments (name, description) VALUES
('Administration', 'Administrative and management functions'),
('Sales', 'Sales and customer management'),
('Inventory', 'Inventory and warehouse management'),
('Finance', 'Financial management and budgeting'),
('Operations', 'General operations and business management');

-- Insert default permissions for departments
INSERT INTO public.department_permissions (department_id, module_name, can_view, can_create, can_update, can_delete)
SELECT d.id, 'dashboard', true, false, false, false FROM public.departments d;

INSERT INTO public.department_permissions (department_id, module_name, can_view, can_create, can_update, can_delete)
SELECT d.id, 'sales', 
  CASE WHEN d.name IN ('Administration', 'Sales') THEN true ELSE false END,
  CASE WHEN d.name IN ('Administration', 'Sales') THEN true ELSE false END,
  CASE WHEN d.name IN ('Administration', 'Sales') THEN true ELSE false END,
  CASE WHEN d.name = 'Administration' THEN true ELSE false END
FROM public.departments d;

INSERT INTO public.department_permissions (department_id, module_name, can_view, can_create, can_update, can_delete)
SELECT d.id, 'inventory',
  CASE WHEN d.name IN ('Administration', 'Inventory', 'Operations') THEN true ELSE false END,
  CASE WHEN d.name IN ('Administration', 'Inventory', 'Operations') THEN true ELSE false END,
  CASE WHEN d.name IN ('Administration', 'Inventory', 'Operations') THEN true ELSE false END,
  CASE WHEN d.name = 'Administration' THEN true ELSE false END
FROM public.departments d;

INSERT INTO public.department_permissions (department_id, module_name, can_view, can_create, can_update, can_delete)
SELECT d.id, 'budgets',
  CASE WHEN d.name IN ('Administration', 'Finance') THEN true ELSE false END,
  CASE WHEN d.name IN ('Administration', 'Finance') THEN true ELSE false END,
  CASE WHEN d.name IN ('Administration', 'Finance') THEN true ELSE false END,
  CASE WHEN d.name = 'Administration' THEN true ELSE false END
FROM public.departments d;

INSERT INTO public.department_permissions (department_id, module_name, can_view, can_create, can_update, can_delete)
SELECT d.id, 'reports',
  CASE WHEN d.name IN ('Administration', 'Finance', 'Operations') THEN true ELSE false END,
  false, false, false
FROM public.departments d;

-- Function to automatically assign default role to new users
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Assign employee role to new users with no department initially
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.user_id, 'employee');
  RETURN NEW;
END;
$$;

-- Trigger to assign role when profile is created
CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();