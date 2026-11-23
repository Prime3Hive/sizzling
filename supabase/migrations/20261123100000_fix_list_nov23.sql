-- ═════════════════════════════════════════════════════════════════════════════
-- Fix list of 23 November 2026
--
-- PRIORITY 1 — why the monthly totals were wrong (confirmed in code):
--
--   a) fn_reverse_entry dated every reversal TODAY, while the corrected entry
--      was re-posted on the document's own date. So whenever a document was
--      restated, its month counted it twice and the month the restatement ran
--      in lost it. Migration 20261117100000 set sales.payment_method with a
--      plain UPDATE; trg_auto_post_sale fired for every banked sale, reversed
--      it dated 17 November and posted it again in its own month. Result:
--      September exactly double, November about −₦59.5m. The August negatives
--      are the same fault from the August restatement of expenses.
--   b) Invoices posted on converted_at (the day someone clicked "convert"),
--      while every page groups them by issue_date. May's invoices sat in a
--      later month.
--   c) The P&L page took its Daily / Event / Invoice columns from the raw
--      tables and its Total from the ledger — two code paths in one row.
--
--   Fixes:
--     1. A reversal is dated on the entry it cancels.
--     2. The P&L and cash functions ignore cancelled pairs (an entry and its
--        reversal net to nil), so months already distorted read correctly
--        WITHOUT editing a single existing journal row.
--     3. Invoices post on their issue date; ones posted on another date are
--        re-posted through the normal append-only route.
--     4. fn_profit_and_loss returns the revenue split itself, so the columns
--        and the total are the same query.
--
-- PRIORITY 2 — one list of money received (fn_money_received) feeding the
--   Payments page and "cash collected".
-- PRIORITY 3 — "no receipt" needs a typed reason; budget warn/block policy.
-- PRIORITY 4 — event quotations/invoices need a named customer and a phone;
--   quotations get a validity date.
--
-- Nothing here deletes or edits an existing expense, sale, invoice or payment.
-- Read-only queries for the clean-up tasks: sql/M-11-fix-list-diagnostics.sql
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Reversals are dated on the entry they cancel
-- ─────────────────────────────────────────────────────────────────────────────
-- The old reasoning was "back-dating would reopen a closed period". It cannot:
-- marking the original as reversed is an UPDATE on a journal entry, which
-- trg_guard_journal_period refuses for a closed period. So any entry that CAN
-- be reversed sits in an open period, and its reversal belongs beside it.
CREATE OR REPLACE FUNCTION public.fn_reverse_entry(p_entry_id uuid, p_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  orig record;
  rid  uuid;
BEGIN
  SELECT * INTO orig FROM public.journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot reverse journal entry %: no such entry.', p_entry_id;
  END IF;
  IF orig.is_reversed THEN
    RETURN NULL;   -- already reversed; twice would double the correction
  END IF;

  UPDATE public.journal_entries
     SET is_reversed = true, reversed_at = now()
   WHERE id = p_entry_id;

  INSERT INTO public.journal_entries
    (entry_date, memo, source_type, source_id, reversal_of_id, posted_by, created_by)
  VALUES (
    orig.entry_date,
    'Reversal of entry #' || orig.entry_no || COALESCE(' — ' || p_reason, '') ||
      COALESCE(' [' || orig.memo || ']', ''),
    orig.source_type, orig.source_id, p_entry_id, auth.uid(), auth.uid()
  )
  RETURNING id INTO rid;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT rid, l.account_id, l.credit, l.debit, 'Reversal: ' || COALESCE(l.description, '')
    FROM public.journal_lines l
   WHERE l.entry_id = p_entry_id;

  RETURN rid;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Invoices post on their issue date
-- ─────────────────────────────────────────────────────────────────────────────
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
    -- The date on the invoice, which is what every page groups by. The day the
    -- quotation was converted is a data-entry time, not the sale's date.
    COALESCE(inv.issue_date, inv.converted_at::date),
    'Invoice ' || ref || COALESCE(' — ' || inv.customer_name, ''),
    'invoice', inv.id, lines
  );
END;
$$;

-- Re-post invoices whose live entry is dated differently from the invoice.
-- Append-only: the old entry is reversed (on its own date) and a new one posted.
DO $$
DECLARE r record; n int := 0; n_skip int := 0;
BEGIN
  FOR r IN
    SELECT i.id, je.entry_date, i.issue_date
      FROM public.invoices i
      JOIN public.journal_entries je
        ON je.source_type = 'invoice' AND je.source_id = i.id
       AND je.reversal_of_id IS NULL AND je.is_reversed = false
     WHERE i.status = 'invoice'
       AND i.issue_date IS NOT NULL
       AND je.entry_date <> i.issue_date
  LOOP
    IF public.fn_books_locked(r.entry_date) OR public.fn_books_locked(r.issue_date) THEN
      n_skip := n_skip + 1;   -- closed period: left for a manual decision
      CONTINUE;
    END IF;
    PERFORM public.fn_post_invoice(r.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Invoices re-posted on their issue date: %, skipped (closed period): %', n, n_skip;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. The P&L — one function, columns and total from the same rows
-- ─────────────────────────────────────────────────────────────────────────────
-- A reversed entry and its reversal are a cancelled pair: together they are
-- nil, so neither is counted. That makes a month's figure "the documents that
-- are live in that month", whatever date an old reversal happens to carry.
--
-- revenue = sales_daily + sales_event + invoice_daily + invoice_event
--         + other_revenue                                   (on every row)
-- net_profit = revenue − cogs − opex − payroll − commission (on every row)
DROP FUNCTION IF EXISTS public.fn_profit_and_loss(date, date);
CREATE FUNCTION public.fn_profit_and_loss(p_from date, p_to date)
RETURNS TABLE (
  month          date,
  revenue        numeric,
  cogs           numeric,
  gross_profit   numeric,
  opex           numeric,
  payroll        numeric,
  commission     numeric,
  net_profit     numeric,
  sales_daily    numeric,
  sales_event    numeric,
  invoice_daily  numeric,
  invoice_event  numeric,
  other_revenue  numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have access to the profit and loss.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Give a from and to date.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH lines AS (
    SELECT date_trunc('month', je.entry_date)::date AS m,
           a.code, a.type,
           (jl.credit - jl.debit) AS cr,
           (jl.debit - jl.credit) AS dr,
           CASE
             WHEN a.type <> 'income'           THEN NULL
             WHEN je.source_type = 'sale'
                  AND s.sale_type = 'event'    THEN 'sales_event'
             WHEN je.source_type = 'sale'      THEN 'sales_daily'
             WHEN je.source_type = 'invoice'
                  AND i.invoice_type = 'event' THEN 'invoice_event'
             WHEN je.source_type = 'invoice'   THEN 'invoice_daily'
             ELSE 'other'
           END AS rev_kind
      FROM public.journal_lines jl
      JOIN public.journal_entries je   ON je.id = jl.entry_id
      JOIN public.chart_of_accounts a  ON a.id  = jl.account_id
      LEFT JOIN public.sales s    ON je.source_type = 'sale'    AND s.id = je.source_id
      LEFT JOIN public.invoices i ON je.source_type = 'invoice' AND i.id = je.source_id
     WHERE je.entry_date BETWEEN p_from AND p_to
       AND a.type IN ('income', 'expense')
       AND je.source_type <> 'year_close'
       AND je.is_reversed = false
       AND je.reversal_of_id IS NULL
  ),
  months AS (
    SELECT generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date AS m
  ),
  agg AS (
    SELECT mo.m,
      COALESCE(sum(l.cr) FILTER (WHERE l.rev_kind = 'sales_daily'), 0)   AS sd,
      COALESCE(sum(l.cr) FILTER (WHERE l.rev_kind = 'sales_event'), 0)   AS se,
      COALESCE(sum(l.cr) FILTER (WHERE l.rev_kind = 'invoice_daily'), 0) AS idl,
      COALESCE(sum(l.cr) FILTER (WHERE l.rev_kind = 'invoice_event'), 0) AS ie,
      COALESCE(sum(l.cr) FILTER (WHERE l.rev_kind = 'other'), 0)         AS orv,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense' AND l.code BETWEEN '5000' AND '5099'), 0) AS cg,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense' AND l.code BETWEEN '5100' AND '5119'), 0) AS pr,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense' AND l.code BETWEEN '5120' AND '5129'), 0) AS cm,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense'
                                   AND NOT (l.code BETWEEN '5000' AND '5129')), 0)              AS ox
      FROM months mo LEFT JOIN lines l ON l.m = mo.m
     GROUP BY mo.m
  ),
  r AS (
    -- Round the parts first and add the rounded parts, so the total is the sum
    -- of what is shown, to the kobo.
    SELECT agg.m,
           round(sd, 2) AS sd, round(se, 2) AS se, round(idl, 2) AS idl,
           round(ie, 2) AS ie, round(orv, 2) AS orv,
           round(cg, 2) AS cg, round(ox, 2) AS ox, round(pr, 2) AS pr, round(cm, 2) AS cm
      FROM agg
  )
  SELECT r.m,
         r.sd + r.se + r.idl + r.ie + r.orv,
         r.cg,
         r.sd + r.se + r.idl + r.ie + r.orv - r.cg,
         r.ox, r.pr, r.cm,
         r.sd + r.se + r.idl + r.ie + r.orv - r.cg - r.ox - r.pr - r.cm,
         r.sd, r.se, r.idl, r.ie, r.orv
    FROM r ORDER BY r.m;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_profit_and_loss(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_profit_and_loss(date, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Money received — one list for the Payments page and "cash collected"
-- ─────────────────────────────────────────────────────────────────────────────
-- Three things bring money in, and they were shown in three places:
--   sale_payment     a row in payments against a sale
--   invoice_payment  a row in invoice_payments against an invoice
--   takings          a completed sale with no payment rows, paid on the spot
--                    (cash, transfer or POS). This is exactly the case
--                    fn_post_sale books straight to Cash or Bank.
-- A completed sale marked "credit" is not money received; it is a receivable.
CREATE OR REPLACE FUNCTION public.fn_money_received(p_from date, p_to date)
RETURNS TABLE (
  id          uuid,
  kind        text,
  received_on date,
  amount      numeric,
  method      text,
  reference   text,
  document    text,
  customer    text,
  source_id   uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.fn_can_read_finance(auth.uid())
          OR public.has_department_permission(auth.uid(), 'sales', 'view')) THEN
    RAISE EXCEPTION 'You do not have access to payments.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Give a from and to date.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  SELECT p.id, 'sale_payment'::text, p.payment_date::date, p.amount::numeric,
         lower(COALESCE(NULLIF(btrim(p.payment_method::text), ''), 'cash')),
         COALESCE(NULLIF(btrim(p.bank_reference), ''), NULLIF(btrim(p.transaction_id), '')),
         s.sale_number::text, s.customer_name::text, s.id
    FROM public.payments p
    JOIN public.sales s ON s.id = p.sale_id
   WHERE p.status = 'completed' AND COALESCE(p.amount, 0) > 0
     AND p.payment_date::date BETWEEN p_from AND p_to

  UNION ALL
  SELECT ip.id, 'invoice_payment'::text, ip.payment_date, ip.amount::numeric,
         lower(COALESCE(NULLIF(btrim(ip.payment_method), ''), 'transfer')),
         NULLIF(btrim(ip.reference), ''),
         COALESCE(i.invoice_number, i.quotation_number)::text, i.customer_name::text, i.id
    FROM public.invoice_payments ip
    JOIN public.invoices i ON i.id = ip.invoice_id
   WHERE ip.payment_date BETWEEN p_from AND p_to

  UNION ALL
  SELECT s.id, 'takings'::text, s.sale_date::date, s.total_amount::numeric,
         lower(COALESCE(NULLIF(btrim(s.payment_method), ''), 'cash')),
         NULL::text,
         s.sale_number::text, s.customer_name::text, s.id
    FROM public.sales s
   WHERE s.status = 'completed'
     AND s.cancelled_at IS NULL
     AND COALESCE(s.total_amount, 0) > 0
     AND s.sale_date::date BETWEEN p_from AND p_to
     AND public.fn_money_account(s.payment_method) IS DISTINCT FROM '2000'
     AND NOT EXISTS (SELECT 1 FROM public.payments p2
                      WHERE p2.sale_id = s.id AND p2.status = 'completed'
                        AND COALESCE(p2.amount, 0) > 0)
  ORDER BY 3 DESC, 4 DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_money_received(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_money_received(date, date) TO authenticated;

-- Cash collected for a period IS the sum of that period's payment records.
CREATE OR REPLACE FUNCTION public.fn_cash_collected(p_from date, p_to date)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v numeric;
BEGIN
  SELECT COALESCE(sum(amount), 0) INTO v FROM public.fn_money_received(p_from, p_to);
  RETURN round(v, 2);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_collected(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_collected(date, date) TO authenticated;

-- A completed sale says how it was paid ("credit" is an explicit choice).
-- Older rows keep NULL and are read as cash takings, as before.
CREATE OR REPLACE FUNCTION public.fn_sale_needs_method()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND COALESCE(btrim(NEW.payment_method), '') = '' THEN
    RAISE EXCEPTION 'Say how this sale was paid (cash, transfer, POS) or mark it as on credit.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sale_needs_method ON public.sales;
CREATE TRIGGER trg_sale_needs_method
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.fn_sale_needs_method();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Receipts: one rule, and "no receipt" needs a typed reason
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS no_receipt_reason text;
COMMENT ON COLUMN public.expenses.no_receipt_reason IS
  'Why an expense at or above the receipt threshold has no receipt. Typed by the person recording it; listed under Expenses → No receipt.';

CREATE OR REPLACE FUNCTION public.fn_guard_expense_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_reason text;
BEGIN
  NEW.description := public.fn_clean_text(NEW.description);
  NEW.payee_name  := NULLIF(public.fn_clean_text(NEW.payee_name), '');
  NEW.reference   := NULLIF(public.fn_clean_text(NEW.reference), '');
  NEW.no_receipt_reason := NULLIF(public.fn_clean_text(NEW.no_receipt_reason), '');

  -- A goods-received expense is supported by its GRN; say so on the record.
  IF COALESCE(NEW.source, 'capture') = 'grn'
     AND NEW.receipt_path IS NULL AND NEW.no_receipt_reason IS NULL THEN
    NEW.no_receipt_reason := 'Supported by the goods received note ' || COALESCE(NEW.reference, '');
  END IF;

  v_reason := NEW.no_receipt_reason;
  IF v_reason IS NOT NULL AND length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Say why there is no receipt (at least 10 characters).' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.fn_validate_expense_amounts(
    NEW.description, NEW.amount_minor, NEW.date,
    -- A typed reason stands in for the receipt; nothing else does.
    COALESCE(NULLIF(btrim(NEW.receipt_path), ''), CASE WHEN v_reason IS NOT NULL THEN 'no-receipt' END),
    'expense',
    COALESCE(NEW.source, 'capture') = 'capture');

  IF COALESCE(btrim(NEW.payment_method), '') = '' THEN
    RAISE EXCEPTION 'Choose how this expense was paid — the credit side of the journal follows it.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.payee_id IS NULL AND COALESCE(btrim(NEW.payee_name), '') = '' THEN
    RAISE EXCEPTION 'Name who was paid.' USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(NEW.source, 'capture') = 'capture'
     AND lower(btrim(NEW.payment_method)) IN ('transfer', 'card', 'pos')
     AND NEW.bank_account_id IS NULL THEN
    RAISE EXCEPTION 'A % payment needs the bank account it went through.', NEW.payment_method
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Budgets: the owner chooses whether going over warns or blocks
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.expense_settings
  ADD COLUMN IF NOT EXISTS budget_over_policy text NOT NULL DEFAULT 'warn';
ALTER TABLE public.expense_settings DROP CONSTRAINT IF EXISTS expense_settings_budget_policy_check;
ALTER TABLE public.expense_settings
  ADD CONSTRAINT expense_settings_budget_policy_check CHECK (budget_over_policy IN ('warn', 'block'));

-- Named to run after trg_expense_rules, which links the budget from the date.
CREATE OR REPLACE FUNCTION public.fn_expense_budget_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_policy text; v_total numeric; v_title text; v_spent bigint;
BEGIN
  SELECT budget_over_policy INTO v_policy FROM public.expense_settings WHERE id;
  IF COALESCE(v_policy, 'warn') <> 'block'
     OR NEW.budget_id IS NULL
     OR NEW.cancelled_at IS NOT NULL
     OR COALESCE(NEW.status, 'approved') = 'rejected'
     OR COALESCE(NEW.source, 'capture') NOT IN ('capture', 'report') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.amount_minor IS NOT DISTINCT FROM OLD.amount_minor
     AND NEW.budget_id    IS NOT DISTINCT FROM OLD.budget_id THEN
    RETURN NEW;
  END IF;

  SELECT total_budget, title INTO v_total, v_title FROM public.budgets WHERE id = NEW.budget_id;
  IF COALESCE(v_total, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT COALESCE(sum(e.amount_minor), 0) INTO v_spent
    FROM public.expenses e
   WHERE e.budget_id = NEW.budget_id
     AND e.cancelled_at IS NULL
     AND COALESCE(e.status, 'approved') <> 'rejected'
     AND e.id IS DISTINCT FROM NEW.id;

  IF v_spent + COALESCE(NEW.amount_minor, 0) > round(v_total * 100) THEN
    RAISE EXCEPTION 'This takes the budget "%" over by %. Raise the budget or choose another one.',
      v_title,
      to_char((v_spent + NEW.amount_minor - round(v_total * 100)) / 100.0, 'FM₦999,999,999,990.00')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_expense_rules_z_budget ON public.expenses;
CREATE TRIGGER trg_expense_rules_z_budget
  BEFORE INSERT OR UPDATE OF amount_minor, budget_id ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_expense_budget_guard();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Quotations and invoices: who the customer is, and how long a quote lasts
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.expense_settings
  ADD COLUMN IF NOT EXISTS quotation_validity_days integer NOT NULL DEFAULT 14;

CREATE OR REPLACE FUNCTION public.fn_invoice_customer_rules()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_limit   bigint;
  v_days    integer;
  v_walk_in boolean;
  v_changed boolean;
BEGIN
  SELECT named_customer_threshold_minor, quotation_validity_days
    INTO v_limit, v_days FROM public.expense_settings WHERE id;

  -- A new quotation is valid for a set number of days unless a date is given.
  IF TG_OP = 'INSERT' AND NEW.status = 'quotation' AND NEW.valid_until IS NULL THEN
    NEW.valid_until := COALESCE(NEW.issue_date, current_date) + COALESCE(v_days, 14);
  END IF;

  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;

  v_changed := TG_OP = 'INSERT'
            OR NEW.customer_name  IS DISTINCT FROM OLD.customer_name
            OR NEW.customer_phone IS DISTINCT FROM OLD.customer_phone
            OR NEW.total_amount   IS DISTINCT FROM OLD.total_amount
            OR NEW.invoice_type   IS DISTINCT FROM OLD.invoice_type
            OR NEW.status         IS DISTINCT FROM OLD.status;
  IF NOT v_changed THEN RETURN NEW; END IF;

  v_walk_in := COALESCE(btrim(NEW.customer_name), '') = '' OR NEW.customer_name ~* '^\s*walk[\s-]*in';

  -- An event is always for somebody we must be able to reach.
  IF NEW.invoice_type = 'event' THEN
    IF v_walk_in THEN
      RAISE EXCEPTION 'An event quotation or invoice needs the customer''s name, not Walk-in.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF length(regexp_replace(COALESCE(NEW.customer_phone, ''), '\D', '', 'g')) < 7 THEN
      RAISE EXCEPTION 'An event quotation or invoice needs the customer''s phone number.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF v_limit IS NOT NULL AND COALESCE(NEW.total_amount, 0) * 100 >= v_limit AND v_walk_in THEN
    RAISE EXCEPTION 'A quotation or invoice of % or more needs the customer''s name, not Walk-in.',
      to_char(v_limit / 100.0, 'FM₦999,999,999') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_invoice_customer_rules ON public.invoices;
CREATE TRIGGER trg_invoice_customer_rules
  BEFORE INSERT OR UPDATE OF customer_name, customer_phone, total_amount, invoice_type, status
  ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_customer_rules();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Reorder levels: set per item, and they stay set
-- ─────────────────────────────────────────────────────────────────────────────
-- Every item showed "10" because the stock functions create an item's first
-- inventory row with a hard-coded reorder level of 10, and the item form never
-- saved the level typed into it. The level lives on inventory rows (the SKU
-- mirrors the highest one), so:
--   • a new inventory row takes the item's own level, not 10;
--   • fn_set_reorder_levels writes levels for one item or many.
CREATE OR REPLACE FUNCTION public.fn_inventory_inherit_reorder()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v numeric;
BEGIN
  -- Only when the item already has stock rows elsewhere or a level on its SKU.
  SELECT s.reorder_level INTO v
    FROM public.products p JOIN public.skus s ON s.id = p.sku_id
   WHERE p.id = NEW.product_id;
  IF FOUND AND v IS NOT NULL
     AND (v > 0 OR EXISTS (SELECT 1 FROM public.inventory i WHERE i.product_id = NEW.product_id)) THEN
    NEW.reorder_level := v;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_inventory_inherit_reorder ON public.inventory;
CREATE TRIGGER trg_inventory_inherit_reorder
  BEFORE INSERT ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_inherit_reorder();

-- p_levels: [{"sku_id": "...", "level": 5}, ...]. Returns how many were set.
CREATE OR REPLACE FUNCTION public.fn_set_reorder_levels(p_levels jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x jsonb; v_sku uuid; v_level numeric; n integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.is_admin(auth.uid())
              OR public.has_department_permission(auth.uid(), 'inventory', 'update')) THEN
    RAISE EXCEPTION 'You do not have access to change reorder levels.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_levels, '[]'::jsonb)) LOOP
    v_sku   := (x->>'sku_id')::uuid;
    v_level := GREATEST(COALESCE((x->>'level')::numeric, 0), 0);
    -- The SKU first, so an item with no stock rows yet keeps its level …
    UPDATE public.skus SET reorder_level = v_level, updated_at = now() WHERE id = v_sku;
    IF NOT FOUND THEN CONTINUE; END IF;
    -- … then every stock row, which is what the SKU is re-synced from.
    UPDATE public.inventory i SET reorder_level = v_level
      FROM public.products p
     WHERE p.sku_id = v_sku AND i.product_id = p.id
       AND i.reorder_level IS DISTINCT FROM v_level;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_set_reorder_levels(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_reorder_levels(jsonb) TO authenticated;

COMMIT;
