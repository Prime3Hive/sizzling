-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION (2/3): Revenue recognition & payment integrity
--
-- Fixes from the 2026-07 financial audit:
--   A2  finance_ledger "revenue" rows were posted VAT-inclusive → now net of
--       VAT (VAT is a liability owed to FIRS, never income).
--   A5  Weekly-Sales / sales-report rows posted Dr AR that nothing ever
--       settled → cash-takings sales now debit Cash directly; only sales with
--       real payment records (or still owing) sit in AR.
--   B1  An issued invoice could be silently demoted to quotation (erasing its
--       revenue while keeping its payments) → status transitions and
--       financial fields are now locked once issued.
--   B2  Cancelling a paid invoice orphaned its cash → blocked until payments
--       are removed/reversed.
--   B4  Overpayment / payments against non-issued documents were possible at
--       the API → enforced in a DB trigger.
--   B7  The Finance-Feed receipt row was inserted from the browser after the
--       payment insert (non-atomic, duplicable) → now auto-posted by trigger.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Sales post to Cash when they are cash takings (A5) ────────────────────
-- Debit side:
--   • sale has completed payment rows, or is still pending/partially_paid
--     → Dr 1100 Accounts Receivable (payments settle it)
--   • completed sale with no payment rows (Weekly Sales / approved sales
--     reports = takings already collected) → Dr 1000 Cash
CREATE OR REPLACE FUNCTION public.fn_post_sale(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; lines jsonb; has_pay boolean; dr_code text;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_id;
  IF NOT FOUND OR s.status = 'cancelled' OR COALESCE(s.total_amount, 0) <= 0 THEN
    PERFORM public.fn_unpost('sale', p_id); RETURN;
  END IF;

  has_pay := EXISTS (
    SELECT 1 FROM public.payments
    WHERE sale_id = s.id AND status = 'completed' AND COALESCE(amount, 0) > 0
  );
  dr_code := CASE WHEN has_pay OR s.status <> 'completed' THEN '1100' ELSE '1000' END;

  lines := jsonb_build_array(
    jsonb_build_object('code', dr_code, 'debit', s.total_amount, 'credit', 0,
      'desc', CASE WHEN dr_code = '1000' THEN 'Cash takings ' ELSE 'Sale ' END || s.sale_number),
    jsonb_build_object('code', '4000', 'debit', 0, 'credit', s.total_amount, 'desc', 'Sales Revenue')
  );
  PERFORM public.fn_post_entry(s.sale_date, 'Sale ' || s.sale_number || COALESCE(' — ' || s.customer_name, ''),
    'sale', s.id, lines);
END;
$$;

-- When a payment appears/disappears the parent sale's debit side must flip
-- between Cash and AR, so re-post the sale alongside the payment.
CREATE OR REPLACE FUNCTION public.trg_post_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_unpost('payment', OLD.id);
    PERFORM public.fn_post_sale(OLD.sale_id);
    RETURN OLD;
  END IF;
  PERFORM public.fn_post_payment(NEW.id);
  PERFORM public.fn_post_sale(NEW.sale_id);
  RETURN NEW;
END; $$;

-- ── 2. Finance-Feed revenue net of VAT (A2) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ledger_post_invoice(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; ref text; net_amt numeric;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_id;
  IF NOT FOUND OR inv.status <> 'invoice' OR COALESCE(inv.total_amount, 0) <= 0 THEN
    PERFORM public.fn_ledger_unpost_revenue('invoice', p_id);
    RETURN;
  END IF;

  ref     := COALESCE(inv.invoice_number, inv.quotation_number);
  net_amt := inv.total_amount - COALESCE(inv.tax_amount, 0);
  IF net_amt <= 0 THEN
    PERFORM public.fn_ledger_unpost_revenue('invoice', p_id);
    RETURN;
  END IF;

  DELETE FROM public.finance_ledger
   WHERE source_type = 'invoice' AND source_id = inv.id AND entry_type = 'revenue';

  INSERT INTO public.finance_ledger (
    user_id, entry_date, entry_type, source_type, source_id,
    description, amount, cost_center, invoice_type, reference_number, recorded_by
  ) VALUES (
    inv.user_id,
    COALESCE(inv.converted_at::date, inv.issue_date),
    'revenue', 'invoice', inv.id,
    'Invoice ' || ref || COALESCE(' — ' || inv.customer_name, '') || ' (net of VAT)',
    net_amt,
    CASE WHEN inv.invoice_type = 'event' THEN 'Event Account' ELSE 'Daily Orders' END,
    inv.invoice_type,
    ref,
    COALESCE(inv.updated_by, inv.created_by)
  );
END;
$$;

-- Regenerate existing invoice revenue rows at net amounts.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.invoices WHERE status = 'invoice' LOOP
    PERFORM public.fn_ledger_post_invoice(r.id);
  END LOOP;
END $$;

-- ── 3. Auto-post invoice receipts to the Finance Feed (B7) ───────────────────
-- Replaces the browser-side finance_ledger insert in InvoiceViewDialog.
-- Keyed by source_type='invoice_payment', source_id=payment id, so each
-- payment posts exactly once and edits/deletes stay in sync.
ALTER TABLE public.finance_ledger DROP CONSTRAINT IF EXISTS finance_ledger_source_type_check;
ALTER TABLE public.finance_ledger
  ADD CONSTRAINT finance_ledger_source_type_check
  CHECK (source_type IN ('sale', 'invoice', 'payment', 'invoice_payment'));

CREATE OR REPLACE FUNCTION public.fn_ledger_post_invoice_payment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; ref text;
BEGIN
  DELETE FROM public.finance_ledger
   WHERE source_type = 'invoice_payment' AND source_id = p_id;

  SELECT ip.*, i.invoice_number, i.quotation_number, i.customer_name,
         i.invoice_type, i.user_id AS invoice_user_id
  INTO r
  FROM public.invoice_payments ip JOIN public.invoices i ON i.id = ip.invoice_id
  WHERE ip.id = p_id;
  IF NOT FOUND OR COALESCE(r.amount, 0) <= 0 THEN RETURN; END IF;

  ref := COALESCE(r.invoice_number, r.quotation_number);
  INSERT INTO public.finance_ledger (
    user_id, entry_date, entry_type, source_type, source_id,
    description, amount, cost_center, invoice_type, reference_number, recorded_by
  ) VALUES (
    COALESCE(r.recorded_by, r.invoice_user_id),
    r.payment_date,
    'payment_received', 'invoice_payment', r.id,
    'Payment received — ' || ref || COALESCE(' (' || r.customer_name || ')', ''),
    r.amount,
    CASE WHEN r.invoice_type = 'event' THEN 'Event Account' ELSE 'Daily Orders' END,
    r.invoice_type,
    ref,
    r.recorded_by
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_ledger_invoice_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.finance_ledger
     WHERE source_type = 'invoice_payment' AND source_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM public.fn_ledger_post_invoice_payment(NEW.id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_auto_ledger_invoice_payment ON public.invoice_payments;
CREATE TRIGGER trg_auto_ledger_invoice_payment
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_ledger_invoice_payment();

-- Backfill: replace the browser-written receipt rows (keyed source_type =
-- 'invoice', duplicable) with deterministic per-payment rows.
DELETE FROM public.finance_ledger
 WHERE entry_type = 'payment_received' AND source_type = 'invoice';

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.invoice_payments LOOP
    PERFORM public.fn_ledger_post_invoice_payment(r.id);
  END LOOP;
END $$;

-- ── 4. Invoice lifecycle guards (B1, B2) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_invoice_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- An issued invoice can never go back to being a quotation.
  IF OLD.status = 'invoice' AND NEW.status = 'quotation' THEN
    RAISE EXCEPTION 'Invoice % has been issued and cannot revert to a quotation. Cancel it and raise a new document instead.',
      COALESCE(OLD.invoice_number, OLD.quotation_number);
  END IF;

  -- Financial substance of an issued invoice is immutable (corrections go
  -- through cancellation / a new document, preserving the audit trail).
  IF OLD.status = 'invoice' AND NEW.status = 'invoice' THEN
    IF NEW.total_amount           IS DISTINCT FROM OLD.total_amount
    OR NEW.subtotal               IS DISTINCT FROM OLD.subtotal
    OR NEW.tax_amount             IS DISTINCT FROM OLD.tax_amount
    OR NEW.tax_percent            IS DISTINCT FROM OLD.tax_percent
    OR NEW.discount_amount        IS DISTINCT FROM OLD.discount_amount
    OR NEW.discount_percent       IS DISTINCT FROM OLD.discount_percent
    OR NEW.service_charge_amount  IS DISTINCT FROM OLD.service_charge_amount
    OR NEW.service_charge_percent IS DISTINCT FROM OLD.service_charge_percent
    OR NEW.waiter_total           IS DISTINCT FROM OLD.waiter_total
    OR NEW.issue_date             IS DISTINCT FROM OLD.issue_date
    OR NEW.invoice_type           IS DISTINCT FROM OLD.invoice_type THEN
      RAISE EXCEPTION 'Invoice % is issued — its amounts, dates and type are locked. Cancel and re-issue to correct it.',
        COALESCE(OLD.invoice_number, OLD.quotation_number);
    END IF;
  END IF;

  -- No cancelling away an invoice that has collected money (B2).
  IF NEW.status = 'cancelled' AND OLD.status = 'invoice'
     AND COALESCE(OLD.amount_paid, 0) > 0 THEN
    RAISE EXCEPTION 'Invoice % has % recorded in payments. Remove or reverse its payments before cancelling.',
      COALESCE(OLD.invoice_number, OLD.quotation_number), OLD.amount_paid;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_update ON public.invoices;
CREATE TRIGGER trg_guard_invoice_update
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_invoice_update();

-- ── 5. Payment guards (B4) ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_invoice_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; paid_others numeric;
BEGIN
  -- FOR UPDATE serialises concurrent payments against the same invoice so two
  -- simultaneous inserts cannot both slip under the balance check.
  SELECT status, total_amount, invoice_number, quotation_number
  INTO inv FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment references a non-existent invoice';
  END IF;
  IF inv.status <> 'invoice' THEN
    RAISE EXCEPTION 'Payments can only be recorded against an issued invoice (% is %)',
      COALESCE(inv.invoice_number, inv.quotation_number), inv.status;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO paid_others
  FROM public.invoice_payments
  WHERE invoice_id = NEW.invoice_id AND id <> NEW.id;

  IF paid_others + NEW.amount > COALESCE(inv.total_amount, 0) + 0.01 THEN
    RAISE EXCEPTION 'Payment of % would exceed the balance due on % (total %, already paid %)',
      NEW.amount, COALESCE(inv.invoice_number, inv.quotation_number), inv.total_amount, paid_others;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_invoice_payment ON public.invoice_payments;
CREATE TRIGGER trg_guard_invoice_payment
  BEFORE INSERT OR UPDATE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_invoice_payment();

-- ── 6. Re-post sales so the debit side reflects the new rule ─────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.sales WHERE status <> 'cancelled' LOOP
    PERFORM public.fn_post_sale(r.id);
  END LOOP;
END $$;
