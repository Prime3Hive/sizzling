-- Grant HR and Manager roles access to Events Finances:
-- Sales, Sale Items, Payments, and Expenses (SELECT + INSERT + UPDATE)

-- ── SALES ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own sales or admin/manager" ON public.sales;
CREATE POLICY "Users can view sales"
ON public.sales FOR SELECT
USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'hr'::app_role)
);

DROP POLICY IF EXISTS "Users can create their own sales" ON public.sales;
CREATE POLICY "Users can create sales"
ON public.sales FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'hr'::app_role)
);

DROP POLICY IF EXISTS "Users can update their own sales" ON public.sales;
CREATE POLICY "Users can update sales"
ON public.sales FOR UPDATE
USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'hr'::app_role)
);

-- ── SALE ITEMS ──────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view sale items for accessible sales" ON public.sale_items;
CREATE POLICY "Users can view sale items"
ON public.sale_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.sales
    WHERE sales.id = sale_items.sale_id
    AND (
      sales.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR has_role(auth.uid(), 'manager'::app_role)
      OR has_role(auth.uid(), 'hr'::app_role)
    )
  )
);

DROP POLICY IF EXISTS "Users can create sale items for their sales" ON public.sale_items;
CREATE POLICY "Users can create sale items"
ON public.sale_items FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sales
    WHERE sales.id = sale_items.sale_id
    AND (
      sales.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR has_role(auth.uid(), 'manager'::app_role)
      OR has_role(auth.uid(), 'hr'::app_role)
    )
  )
);

DROP POLICY IF EXISTS "Users can update sale items for their sales" ON public.sale_items;
CREATE POLICY "Users can update sale items"
ON public.sale_items FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.sales
    WHERE sales.id = sale_items.sale_id
    AND (
      sales.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR has_role(auth.uid(), 'manager'::app_role)
      OR has_role(auth.uid(), 'hr'::app_role)
    )
  )
);

-- ── PAYMENTS ────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view payments for accessible sales" ON public.payments;
CREATE POLICY "Users can view payments"
ON public.payments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.sales
    WHERE sales.id = payments.sale_id
    AND (
      sales.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR has_role(auth.uid(), 'manager'::app_role)
      OR has_role(auth.uid(), 'hr'::app_role)
    )
  )
);

DROP POLICY IF EXISTS "Users can create payments for their sales" ON public.payments;
CREATE POLICY "Users can create payments"
ON public.payments FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.sales
    WHERE sales.id = payments.sale_id
    AND (
      sales.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR has_role(auth.uid(), 'manager'::app_role)
      OR has_role(auth.uid(), 'hr'::app_role)
    )
  )
);

DROP POLICY IF EXISTS "Users can update payments for their sales" ON public.payments;
CREATE POLICY "Users can update payments"
ON public.payments FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.sales
    WHERE sales.id = payments.sale_id
    AND (
      sales.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR has_role(auth.uid(), 'manager'::app_role)
      OR has_role(auth.uid(), 'hr'::app_role)
    )
  )
);

-- ── EXPENSES ────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view expenses for their budgets or if admin/management" ON public.expenses;
CREATE POLICY "Users can view expenses"
ON public.expenses FOR SELECT
USING (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'hr'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id
    AND b.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can create expenses for their budgets" ON public.expenses;
CREATE POLICY "Users can create expenses"
ON public.expenses FOR INSERT
WITH CHECK (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'hr'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id
    AND b.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update expenses for their budgets" ON public.expenses;
CREATE POLICY "Users can update expenses"
ON public.expenses FOR UPDATE
USING (
  is_admin(auth.uid())
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'hr'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.budgets b
    WHERE b.id = expenses.budget_id
    AND b.user_id = auth.uid()
  )
);
