-- ─────────────────────────────────────────────────────────────────────────────
-- Inventory standardization (Phase 1)
--
-- • products gain item_type (sellable / non_sellable) and uom (unit of measure)
--     - sellable items are invoiceable (shown during invoicing)
--     - ALL items appear in purchasing, stock-take, usage and other processes
-- • inventory_movements: an append-only ledger of every stock change. It is the
--   source of truth for "stock used", usage, and the daily inventory report.
--     quantity_change > 0  → stock in  (purchase, return, positive adjustment)
--     quantity_change < 0  → stock out (sale, usage, negative adjustment)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── products: classification + unit of measure ───────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'sellable'
    CHECK (item_type IN ('sellable', 'non_sellable'));

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS uom text NOT NULL DEFAULT 'pcs';

-- Backfill: legacy raw materials / consumables become non-sellable
UPDATE public.products
SET item_type = 'non_sellable'
WHERE item_type = 'sellable'
  AND lower(coalesce(category, '')) IN
    ('raw-material', 'raw material', 'rawmaterial', 'non-sellable', 'non_sellable', 'consumable', 'supply', 'supplies');

-- ── inventory_movements: stock change ledger ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid          NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id    uuid          REFERENCES public.warehouses(id) ON DELETE SET NULL,
  movement_type   text          NOT NULL CHECK (movement_type IN
                    ('purchase', 'sale', 'usage', 'adjustment', 'stock_take', 'transfer', 'return')),
  quantity_change numeric(14,2) NOT NULL,            -- + in / - out
  reference_type  text,                              -- 'invoice','lpo','request','manual'
  reference_id    uuid,
  note            text,
  occurred_on     date          NOT NULL DEFAULT current_date,
  created_by      uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_moves_product  ON public.inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_moves_date     ON public.inventory_movements(occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_inv_moves_type     ON public.inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inv_moves_ref      ON public.inventory_movements(reference_type, reference_id);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

-- All authenticated staff can read and append movements (operational log);
-- admins may also correct/delete.
DROP POLICY IF EXISTS "inventory_movements_read"   ON public.inventory_movements;
CREATE POLICY "inventory_movements_read"  ON public.inventory_movements
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_movements_insert" ON public.inventory_movements;
CREATE POLICY "inventory_movements_insert" ON public.inventory_movements
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_movements_admin"  ON public.inventory_movements;
CREATE POLICY "inventory_movements_admin" ON public.inventory_movements
  FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

-- ── Helper view: per-product stock used (cumulative outflow) ───────────────────
CREATE OR REPLACE VIEW public.product_stock_used AS
SELECT
  product_id,
  COALESCE(SUM(-quantity_change) FILTER (WHERE quantity_change < 0 AND movement_type IN ('sale', 'usage')), 0) AS stock_used
FROM public.inventory_movements
GROUP BY product_id;
