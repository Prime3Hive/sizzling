
-- Fix 1: Restrict sales SELECT to owner/admin/manager
DROP POLICY IF EXISTS "All users can view all sales" ON public.sales;
CREATE POLICY "Users can view own sales or admin/manager"
ON public.sales FOR SELECT
USING (
  auth.uid() = user_id
  OR is_admin(auth.uid())
  OR has_role(auth.uid(), 'manager'::app_role)
);

-- Fix 2: Restrict sale_items SELECT
DROP POLICY IF EXISTS "All users can view all sale items" ON public.sale_items;
CREATE POLICY "Users can view sale items for accessible sales"
ON public.sale_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM sales
    WHERE sales.id = sale_items.sale_id
    AND (
      sales.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR has_role(auth.uid(), 'manager'::app_role)
    )
  )
);

-- Fix 3: Restrict payments SELECT
DROP POLICY IF EXISTS "All users can view all payments" ON public.payments;
CREATE POLICY "Users can view payments for accessible sales"
ON public.payments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM sales
    WHERE sales.id = payments.sale_id
    AND (
      sales.user_id = auth.uid()
      OR is_admin(auth.uid())
      OR has_role(auth.uid(), 'manager'::app_role)
    )
  )
);

-- Fix 4: Add receipts storage bucket RLS policies
CREATE POLICY "Users can upload their own receipts"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'receipts' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can view their own receipts"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'receipts' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR is_admin(auth.uid())
  )
);

CREATE POLICY "Users can delete their own receipts"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'receipts' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- Fix 5: Fix budget_summary security definer view
DROP VIEW IF EXISTS public.budget_summary;
CREATE VIEW public.budget_summary WITH (security_invoker = true) AS
SELECT
  b.id,
  b.title,
  b.type,
  b.total_budget,
  b.start_date,
  b.end_date,
  b.created_at,
  b.updated_at,
  b.user_id,
  COALESCE(SUM(e.amount), 0) AS total_spent,
  COUNT(e.id) AS expense_count,
  b.total_budget - COALESCE(SUM(e.amount), 0) AS remaining_budget,
  CASE WHEN b.total_budget > 0 THEN ROUND((COALESCE(SUM(e.amount), 0) / b.total_budget) * 100, 2) ELSE 0 END AS percentage_used,
  CASE WHEN COALESCE(SUM(e.amount), 0) > b.total_budget THEN true ELSE false END AS is_overspent
FROM budgets b
LEFT JOIN expenses e ON e.budget_id = b.id
GROUP BY b.id, b.title, b.type, b.total_budget, b.start_date, b.end_date, b.created_at, b.updated_at, b.user_id;
