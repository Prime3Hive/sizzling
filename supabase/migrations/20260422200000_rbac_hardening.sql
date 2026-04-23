-- ================================================================
-- RBAC HARDENING
-- Fixes:
--   1. has_role() / is_admin() now require role_status = 'approved'
--   2. staff_profiles: remove open USING(true) PII policy;
--      add secure birthday RPC for all authenticated users
--   3. finance_ledger SELECT: restrict to authorised roles / depts
--   4. finance_ledger INSERT: require approved role
--   5. sales / sale_items / payments: dept-based access for managers
--   6. expenses: dept-based access (finance / budgets dept)
--   7. Salary & bank fields: trigger prevents self-update by staff
--   8. departments: allow all authenticated to view (for dropdowns)
--   9. Seed 'finance' and 'invoices' module permissions
-- ================================================================

-- ── 1. FIX SECURITY DEFINER HELPER FUNCTIONS ─────────────────

-- has_role now enforces approved status
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND role_status = 'approved'
  );
$$;

-- is_admin now enforces approved status
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role = 'admin'
      AND role_status = 'approved'
  );
$$;

-- Department-permission helper used by financial RLS policies
CREATE OR REPLACE FUNCTION public.has_department_permission(
  _user_id UUID,
  _module  TEXT,
  _action  TEXT
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.department_permissions dp
      ON dp.department_id = ur.department_id
    WHERE ur.user_id     = _user_id
      AND ur.role_status = 'approved'
      AND dp.module_name = _module
      AND CASE _action
            WHEN 'view'   THEN dp.can_view
            WHEN 'create' THEN dp.can_create
            WHEN 'update' THEN dp.can_update
            WHEN 'delete' THEN dp.can_delete
            ELSE false
          END
  );
$$;

-- Birthday data: returns only non-PII columns for all authenticated users.
-- This is a SECURITY DEFINER function so RLS on staff_profiles is bypassed
-- intentionally — but only the safe subset of columns is returned.
CREATE OR REPLACE FUNCTION public.get_birthday_profiles()
RETURNS TABLE(
  id              uuid,
  full_name       text,
  date_of_birth   date,
  "position"      text,
  passport_path   text,
  department_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    sp.id,
    sp.full_name::text,
    sp.date_of_birth,
    sp.position::text,
    sp.passport_path,
    d.name::text AS department_name
  FROM public.staff_profiles sp
  LEFT JOIN public.departments d ON d.id = sp.department_id
  WHERE sp.date_of_birth IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_birthday_profiles()                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_department_permission(UUID, TEXT, TEXT)      TO authenticated;

-- ── 2. STAFF PROFILES: REMOVE OPEN PII POLICY ────────────────

-- Drop the policy that lets every authenticated user read all columns
DROP POLICY IF EXISTS "All staff can view birthdays" ON public.staff_profiles;

-- Ensure admin has explicit full-read access (in addition to existing HR policy)
DROP POLICY IF EXISTS "Admin can view all staff profiles" ON public.staff_profiles;
CREATE POLICY "Admin can view all staff profiles"
  ON public.staff_profiles FOR SELECT
  USING (is_admin(auth.uid()));

-- ── 3. PROTECT SENSITIVE FIELDS FROM STAFF SELF-UPDATES ──────

CREATE OR REPLACE FUNCTION public.guard_staff_profile_sensitive_fields()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only admin and HR may change financial / identity fields
  IF NOT (is_admin(auth.uid()) OR has_role(auth.uid(), 'hr'::app_role)) THEN
    NEW.salary         := OLD.salary;
    NEW.bank_name      := OLD.bank_name;
    NEW.account_number := OLD.account_number;
    NEW.account_name   := OLD.account_name;
    NEW.nin            := OLD.nin;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_profile_sensitive_guard ON public.staff_profiles;
CREATE TRIGGER staff_profile_sensitive_guard
  BEFORE UPDATE ON public.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_staff_profile_sensitive_fields();

-- ── 4. FINANCE LEDGER: SCOPE SELECT & HARDEN INSERT ──────────

-- Replace open-to-all SELECT with role/dept-scoped access
DROP POLICY IF EXISTS "finance_ledger_select" ON public.finance_ledger;
CREATE POLICY "finance_ledger_select" ON public.finance_ledger
  FOR SELECT USING (
    is_admin(auth.uid())
    OR has_role(auth.uid(), 'hr'::app_role)
    OR has_department_permission(auth.uid(), 'finance', 'view')
    OR has_department_permission(auth.uid(), 'sales',   'view')
    OR auth.uid() = user_id
  );

-- Require an approved role to insert (in addition to uid = user_id)
DROP POLICY IF EXISTS "finance_ledger_insert" ON public.finance_ledger;
CREATE POLICY "finance_ledger_insert" ON public.finance_ledger
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'hr'::app_role)
      OR has_department_permission(auth.uid(), 'sales',   'create')
      OR has_department_permission(auth.uid(), 'finance', 'create')
    )
  );

-- ── 5. SALES: REPLACE BLANKET MANAGER ACCESS WITH DEPT-BASED ─

DROP POLICY IF EXISTS "Users can view sales" ON public.sales;
CREATE POLICY "Users can view sales"
ON public.sales FOR SELECT USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_role(auth.uid(), 'hr'::app_role)
  OR has_department_permission(auth.uid(), 'sales', 'view')
);

DROP POLICY IF EXISTS "Users can create sales" ON public.sales;
CREATE POLICY "Users can create sales"
ON public.sales FOR INSERT WITH CHECK (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_role(auth.uid(), 'hr'::app_role)
  OR has_department_permission(auth.uid(), 'sales', 'create')
);

DROP POLICY IF EXISTS "Users can update sales" ON public.sales;
CREATE POLICY "Users can update sales"
ON public.sales FOR UPDATE USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_role(auth.uid(), 'hr'::app_role)
  OR has_department_permission(auth.uid(), 'sales', 'update')
);

-- ── SALE ITEMS ────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view sale items" ON public.sale_items;
CREATE POLICY "Users can view sale items"
ON public.sale_items FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_role(auth.uid(), 'hr'::app_role)
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
        OR has_role(auth.uid(), 'hr'::app_role)
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
        OR has_role(auth.uid(), 'hr'::app_role)
        OR has_department_permission(auth.uid(), 'sales', 'update')
      )
  )
);

-- ── PAYMENTS ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view payments" ON public.payments;
CREATE POLICY "Users can view payments"
ON public.payments FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = payments.sale_id
      AND (
        s.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR has_role(auth.uid(), 'hr'::app_role)
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
        OR has_role(auth.uid(), 'hr'::app_role)
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
        OR has_role(auth.uid(), 'hr'::app_role)
        OR has_department_permission(auth.uid(), 'sales', 'update')
      )
  )
);

-- ── EXPENSES ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can view expenses" ON public.expenses;
CREATE POLICY "Users can view expenses"
ON public.expenses FOR SELECT USING (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'hr'::app_role)
  OR has_department_permission(auth.uid(), 'finance', 'view')
  OR has_department_permission(auth.uid(), 'budgets', 'view')
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id AND b.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can create expenses" ON public.expenses;
CREATE POLICY "Users can create expenses"
ON public.expenses FOR INSERT WITH CHECK (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'hr'::app_role)
  OR has_department_permission(auth.uid(), 'finance', 'create')
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
  OR has_role(auth.uid(), 'hr'::app_role)
  OR has_department_permission(auth.uid(), 'finance', 'update')
  OR has_department_permission(auth.uid(), 'budgets', 'update')
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id AND b.user_id = auth.uid()
  )
);

-- ── 6. DEPARTMENTS: LET ALL AUTHENTICATED SEE ALL DEPTS ──────
-- Required for department dropdowns across the app.
DROP POLICY IF EXISTS "Users can view their department" ON public.departments;
DROP POLICY IF EXISTS "All authenticated can view departments" ON public.departments;
CREATE POLICY "All authenticated can view departments"
  ON public.departments FOR SELECT TO authenticated
  USING (true);

-- ── 7. SEED FINANCE AND INVOICES MODULE PERMISSIONS ──────────

-- 'finance' module: Administration (full) + Finance dept (view only by default)
INSERT INTO public.department_permissions
  (department_id, module_name, can_view, can_create, can_update, can_delete)
SELECT
  d.id,
  'finance',
  d.name IN ('Administration', 'Finance', 'Sales'),
  d.name = 'Administration',
  d.name = 'Administration',
  d.name = 'Administration'
FROM public.departments d
ON CONFLICT (department_id, module_name) DO NOTHING;

-- 'invoices' module: Administration (full) + Sales + Finance (view/create/update)
INSERT INTO public.department_permissions
  (department_id, module_name, can_view, can_create, can_update, can_delete)
SELECT
  d.id,
  'invoices',
  d.name IN ('Administration', 'Sales', 'Finance'),
  d.name IN ('Administration', 'Sales'),
  d.name IN ('Administration', 'Sales'),
  d.name = 'Administration'
FROM public.departments d
ON CONFLICT (department_id, module_name) DO NOTHING;
