-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-posting layer: journalize business transactions into double-entry
--
-- Triggers post (and keep in sync) a balanced journal entry for each:
--   • invoice issued       Dr Accounts Receivable / Cr Revenue (+ Cr VAT Payable)
--   • invoice payment      Dr Cash|Bank          / Cr Accounts Receivable
--   • expense              Dr Expense account    / Cr Cash|Bank
--   • payroll (paid)       Dr Salaries & Wages   / Cr Bank
--   • sale (non-cancelled) Dr Accounts Receivable/ Cr Sales Revenue
--   • sale payment         Dr Cash|Bank          / Cr Accounts Receivable
--
-- Each posting is idempotent (delete + recreate by source), and a one-time
-- backfill journalizes all existing history. Requires the double-entry and
-- invoice_payments migrations to have run first.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Helpers ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_acct(p_code text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.chart_of_accounts WHERE code = p_code;
$$;

-- Cash for 'cash', otherwise Bank
CREATE OR REPLACE FUNCTION public.fn_cash_acct(p_method text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_acct(CASE WHEN lower(coalesce(p_method, '')) = 'cash' THEN '1000' ELSE '1010' END);
$$;

CREATE OR REPLACE FUNCTION public.fn_unpost(p_source_type text, p_source_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.journal_entries WHERE source_type = p_source_type AND source_id = p_source_id;
END;
$$;

-- Core poster: replaces any existing entry for (source_type, source_id) with the
-- given balanced set of lines. Lines: jsonb array of {code, debit, credit, desc}.
CREATE OR REPLACE FUNCTION public.fn_post_entry(
  p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE eid uuid; ln jsonb;
BEGIN
  DELETE FROM public.journal_entries WHERE source_type = p_source_type AND source_id = p_source_id;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN RETURN; END IF;

  INSERT INTO public.journal_entries (entry_date, memo, source_type, source_id)
  VALUES (p_date, p_memo, p_source_type, p_source_id)
  RETURNING id INTO eid;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (
      eid,
      public.fn_acct(ln->>'code'),
      COALESCE((ln->>'debit')::numeric, 0),
      COALESCE((ln->>'credit')::numeric, 0),
      ln->>'desc'
    );
  END LOOP;
END;
$$;

-- ── Per-transaction posters ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_post_invoice(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; rev_code text; rev_amt numeric; vat numeric; lines jsonb; ref text;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_id;
  IF NOT FOUND OR inv.status <> 'invoice' OR COALESCE(inv.total_amount, 0) <= 0 THEN
    PERFORM public.fn_unpost('invoice', p_id); RETURN;
  END IF;

  ref      := COALESCE(inv.invoice_number, inv.quotation_number);
  rev_code := CASE WHEN inv.invoice_type = 'event' THEN '4010' ELSE '4000' END;
  vat      := COALESCE(inv.tax_amount, 0);
  rev_amt  := inv.total_amount - vat;

  lines := jsonb_build_array(
    jsonb_build_object('code', '1100', 'debit', inv.total_amount, 'credit', 0, 'desc', 'Invoice ' || ref)
  );
  IF rev_amt > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', rev_code, 'debit', 0, 'credit', rev_amt, 'desc', 'Revenue'));
  END IF;
  IF vat > 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object('code', '2100', 'debit', 0, 'credit', vat, 'desc', 'VAT'));
  END IF;

  PERFORM public.fn_post_entry(
    COALESCE(inv.converted_at::date, inv.issue_date),
    'Invoice ' || ref || COALESCE(' — ' || inv.customer_name, ''),
    'invoice', inv.id, lines
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_post_invoice_payment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; lines jsonb; ref text; cash_code text;
BEGIN
  SELECT ip.*, i.invoice_number, i.quotation_number, i.customer_name
  INTO r
  FROM public.invoice_payments ip JOIN public.invoices i ON i.id = ip.invoice_id
  WHERE ip.id = p_id;
  IF NOT FOUND OR COALESCE(r.amount, 0) <= 0 THEN
    PERFORM public.fn_unpost('invoice_payment', p_id); RETURN;
  END IF;

  ref := COALESCE(r.invoice_number, r.quotation_number);
  cash_code := (SELECT code FROM public.chart_of_accounts WHERE id = public.fn_cash_acct(r.payment_method));
  lines := jsonb_build_array(
    jsonb_build_object('code', cash_code, 'debit', r.amount, 'credit', 0, 'desc', 'Receipt ' || ref),
    jsonb_build_object('code', '1100',    'debit', 0, 'credit', r.amount, 'desc', 'AR settled')
  );

  PERFORM public.fn_post_entry(r.payment_date, 'Payment — ' || ref || COALESCE(' (' || r.customer_name || ')', ''),
    'invoice_payment', p_id, lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_post_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e record; exp_code text; cash_code text; lines jsonb;
BEGIN
  SELECT * INTO e FROM public.expenses WHERE id = p_id;
  IF NOT FOUND OR COALESCE(e.amount, 0) <= 0 THEN
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

CREATE OR REPLACE FUNCTION public.fn_post_payroll(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; lines jsonb;
BEGIN
  SELECT * INTO p FROM public.payroll_records WHERE id = p_id;
  IF NOT FOUND OR p.status <> 'paid' OR COALESCE(p.net_pay, 0) <= 0 THEN
    PERFORM public.fn_unpost('payroll', p_id); RETURN;
  END IF;

  lines := jsonb_build_array(
    jsonb_build_object('code', '5100', 'debit', p.net_pay, 'credit', 0, 'desc', 'Salaries & Wages'),
    jsonb_build_object('code', '1010', 'debit', 0, 'credit', p.net_pay, 'desc', 'Net pay')
  );
  PERFORM public.fn_post_entry(
    COALESCE(p.paid_at::date, p.period_end, p.period_start, p.created_at::date),
    'Payroll — ' || COALESCE(p.staff_name, ''), 'payroll', p.id, lines
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_post_sale(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; lines jsonb;
BEGIN
  SELECT * INTO s FROM public.sales WHERE id = p_id;
  IF NOT FOUND OR s.status = 'cancelled' OR COALESCE(s.total_amount, 0) <= 0 THEN
    PERFORM public.fn_unpost('sale', p_id); RETURN;
  END IF;

  lines := jsonb_build_array(
    jsonb_build_object('code', '1100', 'debit', s.total_amount, 'credit', 0, 'desc', 'Sale ' || s.sale_number),
    jsonb_build_object('code', '4000', 'debit', 0, 'credit', s.total_amount, 'desc', 'Sales Revenue')
  );
  PERFORM public.fn_post_entry(s.sale_date, 'Sale ' || s.sale_number || COALESCE(' — ' || s.customer_name, ''),
    'sale', s.id, lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_post_payment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; lines jsonb; cash_code text;
BEGIN
  SELECT pay.*, s.sale_number INTO r
  FROM public.payments pay JOIN public.sales s ON s.id = pay.sale_id
  WHERE pay.id = p_id;
  IF NOT FOUND OR r.status <> 'completed' OR COALESCE(r.amount, 0) <= 0 THEN
    PERFORM public.fn_unpost('payment', p_id); RETURN;
  END IF;

  cash_code := (SELECT code FROM public.chart_of_accounts WHERE id = public.fn_cash_acct(r.payment_method));
  lines := jsonb_build_array(
    jsonb_build_object('code', cash_code, 'debit', r.amount, 'credit', 0, 'desc', 'Receipt ' || r.sale_number),
    jsonb_build_object('code', '1100', 'debit', 0, 'credit', r.amount, 'desc', 'AR settled')
  );
  PERFORM public.fn_post_entry(COALESCE(r.payment_date, CURRENT_DATE), 'Sale payment — ' || r.sale_number,
    'payment', p_id, lines);
END;
$$;

-- ── Trigger wrappers ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_post_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.fn_unpost('invoice', OLD.id); RETURN OLD; END IF;
  PERFORM public.fn_post_invoice(NEW.id); RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_post_invoice_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.fn_unpost('invoice_payment', OLD.id); RETURN OLD; END IF;
  PERFORM public.fn_post_invoice_payment(NEW.id); RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_post_expense() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.fn_unpost('expense', OLD.id); RETURN OLD; END IF;
  PERFORM public.fn_post_expense(NEW.id); RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_post_payroll() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.fn_unpost('payroll', OLD.id); RETURN OLD; END IF;
  PERFORM public.fn_post_payroll(NEW.id); RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_post_sale() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.fn_unpost('sale', OLD.id); RETURN OLD; END IF;
  PERFORM public.fn_post_sale(NEW.id); RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_post_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM public.fn_unpost('payment', OLD.id); RETURN OLD; END IF;
  PERFORM public.fn_post_payment(NEW.id); RETURN NEW;
END; $$;

-- ── Attach triggers ───────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_auto_post_invoice ON public.invoices;
CREATE TRIGGER trg_auto_post_invoice
  AFTER INSERT OR UPDATE OF status, total_amount, tax_amount, invoice_type, converted_at, issue_date, invoice_number
  OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_invoice();

DROP TRIGGER IF EXISTS trg_auto_post_invoice_payment ON public.invoice_payments;
CREATE TRIGGER trg_auto_post_invoice_payment
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_invoice_payment();

DROP TRIGGER IF EXISTS trg_auto_post_expense ON public.expenses;
CREATE TRIGGER trg_auto_post_expense
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_expense();

DROP TRIGGER IF EXISTS trg_auto_post_payroll ON public.payroll_records;
CREATE TRIGGER trg_auto_post_payroll
  AFTER INSERT OR UPDATE OR DELETE ON public.payroll_records
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_payroll();

DROP TRIGGER IF EXISTS trg_auto_post_sale ON public.sales;
CREATE TRIGGER trg_auto_post_sale
  AFTER INSERT OR UPDATE OR DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_sale();

DROP TRIGGER IF EXISTS trg_auto_post_payment ON public.payments;
CREATE TRIGGER trg_auto_post_payment
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_payment();

-- ── One-time backfill of existing history (idempotent) ────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.invoices WHERE status = 'invoice' LOOP PERFORM public.fn_post_invoice(r.id); END LOOP;
  FOR r IN SELECT id FROM public.invoice_payments LOOP PERFORM public.fn_post_invoice_payment(r.id); END LOOP;
  FOR r IN SELECT id FROM public.expenses LOOP PERFORM public.fn_post_expense(r.id); END LOOP;
  FOR r IN SELECT id FROM public.payroll_records WHERE status = 'paid' LOOP PERFORM public.fn_post_payroll(r.id); END LOOP;
  FOR r IN SELECT id FROM public.sales WHERE status <> 'cancelled' LOOP PERFORM public.fn_post_sale(r.id); END LOOP;
  FOR r IN SELECT id FROM public.payments WHERE status = 'completed' LOOP PERFORM public.fn_post_payment(r.id); END LOOP;
END $$;
