-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-post revenue to the finance ledger — removes the manual "Record in
-- Finance" step on invoices, and closes the gap where sales entered via
-- Weekly Sales never reached the Finance Feed at all.
--
-- Previously a finance_ledger 'revenue' row only appeared when someone clicked
-- "Record in Finance" on an issued invoice, or when a staff sales report was
-- approved. The KPI totals shown above the Feed (Gross Revenue, P&L, etc.) are
-- computed directly from `invoices`/`sales`, independent of that flag — so an
-- issued invoice or a manually-entered Weekly Sales row could count toward
-- Revenue while being invisible in the Feed underneath it.
--
-- This mirrors the same auto-posting pattern already used for the double-entry
-- journal (see 20260609120000_auto_post_journals.sql): a trigger posts (and
-- idempotently replaces, by delete-then-insert) one 'revenue' row per
-- qualifying invoice/sale, keyed by (source_type, source_id, entry_type).
-- The entry_type filter on delete is important: an invoice's 'revenue' row and
-- its 'payment_received' rows share the same (source_type='invoice',
-- source_id=invoice.id) pair, so only 'revenue' rows must ever be touched here.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_ledger_unpost_revenue(p_source_type text, p_source_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.finance_ledger
   WHERE source_type = p_source_type AND source_id = p_source_id AND entry_type = 'revenue';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_ledger_post_invoice(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; ref text;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_id;
  IF NOT FOUND OR inv.status <> 'invoice' OR COALESCE(inv.total_amount, 0) <= 0 THEN
    PERFORM public.fn_ledger_unpost_revenue('invoice', p_id);
    RETURN;
  END IF;

  ref := COALESCE(inv.invoice_number, inv.quotation_number);

  DELETE FROM public.finance_ledger
   WHERE source_type = 'invoice' AND source_id = inv.id AND entry_type = 'revenue';

  INSERT INTO public.finance_ledger (
    user_id, entry_date, entry_type, source_type, source_id,
    description, amount, cost_center, invoice_type, reference_number, recorded_by
  ) VALUES (
    inv.user_id,
    COALESCE(inv.converted_at::date, inv.issue_date),
    'revenue', 'invoice', inv.id,
    'Invoice ' || ref || COALESCE(' — ' || inv.customer_name, ''),
    inv.total_amount,
    CASE WHEN inv.invoice_type = 'event' THEN 'Event Account' ELSE 'Daily Orders' END,
    inv.invoice_type,
    ref,
    COALESCE(inv.updated_by, inv.created_by)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_ledger_post_sale(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_id;
  IF NOT FOUND OR s.status = 'cancelled' OR COALESCE(s.total_amount, 0) <= 0 THEN
    PERFORM public.fn_ledger_unpost_revenue('sale', p_id);
    RETURN;
  END IF;

  DELETE FROM public.finance_ledger
   WHERE source_type = 'sale' AND source_id = s.id AND entry_type = 'revenue';

  INSERT INTO public.finance_ledger (
    user_id, entry_date, entry_type, source_type, source_id,
    description, amount, cost_center, invoice_type, reference_number, recorded_by
  ) VALUES (
    s.user_id,
    s.sale_date,
    'revenue', 'sale', s.id,
    'Sale ' || s.sale_number || COALESCE(' — ' || s.customer_name, ''),
    s.total_amount,
    CASE WHEN s.sale_type = 'event' THEN 'Event Account' ELSE 'Daily Orders' END,
    NULL,
    s.sale_number,
    COALESCE(s.created_by, s.user_id)
  );
END;
$$;

-- ── Trigger wrappers ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_ledger_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.fn_ledger_unpost_revenue('invoice', OLD.id); RETURN OLD; END IF;
  PERFORM public.fn_ledger_post_invoice(NEW.id); RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_ledger_sale() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.fn_ledger_unpost_revenue('sale', OLD.id); RETURN OLD; END IF;
  PERFORM public.fn_ledger_post_sale(NEW.id); RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_auto_ledger_invoice ON public.invoices;
CREATE TRIGGER trg_auto_ledger_invoice
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_invoice();

DROP TRIGGER IF EXISTS trg_auto_ledger_sale ON public.sales;
CREATE TRIGGER trg_auto_ledger_sale
  AFTER INSERT OR UPDATE OR DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_sale();

-- ── Backfill ───────────────────────────────────────────────────────────────────
-- Clear existing manually-posted revenue rows (from the old "Record in Finance"
-- button and sales-report approvals) and regenerate deterministically for every
-- qualifying invoice/sale — this is what closes the completeness gap for
-- invoices never manually posted, and for Weekly-Sales rows that never had a
-- ledger entry at all. payment_received rows are untouched (entry_type filter).
DELETE FROM public.finance_ledger WHERE entry_type = 'revenue' AND source_type IN ('invoice', 'sale');

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.invoices WHERE status = 'invoice' LOOP
    PERFORM public.fn_ledger_post_invoice(r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.sales WHERE status <> 'cancelled' LOOP
    PERFORM public.fn_ledger_post_sale(r.id);
  END LOOP;
END $$;
