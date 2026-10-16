-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK of 20261017100000_inventory_finance_fixes.sql
--
-- Restores the previous bodies of fn_post_stock_movement, fn_consume_invoice_
-- stock (20260819100000), fn_restock_receipt_item (20260723120000), the
-- negative-stock guard and record_stock_movements (20261016100000), and drops
-- the moving-average trigger, set_product_cost and fn_deplete_stock.
--
-- Kept on purpose: the widened cost columns (narrowing would round recorded
-- costs) and the 'reversal' movement type (rows of that type may now exist).
-- Journals already posted stay posted — the ledger is append-only.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP TRIGGER IF EXISTS trg_zz_moving_average_cost ON public.inventory_movements;
DROP FUNCTION IF EXISTS public.fn_update_moving_average_cost();
DROP FUNCTION IF EXISTS public.set_product_cost(uuid, numeric, text);
DROP FUNCTION IF EXISTS public.record_stock_movements(jsonb, text, text, date, text, text, uuid);

CREATE OR REPLACE FUNCTION public.fn_post_stock_movement(p_movement_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m         record;
  cost      numeric;
  val       numeric;
  exp_code  text;
  qty_abs   numeric;
BEGIN
  SELECT * INTO m FROM public.inventory_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Already posted by the invoice or receipt path — leave well alone.
  IF COALESCE(m.reference_type, '') IN ('invoice', 'lpo_receipt') THEN
    RETURN;
  END IF;
  IF lower(COALESCE(m.movement_type, '')) IN ('sale', 'purchase') THEN
    RETURN;
  END IF;

  -- A transfer moves stock between warehouses. Total inventory is unchanged, so
  -- there is nothing for the ledger to say.
  IF lower(COALESCE(m.movement_type, '')) = 'transfer' THEN
    RETURN;
  END IF;

  IF COALESCE(m.quantity_change, 0) = 0 THEN
    PERFORM public.fn_unpost('stock_movement', p_movement_id);
    RETURN;
  END IF;

  cost    := COALESCE(NULLIF(m.unit_cost, 0), public.fn_product_cost(m.product_id), 0);
  qty_abs := abs(m.quantity_change);
  val     := round(qty_abs * cost, 2);

  -- A zero-cost item cannot be valued. Post nothing rather than post a nil
  -- entry that silently understates cost — M-09 exists to price these items,
  -- and a missing entry is visible where a zero entry is not.
  IF val <= 0 THEN
    PERFORM public.fn_unpost('stock_movement', p_movement_id);
    RETURN;
  END IF;

  exp_code := public.fn_stock_issue_expense_code(m.movement_type);

  IF m.quantity_change < 0 THEN
    -- Stock out: relieve inventory, charge the cost.
    PERFORM public.fn_post_entry(
      COALESCE(m.occurred_on, current_date),
      'Stock issued — ' || COALESCE(m.note, m.movement_type),
      'stock_movement', p_movement_id,
      jsonb_build_array(
        jsonb_build_object('code', exp_code, 'debit', val, 'credit', 0,
                           'desc', CASE WHEN exp_code = '5000'
                                        THEN 'Cost of goods sold' ELSE 'Stock write-off' END),
        jsonb_build_object('code', '1200', 'debit', 0, 'credit', val,
                           'desc', 'Inventory issued')
      )
    );
  ELSE
    -- Stock in that did not come from a supplier: an upward adjustment, a count
    -- gain, a return to store. Reinstate the asset against the same account the
    -- loss would have been charged to.
    PERFORM public.fn_post_entry(
      COALESCE(m.occurred_on, current_date),
      'Stock adjustment in — ' || COALESCE(m.note, m.movement_type),
      'stock_movement', p_movement_id,
      jsonb_build_array(
        jsonb_build_object('code', '1200', 'debit', val, 'credit', 0,
                           'desc', 'Inventory adjustment'),
        jsonb_build_object('code', exp_code, 'debit', 0, 'credit', val,
                           'desc', 'Stock adjustment credit')
      )
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_consume_invoice_stock(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv        record;
  it         record;
  mv         record;
  wh_id      uuid;
  has_moves  boolean;
  available  numeric;
  cost       numeric;
  cogs_total numeric := 0;
  pname      text;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- "Holds live movements": originals that have not been reversed. Counting
  -- every row would stay true forever once a cancellation had written its
  -- reversals, and an invoice re-issued after cancellation would then never
  -- consume stock again.
  has_moves := EXISTS (
    SELECT 1 FROM public.inventory_movements m
    WHERE m.reference_type = 'invoice' AND m.reference_id = p_invoice_id
      AND m.reverses_movement_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_movements r WHERE r.reverses_movement_id = m.id
      )
  );

  -- Consume on issue (once)
  IF inv.status = 'invoice' AND NOT has_moves THEN
    FOR it IN
      SELECT product_id, quantity
      FROM public.invoice_items
      WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL AND quantity > 0
    LOOP
      -- Untracked products (no inventory rows) are skipped entirely — no
      -- phantom movements, no cost.
      SELECT COALESCE(SUM(quantity), NULL) INTO available
      FROM public.inventory WHERE product_id = it.product_id;
      IF available IS NULL THEN CONTINUE; END IF;

      IF available < it.quantity THEN
        SELECT name INTO pname FROM public.products WHERE id = it.product_id;
        RAISE EXCEPTION 'Insufficient stock to issue this invoice: % has % on hand but % is being invoiced. Adjust stock or the line quantity first.',
          COALESCE(pname, it.product_id::text), available, it.quantity;
      END IF;

      -- deplete the warehouse holding the most stock for this product
      SELECT warehouse_id INTO wh_id
      FROM public.inventory WHERE product_id = it.product_id
      ORDER BY quantity DESC LIMIT 1;

      cost := public.fn_product_cost(it.product_id);

      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost)
      VALUES
        (it.product_id, wh_id, 'sale', -it.quantity, 'invoice', p_invoice_id,
         COALESCE(inv.converted_at::date, inv.issue_date),
         'Invoice ' || COALESCE(inv.invoice_number, inv.quotation_number), cost);

      UPDATE public.inventory
      SET quantity = quantity - it.quantity, last_updated = now(), updated_at = now()
      WHERE product_id = it.product_id AND warehouse_id = wh_id;

      cogs_total := cogs_total + round(it.quantity * COALESCE(cost, 0), 2);
    END LOOP;

    -- Cost of goods sold for the tracked lines (IAS 2 matching)
    IF cogs_total > 0 THEN
      PERFORM public.fn_post_entry(
        COALESCE(inv.converted_at::date, inv.issue_date),
        'COGS — Invoice ' || COALESCE(inv.invoice_number, inv.quotation_number),
        'invoice_cogs', p_invoice_id,
        jsonb_build_array(
          jsonb_build_object('code', '5000', 'debit', cogs_total, 'credit', 0, 'desc', 'Cost of goods sold'),
          jsonb_build_object('code', '1200', 'debit', 0, 'credit', cogs_total, 'desc', 'Inventory consumed')
        )
      );
    END IF;

  -- Reverse if it left 'invoice' status (e.g. cancelled) after having consumed
  ELSIF inv.status <> 'invoice' AND has_moves THEN
    -- Restores quantities AND writes a reversing movement for each original,
    -- instead of erasing the movements outright.
    PERFORM public.fn_reverse_invoice_movements(p_invoice_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_restock_receipt_item(p_receipt_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE ri record; pid uuid; wh uuid; qty numeric; cost numeric; val numeric;
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

  cost := COALESCE(NULLIF(ri.unit_price, 0), public.fn_product_cost(pid), 0);

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
    (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost)
  VALUES
    (pid, wh, 'purchase', qty, 'lpo_receipt', ri.id, current_date, 'Goods received: ' || COALESCE(ri.item_name, ''), cost);

  -- Capitalize the goods (IAS 2): the liability sits in AP until the supplier
  -- is paid (settle via remittance/manual journal: Dr 2000 / Cr Bank).
  val := round(qty * cost, 2);
  IF val > 0 THEN
    PERFORM public.fn_post_entry(
      current_date,
      'Goods received — ' || COALESCE(ri.item_name, ''),
      'inventory_purchase', ri.id,
      jsonb_build_array(
        jsonb_build_object('code', '1200', 'debit', val, 'credit', 0, 'desc', 'Inventory received'),
        jsonb_build_object('code', '2000', 'debit', 0, 'credit', val, 'desc', 'Supplier payable')
      )
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_inventory_negative_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  allowed boolean;
  pname   text;
BEGIN
  IF NEW.quantity >= 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.quantity >= OLD.quantity THEN RETURN NEW; END IF;

  SELECT allow_negative_stock INTO allowed FROM public.inventory_settings WHERE singleton;
  IF COALESCE(allowed, false) THEN RETURN NEW; END IF;

  SELECT name INTO pname FROM public.products WHERE id = NEW.product_id;
  RAISE EXCEPTION 'Insufficient stock: % has % on hand, this would take it to %. Negative stock is turned off in Inventory setup.',
    COALESCE(pname, NEW.product_id::text),
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.quantity ELSE 0 END,
    NEW.quantity
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.record_stock_movements(
  p_lines            jsonb,
  p_movement_type    text,
  p_note             text DEFAULT NULL,
  p_occurred_on      date DEFAULT current_date,
  p_transaction_type text DEFAULT NULL
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

    -- the warehouse holding the most stock for this product, else the first
    inv_id := NULL; wh_id := NULL;
    SELECT id, warehouse_id INTO inv_id, wh_id FROM public.inventory
    WHERE product_id = pid ORDER BY quantity DESC LIMIT 1;

    IF inv_id IS NOT NULL THEN
      UPDATE public.inventory
      SET quantity = quantity + delta, last_updated = now(), updated_at = now()
      WHERE id = inv_id;
    ELSE
      SELECT id INTO wh_id FROM public.warehouses ORDER BY created_at LIMIT 1;
      IF wh_id IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before recording stock.'; END IF;
      INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level)
      VALUES (pid, wh_id, delta, 10);
    END IF;

    INSERT INTO public.inventory_movements
      (product_id, warehouse_id, movement_type, quantity_change, reference_type, occurred_on, note, created_by)
    VALUES
      (pid, wh_id, p_movement_type, delta, 'manual', COALESCE(p_occurred_on, current_date), p_note, auth.uid());

    IF p_transaction_type IS NOT NULL AND sid IS NOT NULL THEN
      price := COALESCE(NULLIF(line->>'unit_price', '')::numeric,
                        (SELECT cost_per_unit FROM public.skus WHERE id = sid), 0);
      INSERT INTO public.transactions
        (transaction_type, sku_id, quantity, unit_price, total_amount, notes, user_id, created_by)
      VALUES
        (p_transaction_type, sid, delta, price, abs(delta) * price, COALESCE(p_note, ''), auth.uid(), auth.uid());
    END IF;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_movements(jsonb, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_movements(jsonb, text, text, date, text) TO authenticated;

-- fn_consume_invoice_stock no longer calls it
DROP FUNCTION IF EXISTS public.fn_deplete_stock(uuid, numeric, text, text, uuid, date, text, numeric, uuid);

COMMIT;
