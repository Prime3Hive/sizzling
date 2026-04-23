-- ================================================================
-- SIMPLIFY DEPARTMENTS & REMOVE HR BUSINESS-MODULE BYPASS
-- Changes:
--   1. Remove 'Inventory' and 'Finance' departments
--      (migrate affected users to NULL dept first)
--   2. Remaining departments: Administration, Operations, Sales
--   3. Remove has_role('hr') from financial RLS policies —
--      HR now follows department permissions like any other role
--   4. HR retains access to staff-management tables (profiles,
--      leave requests, complaints) — that is their core function
--   5. Reseed clean permissions for the 3 departments
-- ================================================================

-- ── 1. DETACH USERS FROM REMOVED DEPARTMENTS ─────────────────
-- user_roles and staff_profiles use RESTRICT FK — clear them first.

UPDATE public.user_roles
SET department_id = NULL
WHERE department_id IN (
  SELECT id FROM public.departments
  WHERE name IN ('Inventory', 'Finance')
);

UPDATE public.staff_profiles
SET department_id = NULL
WHERE department_id IN (
  SELECT id FROM public.departments
  WHERE name IN ('Inventory', 'Finance')
);

-- ── 2. DELETE REMOVED DEPARTMENT DATA ────────────────────────

DELETE FROM public.department_permissions
WHERE department_id IN (
  SELECT id FROM public.departments
  WHERE name IN ('Inventory', 'Finance')
);

DELETE FROM public.departments
WHERE name IN ('Inventory', 'Finance');

-- ── 3. RESEED PERMISSIONS FOR 3 REMAINING DEPARTMENTS ────────
-- Strategy:
--   Administration : full access to all modules (admin-equivalent for dept users)
--   Operations     : inventory + reports (view/create/update)
--   Sales          : sales + invoices (view/create/update) + finance (view only)

-- Clear existing seeded permissions for remaining departments
-- so we can replace them cleanly without duplicate-conflict noise.
DELETE FROM public.department_permissions
WHERE department_id IN (
  SELECT id FROM public.departments
  WHERE name IN ('Administration', 'Operations', 'Sales')
);

-- Re-insert fresh defaults
INSERT INTO public.department_permissions
  (department_id, module_name, can_view, can_create, can_update, can_delete)
SELECT
  d.id,
  m.module_name,
  m.can_view,
  m.can_create,
  m.can_update,
  m.can_delete
FROM public.departments d
CROSS JOIN (VALUES
  -- module_name,  view,  create, update, delete
  ('dashboard',   true,  false,  false,  false),
  ('sales',       true,  true,   true,   false),
  ('inventory',   true,  true,   true,   false),
  ('invoices',    true,  true,   true,   false),
  ('finance',     true,  false,  false,  false),
  ('budgets',     true,  true,   true,   false),
  ('reports',     true,  false,  false,  false)
) AS m(module_name, can_view, can_create, can_update, can_delete)
WHERE d.name = 'Administration'

UNION ALL

SELECT
  d.id,
  m.module_name,
  m.can_view,
  m.can_create,
  m.can_update,
  m.can_delete
FROM public.departments d
CROSS JOIN (VALUES
  ('dashboard',   true,  false,  false,  false),
  ('sales',       false, false,  false,  false),
  ('inventory',   true,  true,   true,   false),
  ('invoices',    false, false,  false,  false),
  ('finance',     false, false,  false,  false),
  ('budgets',     false, false,  false,  false),
  ('reports',     true,  false,  false,  false)
) AS m(module_name, can_view, can_create, can_update, can_delete)
WHERE d.name = 'Operations'

UNION ALL

SELECT
  d.id,
  m.module_name,
  m.can_view,
  m.can_create,
  m.can_update,
  m.can_delete
FROM public.departments d
CROSS JOIN (VALUES
  ('dashboard',   true,  false,  false,  false),
  ('sales',       true,  true,   true,   false),
  ('inventory',   false, false,  false,  false),
  ('invoices',    true,  true,   true,   false),
  ('finance',     true,  false,  false,  false),
  ('budgets',     false, false,  false,  false),
  ('reports',     false, false,  false,  false)
) AS m(module_name, can_view, can_create, can_update, can_delete)
WHERE d.name = 'Sales';

-- ── 4. REMOVE HR FROM FINANCIAL TABLE RLS POLICIES ───────────
-- HR now gets business-module access only through department
-- permissions, exactly like managers and employees.
-- HR retains special access to staff-management tables below.

-- SALES
DROP POLICY IF EXISTS "Users can view sales" ON public.sales;
CREATE POLICY "Users can view sales"
ON public.sales FOR SELECT USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_department_permission(auth.uid(), 'sales', 'view')
);

DROP POLICY IF EXISTS "Users can create sales" ON public.sales;
CREATE POLICY "Users can create sales"
ON public.sales FOR INSERT WITH CHECK (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_department_permission(auth.uid(), 'sales', 'create')
);

DROP POLICY IF EXISTS "Users can update sales" ON public.sales;
CREATE POLICY "Users can update sales"
ON public.sales FOR UPDATE USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_department_permission(auth.uid(), 'sales', 'update')
);

-- SALE ITEMS
DROP POLICY IF EXISTS "Users can view sale items" ON public.sale_items;
CREATE POLICY "Users can view sale items"
ON public.sale_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_department_permission(auth.uid(), 'sales', 'view')
      )
  )
);

DROP POLICY IF EXISTS "Users can create sale items" ON public.sale_items;
CREATE POLICY "Users can create sale items"
ON public.sale_items FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_department_permission(auth.uid(), 'sales', 'create')
      )
  )
);

DROP POLICY IF EXISTS "Users can update sale items" ON public.sale_items;
CREATE POLICY "Users can update sale items"
ON public.sale_items FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_department_permission(auth.uid(), 'sales', 'update')
      )
  )
);

-- PAYMENTS
DROP POLICY IF EXISTS "Users can view payments" ON public.payments;
CREATE POLICY "Users can view payments"
ON public.payments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = payments.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_department_permission(auth.uid(), 'sales', 'view')
      )
  )
);

DROP POLICY IF EXISTS "Users can create payments" ON public.payments;
CREATE POLICY "Users can create payments"
ON public.payments FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = payments.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_department_permission(auth.uid(), 'sales', 'create')
      )
  )
);

DROP POLICY IF EXISTS "Users can update payments" ON public.payments;
CREATE POLICY "Users can update payments"
ON public.payments FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = payments.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_department_permission(auth.uid(), 'sales', 'update')
      )
  )
);

-- EXPENSES
DROP POLICY IF EXISTS "Users can view expenses" ON public.expenses;
CREATE POLICY "Users can view expenses"
ON public.expenses FOR SELECT USING (
  is_admin(auth.uid())
  OR has_department_permission(auth.uid(), 'budgets', 'view')
  OR has_department_permission(auth.uid(), 'finance', 'view')
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id AND b.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can create expenses" ON public.expenses;
CREATE POLICY "Users can create expenses"
ON public.expenses FOR INSERT WITH CHECK (
  is_admin(auth.uid())
  OR has_department_permission(auth.uid(), 'budgets', 'create')
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id AND b.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update expenses" ON public.expenses;
CREATE POLICY "Users can update expenses"
ON public.expenses FOR UPDATE USING (
  is_admin(auth.uid())
  OR has_department_permission(auth.uid(), 'budgets', 'update')
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id AND b.user_id = auth.uid()
  )
);

-- FINANCE LEDGER
DROP POLICY IF EXISTS "finance_ledger_select" ON public.finance_ledger;
CREATE POLICY "finance_ledger_select" ON public.finance_ledger
  FOR SELECT USING (
    is_admin(auth.uid())
    OR has_department_permission(auth.uid(), 'finance', 'view')
    OR has_department_permission(auth.uid(), 'sales',   'view')
    OR auth.uid() = user_id
  );

DROP POLICY IF EXISTS "finance_ledger_insert" ON public.finance_ledger;
CREATE POLICY "finance_ledger_insert" ON public.finance_ledger
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      is_admin(auth.uid())
      OR has_department_permission(auth.uid(), 'sales',   'create')
      OR has_department_permission(auth.uid(), 'finance', 'create')
    )
  );

-- ── NOTE: HR-specific table access is intentionally preserved ─
-- staff_profiles  : HR can view/update all (core HR function)
-- staff_leave_requests : HR can view/update all
-- staff_complaints     : HR can view/update all
-- payroll_records      : HR can view
-- The trigger guard_staff_profile_sensitive_fields also keeps
-- HR authorised to modify salary/bank/NIN fields.
-- These are not business-module policies; they are people-
-- management policies that belong to the HR role by definition.
