-- ─────────────────────────────────────────────────────────────────────────────
-- Inventory standardization (Phase 4 close-out): goods receipt restocks stock
--
-- Standard single item-master model: a "product" is the item that is purchased,
-- stocked AND sold. LPO lines are linked to a product (resolved from the SKU
-- link, then by name). When goods are received, the product's inventory is
-- increased and a 'purchase' movement is recorded — closing the loop:
--   purchase (receipt)  → + stock, + purchase movement
--   sale (invoice)      → − stock, − sale movement
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Link LPO items to the product item-master
ALTER TABLE public.lpo_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

-- Resolve product_id on write (from sku link, else by matching name)
CREATE OR REPLACE FUNCTION public.fn_resolve_lpo_item_product()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.product_id IS NULL THEN
    IF NEW.sku_id IS NOT NULL THEN
      SELECT id INTO NEW.product_id FROM public.products WHERE sku_id = NEW.sku_id LIMIT 1;
    END IF;
    IF NEW.product_id IS NULL AND NEW.item_name IS NOT NULL THEN
      SELECT id INTO NEW.product_id FROM public.products WHERE lower(name) = lower(NEW.item_name) LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolve_lpo_item_product ON public.lpo_items;
CREATE TRIGGER trg_resolve_lpo_item_product
  BEFORE INSERT OR UPDATE OF sku_id, item_name, product_id ON public.lpo_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_resolve_lpo_item_product();

-- Backfill existing LPO items
UPDATE public.lpo_items li SET product_id = p.id
  FROM public.products p
  WHERE li.product_id IS NULL AND li.sku_id IS NOT NULL AND p.sku_id = li.sku_id;
UPDATE public.lpo_items li SET product_id = p.id
  FROM public.products p
  WHERE li.product_id IS NULL AND lower(p.name) = lower(li.item_name);

-- 2. Restock inventory + record a purchase movement on goods receipt
--    Helper that processes a single GRN line (used by trigger and backfill).
CREATE OR REPLACE FUNCTION public.fn_restock_receipt_item(p_receipt_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE ri record; pid uuid; wh uuid; qty numeric;
BEGIN
  SELECT * INTO ri FROM public.lpo_receipt_items WHERE id = p_receipt_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  qty := ri.quantity_received;
  IF qty IS NULL OR qty <= 0 THEN RETURN; END IF;

  SELECT product_id INTO pid FROM public.lpo_items WHERE id = ri.lpo_item_id;
  IF pid IS NULL THEN RETURN; END IF;  -- not a stocked product; skip

  -- idempotency: don't double-post for the same receipt line
  IF EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_type = 'lpo_receipt' AND reference_id = ri.id
  ) THEN
    RETURN;
  END IF;

  -- restock the warehouse already holding the most stock; otherwise the first one
  SELECT warehouse_id INTO wh FROM public.inventory WHERE product_id = pid ORDER BY quantity DESC LIMIT 1;
  IF wh IS NOT NULL THEN
    UPDATE public.inventory SET quantity = quantity + qty, last_updated = now(), updated_at = now()
    WHERE product_id = pid AND warehouse_id = wh;
  ELSE
    SELECT id INTO wh FROM public.warehouses LIMIT 1;
    IF wh IS NOT NULL THEN
      INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level)
      VALUES (pid, wh, qty, 10);
    END IF;
  END IF;

  INSERT INTO public.inventory_movements
    (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note)
  VALUES
    (pid, wh, 'purchase', qty, 'lpo_receipt', ri.id, current_date, 'Goods received: ' || COALESCE(ri.item_name, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_restock_on_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_restock_receipt_item(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_restock_on_receipt ON public.lpo_receipt_items;
CREATE TRIGGER trg_restock_on_receipt
  AFTER INSERT ON public.lpo_receipt_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_restock_on_receipt();

-- Backfill: restock for goods already received (idempotent)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.lpo_receipt_items LOOP
    PERFORM public.fn_restock_receipt_item(r.id);
  END LOOP;
END $$;
