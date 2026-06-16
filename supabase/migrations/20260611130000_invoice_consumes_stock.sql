-- ─────────────────────────────────────────────────────────────────────────────
-- Inventory standardization (Phase 2): invoicing consumes stock
--
-- When an invoice is issued (status = 'invoice'), each line item that maps to a
-- product reduces inventory and records a 'sale' movement. If the invoice is
-- later cancelled or deleted, the stock is returned and the movements removed.
-- Idempotent: consumption happens once per invoice.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_consume_invoice_stock(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv       record;
  it        record;
  mv        record;
  wh_id     uuid;
  has_moves boolean;
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
      -- deplete the warehouse holding the most stock for this product
      SELECT warehouse_id INTO wh_id
      FROM public.inventory WHERE product_id = it.product_id
      ORDER BY quantity DESC LIMIT 1;

      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note)
      VALUES
        (it.product_id, wh_id, 'sale', -it.quantity, 'invoice', p_invoice_id,
         COALESCE(inv.converted_at::date, inv.issue_date),
         'Invoice ' || COALESCE(inv.invoice_number, inv.quotation_number));

      IF wh_id IS NOT NULL THEN
        UPDATE public.inventory
        SET quantity = quantity - it.quantity, last_updated = now(), updated_at = now()
        WHERE product_id = it.product_id AND warehouse_id = wh_id;
      END IF;
    END LOOP;

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
  END IF;
END;
$$;

-- Trigger wrapper (handles delete by returning stock)
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
    RETURN OLD;
  END IF;

  PERFORM public.fn_consume_invoice_stock(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_consume_stock ON public.invoices;
CREATE TRIGGER trg_invoice_consume_stock
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_consume_invoice_stock();

-- Backfill: consume stock for invoices already issued
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.invoices WHERE status = 'invoice' LOOP
    PERFORM public.fn_consume_invoice_stock(r.id);
  END LOOP;
END $$;
