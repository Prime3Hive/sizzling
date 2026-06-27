-- One inventory request can list multiple items.
-- A child table holds the line items; the existing single-item columns on
-- inventory_requests are kept (back-compat) and the first line mirrors them.

CREATE TABLE IF NOT EXISTS public.inventory_request_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES public.inventory_requests(id) ON DELETE CASCADE,
  sku_id             uuid REFERENCES public.skus(id) ON DELETE SET NULL,
  requested_quantity numeric NOT NULL DEFAULT 1 CHECK (requested_quantity > 0),
  fulfilled_quantity numeric NOT NULL DEFAULT 0,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_request_items_request
  ON public.inventory_request_items(request_id);

ALTER TABLE public.inventory_request_items ENABLE ROW LEVEL SECURITY;

-- Access follows the parent request: the requester, or an approved
-- admin/manager/hr, may read; the requester or admin/manager may write.
DROP POLICY IF EXISTS "inventory_request_items_select" ON public.inventory_request_items;
CREATE POLICY "inventory_request_items_select"
ON public.inventory_request_items FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.inventory_requests r
    WHERE r.id = request_id
      AND (
        r.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid()
            AND role IN ('admin', 'manager', 'hr')
            AND role_status = 'approved'
        )
      )
  )
);

DROP POLICY IF EXISTS "inventory_request_items_write" ON public.inventory_request_items;
CREATE POLICY "inventory_request_items_write"
ON public.inventory_request_items FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.inventory_requests r
    WHERE r.id = request_id
      AND (
        r.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid()
            AND role = 'manager'
            AND role_status = 'approved'
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.inventory_requests r
    WHERE r.id = request_id
      AND (
        r.user_id = auth.uid()
        OR is_admin(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid()
            AND role = 'manager'
            AND role_status = 'approved'
        )
      )
  )
);

-- Backfill: every existing single-item request becomes one line item.
INSERT INTO public.inventory_request_items (request_id, sku_id, requested_quantity, fulfilled_quantity)
SELECT r.id, r.sku_id, r.requested_quantity, COALESCE(r.fulfilled_quantity, 0)
FROM public.inventory_requests r
WHERE r.sku_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_request_items i WHERE i.request_id = r.id
  );
