-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK of 20261027100000_production.sql
--
-- Drops the production tables, lots, pack sizes and their functions, and
-- restores the previous bodies of fn_deplete_stock, record_stock_movements,
-- fn_post_stock_movement, fn_update_moving_average_cost, set_product_cost,
-- fn_consume_invoice_stock, fn_restock_receipt_item (20261017100000) and
-- fn_reverse_invoice_movements (20260819100000).
--
-- Kept on purpose: the widened quantity columns (narrowing back to integer
-- would round recorded stock), accounts 1210/5050 and the item_class column
-- (journals may already name them; the ledger is append-only), and the
-- production movement types (rows of those types may now exist). Before
-- rolling back, reclassify finished goods so 1210 is empty.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP FUNCTION IF EXISTS public.reverse_production_run(uuid, text);
DROP FUNCTION IF EXISTS public.cancel_production_run(uuid);
DROP FUNCTION IF EXISTS public.reject_production_run(uuid, text);
DROP FUNCTION IF EXISTS public.approve_production_run(uuid, text);
DROP FUNCTION IF EXISTS public.submit_production_run(jsonb);
DROP FUNCTION IF EXISTS public.fn_notify_production_approvers(uuid, text, text);
DROP FUNCTION IF EXISTS public.set_production_item(uuid, text, text, integer);

DROP TRIGGER IF EXISTS trg_apply_lot_movement    ON public.inventory_movements;
DROP TRIGGER IF EXISTS trg_reclass_product_stock ON public.products;
DROP FUNCTION IF EXISTS public.fn_apply_lot_movement();
DROP FUNCTION IF EXISTS public.fn_reclass_product_stock();
DROP FUNCTION IF EXISTS public.fn_next_lot_number(uuid, date);

ALTER TABLE public.inventory_movements DROP COLUMN IF EXISTS lot_id;
ALTER TABLE public.production_runs DROP CONSTRAINT IF EXISTS production_runs_lot_fk;
DROP TABLE IF EXISTS public.stock_lots;
DROP TABLE IF EXISTS public.production_run_costs;
DROP TABLE IF EXISTS public.production_run_inputs;
DROP TABLE IF EXISTS public.production_runs;
DROP SEQUENCE IF EXISTS public.production_run_seq;
DROP TABLE IF EXISTS public.recipe_costs;
DROP TABLE IF EXISTS public.recipe_lines;
DROP TABLE IF EXISTS public.recipes;
DROP TABLE IF EXISTS public.product_units;

ALTER TABLE public.products
  DROP COLUMN IF EXISTS lot_code,
  DROP COLUMN IF EXISTS shelf_life_days;

DROP FUNCTION IF EXISTS public.fn_deplete_stock(uuid, numeric, text, text, uuid, date, text, numeric, uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_post_stock_movement(p_movement_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m         record;
  mtype     text;
  cost      numeric;
  val       numeric;
  exp_code  text;
BEGIN
  SELECT * INTO m FROM public.inventory_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN RETURN; END IF;
  mtype := lower(COALESCE(m.movement_type, ''));

  -- Posted by their own documents: invoice COGS and LPO receipts.
  IF COALESCE(m.reference_type, '') IN ('invoice', 'lpo_receipt') THEN RETURN; END IF;
  IF mtype IN ('sale', 'transfer', 'reversal') THEN RETURN; END IF;

  IF COALESCE(m.quantity_change, 0) = 0 THEN
    PERFORM public.fn_unpost('stock_movement', p_movement_id);
    RETURN;
  END IF;

  cost := COALESCE(NULLIF(m.unit_cost, 0), public.fn_product_cost(m.product_id), 0);
  val  := round(abs(m.quantity_change) * cost, 2);

  -- A zero-cost item cannot be valued; a missing entry is visible, a nil one
  -- is not.
  IF val <= 0 THEN
    PERFORM public.fn_unpost('stock_movement', p_movement_id);
    RETURN;
  END IF;

  -- Opening stock on a new item: an asset the business already owned.
  IF m.reference_type = 'opening' THEN
    PERFORM public.fn_post_entry(
      COALESCE(m.occurred_on, current_date),
      'Opening stock — ' || COALESCE(m.note, ''),
      'stock_movement', p_movement_id,
      CASE WHEN m.quantity_change > 0 THEN jsonb_build_array(
        jsonb_build_object('code', '1200', 'debit', val, 'credit', 0, 'desc', 'Opening stock'),
        jsonb_build_object('code', '3000', 'debit', 0, 'credit', val, 'desc', 'Opening stock'))
      ELSE jsonb_build_array(
        jsonb_build_object('code', '3000', 'debit', val, 'credit', 0, 'desc', 'Opening stock correction'),
        jsonb_build_object('code', '1200', 'debit', 0, 'credit', val, 'desc', 'Opening stock correction'))
      END);
    RETURN;
  END IF;

  -- Stock bought outside an LPO. The expense already charged it to COGS; move
  -- it into Inventory until it is used.
  IF mtype = 'purchase' THEN
    PERFORM public.fn_post_entry(
      COALESCE(m.occurred_on, current_date),
      'Stock received — ' || COALESCE(m.note, 'purchase'),
      'stock_movement', p_movement_id,
      CASE WHEN m.quantity_change > 0 THEN jsonb_build_array(
        jsonb_build_object('code', '1200', 'debit', val, 'credit', 0, 'desc', 'Stock received into inventory'),
        jsonb_build_object('code', '5000', 'debit', 0, 'credit', val, 'desc', 'Held in stock until used'))
      ELSE jsonb_build_array(
        jsonb_build_object('code', '5000', 'debit', val, 'credit', 0, 'desc', 'Purchase returned'),
        jsonb_build_object('code', '1200', 'debit', 0, 'credit', val, 'desc', 'Purchase returned'))
      END);
    RETURN;
  END IF;

  exp_code := public.fn_stock_issue_expense_code(m.movement_type);

  IF m.quantity_change < 0 THEN
    PERFORM public.fn_post_entry(
      COALESCE(m.occurred_on, current_date),
      'Stock issued — ' || COALESCE(m.note, m.movement_type),
      'stock_movement', p_movement_id,
      jsonb_build_array(
        jsonb_build_object('code', exp_code, 'debit', val, 'credit', 0,
                           'desc', CASE WHEN exp_code = '5000' THEN 'Cost of goods sold' ELSE 'Stock write-off' END),
        jsonb_build_object('code', '1200', 'debit', 0, 'credit', val, 'desc', 'Inventory issued')));
  ELSE
    PERFORM public.fn_post_entry(
      COALESCE(m.occurred_on, current_date),
      'Stock adjustment in — ' || COALESCE(m.note, m.movement_type),
      'stock_movement', p_movement_id,
      jsonb_build_array(
        jsonb_build_object('code', '1200', 'debit', val, 'credit', 0, 'desc', 'Inventory adjustment'),
        jsonb_build_object('code', exp_code, 'debit', 0, 'credit', val, 'desc', 'Stock adjustment credit')));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_moving_average_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  total    numeric;
  prev_qty numeric;
  cur_cost numeric;
  new_cost numeric;
BEGIN
  IF NEW.movement_type <> 'purchase' OR NEW.quantity_change <= 0
     OR COALESCE(NEW.unit_cost, 0) <= 0 OR NEW.reverses_movement_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO total FROM public.inventory WHERE product_id = NEW.product_id;
  prev_qty := total - NEW.quantity_change;
  SELECT COALESCE(cost_price, 0) INTO cur_cost FROM public.products WHERE id = NEW.product_id;

  -- Nothing (or less than nothing) was on hand: the new price is the cost.
  IF prev_qty <= 0 OR cur_cost <= 0 OR total <= 0 THEN
    new_cost := NEW.unit_cost;
  ELSE
    new_cost := (prev_qty * cur_cost + NEW.quantity_change * NEW.unit_cost) / total;
  END IF;

  UPDATE public.products SET cost_price = round(new_cost, 4)
  WHERE id = NEW.product_id AND cost_price IS DISTINCT FROM round(new_cost, 4);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_product_cost(p_sku_id uuid, p_cost numeric, p_note text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pid      uuid;
  pname    text;
  old_cost numeric;
  on_hand  numeric;
  delta    numeric;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'manager')) THEN
    RAISE EXCEPTION 'Only an admin or manager can change an item''s cost.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_cost IS NULL OR p_cost < 0 THEN RAISE EXCEPTION 'Cost must be zero or more.'; END IF;

  SELECT id, name, COALESCE(cost_price, 0) INTO pid, pname, old_cost
  FROM public.products WHERE sku_id = p_sku_id LIMIT 1;
  IF pid IS NULL THEN RAISE EXCEPTION 'Item is not linked to an inventory product.'; END IF;
  IF round(p_cost, 4) = round(old_cost, 4) THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO on_hand FROM public.inventory WHERE product_id = pid;
  delta := round(GREATEST(on_hand, 0) * (p_cost - old_cost), 2);

  IF delta <> 0 THEN
    PERFORM public.fn_post_entry(
      current_date,
      'Stock revaluation — ' || pname || ' ' || old_cost || ' → ' || p_cost || COALESCE(' (' || p_note || ')', ''),
      'stock_revaluation', gen_random_uuid(),
      CASE WHEN delta > 0 THEN jsonb_build_array(
        jsonb_build_object('code', '1200', 'debit', delta, 'credit', 0, 'desc', 'Stock revalued up'),
        jsonb_build_object('code', '5900', 'debit', 0, 'credit', delta, 'desc', 'Stock revaluation gain'))
      ELSE jsonb_build_array(
        jsonb_build_object('code', '5900', 'debit', -delta, 'credit', 0, 'desc', 'Stock revaluation loss'),
        jsonb_build_object('code', '1200', 'debit', 0, 'credit', -delta, 'desc', 'Stock revalued down'))
      END);
  END IF;

  UPDATE public.products SET cost_price = round(p_cost, 4) WHERE id = pid;
  RETURN delta;
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_cost(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_cost(uuid, numeric, text) TO authenticated;

-- Shared by every stock-out: take p_qty (> 0) from the product's warehouses,
-- largest holding first, writing one movement per warehouse touched. Whatever
-- the warehouses cannot cover lands on the largest one (the guard decides
-- whether that is allowed). Returns nothing; raises on refusal.
CREATE OR REPLACE FUNCTION public.fn_deplete_stock(
  p_product_id     uuid,
  p_qty            numeric,
  p_movement_type  text,
  p_reference_type text,
  p_reference_id   uuid,
  p_occurred_on    date,
  p_note           text,
  p_unit_cost      numeric,
  p_created_by     uuid
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  r        record;
  remaining numeric := p_qty;
  take     numeric;
  first_id uuid;
  first_wh uuid;
BEGIN
  FOR r IN
    SELECT id, warehouse_id, quantity FROM public.inventory
    WHERE product_id = p_product_id ORDER BY quantity DESC, id
  LOOP
    IF first_id IS NULL THEN first_id := r.id; first_wh := r.warehouse_id; END IF;
    EXIT WHEN remaining <= 0;
    CONTINUE WHEN r.quantity <= 0;
    take := LEAST(remaining, r.quantity);
    UPDATE public.inventory SET quantity = quantity - take, last_updated = now(), updated_at = now() WHERE id = r.id;
    INSERT INTO public.inventory_movements
      (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost, created_by)
    VALUES (p_product_id, r.warehouse_id, p_movement_type, -take, p_reference_type, p_reference_id, p_occurred_on, p_note, p_unit_cost, p_created_by);
    remaining := remaining - take;
  END LOOP;

  IF remaining > 0 THEN
    IF first_id IS NULL THEN
      SELECT id INTO first_wh FROM public.warehouses ORDER BY created_at LIMIT 1;
      IF first_wh IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before recording stock.'; END IF;
      INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level)
      VALUES (p_product_id, first_wh, -remaining, 10);
    ELSE
      UPDATE public.inventory SET quantity = quantity - remaining, last_updated = now(), updated_at = now() WHERE id = first_id;
    END IF;
    INSERT INTO public.inventory_movements
      (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost, created_by)
    VALUES (p_product_id, first_wh, p_movement_type, -remaining, p_reference_type, p_reference_id, p_occurred_on, p_note, p_unit_cost, p_created_by);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_deplete_stock(uuid, numeric, text, text, uuid, date, text, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_deplete_stock(uuid, numeric, text, text, uuid, date, text, numeric, uuid) TO authenticated;

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
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  line    jsonb;
  pid     uuid;
  sid     uuid;
  delta   numeric;
  price   numeric;
  inv_id  uuid;
  wh_id   uuid;
  d       date := COALESCE(p_occurred_on, current_date);
  ref     text := COALESCE(p_reference_type, 'manual');
  n       integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to record stock.' USING ERRCODE = 'insufficient_privilege';
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

    -- Price given on the line (a purchase price, an opening-stock cost);
    -- otherwise the movement is stamped with the item's current average cost.
    price := NULLIF(line->>'unit_price', '')::numeric;

    IF delta < 0 THEN
      PERFORM public.fn_deplete_stock(pid, -delta, p_movement_type, ref, p_reference_id, d, p_note, NULL, auth.uid());
    ELSE
      inv_id := NULL; wh_id := NULL;
      SELECT id, warehouse_id INTO inv_id, wh_id FROM public.inventory
      WHERE product_id = pid ORDER BY quantity DESC, id LIMIT 1;
      IF inv_id IS NOT NULL THEN
        UPDATE public.inventory SET quantity = quantity + delta, last_updated = now(), updated_at = now() WHERE id = inv_id;
      ELSE
        SELECT id INTO wh_id FROM public.warehouses ORDER BY created_at LIMIT 1;
        IF wh_id IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before recording stock.'; END IF;
        INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level) VALUES (pid, wh_id, delta, 10);
      END IF;
      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost, created_by)
      VALUES (pid, wh_id, p_movement_type, delta, ref, p_reference_id, d, p_note, NULLIF(price, 0), auth.uid());
    END IF;

    IF p_transaction_type IS NOT NULL AND sid IS NOT NULL THEN
      price := COALESCE(price, public.fn_product_cost(pid), 0);
      INSERT INTO public.transactions
        (transaction_type, sku_id, quantity, unit_price, total_amount, notes, user_id, created_by, reference_id)
      VALUES
        (p_transaction_type, sid, delta, price, abs(delta) * price, COALESCE(p_note, ''), auth.uid(), auth.uid(), p_reference_id);
    END IF;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_consume_invoice_stock(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv        record;
  it         record;
  has_moves  boolean;
  available  numeric;
  cost       numeric;
  cogs_total numeric := 0;
  pname      text;
  allowed    boolean;
  d          date;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  has_moves := EXISTS (
    SELECT 1 FROM public.inventory_movements m
    WHERE m.reference_type = 'invoice' AND m.reference_id = p_invoice_id
      AND m.reverses_movement_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.inventory_movements r WHERE r.reverses_movement_id = m.id)
  );

  IF inv.status = 'invoice' AND NOT has_moves THEN
    SELECT allow_negative_stock INTO allowed FROM public.inventory_settings WHERE singleton;
    d := COALESCE(inv.converted_at::date, inv.issue_date);

    FOR it IN
      SELECT product_id, SUM(quantity) AS quantity
      FROM public.invoice_items
      WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL AND quantity > 0
      GROUP BY product_id
    LOOP
      -- Untracked products (no inventory rows) are skipped entirely.
      SELECT SUM(quantity) INTO available FROM public.inventory WHERE product_id = it.product_id;
      IF available IS NULL THEN CONTINUE; END IF;

      IF available < it.quantity AND NOT COALESCE(allowed, false) THEN
        SELECT name INTO pname FROM public.products WHERE id = it.product_id;
        RAISE EXCEPTION 'Insufficient stock to issue this invoice: % has % on hand but % is being invoiced. Adjust stock or the line quantity first.',
          COALESCE(pname, it.product_id::text), available, it.quantity;
      END IF;

      cost := public.fn_product_cost(it.product_id);
      PERFORM public.fn_deplete_stock(
        it.product_id, it.quantity, 'sale', 'invoice', p_invoice_id, d,
        'Invoice ' || COALESCE(inv.invoice_number, inv.quotation_number), cost, NULL);

      cogs_total := cogs_total + round(it.quantity * COALESCE(cost, 0), 2);
    END LOOP;

    IF cogs_total > 0 THEN
      PERFORM public.fn_post_entry(
        d,
        'COGS — Invoice ' || COALESCE(inv.invoice_number, inv.quotation_number),
        'invoice_cogs', p_invoice_id,
        jsonb_build_array(
          jsonb_build_object('code', '5000', 'debit', cogs_total, 'credit', 0, 'desc', 'Cost of goods sold'),
          jsonb_build_object('code', '1200', 'debit', 0, 'credit', cogs_total, 'desc', 'Inventory consumed')));
    END IF;

  ELSIF inv.status <> 'invoice' AND has_moves THEN
    PERFORM public.fn_reverse_invoice_movements(p_invoice_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_restock_receipt_item(p_receipt_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE ri record; pid uuid; wh uuid; qty numeric; cost numeric; val numeric; d date;
BEGIN
  SELECT * INTO ri FROM public.lpo_receipt_items WHERE id = p_receipt_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  qty := ri.quantity_received;
  IF qty IS NULL OR qty <= 0 THEN RETURN; END IF;

  SELECT product_id INTO pid FROM public.lpo_items WHERE id = ri.lpo_item_id;
  IF pid IS NULL THEN RETURN; END IF;  -- not a stocked product

  IF EXISTS (SELECT 1 FROM public.inventory_movements
             WHERE reference_type = 'lpo_receipt' AND reference_id = ri.id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(received_date, current_date) INTO d FROM public.lpo_receipts WHERE id = ri.receipt_id;
  d := COALESCE(d, current_date);
  cost := COALESCE(NULLIF(ri.unit_price, 0), public.fn_product_cost(pid), 0);

  SELECT warehouse_id INTO wh FROM public.inventory WHERE product_id = pid ORDER BY quantity DESC LIMIT 1;
  IF wh IS NOT NULL THEN
    UPDATE public.inventory SET quantity = quantity + qty, last_updated = now(), updated_at = now()
    WHERE product_id = pid AND warehouse_id = wh;
  ELSE
    SELECT id INTO wh FROM public.warehouses ORDER BY created_at LIMIT 1;
    -- Capitalising value with nowhere to put the stock would leave the ledger
    -- holding goods the stock module doesn't have.
    IF wh IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before receiving goods.'; END IF;
    INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level) VALUES (pid, wh, qty, 10);
  END IF;

  INSERT INTO public.inventory_movements
    (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost)
  VALUES
    (pid, wh, 'purchase', qty, 'lpo_receipt', ri.id, d, 'Goods received: ' || COALESCE(ri.item_name, ''), cost);

  val := round(qty * cost, 2);
  IF val > 0 THEN
    PERFORM public.fn_post_entry(
      d,
      'Goods received — ' || COALESCE(ri.item_name, ''),
      'inventory_purchase', ri.id,
      jsonb_build_array(
        jsonb_build_object('code', '1200', 'debit', val, 'credit', 0, 'desc', 'Inventory received'),
        jsonb_build_object('code', '2000', 'debit', 0, 'credit', val, 'desc', 'Supplier payable')));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_reverse_invoice_movements(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE mv record;
BEGIN
  FOR mv IN
    SELECT m.* FROM public.inventory_movements m
    WHERE m.reference_type = 'invoice' AND m.reference_id = p_invoice_id
      AND m.reverses_movement_id IS NULL          -- not itself a reversal
      AND NOT EXISTS (                            -- and not already reversed
        SELECT 1 FROM public.inventory_movements r
        WHERE r.reverses_movement_id = m.id
      )
  LOOP
    IF mv.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET quantity = quantity + (-mv.quantity_change), last_updated = now(), updated_at = now()
      WHERE product_id = mv.product_id AND warehouse_id = mv.warehouse_id;
    END IF;

    INSERT INTO public.inventory_movements
      (product_id, warehouse_id, movement_type, quantity_change, reference_type,
       reference_id, occurred_on, note, unit_cost, reverses_movement_id)
    VALUES
      (mv.product_id, mv.warehouse_id, 'reversal', -mv.quantity_change, 'invoice',
       p_invoice_id, current_date,
       'Reversal of movement ' || mv.id || ' — invoice no longer consumes stock',
       mv.unit_cost, mv.id);
  END LOOP;

  PERFORM public.fn_unpost('invoice_cogs', p_invoice_id);
END;
$$;

DROP FUNCTION IF EXISTS public.fn_inventory_account(uuid);
DROP FUNCTION IF EXISTS public.fn_can_read_production(uuid);
DROP FUNCTION IF EXISTS public.fn_has_module_permission(uuid, text, text);

COMMIT;
