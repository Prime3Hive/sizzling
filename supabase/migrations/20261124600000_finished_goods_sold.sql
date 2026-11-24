-- ═════════════════════════════════════════════════════════════════════════════
-- Finished goods sold reduce their lots (inventory redesign, build stage 6)
--
-- Needs 20261124300000_stock_out_and_count.sql first.
--
-- What stage 6 asks for and where it already stands:
--   • A production batch from a recipe deducts its ingredients and creates one
--     finished-good lot with a cost and an expiry date. That is the Production
--     module (20261027100000) and is not changed here.
--   • A finished good sold on an INVOICE with an item line already leaves
--     stock, earliest-expiring lot first (fn_sync_invoice_stock).
--   • Daily sales recorded as takings (weekly sales, staff sales reports) are
--     money totals with no items, so nothing told the stock what was sold.
--     Finished goods sold that way stayed on the shelf in the records.
--
-- This adds the missing piece: fn_record_goods_sold, a "Sold" entry for the
-- finished goods that went out in the day's sales. It takes them from the
-- oldest lot first, and only from lots still in date: an expired lot is not
-- sold, it is recorded as waste.
--
-- This migration changes NO existing record and nothing about how the books
-- post. A 'sale' movement carries quantity and cost only; the money for the
-- sale is recorded where it always was.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- p_lines: [ { sku_id | product_id, quantity, unit?, lot_id? } ]
--   quantity is in `unit` (the stock unit when left out; a pack size otherwise).
--   lot_id names the lot to take from first; without it, the oldest in-date lot.
-- Returns { batch_id, lines, value, lots: [ { item, lot_number, expires_on, quantity } ] }.
CREATE OR REPLACE FUNCTION public.fn_record_goods_sold(
  p_lines       jsonb,
  p_occurred_on date DEFAULT current_date,
  p_note        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_date    date := COALESCE(p_occurred_on, current_date);
  v_note    text := NULLIF(public.fn_clean_text(p_note), '');
  v_batch   uuid := gen_random_uuid();
  line      jsonb;
  pr        record;
  l         record;
  pid       uuid;
  sid       uuid;
  v_lot     uuid;
  qty       numeric;
  unit      text;
  factor    numeric;
  stock_qty numeric;
  need      numeric;
  take      numeric;
  on_hand   numeric;
  in_lots   numeric;
  expired   numeric;
  cost      numeric;
  n         integer := 0;
  v_value   numeric := 0;
  v_lots    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to record stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.fn_has_module_permission(v_uid, 'inventory', 'create') OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'You don''t have permission to record stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Choose what was sold and how much.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_date > current_date THEN
    RAISE EXCEPTION 'Sales cannot be recorded for a future date (%).', v_date USING ERRCODE = 'check_violation';
  END IF;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    qty := NULLIF(line->>'quantity', '')::numeric;
    IF qty IS NULL OR qty = 0 THEN CONTINUE; END IF;
    IF qty < 0 THEN RAISE EXCEPTION 'A quantity cannot be negative.' USING ERRCODE = 'check_violation'; END IF;

    pid := NULLIF(line->>'product_id', '')::uuid;
    sid := NULLIF(line->>'sku_id', '')::uuid;
    IF pid IS NULL AND sid IS NOT NULL THEN
      SELECT id INTO pid FROM public.products WHERE sku_id = sid ORDER BY created_at LIMIT 1;
    END IF;
    SELECT p.id, p.sku_id, p.name, p.item_class, public.fn_normalise_unit(p.uom) AS uom INTO pr
      FROM public.products p WHERE p.id = pid;
    IF NOT FOUND THEN RAISE EXCEPTION 'An item on the list no longer exists.' USING ERRCODE = 'check_violation'; END IF;
    IF COALESCE(pr.item_class, 'raw_material') = 'raw_material' THEN
      RAISE EXCEPTION '% is not a finished good. Ingredients leave stock as an issue to the kitchen, an event or production.', pr.name
        USING ERRCODE = 'check_violation';
    END IF;
    sid := pr.sku_id;

    unit := COALESCE(public.fn_normalise_unit(line->>'unit'), pr.uom);
    factor := CASE WHEN unit = pr.uom THEN 1 ELSE public.fn_unit_factor(pid, unit, true) END;
    stock_qty := round(qty * factor, 4);
    IF stock_qty <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(sum(quantity), 0) INTO on_hand FROM public.inventory WHERE product_id = pid;
    SELECT COALESCE(sum(qty_remaining), 0),
           COALESCE(sum(qty_remaining) FILTER (WHERE expires_on IS NOT NULL AND expires_on < v_date), 0)
      INTO in_lots, expired
      FROM public.stock_lots WHERE product_id = pid AND status = 'active' AND qty_remaining > 0;

    v_lot := NULLIF(line->>'lot_id', '')::uuid;
    IF v_lot IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.stock_lots
          WHERE id = v_lot AND product_id = pid AND status = 'active' AND qty_remaining > 0
            AND (expires_on IS NULL OR expires_on >= v_date)) THEN
      RAISE EXCEPTION '%: that lot has nothing left to sell, or it has expired.', pr.name USING ERRCODE = 'check_violation';
    END IF;

    cost := COALESCE(public.fn_product_cost(pid), 0);
    PERFORM public.fn_clear_movement_context();
    PERFORM set_config('app.route', 'sale', true);
    PERFORM set_config('app.cost_center', 'Daily Orders', true);
    PERFORM set_config('app.entered_unit', CASE WHEN unit = pr.uom THEN '' ELSE unit END, true);
    PERFORM set_config('app.entered_factor', factor::text, true);

    -- Oldest in-date lot first (the chosen lot ahead of the rest). Each call
    -- takes no more than its lot holds, so exactly that lot is drawn.
    need := stock_qty;
    FOR l IN
      SELECT id, qty_remaining FROM public.stock_lots
       WHERE product_id = pid AND status = 'active' AND qty_remaining > 0
         AND (expires_on IS NULL OR expires_on >= v_date)
       ORDER BY COALESCE(id = v_lot, false) DESC, expires_on NULLS LAST, produced_on, lot_number
    LOOP
      EXIT WHEN need <= 0;
      take := LEAST(need, l.qty_remaining);
      PERFORM public.fn_deplete_stock(pid, take, 'sale', 'daily_sale', v_batch, v_date,
                                      COALESCE(v_note, 'Sold in the day''s sales'), NULL, v_uid, l.id);
      need := need - take;
    END LOOP;

    IF need > 0 THEN
      IF expired > 0 THEN
        RAISE EXCEPTION '%: only % % is in date. % % has expired and cannot be sold: record it as waste.',
          pr.name, rtrim(rtrim(to_char(stock_qty - need, 'FM999999990.0000'), '0'), '.'), pr.uom,
          rtrim(rtrim(to_char(expired, 'FM999999990.0000'), '0'), '.'), pr.uom
          USING ERRCODE = 'check_violation';
      ELSIF on_hand - in_lots >= need THEN
        -- Stock of a finished good that is not in any lot (entered as opening
        -- stock, or made before lots): nothing in a lot is left, so this draws it.
        PERFORM public.fn_deplete_stock(pid, need, 'sale', 'daily_sale', v_batch, v_date,
                                        COALESCE(v_note, 'Sold in the day''s sales'), NULL, v_uid, NULL);
      ELSE
        RAISE EXCEPTION '%: % % on hand, % % entered as sold. Record the missing production batch, or correct the count.',
          pr.name, rtrim(rtrim(to_char(on_hand, 'FM999999990.0000'), '0'), '.'), pr.uom,
          rtrim(rtrim(to_char(stock_qty, 'FM999999990.0000'), '0'), '.'), pr.uom
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF sid IS NOT NULL THEN
      INSERT INTO public.transactions
        (transaction_type, sku_id, quantity, unit_price, total_amount, notes, user_id, created_by, reference_id)
      VALUES ('SALE', sid, -stock_qty, round(cost, 4), round(stock_qty * cost, 2),
              COALESCE(v_note, 'Sold in the day''s sales'), v_uid, v_uid, v_batch);
    END IF;

    v_value := v_value + stock_qty * cost;
    n := n + 1;
  END LOOP;

  PERFORM public.fn_clear_movement_context();

  IF n = 0 THEN
    RAISE EXCEPTION 'Enter a quantity for at least one item.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'item', x.name, 'lot_number', x.lot_number, 'expires_on', x.expires_on, 'quantity', x.qty)
           ORDER BY x.name, x.expires_on NULLS LAST), '[]'::jsonb)
    INTO v_lots
    FROM (SELECT p.name, sl.lot_number, sl.expires_on, sum(-m.quantity_change) AS qty
            FROM public.inventory_movements m
            JOIN public.products p ON p.id = m.product_id
            LEFT JOIN public.stock_lots sl ON sl.id = m.lot_id
           WHERE m.reference_type = 'daily_sale' AND m.reference_id = v_batch
           GROUP BY p.name, sl.lot_number, sl.expires_on) x;

  RETURN jsonb_build_object('batch_id', v_batch, 'lines', n, 'value', round(v_value, 2), 'lots', v_lots);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_record_goods_sold(jsonb, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_record_goods_sold(jsonb, date, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
