-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION PHASE 3: Inventory costing (IAS 2), bank rec, FIRS TIN
--
--   A8  Inventory had quantities but no value: goods received via procurement
--       never reached the books at all, invoicing depleted stock with no COGS,
--       negative stock was allowed, and the 1200/5000 accounts only moved via
--       hand-typed expenses.
--       → products carry a true cost_price (the sku mirror previously
--         overwrote cost with the SELLING price — fixed);
--       → every inventory movement is stamped with unit_cost at the time it
--         happens;
--       → goods receipt posts   Dr 1200 Inventory / Cr 2000 Accounts Payable;
--       → invoice issue posts   Dr 5000 COGS      / Cr 1200 Inventory;
--       → issuing an invoice for more than the tracked stock on hand is
--         rejected (adjust stock first).
--       Applied PROSPECTIVELY (IAS 8): history gets costs stamped for
--       reference but no retro journals — post opening inventory value as a
--       manual journal (Dr 1200 / Cr 3000) when adopting.
--   C5  Bank reconciliation: journal lines can now be ticked off against the
--       bank statement (reconciled_at / reconciled_by; admin UI in Accounting).
--   FIRS e-invoicing readiness: invoices capture the customer's TIN.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. True product cost ─────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2) CHECK (cost_price IS NULL OR cost_price >= 0);

-- Best-available backfill from the sku mirror. Caveat: the old mirror bug set
-- cost_per_unit = selling price for products edited since harmonization, so
-- these values need review where cost equals price.
UPDATE public.products p
SET cost_price = s.cost_per_unit
FROM public.skus s
WHERE p.sku_id = s.id
  AND p.cost_price IS NULL
  AND COALESCE(s.cost_per_unit, 0) > 0;

-- Fix the mirror: sku cost tracks the product's COST, never its selling price.
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
    VALUES (NEW.name, COALESCE(NEW.sku, NEW.id::text), COALESCE(NEW.uom, 'unit'), COALESCE(NEW.cost_price, 0),
            COALESCE(NEW.category, 'general'), 0, 0, NEW.user_id, NEW.created_by)
    RETURNING id INTO sid;
  ELSE
    UPDATE public.skus SET
      name            = NEW.name,
      sku_code        = COALESCE(NEW.sku, sku_code),
      unit_of_measure = COALESCE(NEW.uom, unit_of_measure),
      cost_per_unit   = COALESCE(NEW.cost_price, cost_per_unit),
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
  BEFORE INSERT OR UPDATE OF name, sku, uom, price, cost_price, category, sku_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_product_to_sku();

-- Product cost with sku fallback (weighted-average bookkeeping can refine this
-- later; a single current cost per product is the SME-appropriate baseline).
CREATE OR REPLACE FUNCTION public.fn_product_cost(p_product_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(p.cost_price, s.cost_per_unit, 0)
  FROM public.products p
  LEFT JOIN public.skus s ON s.id = p.sku_id
  WHERE p.id = p_product_id;
$$;

-- ── 2. Costed inventory movements ────────────────────────────────────────────
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2);

-- Reference-only stamp for history (no retro journals — prospective adoption).
UPDATE public.inventory_movements m
SET unit_cost = ri.unit_price
FROM public.lpo_receipt_items ri
WHERE m.unit_cost IS NULL AND m.reference_type = 'lpo_receipt' AND m.reference_id = ri.id;

UPDATE public.inventory_movements m
SET unit_cost = public.fn_product_cost(m.product_id)
WHERE m.unit_cost IS NULL;

-- ── 3. Goods receipt: capitalize to Inventory (Dr 1200 / Cr 2000) ────────────
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

-- ── 4. Invoice consumption: stock guard + COGS (Dr 5000 / Cr 1200) ───────────
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

  has_moves := EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE reference_type = 'invoice' AND reference_id = p_invoice_id
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
    FOR mv IN
      SELECT * FROM public.inventory_movements
      WHERE reference_type = 'invoice' AND reference_id = p_invoice_id
    LOOP
      IF mv.warehouse_id IS NOT NULL THEN
        UPDATE public.inventory
        SET quantity = quantity + (-mv.quantity_change), last_updated = now(), updated_at = now()
        WHERE product_id = mv.product_id AND warehouse_id = mv.warehouse_id;
      END IF;
    END LOOP;
    DELETE FROM public.inventory_movements
    WHERE reference_type = 'invoice' AND reference_id = p_invoice_id;
    PERFORM public.fn_unpost('invoice_cogs', p_invoice_id);
  END IF;
END;
$$;

-- Delete path must also reverse the COGS entry.
CREATE OR REPLACE FUNCTION public.trg_consume_invoice_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE mv record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR mv IN
      SELECT * FROM public.inventory_movements
      WHERE reference_type = 'invoice' AND reference_id = OLD.id
    LOOP
      IF mv.warehouse_id IS NOT NULL THEN
        UPDATE public.inventory
        SET quantity = quantity + (-mv.quantity_change), last_updated = now(), updated_at = now()
        WHERE product_id = mv.product_id AND warehouse_id = mv.warehouse_id;
      END IF;
    END LOOP;
    DELETE FROM public.inventory_movements
    WHERE reference_type = 'invoice' AND reference_id = OLD.id;
    PERFORM public.fn_unpost('invoice_cogs', OLD.id);
    RETURN OLD;
  END IF;

  PERFORM public.fn_consume_invoice_stock(NEW.id);
  RETURN NEW;
END;
$$;

-- ── 5. Bank reconciliation columns ───────────────────────────────────────────
ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_journal_lines_reconciled ON public.journal_lines(account_id, reconciled_at);

-- Reconciling a line does not change its financial substance, so ticking off
-- statement lines must remain possible even after the period is closed. The
-- period guard now permits updates that ONLY touch the reconciliation columns.
CREATE OR REPLACE FUNCTION public.fn_guard_journal_line_period()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d date;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.entry_id    IS NOT DISTINCT FROM OLD.entry_id
     AND NEW.account_id  IS NOT DISTINCT FROM OLD.account_id
     AND NEW.debit       IS NOT DISTINCT FROM OLD.debit
     AND NEW.credit      IS NOT DISTINCT FROM OLD.credit
     AND NEW.description IS NOT DISTINCT FROM OLD.description THEN
    RETURN NEW;  -- reconciliation-only change
  END IF;

  SELECT entry_date INTO d FROM public.journal_entries
  WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF d IS NOT NULL AND public.fn_books_locked(d) THEN
    RAISE EXCEPTION 'Books are closed through %: journal lines dated % are locked.',
      (SELECT max(locked_through) FROM public.period_locks), d;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── 6. FIRS e-invoicing readiness: customer TIN ──────────────────────────────
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS customer_tin text;
