-- ================================================================
-- SALES DEPARTMENT: REMOVE FINANCE AND EXPENSES ACCESS
-- Sales staff should only see Invoices (+ Sales/Payments which they
-- already have). Finance and Budgets/Expenses are removed.
-- ================================================================

UPDATE public.department_permissions
SET
  can_view   = false,
  can_create = false,
  can_update = false,
  can_delete = false
WHERE module_name IN ('finance', 'budgets')
  AND department_id = (
    SELECT id FROM public.departments WHERE name = 'Sales'
  );
