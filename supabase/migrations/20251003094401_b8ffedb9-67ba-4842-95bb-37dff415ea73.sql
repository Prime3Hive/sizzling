-- Create management department if it doesn't exist
INSERT INTO public.departments (name, description)
VALUES ('Management', 'Management department with access to all reports and data')
ON CONFLICT DO NOTHING;

-- Drop existing restrictive policies and create new ones that allow admin and management access

-- Budgets policies
DROP POLICY IF EXISTS "Users can view their own budgets" ON public.budgets;
CREATE POLICY "Users can view their own budgets or if admin/management"
ON public.budgets
FOR SELECT
USING (
  auth.uid() = user_id 
  OR is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN departments d ON ur.department_id = d.id
    WHERE ur.user_id = auth.uid() 
    AND d.name = 'Management'
  )
);

-- Budget items policies
DROP POLICY IF EXISTS "Users can view budget items for their budgets" ON public.budget_items;
CREATE POLICY "Users can view budget items for their budgets or if admin/management"
ON public.budget_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM budgets b
    WHERE b.id = budget_items.budget_id 
    AND (
      b.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN departments d ON ur.department_id = d.id
        WHERE ur.user_id = auth.uid() 
        AND d.name = 'Management'
      )
    )
  )
);

-- Expenses policies
DROP POLICY IF EXISTS "Users can view expenses for their budgets" ON public.expenses;
CREATE POLICY "Users can view expenses for their budgets or if admin/management"
ON public.expenses
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM budgets b
    WHERE b.id = expenses.budget_id 
    AND (
      b.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN departments d ON ur.department_id = d.id
        WHERE ur.user_id = auth.uid() 
        AND d.name = 'Management'
      )
    )
  )
);

-- Reconciliation reports policies
DROP POLICY IF EXISTS "Users can view their own reconciliation reports" ON public.reconciliation_reports;
CREATE POLICY "Users can view their own reconciliation reports or if admin/management"
ON public.reconciliation_reports
FOR SELECT
USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN departments d ON ur.department_id = d.id
    WHERE ur.user_id = auth.uid() 
    AND d.name = 'Management'
  )
);

-- Discrepancies policies
DROP POLICY IF EXISTS "Users can view discrepancies for their reports" ON public.discrepancies;
CREATE POLICY "Users can view discrepancies for their reports or if admin/management"
ON public.discrepancies
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM reconciliation_reports rr
    WHERE rr.id = discrepancies.reconciliation_report_id 
    AND (
      rr.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN departments d ON ur.department_id = d.id
        WHERE ur.user_id = auth.uid() 
        AND d.name = 'Management'
      )
    )
  )
);

-- Inventory requests policies
DROP POLICY IF EXISTS "Users can view their own inventory requests" ON public.inventory_requests;
CREATE POLICY "Users can view their own inventory requests or if admin/management"
ON public.inventory_requests
FOR SELECT
USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN departments d ON ur.department_id = d.id
    WHERE ur.user_id = auth.uid() 
    AND d.name = 'Management'
  )
);