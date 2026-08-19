-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 — Cost is recognised when stock is issued (R-36)
--
-- The gap
-- ───────
-- Stock going IN posts a journal. Stock going OUT mostly does not.
--
--   received (LPO)          movement 'purchase'    Dr 1200 / Cr 2000   ✓ posts
--   sold on an invoice      movement 'sale'        Dr 5000 / Cr 1200   ✓ posts
--   issued to the kitchen   movement 'usage'       — nothing at all
--   written off / shrinkage movement 'adjustment'  — nothing at all
--
-- For a catering business almost all stock leaves through the third line. The
-- consequence is not subtle: account 1200 Inventory only ever grows, cost of
-- sales is understated by the whole of kitchen consumption, and the stock module
-- drifts away from the ledger for a reason no reconciliation can explain. The
-- audit measured that gap at 2,284,985 (module 5,660,970 vs GL 3,375,985).
--
-- The rule
-- ────────
-- Every movement that takes stock out of the building relieves inventory and
-- charges the cost somewhere:
--
--   usage / issue / consumption   Dr 5000 Cost of Goods Sold  Cr 1200 Inventory
--   adjustment down, waste, loss  Dr 5900 Other Expenses      Cr 1200 Inventory
--   adjustment up (found stock)   Dr 1200 Inventory           Cr 5900 Other Expenses
--
-- Consumption is a cost of sale. Shrinkage is not — it is a loss, and burying it
-- in COGS hides exactly the number a stock control problem shows up in. They are
-- split deliberately.
--
-- Valued at the movement's own unit_cost where one was recorded, otherwise at
-- the product's weighted average via fn_product_cost, matching how receipts and
-- invoiced sales are already valued.
--
-- What this does NOT touch
-- ────────────────────────
-- 'sale' movements and 'purchase' movements. Both already post through
-- fn_consume_invoice_stock and fn_capitalize_receipt_item respectively, and
-- posting them again here would be the very double-posting Phase 1 exists to
-- remove. The guard is on reference_type, so an invoice-driven movement is
-- skipped no matter what movement_type it carries.
--
-- Ordering: run AFTER 20260816120000_phase1_append_only_journal.sql.
-- ROLLBACK: 20260819100000_phase1_cogs_on_stock_issue.down.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Which account carries the cost ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_stock_issue_expense_code(p_movement_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(COALESCE(p_movement_type, ''))
           WHEN 'usage'       THEN '5000'   -- consumed in production: cost of sale
           WHEN 'issue'       THEN '5000'
           WHEN 'consumption' THEN '5000'
           WHEN 'production'  THEN '5000'
           ELSE '5900'                      -- adjustment, waste, loss, shrinkage
         END;
$$;

-- ── 2. Post the movement ─────────────────────────────────────────────────────
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

-- ── 3. Stamp the cost, then post ─────────────────────────────────────────────
-- unit_cost is captured at the moment of the movement so the posting and any
-- later restatement agree on what the stock was worth when it left.
CREATE OR REPLACE FUNCTION public.trg_stamp_movement_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.unit_cost IS NULL OR NEW.unit_cost = 0 THEN
    NEW.unit_cost := public.fn_product_cost(NEW.product_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_movement_cost ON public.inventory_movements;
CREATE TRIGGER trg_stamp_movement_cost
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.trg_stamp_movement_cost();

CREATE OR REPLACE FUNCTION public.trg_post_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fn_post_stock_movement(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_stock_movement ON public.inventory_movements;
CREATE TRIGGER trg_post_stock_movement
  AFTER INSERT OR UPDATE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_stock_movement();

-- ── 3b. Reversal lineage on movements ───────────────────────────────────────
-- Same shape as the journal: a reversing movement points at its original, so
-- an original is reversed at most once and "is this still live" is a lookup
-- rather than a guess from quantities.
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS reverses_movement_id uuid REFERENCES public.inventory_movements(id);

CREATE INDEX IF NOT EXISTS idx_movements_reverses
  ON public.inventory_movements(reverses_movement_id);

-- ── 4. Stock movements are records too (Rule 1) ──────────────────────────────
-- fn_consume_invoice_stock and trg_consume_invoice_stock both DELETE FROM
-- inventory_movements when an invoice leaves 'invoice' status or is removed.
-- A stock movement is a statement that goods physically moved; deleting it
-- rewrites history the same way deleting a journal entry does, and it is named
-- in the same rule. Deletion is refused; the reversing movement those functions
-- already write is the correct and sufficient record.
CREATE OR REPLACE FUNCTION public.fn_block_movement_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Stock movements cannot be deleted (movement %). Record a reversing movement instead — the original stays on the file.',
    COALESCE(OLD.id::text, '?')
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_movement_delete ON public.inventory_movements;
CREATE TRIGGER trg_block_movement_delete
  BEFORE DELETE ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_movement_delete();

-- The two functions that delete movements are rewritten to reverse them. Both
-- already restore the inventory quantity; they now leave the audit trail intact
-- and let the posting reverse itself through fn_post_stock_movement.
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

-- ── 5. Rewire the two invoice paths that deleted movements ──────────────────
-- Bodies lifted verbatim from 20260723120000; the only change is that the
-- delete-and-forget block becomes a call to fn_reverse_invoice_movements.

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

-- Delete path must also reverse the COGS entry.
CREATE OR REPLACE FUNCTION public.trg_consume_invoice_stock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE mv record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_reverse_invoice_movements(OLD.id);
    RETURN OLD;
  END IF;

  PERFORM public.fn_consume_invoice_stock(NEW.id);
  RETURN NEW;
END;
$$;

COMMIT;
