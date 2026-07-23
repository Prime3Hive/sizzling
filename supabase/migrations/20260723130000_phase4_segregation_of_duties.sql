-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION PHASE 4: Segregation of duties — HR loses financial WRITE
--
--   B5 (residual): the HR role had blanket create/update rights over sales,
--   payments, expenses, invoices and the finance feed — the same person who
--   administers staff could also book and alter revenue and spending. Standard
--   segregation of duties (COSO / ISA 315) separates custody, recording and
--   authorization.
--
--   This migration removes ONLY the write clauses: HR keeps every SELECT it
--   had (payroll administration still needs visibility of finances). Any HR
--   user who genuinely must record finance can be granted the 'finance' /
--   'sales' / 'invoices' department permission explicitly through User
--   Management — deliberate, per-person, auditable — instead of implicitly by
--   role. Rollback = re-run 20260422200000 §4–6 and 20260629150000.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── finance_ledger: INSERT ───────────────────────────────────────────────────
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

-- ── sales: INSERT / UPDATE ───────────────────────────────────────────────────
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

-- ── sale_items: INSERT / UPDATE ──────────────────────────────────────────────
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

-- ── payments: INSERT / UPDATE ────────────────────────────────────────────────
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

-- ── expenses: INSERT / UPDATE ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can create expenses" ON public.expenses;
CREATE POLICY "Users can create expenses"
ON public.expenses FOR INSERT WITH CHECK (
  is_admin(auth.uid())
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
  OR has_department_permission(auth.uid(), 'finance', 'update')
  OR has_department_permission(auth.uid(), 'budgets', 'update')
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id AND b.user_id = auth.uid()
  )
);

-- ── invoices: INSERT / UPDATE (SELECT keeps HR; DELETE never had HR) ─────────
DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      is_admin(auth.uid())
      OR has_department_permission(auth.uid(), 'invoices', 'create')
    )
  );

DROP POLICY IF EXISTS "invoices_update" ON public.invoices;
CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR is_admin(auth.uid())
    OR has_department_permission(auth.uid(), 'invoices', 'update')
  );

-- ── invoice_items: INSERT / UPDATE / DELETE ──────────────────────────────────
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
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );

-- ── invoice_payments: INSERT / UPDATE / DELETE ───────────────────────────────
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
          OR has_department_permission(auth.uid(), 'invoices', 'update')
        )
    )
  );
