-- ROLLBACK of 20261027120000_inventory_access.sql: stock writes go back to
-- admin-only (plus whatever the caller's own table access allows).
BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products', 'skus', 'inventory', 'stock_takes', 'stock_take_items', 'unit_conversions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Inventory editors can manage ' || t, t);
  END LOOP;
END $$;

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

    price := NULLIF(line->>'unit_price', '')::numeric;

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
  inv_code text;
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
  inv_code := public.fn_inventory_account(pid);

  IF delta <> 0 THEN
    PERFORM public.fn_post_entry(
      current_date,
      'Stock revaluation — ' || pname || ' ' || old_cost || ' → ' || p_cost || COALESCE(' (' || p_note || ')', ''),
      'stock_revaluation', gen_random_uuid(),
      CASE WHEN delta > 0 THEN jsonb_build_array(
        jsonb_build_object('code', inv_code, 'debit', delta, 'credit', 0, 'desc', 'Stock revalued up'),
        jsonb_build_object('code', '5900',   'debit', 0, 'credit', delta, 'desc', 'Stock revaluation gain'))
      ELSE jsonb_build_array(
        jsonb_build_object('code', '5900',   'debit', -delta, 'credit', 0, 'desc', 'Stock revaluation loss'),
        jsonb_build_object('code', inv_code, 'debit', 0, 'credit', -delta, 'desc', 'Stock revalued down'))
      END);
  END IF;

  UPDATE public.products SET cost_price = round(p_cost, 4) WHERE id = pid;
  RETURN delta;
END;
$$;

COMMIT;
