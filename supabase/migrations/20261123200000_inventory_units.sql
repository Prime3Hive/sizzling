-- ═════════════════════════════════════════════════════════════════════════════
-- Inventory units (fix list of 23 November 2026, "inventory and units")
--
-- Needs 20261123100000_fix_list_nov23.sql first.
--
-- What was already there, confirmed in code before changing anything:
--   • products.uom is the item's STOCK unit. Balances and movements are in it.
--   • product_units (20261027100000) holds pack sizes per item: 1 bag = 10 kg.
--     Production used them; stock-ins and goods received notes did not.
--   • Since 20261117100000 stock movements post no cost (purchases are costed
--     by their expense), so a stock-in no longer takes cost out of the month.
--
-- What was wrong:
--   • A goods received note line ordered in a pack unit ("bag" for an item
--     stocked in kg) added the number of bags to the kg balance, and stamped
--     the price per bag as the cost per kg.
--   • "Record stock" had no unit at all: every number was taken as stock units.
--   • An item's unit could be changed freely, leaving old quantities and the
--     cost in the previous unit.
--
-- This migration changes NO existing stock quantity, cost or movement. Every
-- existing item keeps its unit; pack sizes and the purchase unit are set per
-- item afterwards, with the owner.
--
--   1. More units, and custom ones.
--   2. products.purchase_unit: the unit on the supplier's receipt (optional).
--   3. Movements remember what was typed: entered_qty + entered_unit, and the
--      stock unit in force when they were recorded.
--   4. record_stock_movements takes a unit per line (and a per-delivery factor,
--      and a total price) and converts to stock units.
--   5. Goods received notes convert from the order's unit to stock units; the
--      factor can be overridden per delivery.
--   6. The stock unit is locked once an item has movements. fn_change_stock_unit
--      restates the balance, cost, reorder level, pack sizes and recipes.
--   7. product_unit_changes: when an item's unit changed or an opening count
--      was posted. Movements before that are "before unit change".
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Units
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_normalise_unit(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN u IN ('kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms')                         THEN 'kg'
    WHEN u IN ('g', 'gm', 'gms', 'gram', 'grams', 'gramme', 'grammes')                         THEN 'gram'
    WHEN u IN ('l', 'lt', 'ltr', 'ltrs', 'liter', 'liters', 'litre', 'litres')                THEN 'litre'
    WHEN u IN ('ml', 'mls', 'millilitre', 'millilitres', 'milliliter', 'milliliters')          THEN 'millilitre'
    WHEN u IN ('pc', 'pcs', 'piece', 'pieces', 'unit', 'units', 'each', 'ea', 'no', 'nos')    THEN 'piece'
    WHEN u IN ('pack', 'packs', 'pk', 'pkt', 'pkts', 'packet', 'packets')                      THEN 'pack'
    WHEN u IN ('bag', 'bags', 'sack', 'sacks')                                                 THEN 'bag'
    WHEN u IN ('carton', 'cartons', 'ctn', 'ctns')                                             THEN 'carton'
    WHEN u IN ('basket', 'baskets')                                                            THEN 'basket'
    WHEN u IN ('crate', 'crates')                                                              THEN 'crate'
    WHEN u IN ('bottle', 'bottles', 'btl', 'btls')                                             THEN 'bottle'
    WHEN u IN ('tin', 'tins', 'can', 'cans')                                                   THEN 'tin'
    WHEN u IN ('sachet', 'sachets')                                                            THEN 'sachet'
    -- A custom unit: kept as typed, in lower case so "Bucket" and "bucket" are one.
    ELSE NULLIF(u, '')
  END
  FROM (SELECT lower(btrim(COALESCE(p, ''))) AS u) s;
$$;

-- Units an admin has added to the standard list (Inventory → Units).
ALTER TABLE public.inventory_settings
  ADD COLUMN IF NOT EXISTS custom_units text[] NOT NULL DEFAULT '{}';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Purchase unit, and the record of unit changes
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.products
  -- The unit goods usually arrive in. NULL = the stock unit. Must be the stock
  -- unit or one of the item's pack sizes (product_units).
  ADD COLUMN IF NOT EXISTS purchase_unit text;

CREATE TABLE IF NOT EXISTS public.product_unit_changes (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid          NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- unit_change: the stock unit changed and the balance was restated.
  -- opening_count: a physical count was posted as the new starting point.
  kind       text          NOT NULL CHECK (kind IN ('unit_change', 'opening_count')),
  old_unit   text,
  new_unit   text,
  -- New stock units in one old stock unit (1 for an opening count).
  factor     numeric(18,6) NOT NULL DEFAULT 1 CHECK (factor > 0),
  note       text,
  changed_by uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_unit_changes_product
  ON public.product_unit_changes(product_id, changed_at DESC);

ALTER TABLE public.product_unit_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_unit_changes_read" ON public.product_unit_changes;
CREATE POLICY "product_unit_changes_read" ON public.product_unit_changes
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.product_unit_changes FROM anon;
GRANT SELECT ON public.product_unit_changes TO authenticated;

-- Stock units in one `p_unit` of an item. 1 for the stock unit itself.
-- Strict: an unknown unit is refused. Not strict: it counts as 1 (old orders).
CREATE OR REPLACE FUNCTION public.fn_unit_factor(p_product_id uuid, p_unit text, p_strict boolean DEFAULT true)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uom text; v_name text; v_unit text; f numeric;
BEGIN
  v_unit := public.fn_normalise_unit(p_unit);
  IF v_unit IS NULL THEN RETURN 1; END IF;
  SELECT public.fn_normalise_unit(uom), name INTO v_uom, v_name FROM public.products WHERE id = p_product_id;
  IF v_uom IS NULL OR v_unit = v_uom THEN RETURN 1; END IF;

  SELECT factor INTO f FROM public.product_units
   WHERE product_id = p_product_id
     AND public.fn_normalise_unit(unit_name) = v_unit
   ORDER BY created_at LIMIT 1;
  IF f IS NOT NULL THEN RETURN f; END IF;

  IF p_strict THEN
    RAISE EXCEPTION '% is stocked in %. Say how many % are in one % (Edit item → Units) before recording it in %.',
      v_name, v_uom, v_uom, v_unit, v_unit USING ERRCODE = 'check_violation';
  END IF;
  RETURN 1;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_unit_factor(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_unit_factor(uuid, text, boolean) TO authenticated;

-- An item needs a stock unit; the unit is locked once it has movements; the
-- purchase unit must be convertible.
CREATE OR REPLACE FUNCTION public.fn_product_unit_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.fn_normalise_unit(NEW.uom) IS NULL THEN
    RAISE EXCEPTION 'Choose the unit % is stocked in.', COALESCE(NEW.name, 'this item') USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE'
     AND public.fn_normalise_unit(OLD.uom) IS DISTINCT FROM public.fn_normalise_unit(NEW.uom)
     AND COALESCE(current_setting('app.unit_change', true), '') <> 'on'
     AND EXISTS (SELECT 1 FROM public.inventory_movements WHERE product_id = NEW.id) THEN
    RAISE EXCEPTION '% already has stock movements in %. Use "Change stock unit" so the balance and cost are restated.',
      NEW.name, OLD.uom USING ERRCODE = 'check_violation';
  END IF;

  NEW.purchase_unit := public.fn_normalise_unit(NEW.purchase_unit);
  IF NEW.purchase_unit = public.fn_normalise_unit(NEW.uom) THEN
    NEW.purchase_unit := NULL;
  END IF;
  IF NEW.purchase_unit IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.purchase_unit IS DISTINCT FROM OLD.purchase_unit)
     AND NOT EXISTS (SELECT 1 FROM public.product_units
                      WHERE product_id = NEW.id
                        AND public.fn_normalise_unit(unit_name) = NEW.purchase_unit) THEN
    RAISE EXCEPTION 'Say how many % are in one % before making it the purchase unit.',
      NEW.uom, NEW.purchase_unit USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
-- After trg_a_product_normalise, before trg_zsync_product_to_sku.
DROP TRIGGER IF EXISTS trg_b_product_unit_rules ON public.products;
CREATE TRIGGER trg_b_product_unit_rules
  BEFORE INSERT OR UPDATE OF uom, purchase_unit ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_product_unit_rules();

-- Removing a pack size that was the purchase unit clears the purchase unit.
CREATE OR REPLACE FUNCTION public.fn_product_unit_removed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.products SET purchase_unit = NULL
   WHERE id = OLD.product_id
     AND purchase_unit = public.fn_normalise_unit(OLD.unit_name);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_product_unit_removed ON public.product_units;
CREATE TRIGGER trg_product_unit_removed
  AFTER DELETE ON public.product_units
  FOR EACH ROW EXECUTE FUNCTION public.fn_product_unit_removed();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Movements remember what was typed
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.inventory_movements
  -- What the person typed, when it was not in stock units: "2" "bag".
  ADD COLUMN IF NOT EXISTS entered_qty  numeric(14,4),
  ADD COLUMN IF NOT EXISTS entered_unit text,
  -- The item's stock unit when this was recorded. NULL on older movements.
  ADD COLUMN IF NOT EXISTS stock_unit   text;

-- The functions that record stock set two transaction-local settings before
-- they insert: app.entered_unit and app.entered_factor. One movement or
-- several (split across lots or warehouses), each row works out its own share.
CREATE OR REPLACE FUNCTION public.fn_stamp_movement_unit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u text; f numeric;
BEGIN
  IF NEW.stock_unit IS NULL THEN
    SELECT public.fn_normalise_unit(uom) INTO NEW.stock_unit FROM public.products WHERE id = NEW.product_id;
  END IF;
  IF NEW.entered_unit IS NULL THEN
    u := NULLIF(current_setting('app.entered_unit', true), '');
    f := NULLIF(current_setting('app.entered_factor', true), '')::numeric;
    IF u IS NOT NULL AND f IS NOT NULL AND f > 0 AND u IS DISTINCT FROM NEW.stock_unit THEN
      NEW.entered_unit := u;
      NEW.entered_qty  := round(NEW.quantity_change / f, 4);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stamp_movement_unit ON public.inventory_movements;
CREATE TRIGGER trg_stamp_movement_unit
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_movement_unit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Recording stock, with a unit per line
-- ─────────────────────────────────────────────────────────────────────────────
-- A line is
--   { sku_id | product_id, quantity_change, unit?, factor?, unit_price?, total_price?, lot_id? }
-- quantity_change and unit_price are in `unit` (the stock unit when left out).
-- `factor` overrides the item's pack size for this one delivery (a bag that
-- weighed 9.5 kg). `total_price` is what was paid for the whole line; it wins
-- over unit_price. Everything is stored in stock units.
CREATE OR REPLACE FUNCTION public.record_stock_movements(
  p_lines            jsonb,
  p_movement_type    text,
  p_note             text DEFAULT NULL,
  p_occurred_on      date DEFAULT current_date,
  p_transaction_type text DEFAULT NULL,
  p_reference_type   text DEFAULT 'manual',
  p_reference_id     uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  line    jsonb;
  pid     uuid;
  sid     uuid;
  delta   numeric;
  price   numeric;
  total   numeric;
  unit    text;
  factor  numeric;
  inv_id  uuid;
  wh_id   uuid;
  d       date := COALESCE(p_occurred_on, current_date);
  ref     text := COALESCE(p_reference_type, 'manual');
  n       integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to record stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.fn_has_module_permission(auth.uid(), 'inventory', 'create')
          OR public.has_role(auth.uid(), 'manager')) THEN
    RAISE EXCEPTION 'You don''t have permission to record stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'No items to record.';
  END IF;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    delta := NULLIF(line->>'quantity_change', '')::numeric;
    IF delta IS NULL OR delta = 0 THEN CONTINUE; END IF;

    pid := NULLIF(line->>'product_id', '')::uuid;
    sid := NULLIF(line->>'sku_id', '')::uuid;
    IF pid IS NULL THEN
      SELECT id INTO pid FROM public.products WHERE sku_id = sid LIMIT 1;
    ELSIF sid IS NULL THEN
      SELECT sku_id INTO sid FROM public.products WHERE id = pid;
    END IF;
    IF pid IS NULL THEN
      RAISE EXCEPTION 'Item % is not linked to an inventory product.', COALESCE(sid::text, '?');
    END IF;

    -- Convert what was typed into stock units.
    unit   := public.fn_normalise_unit(line->>'unit');
    factor := NULLIF(line->>'factor', '')::numeric;
    IF factor IS NOT NULL AND factor <= 0 THEN
      RAISE EXCEPTION 'The conversion factor must be greater than zero.' USING ERRCODE = 'check_violation';
    END IF;
    IF unit IS NULL THEN
      factor := 1;
    ELSIF factor IS NULL THEN
      factor := public.fn_unit_factor(pid, unit, true);
    ELSIF unit = (SELECT public.fn_normalise_unit(uom) FROM public.products WHERE id = pid) THEN
      factor := 1;
    END IF;

    delta := round(delta * factor, 4);
    IF delta = 0 THEN CONTINUE; END IF;

    price := NULLIF(line->>'unit_price', '')::numeric;
    total := NULLIF(line->>'total_price', '')::numeric;
    IF total IS NOT NULL AND total > 0 THEN
      price := total / abs(delta);
    ELSIF price IS NOT NULL THEN
      price := price / factor;
    END IF;

    PERFORM set_config('app.entered_unit',   COALESCE(unit, ''), true);
    PERFORM set_config('app.entered_factor', factor::text,       true);

    IF delta < 0 THEN
      PERFORM public.fn_deplete_stock(pid, -delta, p_movement_type, ref, p_reference_id, d, p_note, NULL, auth.uid(),
                                      NULLIF(line->>'lot_id', '')::uuid);
    ELSE
      inv_id := NULL; wh_id := NULL;
      SELECT id, warehouse_id INTO inv_id, wh_id FROM public.inventory
      WHERE product_id = pid ORDER BY quantity DESC, id LIMIT 1;
      IF inv_id IS NOT NULL THEN
        UPDATE public.inventory SET quantity = quantity + delta, last_updated = now(), updated_at = now() WHERE id = inv_id;
      ELSE
        SELECT id INTO wh_id FROM public.warehouses ORDER BY created_at LIMIT 1;
        IF wh_id IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before recording stock.'; END IF;
        INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level) VALUES (pid, wh_id, delta, 0);
      END IF;
      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost, created_by)
      VALUES (pid, wh_id, p_movement_type, delta, ref, p_reference_id, d, p_note, NULLIF(round(price, 4), 0), auth.uid());
    END IF;

    PERFORM set_config('app.entered_unit',   '', true);
    PERFORM set_config('app.entered_factor', '', true);

    IF p_transaction_type IS NOT NULL AND sid IS NOT NULL THEN
      price := COALESCE(price, public.fn_product_cost(pid), 0);
      INSERT INTO public.transactions
        (transaction_type, sku_id, quantity, unit_price, total_amount, notes, user_id, created_by, reference_id)
      VALUES
        (p_transaction_type, sid, delta, round(price, 4), round(abs(delta) * price, 2), COALESCE(p_note, ''), auth.uid(), auth.uid(), p_reference_id);
    END IF;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_movements(jsonb, text, text, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_movements(jsonb, text, text, date, text, text, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Goods received notes convert to stock units
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.lpo_receipt_items
  -- Stock units in one of the order's units for THIS delivery. NULL = the
  -- item's own pack size.
  ADD COLUMN IF NOT EXISTS conversion_factor numeric(18,6) CHECK (conversion_factor IS NULL OR conversion_factor > 0);

CREATE OR REPLACE FUNCTION public.fn_restock_receipt_item(p_receipt_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  ri record; pid uuid; wh uuid; qty numeric; cost numeric; val numeric; d date;
  v_unit text; f numeric; stock_qty numeric;
BEGIN
  SELECT * INTO ri FROM public.lpo_receipt_items WHERE id = p_receipt_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  qty := ri.quantity_received;
  IF qty IS NULL OR qty <= 0 THEN RETURN; END IF;

  SELECT product_id, unit_of_measure INTO pid, v_unit FROM public.lpo_items WHERE id = ri.lpo_item_id;
  IF pid IS NULL THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.inventory_movements
             WHERE reference_type = 'lpo_receipt' AND reference_id = ri.id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(received_date, current_date) INTO d FROM public.lpo_receipts WHERE id = ri.receipt_id;
  d := COALESCE(d, current_date);

  -- The order line is in the purchase unit and priced per purchase unit.
  -- Stock and its cost are kept per stock unit.
  f := COALESCE(ri.conversion_factor, public.fn_unit_factor(pid, v_unit, false), 1);
  stock_qty := round(qty * f, 4);
  cost := COALESCE(NULLIF(ri.unit_price, 0) / f, public.fn_product_cost(pid), 0);

  SELECT warehouse_id INTO wh FROM public.inventory WHERE product_id = pid ORDER BY quantity DESC LIMIT 1;
  IF wh IS NOT NULL THEN
    UPDATE public.inventory SET quantity = quantity + stock_qty, last_updated = now(), updated_at = now()
    WHERE product_id = pid AND warehouse_id = wh;
  ELSE
    SELECT id INTO wh FROM public.warehouses ORDER BY created_at LIMIT 1;
    IF wh IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before receiving goods.'; END IF;
    INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level) VALUES (pid, wh, stock_qty, 0);
  END IF;

  PERFORM set_config('app.entered_unit',   COALESCE(public.fn_normalise_unit(v_unit), ''), true);
  PERFORM set_config('app.entered_factor', f::text, true);
  INSERT INTO public.inventory_movements
    (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost)
  VALUES
    (pid, wh, 'purchase', stock_qty, 'lpo_receipt', ri.id, d, 'Goods received: ' || COALESCE(ri.item_name, ''), round(cost, 4));
  PERFORM set_config('app.entered_unit',   '', true);
  PERFORM set_config('app.entered_factor', '', true);

  -- The value is what was paid: purchase units × price per purchase unit.
  val := round(qty * COALESCE(NULLIF(ri.unit_price, 0), cost * f), 2);
  IF val > 0 THEN
    PERFORM public.fn_post_entry(
      d,
      'Goods received — ' || COALESCE(ri.item_name, ''),
      'inventory_purchase', ri.id,
      jsonb_build_array(
        jsonb_build_object('code', public.fn_inventory_account(pid), 'debit', val, 'credit', 0, 'desc', 'Inventory received'),
        jsonb_build_object('code', '2000', 'debit', 0, 'credit', val, 'desc', 'Supplier payable')));
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Changing an item's stock unit, properly
-- ─────────────────────────────────────────────────────────────────────────────
-- The negative-stock guard, unchanged except that restating a balance into a
-- new unit is not a stock-out (a balance of −3 bags becomes −30 kg).
CREATE OR REPLACE FUNCTION public.fn_inventory_negative_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  allowed   boolean;
  others    numeric;
  new_total numeric;
  pname     text;
BEGIN
  IF COALESCE(current_setting('app.unit_change', true), '') = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.quantity >= OLD.quantity THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.quantity >= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO others
  FROM public.inventory
  WHERE product_id = NEW.product_id AND (TG_OP = 'INSERT' OR id <> NEW.id);
  new_total := others + NEW.quantity;
  IF new_total >= 0 THEN RETURN NEW; END IF;

  SELECT allow_negative_stock INTO allowed FROM public.inventory_settings WHERE singleton;
  IF COALESCE(allowed, false) THEN RETURN NEW; END IF;

  SELECT name INTO pname FROM public.products WHERE id = NEW.product_id;
  RAISE EXCEPTION 'Insufficient stock: % has % on hand, this would take it to %. Negative stock is turned off in Inventory setup.',
    COALESCE(pname, NEW.product_id::text),
    others + CASE WHEN TG_OP = 'UPDATE' THEN OLD.quantity ELSE 0 END,
    new_total
    USING ERRCODE = 'check_violation';
END;
$$;

-- p_factor: how many NEW units are in one OLD unit.
--   bag → kg, a bag holding 10 kg:   p_factor = 10
--   piece → kg where "piece" stood in for kg: p_factor = 1
-- Balance and reorder level are multiplied, cost per unit divided, so the
-- stock VALUE does not move. The old unit is kept as a pack size (1 bag =
-- 10 kg) and becomes the purchase unit when none is set. Old movements are
-- left exactly as they were; product_unit_changes says when the unit changed.
CREATE OR REPLACE FUNCTION public.fn_change_stock_unit(
  p_sku_id uuid, p_new_unit text, p_factor numeric, p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p        record;
  v_old    text;
  v_new    text := public.fn_normalise_unit(p_new_unit);
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

  PERFORM set_config('app.unit_change', 'on', true);

  UPDATE public.inventory
     SET quantity      = round(quantity * p_factor, 4),
         reorder_level = round(COALESCE(reorder_level, 0) * p_factor),
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

  UPDATE public.skus SET reorder_level = round(COALESCE(reorder_level, 0) * p_factor) WHERE id = p_sku_id;

  PERFORM set_config('app.unit_change', '', true);

  INSERT INTO public.product_unit_changes (product_id, kind, old_unit, new_unit, factor, note, changed_by)
  VALUES (p.id, 'unit_change', v_old, v_new, p_factor, NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.fn_change_stock_unit(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_change_stock_unit(uuid, text, numeric, text) TO authenticated;

-- A full physical count posted as the new starting point: every active item
-- is marked, so its earlier movements read as "before the opening count" and
-- stay out of usage figures. Quantities are set by the stock take itself.
CREATE OR REPLACE FUNCTION public.fn_mark_opening_count(p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin can post an opening count.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO public.product_unit_changes (product_id, kind, old_unit, new_unit, factor, note, changed_by)
  SELECT pr.id, 'opening_count', public.fn_normalise_unit(pr.uom), public.fn_normalise_unit(pr.uom), 1,
         NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid()
    FROM public.products pr
    JOIN public.skus s ON s.id = pr.sku_id
   WHERE NOT COALESCE(s.is_archived, false);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_mark_opening_count(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mark_opening_count(text) TO authenticated;

-- Stock received against an expense is found by the expense's id.
CREATE INDEX IF NOT EXISTS idx_inv_moves_reference
  ON public.inventory_movements(reference_type, reference_id);

COMMIT;
