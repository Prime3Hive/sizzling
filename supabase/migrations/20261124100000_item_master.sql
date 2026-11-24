-- ═════════════════════════════════════════════════════════════════════════════
-- Item master (inventory redesign of 23 November 2026, build stage 1)
--
-- Needs 20261123200000_inventory_units.sql first.
--
-- This migration changes NO stock quantity, cost, movement or ledger entry.
-- It adds what an item needs to be set up once, fully, and fixes two faults
-- found in the review of 23 November:
--
--   A. The item page said "This item doesn't exist" for every item. `inventory`
--      has two identical foreign keys to `products` (fk_inventory_product_id
--      and inventory_product_id_fkey) and two to `warehouses`, so any query
--      that reads an item with its stock is ambiguous and the API answers
--      HTTP 300. The duplicate of each pair is dropped; the other stays.
--   B. Changing Chicken Wings from bag to kg (1 bag = 20 kg) previewed the
--      reorder level as 20 kg and saved 400 kg. fn_change_stock_unit restated
--      the level on the stock rows, the mirror trigger copied that to the item
--      (1 → 20), and the function then multiplied the item's level a second
--      time (20 → 400). The second multiplication is removed.
--
--   1. products.item_kind        raw ingredient, packaging, cleaning, fuel,
--                                finished good
--      products.storage_place    where it is kept; orders the count sheet
--      products.default_payee_id the usual supplier (optional)
--      products.counted_weekly   on the weekly count sheet, or left out
--      inventory_settings.storage_places   the list of storage places
--   2. One item per name.
--   3. An item with stock on hand cannot be archived.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A. One foreign key per relationship
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inventory'::regclass AND conname = 'inventory_product_id_fkey')
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inventory'::regclass AND conname = 'fk_inventory_product_id') THEN
    ALTER TABLE public.inventory DROP CONSTRAINT fk_inventory_product_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inventory'::regclass AND conname = 'inventory_warehouse_id_fkey')
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.inventory'::regclass AND conname = 'fk_inventory_warehouse_id') THEN
    ALTER TABLE public.inventory DROP CONSTRAINT fk_inventory_warehouse_id;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The item master fields
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.products
  -- NULL = not set yet. Existing items are left unset on purpose: the owner
  -- says what each one is (Inventory → "Needs setup").
  ADD COLUMN IF NOT EXISTS item_kind        text,
  ADD COLUMN IF NOT EXISTS storage_place    text,
  ADD COLUMN IF NOT EXISTS default_payee_id uuid REFERENCES public.payees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS counted_weekly   boolean NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_item_kind_check
    CHECK (item_kind IS NULL OR item_kind IN ('raw_ingredient', 'packaging', 'cleaning', 'fuel', 'finished_good'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Items already made in production are finished goods: a fact, not a guess.
UPDATE public.products SET item_kind = 'finished_good'
 WHERE item_class <> 'raw_material' AND item_kind IS DISTINCT FROM 'finished_good';

ALTER TABLE public.inventory_settings
  ADD COLUMN IF NOT EXISTS storage_places text[] NOT NULL
    DEFAULT ARRAY['Freezer', 'Cold room', 'Dry store', 'Gas store'];

-- The type follows the production class: an item made in production is a
-- finished good, and nothing else is. Lots, shelf life and the finished-goods
-- account all hang off item_class, so that stays the one place it is decided
-- (Production → item setup).
CREATE OR REPLACE FUNCTION public.fn_product_master_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.storage_place := NULLIF(btrim(COALESCE(NEW.storage_place, '')), '');

  IF COALESCE(NEW.item_class, 'raw_material') <> 'raw_material' THEN
    NEW.item_kind := 'finished_good';
  ELSIF NEW.item_kind = 'finished_good' THEN
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.item_class, 'raw_material') <> 'raw_material' THEN
      -- Moved back out of production: the type has to be chosen again.
      NEW.item_kind := NULL;
    ELSE
      RAISE EXCEPTION '% is not made in production. Set it up as a finished good in Production first.',
        COALESCE(NEW.name, 'This item') USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- After trg_b_product_unit_rules, before trg_zsync_product_to_sku.
DROP TRIGGER IF EXISTS trg_c_product_master_rules ON public.products;
CREATE TRIGGER trg_c_product_master_rules
  BEFORE INSERT OR UPDATE OF item_kind, item_class, storage_place ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_product_master_rules();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. One item per name
-- ─────────────────────────────────────────────────────────────────────────────
-- Checked when an item is added or renamed. Not a unique index: names already
-- in the list are left as they are, and an item whose name is already shared
-- can still be edited. Archived items count, so "Prawns" is restored rather
-- than added a second time.
CREATE OR REPLACE FUNCTION public.fn_product_name_unique()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text := lower(btrim(regexp_replace(COALESCE(NEW.name, ''), '\s+', ' ', 'g')));
BEGIN
  IF v_name = '' THEN
    RAISE EXCEPTION 'Give the item a name.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE'
     AND v_name = lower(btrim(regexp_replace(COALESCE(OLD.name, ''), '\s+', ' ', 'g'))) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.products o
              WHERE o.id IS DISTINCT FROM NEW.id
                AND lower(btrim(regexp_replace(COALESCE(o.name, ''), '\s+', ' ', 'g'))) = v_name) THEN
    RAISE EXCEPTION '"%" is already in the item list. Use that item instead of adding it again.',
      btrim(NEW.name) USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_a0_product_name_unique ON public.products;
CREATE TRIGGER trg_a0_product_name_unique
  BEFORE INSERT OR UPDATE OF name ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_product_name_unique();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. No archiving with stock on hand
-- ─────────────────────────────────────────────────────────────────────────────
-- The stock is first corrected to zero, with a reason (Record stock →
-- Correction). The Inventory page does both in one step.
CREATE OR REPLACE FUNCTION public.fn_sku_archive_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.is_archived, false) AND NOT COALESCE(OLD.is_archived, false)
     AND COALESCE(NEW.stock_quantity, 0) <> 0 THEN
    RAISE EXCEPTION '% still has % % on hand. Record a correction to zero, with the reason, before archiving it.',
      NEW.name, rtrim(rtrim(to_char(NEW.stock_quantity, 'FM999999990.0000'), '0'), '.'), COALESCE(NEW.unit_of_measure, '')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sku_archive_guard ON public.skus;
CREATE TRIGGER trg_sku_archive_guard
  BEFORE UPDATE OF is_archived ON public.skus
  FOR EACH ROW EXECUTE FUNCTION public.fn_sku_archive_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Changing the stock unit restates the reorder level once
-- ─────────────────────────────────────────────────────────────────────────────
-- Identical to 20261123200000 except for the item's reorder level (marked).
CREATE OR REPLACE FUNCTION public.fn_change_stock_unit(
  p_sku_id uuid, p_new_unit text, p_factor numeric, p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p        record;
  v_old    text;
  v_new    text := public.fn_normalise_unit(p_new_unit);
  v_level  numeric;
BEGIN
  IF NOT public.fn_has_module_permission(auth.uid(), 'inventory', 'update') THEN
    RAISE EXCEPTION 'You don''t have permission to change an item''s unit.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_new IS NULL THEN RAISE EXCEPTION 'Choose the new stock unit.'; END IF;
  IF p_factor IS NULL OR p_factor <= 0 THEN RAISE EXCEPTION 'The conversion factor must be greater than zero.'; END IF;

  SELECT * INTO p FROM public.products WHERE sku_id = p_sku_id ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item is not linked to an inventory product.'; END IF;
  v_old := public.fn_normalise_unit(p.uom);
  IF v_old = v_new THEN RAISE EXCEPTION '% is already stocked in %.', p.name, v_new; END IF;

  -- Made items carry lots, yields and run records in their unit; those are
  -- not restated here.
  IF p.item_class <> 'raw_material'
     OR EXISTS (SELECT 1 FROM public.stock_lots WHERE product_id = p.id AND status <> 'void') THEN
    RAISE EXCEPTION '% is made in production; its unit cannot be changed here.', p.name;
  END IF;
  IF EXISTS (SELECT 1 FROM public.production_run_inputs i
               JOIN public.production_runs r ON r.id = i.run_id
              WHERE i.product_id = p.id AND r.status = 'submitted') THEN
    RAISE EXCEPTION '% is in a production run waiting for approval. Approve or reject it first.', p.name;
  END IF;

  -- The level as it stands, in the old unit, read before anything moves.
  SELECT COALESCE(reorder_level, 0) INTO v_level FROM public.skus WHERE id = p_sku_id;
  v_level := round(COALESCE(v_level, 0) * p_factor);

  PERFORM set_config('app.unit_change', 'on', true);

  UPDATE public.inventory
     SET quantity      = round(quantity * p_factor, 4),
         reorder_level = v_level,
         last_updated  = now(), updated_at = now()
   WHERE product_id = p.id;

  -- Pack sizes were "old units per pack"; they become "new units per pack".
  DELETE FROM public.product_units
   WHERE product_id = p.id AND public.fn_normalise_unit(unit_name) = v_new;
  UPDATE public.product_units SET factor = factor * p_factor WHERE product_id = p.id;
  IF p_factor <> 1 THEN
    INSERT INTO public.product_units (product_id, unit_name, factor, created_by)
    VALUES (p.id, v_old, p_factor, auth.uid())
    ON CONFLICT (product_id, lower(btrim(unit_name))) DO UPDATE SET factor = EXCLUDED.factor;
  END IF;

  -- Recipes keep saying what they said: "2 bag" stays 2 bags, now 20 kg.
  UPDATE public.recipe_lines
     SET factor    = factor * p_factor,
         unit_name = COALESCE(NULLIF(btrim(unit_name), ''), v_old)
   WHERE product_id = p.id;

  UPDATE public.products
     SET uom           = v_new,
         cost_price    = round(COALESCE(cost_price, 0) / p_factor, 4),
         purchase_unit = CASE
                           WHEN p_factor = 1 THEN NULL
                           WHEN purchase_unit IS NULL OR purchase_unit = v_new THEN v_old
                           ELSE purchase_unit
                         END
   WHERE id = p.id;

  -- CHANGED: the item's level is SET to the restated figure, not multiplied.
  -- The stock rows above already carried it to the item through the mirror
  -- trigger; multiplying here as well turned 1 bag into 400 kg instead of 20.
  UPDATE public.skus SET reorder_level = v_level WHERE id = p_sku_id;

  PERFORM set_config('app.unit_change', '', true);

  INSERT INTO public.product_unit_changes (product_id, kind, old_unit, new_unit, factor, note, changed_by)
  VALUES (p.id, 'unit_change', v_old, v_new, p_factor, NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.fn_change_stock_unit(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_change_stock_unit(uuid, text, numeric, text) TO authenticated;

COMMIT;

-- The API caches the table relationships; make it read them again.
NOTIFY pgrst, 'reload schema';
