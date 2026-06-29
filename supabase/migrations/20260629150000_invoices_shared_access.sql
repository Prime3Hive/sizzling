-- ════════════════════════════════════════════════════════════════════════════
-- Invoices: shared, department-permission based access
--   Quotations and invoices raised anywhere in the system must be visible to
--   every user who has the 'invoices' module permission — not just the person
--   who created the document. The original owner-only RLS (auth.uid() = user_id)
--   was never brought in line with the RBAC hardening pass that already opened
--   up sales / payments / expenses.
--
--   This migration mirrors the public.sales pattern: owner OR admin OR hr OR
--   has_department_permission('invoices', <action>). invoice_items and
--   invoice_payments follow access to their parent invoice.
-- ════════════════════════════════════════════════════════════════════════════

-- ── invoices ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR is_admin(auth.uid())
    OR has_role(auth.uid(), 'hr'::app_role)
    OR has_department_permission(auth.uid(), 'invoices', 'view')
  );

DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      is_admin(auth.uid())
      OR has_role(auth.uid(), 'hr'::app_role)
      OR has_department_permission(auth.uid(), 'invoices', 'create')
    )
  );

DROP POLICY IF EXISTS "invoices_update" ON public.invoices;
CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR is_admin(auth.uid())
    OR has_role(auth.uid(), 'hr'::app_role)
    OR has_department_permission(auth.uid(), 'invoices', 'update')
  );

DROP POLICY IF EXISTS "invoices_delete" ON public.invoices;
CREATE POLICY "invoices_delete" ON public.invoices
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR is_admin(auth.uid())
    OR has_department_permission(auth.uid(), 'invoices', 'delete')
  );

-- ── invoice_items (access follows parent invoice) ────────────────────────────
DROP POLICY IF EXISTS "invoice_items_select" ON public.invoice_items;
CREATE POLICY "invoice_items_select" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_role(auth.uid(), 'hr'::app_role)
          OR has_department_permission(auth.uid(), 'invoices', 'view')
        )
    )
  );

DROP POLICY IF EXISTS "invoice_items_insert" ON public.invoice_items;
CREATE POLICY "invoice_items_insert" ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_role(auth.uid(), 'hr'::app_role)
          OR has_department_permission(auth.uid(), 'invoices', 'create')
        )
    )
  );

DROP POLICY IF EXISTS "invoice_items_update" ON public.invoice_items;
CREATE POLICY "invoice_items_update" ON public.invoice_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_role(auth.uid(), 'hr'::app_role)
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );

DROP POLICY IF EXISTS "invoice_items_delete" ON public.invoice_items;
CREATE POLICY "invoice_items_delete" ON public.invoice_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_items.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_role(auth.uid(), 'hr'::app_role)
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );

-- ── invoice_payments (access follows parent invoice) ─────────────────────────
DROP POLICY IF EXISTS "invoice_payments_select" ON public.invoice_payments;
CREATE POLICY "invoice_payments_select" ON public.invoice_payments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_role(auth.uid(), 'hr'::app_role)
          OR has_department_permission(auth.uid(), 'invoices', 'view')
        )
    )
  );

DROP POLICY IF EXISTS "invoice_payments_insert" ON public.invoice_payments;
CREATE POLICY "invoice_payments_insert" ON public.invoice_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_role(auth.uid(), 'hr'::app_role)
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );

DROP POLICY IF EXISTS "invoice_payments_update" ON public.invoice_payments;
CREATE POLICY "invoice_payments_update" ON public.invoice_payments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_role(auth.uid(), 'hr'::app_role)
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );

DROP POLICY IF EXISTS "invoice_payments_delete" ON public.invoice_payments;
CREATE POLICY "invoice_payments_delete" ON public.invoice_payments
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND (
          i.user_id = auth.uid()
          OR is_admin(auth.uid())
          OR has_role(auth.uid(), 'hr'::app_role)
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );
