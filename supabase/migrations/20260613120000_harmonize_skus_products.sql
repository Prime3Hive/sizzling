-- ─────────────────────────────────────────────────────────────────────────────
-- Harmonize SKU Catalog and Inventory onto ONE source of truth
--
-- products + inventory + inventory_movements is the master. The legacy `skus`
-- table becomes an auto-maintained mirror so any code still reading it (SKU
-- Catalog page, Dashboard low-stock, Analytics, procurement-receive, requests)
-- shows the SAME items and the SAME stock as Inventory.
--   • product create/update  → mirrors fields into its linked sku
--   • inventory change        → syncs the sku's stock_quantity / reorder_level
--   • existing standalone skus → promoted to products (so they appear in Inventory)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Product → SKU field mirror (runs BEFORE so it can set products.sku_id)
CREATE OR REPLACE FUNCTION public.fn_sync_product_to_sku()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE sid uuid;
BEGIN
  sid := NEW.sku_id;
  IF sid IS NULL AND NEW.sku IS NOT NULL THEN
    SELECT id INTO sid FROM public.skus WHERE lower(sku_code) = lower(NEW.sku) LIMIT 1;
  END IF;

  IF sid IS NULL THEN
    INSERT INTO public.skus (name, sku_code, unit_of_measure, cost_per_unit, category, stock_quantity, reorder_level, user_id, created_by)
    VALUES (NEW.name, COALESCE(NEW.sku, NEW.id::text), COALESCE(NEW.uom, 'unit'), COALESCE(NEW.price, 0),
            COALESCE(NEW.category, 'general'), 0, 0, NEW.user_id, NEW.created_by)
    RETURNING id INTO sid;
  ELSE
    UPDATE public.skus SET
      name            = NEW.name,
      sku_code        = COALESCE(NEW.sku, sku_code),
      unit_of_measure = COALESCE(NEW.uom, unit_of_measure),
      cost_per_unit   = COALESCE(NEW.price, cost_per_unit),
      category        = COALESCE(NEW.category, category),
      updated_at      = now()
    WHERE id = sid;
  END IF;

  NEW.sku_id := sid;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zsync_product_to_sku ON public.products;
CREATE TRIGGER trg_zsync_product_to_sku
  BEFORE INSERT OR UPDATE OF name, sku, uom, price, category, sku_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_product_to_sku();

-- 2. Inventory → SKU stock mirror
CREATE OR REPLACE FUNCTION public.fn_sync_inventory_to_sku()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE pid uuid; sid uuid; total numeric; rl numeric;
BEGIN
  pid := COALESCE(NEW.product_id, OLD.product_id);
  SELECT sku_id INTO sid FROM public.products WHERE id = pid;
  IF sid IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(quantity), 0), COALESCE(MAX(reorder_level), 0)
  INTO total, rl FROM public.inventory WHERE product_id = pid;

  UPDATE public.skus SET stock_quantity = total, reorder_level = rl, updated_at = now() WHERE id = sid;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_inventory_to_sku ON public.inventory;
CREATE TRIGGER trg_sync_inventory_to_sku
  AFTER INSERT OR UPDATE OF quantity, reorder_level OR DELETE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_inventory_to_sku();

-- 3. Backfill ────────────────────────────────────────────────────────────────
-- 3a. Promote standalone skus (with no product) into products so they show in Inventory
INSERT INTO public.products (name, category, item_type, uom, price, sku, sku_id, user_id, created_by)
SELECT s.name, COALESCE(s.category, 'general'), 'non_sellable', COALESCE(s.unit_of_measure, 'unit'),
       COALESCE(s.cost_per_unit, 0), s.sku_code, s.id, s.user_id, s.created_by
FROM public.skus s
WHERE NOT EXISTS (
  SELECT 1 FROM public.products p
  WHERE p.sku_id = s.id OR (p.sku IS NOT NULL AND lower(p.sku) = lower(s.sku_code))
);

-- 3b. Seed inventory for products that have none, carrying their sku's stock
INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level)
SELECT p.id, (SELECT id FROM public.warehouses LIMIT 1),
       COALESCE(s.stock_quantity, 0), COALESCE(s.reorder_level, 0)
FROM public.products p
JOIN public.skus s ON s.id = p.sku_id
WHERE (SELECT id FROM public.warehouses LIMIT 1) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.product_id = p.id);

-- 3c. Ensure every product has a linked sku (touch fires the mirror trigger)
UPDATE public.products SET name = name WHERE sku_id IS NULL;

-- 3d. Final stock sync: every linked sku reflects its product's total inventory
UPDATE public.skus s
SET stock_quantity = COALESCE(agg.total, 0),
    reorder_level  = COALESCE(agg.rl, 0),
    updated_at     = now()
FROM (
  SELECT p.sku_id AS sid, SUM(i.quantity) AS total, MAX(i.reorder_level) AS rl
  FROM public.products p JOIN public.inventory i ON i.product_id = p.id
  WHERE p.sku_id IS NOT NULL
  GROUP BY p.sku_id
) agg
WHERE s.id = agg.sid;
