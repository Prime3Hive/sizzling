-- ═════════════════════════════════════════════════════════════════════════════
-- AUDIT REMEDIATION PHASE 2: WHT tracking, VAT on sales, expense approval
--
--   C4  Withholding tax: corporate/government customers remit net of WHT
--       (5%/10% deduction at source). Without tracking, their invoices never
--       reconcile. invoice_payments now carries wht_amount; the withheld
--       portion settles the receivable and sits in 1150 WHT Receivable until
--       the credit note is claimed against income tax.
--   A6  (sales leg) Weekly-Sales / takings never carried VAT. sales.vat_amount
--       lets VAT-inclusive takings be split: revenue credited net, VAT to 2100.
--   B5  Maker-checker: expenses now have pending/approved/rejected status.
--       Only APPROVED expenses post to the ledger; approval is admin-only,
--       enforced in a DB trigger (not just the UI).
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. WHT Receivable account ────────────────────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, normal_balance, sort_order) VALUES
  ('1150', 'WHT Receivable', 'asset', 'debit', 35)
ON CONFLICT (code) DO NOTHING;

-- ── 2. WHT on invoice payments ───────────────────────────────────────────────
ALTER TABLE public.invoice_payments
  ADD COLUMN IF NOT EXISTS wht_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (wht_amount >= 0);

-- A payment settles the receivable by cash received PLUS tax withheld at source.
CREATE OR REPLACE FUNCTION public.sync_invoice_amount_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv_id uuid;
  inv_total numeric;
  paid_sum  numeric;
BEGIN
  inv_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT COALESCE(SUM(amount + COALESCE(wht_amount, 0)), 0) INTO paid_sum
  FROM public.invoice_payments WHERE invoice_id = inv_id;

  SELECT total_amount INTO inv_total
  FROM public.invoices WHERE id = inv_id;

  UPDATE public.invoices
  SET amount_paid    = paid_sum,
      payment_status = CASE
        WHEN paid_sum <= 0            THEN 'unpaid'
        WHEN paid_sum >= inv_total    THEN 'paid'
        ELSE 'partial'
      END,
      updated_at = now()
  WHERE id = inv_id;

  RETURN NULL;
END;
$$;

-- Journal: Dr Cash|Bank (cash received) + Dr WHT Receivable (withheld)
--          / Cr Accounts Receivable (total settled)
CREATE OR REPLACE FUNCTION public.fn_post_invoice_payment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; lines jsonb; ref text; cash_code text; wht numeric; settled numeric;
BEGIN
  SELECT ip.*, i.invoice_number, i.quotation_number, i.customer_name
  INTO r
  FROM public.invoice_payments ip JOIN public.invoices i ON i.id = ip.invoice_id
  WHERE ip.id = p_id;
  IF NOT FOUND OR COALESCE(r.amount, 0) <= 0 THEN
    PERFORM public.fn_unpost('invoice_payment', p_id); RETURN;
  END IF;

  ref     := COALESCE(r.invoice_number, r.quotation_number);
  wht     := COALESCE(r.wht_amount, 0);
  settled := r.amount + wht;
  cash_code := (SELECT code FROM public.chart_of_accounts WHERE id = public.fn_cash_acct(r.payment_method));

  lines := jsonb_build_array(
    jsonb_build_object('code', cash_code, 'debit', r.amount, 'credit', 0, 'desc', 'Receipt ' || ref)
  );
  IF wht > 0 THEN
    lines := lines || jsonb_build_array(
      jsonb_build_object('code', '1150', 'debit', wht, 'credit', 0, 'desc', 'WHT withheld at source')
    );
  END IF;
  lines := lines || jsonb_build_array(
    jsonb_build_object('code', '1100', 'debit', 0, 'credit', settled, 'desc', 'AR settled')
  );

  PERFORM public.fn_post_entry(r.payment_date, 'Payment — ' || ref || COALESCE(' (' || r.customer_name || ')', ''),
    'invoice_payment', p_id, lines);
END;
$$;

-- Balance guard now counts cash + WHT toward the invoice total.
CREATE OR REPLACE FUNCTION public.fn_guard_invoice_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; paid_others numeric;
BEGIN
  SELECT status, total_amount, invoice_number, quotation_number
  INTO inv FROM public.invoices WHERE id = NEW.invoice_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment references a non-existent invoice';
  END IF;
  IF inv.status <> 'invoice' THEN
    RAISE EXCEPTION 'Payments can only be recorded against an issued invoice (% is %)',
      COALESCE(inv.invoice_number, inv.quotation_number), inv.status;
  END IF;

  SELECT COALESCE(SUM(amount + COALESCE(wht_amount, 0)), 0) INTO paid_others
  FROM public.invoice_payments
  WHERE invoice_id = NEW.invoice_id AND id <> NEW.id;

  IF paid_others + NEW.amount + COALESCE(NEW.wht_amount, 0) > COALESCE(inv.total_amount, 0) + 0.01 THEN
    RAISE EXCEPTION 'Payment of % (+% WHT) would exceed the balance due on % (total %, already settled %)',
      NEW.amount, COALESCE(NEW.wht_amount, 0), COALESCE(inv.invoice_number, inv.quotation_number),
      inv.total_amount, paid_others;
  END IF;

  RETURN NEW;
END;
$$;

-- Re-sync stored amount_paid (definition of "paid" unchanged for legacy rows —
-- wht_amount defaults to 0 — but run it so any drift is corrected).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT invoice_id FROM public.invoice_payments LOOP
    UPDATE public.invoices i
    SET amount_paid = (SELECT COALESCE(SUM(amount + COALESCE(wht_amount,0)),0) FROM public.invoice_payments WHERE invoice_id = r.invoice_id)
    WHERE i.id = r.invoice_id;
  END LOOP;
END $$;

-- ── 3. VAT on the sales / takings path ───────────────────────────────────────
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS vat_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0);

-- Revenue credited NET of VAT; the VAT portion goes to 2100 VAT Payable.
CREATE OR REPLACE FUNCTION public.fn_post_sale(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; lines jsonb; has_pay boolean; dr_code text; vat numeric; net numeric;
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

  vat := LEAST(COALESCE(s.vat_amount, 0), s.total_amount);
  net := s.total_amount - vat;

  lines := jsonb_build_array(
    jsonb_build_object('code', dr_code, 'debit', s.total_amount, 'credit', 0,
      'desc', CASE WHEN dr_code = '1000' THEN 'Cash takings ' ELSE 'Sale ' END || s.sale_number)
  );
  IF net > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '4000', 'debit', 0, 'credit', net, 'desc', 'Sales Revenue'));
  END IF;
  IF vat > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2100', 'debit', 0, 'credit', vat, 'desc', 'Output VAT'));
  END IF;

  PERFORM public.fn_post_entry(s.sale_date, 'Sale ' || s.sale_number || COALESCE(' — ' || s.customer_name, ''),
    'sale', s.id, lines);
END;
$$;

-- Finance-Feed revenue for sales: net of VAT, mirroring invoices.
CREATE OR REPLACE FUNCTION public.fn_ledger_post_sale(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; net numeric;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_id;
  IF NOT FOUND OR s.status = 'cancelled' OR COALESCE(s.total_amount, 0) <= 0 THEN
    PERFORM public.fn_ledger_unpost_revenue('sale', p_id);
    RETURN;
  END IF;

  net := s.total_amount - LEAST(COALESCE(s.vat_amount, 0), s.total_amount);
  IF net <= 0 THEN
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
    net,
    CASE WHEN s.sale_type = 'event' THEN 'Event Account' ELSE 'Daily Orders' END,
    NULL,
    s.sale_number,
    COALESCE(s.created_by, s.user_id)
  );
END;
$$;

-- ── 4. Maker-checker for expenses ────────────────────────────────────────────
-- Existing rows (and system-generated inserts from admin-gated flows) default
-- to 'approved' so history and automation are unaffected; the UI submits
-- non-admin manual entries as 'pending'.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Only admins may move an expense into/out of 'approved'.
CREATE OR REPLACE FUNCTION public.fn_guard_expense_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- auth.uid() IS NULL means a service-role/SQL-console operation (RLS already
  -- blocks anonymous API writes), so only authenticated non-admins are stopped.
  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND auth.uid() IS NOT NULL
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin can change the approval status of an expense';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_approval ON public.expenses;
CREATE TRIGGER trg_guard_expense_approval
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_expense_approval();

-- Only APPROVED expenses reach the general ledger.
CREATE OR REPLACE FUNCTION public.fn_post_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e record; exp_code text; cash_code text; lines jsonb;
BEGIN
  SELECT * INTO e FROM public.expenses WHERE id = p_id;
  IF NOT FOUND OR COALESCE(e.amount, 0) <= 0 OR COALESCE(e.status, 'approved') <> 'approved' THEN
    PERFORM public.fn_unpost('expense', p_id); RETURN;
  END IF;

  exp_code := CASE
    WHEN COALESCE(e.account_type, 'COGS') = 'COGS' THEN '5000'
    WHEN e.category ILIKE '%rent%'                 THEN '5200'
    WHEN e.category ILIKE '%util%'                 THEN '5300'
    WHEN e.account_type = 'OpEX'                    THEN '5400'
    ELSE '5900'
  END;
  cash_code := (SELECT code FROM public.chart_of_accounts WHERE id = public.fn_cash_acct(e.payment_method));

  lines := jsonb_build_array(
    jsonb_build_object('code', exp_code,  'debit', e.amount, 'credit', 0, 'desc', e.category),
    jsonb_build_object('code', cash_code, 'debit', 0, 'credit', e.amount, 'desc', 'Paid')
  );
  PERFORM public.fn_post_entry(e.date, 'Expense — ' || e.description, 'expense', e.id, lines);
END;
$$;

-- The expense trigger must also fire on status changes so approval posts the
-- journal and rejection unposts it.
DROP TRIGGER IF EXISTS trg_auto_post_expense ON public.expenses;
CREATE TRIGGER trg_auto_post_expense
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_expense();
