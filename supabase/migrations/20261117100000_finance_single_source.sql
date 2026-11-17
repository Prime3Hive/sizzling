-- ═════════════════════════════════════════════════════════════════════════════
-- Finance & inventory code fixes (2026-11-17)
--
-- Implements "Sizzling Portal — Code Fixes (Finance & Inventory)":
--
--   1. One P&L. fn_profit_and_loss(from, to) reads the general ledger and is the
--      only place profit is computed. Every page calls it.
--   2. Purchases are direct costs (option a). A goods receipt (GRN) creates ONE
--      expense (Dr 5000 / Cr Cash|Bank|AP). Stock movements carry quantities
--      only; they no longer post cost to the ledger. Existing stock-cost
--      postings are reversed ON THEIR OWN DATE so no month is restated into
--      another, and the missing GRN expenses are backfilled.
--      Ledger inventory (1200/1210) is brought to the stock value by an explicit
--      "match ledger to stock" posting (fn_sync_inventory_ledger).
--   3. Expense categories come from public.expense_categories, each carrying its
--      ledger account. The DB rejects categories outside the list, blocks
--      salaries as expenses, fills the account from the category and lets only
--      Finance change it.
--   4. Settling a payable never creates an expense.
--   5. fn_clean_text stripped EVERY space (a literal space sat inside its
--      "invisible characters" class). Fixed.
--   6. Payment method → account map in one function; sales carry their method.
--   7. Controls: self-approval limit, named customer above a threshold,
--      duplicate payment guard, supplier normalisation, LPO unit check,
--      budget auto-link and a "monthly" budget type.
--   8. Equity: 3000/3100 guaranteed, year-end close function.
--
-- Read-only diagnostics for the data clean-up are in
-- sql/M-10-finance-fixes-diagnostics.sql.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Accounts
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, normal_balance, sort_order) VALUES
  ('3000', 'Owner''s Equity',                    'equity',  'credit',  80),
  ('3100', 'Retained Earnings',                  'equity',  'credit',  90),
  ('5010', 'Inventory Adjustment / Shrinkage',   'expense', 'debit',  131),
  ('5050', 'Production Expenses',                'expense', 'debit',  135),
  ('5120', 'Staff Sales Commission',             'expense', 'debit',  146)
ON CONFLICT (code) DO UPDATE SET is_active = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Text cleaning: stop stripping spaces
-- ─────────────────────────────────────────────────────────────────────────────
-- The old class '[<LRM><RLM><BOM><LRI><RLI><FSI><PDI> ]' ended in an ordinary
-- space, so "Market run for event" was stored as "Marketrunforevent".
-- Written with escapes so the class can't silently pick up a visible character.
CREATE OR REPLACE FUNCTION public.fn_clean_text(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(
           regexp_replace(
             regexp_replace(COALESCE(p, ''), '[​‌‍‎‏⁦⁧⁨⁩﻿]', '', 'g'),
             ' ', ' ', 'g'),
           '\s+', ' ', 'g'));
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Settings
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.expense_settings
  -- Above this, the person who recorded an expense cannot approve it. NULL = off.
  ADD COLUMN IF NOT EXISTS self_approval_limit_minor      bigint DEFAULT 50000000,   -- ₦500,000
  -- Quotations/invoices at or above this need a named customer. NULL = off.
  ADD COLUMN IF NOT EXISTS named_customer_threshold_minor bigint DEFAULT 50000000;   -- ₦500,000

ALTER TABLE public.inventory_settings
  -- false (default) = periodic: purchases are costed when bought (expense), stock
  -- movements are quantities only. true restores the old perpetual postings.
  ADD COLUMN IF NOT EXISTS perpetual_inventory_ledger boolean NOT NULL DEFAULT false;

-- Block negative stock (the setting already existed; it now defaults off).
UPDATE public.inventory_settings SET allow_negative_stock = false, updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Who counts as Finance
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_is_finance(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NULL   -- SQL console / service role
      OR public.is_admin(p_user)
      OR public.has_department_permission(p_user, 'finance', 'update');
$$;

CREATE OR REPLACE FUNCTION public.fn_can_read_finance(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NULL
      OR public.is_admin(p_user)
      OR public.has_role(p_user, 'manager')
      OR public.has_department_permission(p_user, 'finance', 'view');
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Payment method → account (one map for everything)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_money_account(p_method text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN m IN ('cash', 'petty cash', 'petty_cash')                                   THEN '1000'
    WHEN m IN ('credit', 'on credit', 'on_credit')                                   THEN '2000'
    WHEN m IN ('transfer', 'bank transfer', 'bank_transfer', 'bank', 'pos', 'card',
               'cheque', 'check', 'online', 'ussd', 'debit card', 'credit card')     THEN '1010'
    ELSE NULL
  END
  FROM (SELECT lower(btrim(COALESCE(p_method, ''))) AS m) s;
$$;

CREATE OR REPLACE FUNCTION public.fn_expense_credit_code(p_method text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(public.fn_money_account(p_method), '1000');
$$;

-- Money received: never "credit" — anything that isn't cash is the bank.
CREATE OR REPLACE FUNCTION public.fn_cash_acct(p_method text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_acct(CASE WHEN public.fn_money_account(p_method) = '1000' THEN '1000' ELSE '1010' END);
$$;

-- Sales carry how they were paid. Cash takings with no method stay in Cash.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_method text;

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

  dr_code := CASE
    WHEN has_pay OR s.status <> 'completed'                THEN '1100'
    WHEN public.fn_money_account(s.payment_method) = '2000' THEN '1100'   -- sold on credit
    WHEN public.fn_money_account(s.payment_method) = '1010' THEN '1010'
    ELSE '1000'
  END;

  vat := LEAST(COALESCE(s.vat_amount, 0), s.total_amount);
  net := s.total_amount - vat;

  lines := jsonb_build_array(
    jsonb_build_object('code', dr_code, 'debit', s.total_amount, 'credit', 0,
      'desc', CASE dr_code WHEN '1000' THEN 'Cash takings ' WHEN '1010' THEN 'Takings banked ' ELSE 'Sale ' END || s.sale_number)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Periodic inventory: stock movements stop posting cost
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_inventory_perpetual()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT perpetual_inventory_ledger FROM public.inventory_settings LIMIT 1), false);
$$;

/** A ledger document that moves stock COST (as opposed to an opening balance). */
CREATE OR REPLACE FUNCTION public.fn_is_stock_cost_entry(p_source_type text, p_source_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_source_type IN ('inventory_purchase', 'invoice_cogs', 'production',
                           'stock_revaluation', 'stock_reclass') THEN true
    WHEN p_source_type = 'stock_movement' THEN NOT EXISTS (
      SELECT 1 FROM public.inventory_movements
       WHERE id = p_source_id AND reference_type = 'opening')
    ELSE false
  END;
$$;

-- fn_post_entry, unchanged except for the periodic-inventory switch at the top.
CREATE OR REPLACE FUNCTION public.fn_post_entry(
  p_date date, p_memo text, p_source_type text, p_source_id uuid, p_lines jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  live_id   uuid;
  eid       uuid;
  ln        jsonb;
  want_fp   text;
  have_fp   text;
  want_n    int := 0;
BEGIN
  -- Periodic inventory: purchases are costed by their expense, so documents
  -- that only move stock cost post nothing (and any live posting is unposted).
  IF public.fn_is_stock_cost_entry(p_source_type, p_source_id)
     AND NOT public.fn_inventory_perpetual() THEN
    p_lines := '[]'::jsonb;
  END IF;

  SELECT id INTO live_id
  FROM public.journal_entries
  WHERE source_type = p_source_type
    AND source_id   = p_source_id
    AND reversal_of_id IS NULL
    AND is_reversed = false
  LIMIT 1;

  IF p_lines IS NOT NULL THEN
    want_n := jsonb_array_length(p_lines);
  END IF;

  IF want_n = 0 THEN
    IF live_id IS NOT NULL THEN
      PERFORM public.fn_reverse_entry(live_id, 'source document no longer posts');
    END IF;
    RETURN;
  END IF;

  SELECT string_agg(f, '|' ORDER BY f) INTO want_fp
  FROM (
    SELECT (x->>'code') || ':' ||
           to_char(COALESCE((x->>'debit')::numeric,  0), 'FM9999999999990.00') || ':' ||
           to_char(COALESCE((x->>'credit')::numeric, 0), 'FM9999999999990.00') AS f
    FROM jsonb_array_elements(p_lines) x
  ) s;

  IF live_id IS NOT NULL THEN
    SELECT string_agg(f, '|' ORDER BY f) INTO have_fp
    FROM (
      SELECT a.code || ':' ||
             to_char(l.debit,  'FM9999999999990.00') || ':' ||
             to_char(l.credit, 'FM9999999999990.00') AS f
      FROM public.journal_lines l
      JOIN public.chart_of_accounts a ON a.id = l.account_id
      WHERE l.entry_id = live_id
    ) s;

    IF have_fp IS NOT DISTINCT FROM want_fp
       AND (SELECT entry_date FROM public.journal_entries WHERE id = live_id) = p_date THEN
      RETURN;
    END IF;

    PERFORM public.fn_reverse_entry(live_id, 'restated from source document');
  END IF;

  INSERT INTO public.journal_entries
    (entry_date, memo, source_type, source_id, posted_by, created_by)
  VALUES (p_date, p_memo, p_source_type, p_source_id, auth.uid(), auth.uid())
  RETURNING id INTO eid;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
    VALUES (
      eid,
      public.fn_acct(ln->>'code'),
      round(COALESCE((ln->>'debit')::numeric, 0), 2),
      round(COALESCE((ln->>'credit')::numeric, 0), 2),
      ln->>'desc'
    );
  END LOOP;
END;
$$;

/** Reverse an entry on a given date (used to restate history month by month). */
CREATE OR REPLACE FUNCTION public.fn_reverse_entry_on(p_entry_id uuid, p_date date, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE orig record; rid uuid;
BEGIN
  SELECT * INTO orig FROM public.journal_entries WHERE id = p_entry_id;
  IF NOT FOUND OR orig.is_reversed THEN RETURN NULL; END IF;

  UPDATE public.journal_entries SET is_reversed = true, reversed_at = now() WHERE id = p_entry_id;

  INSERT INTO public.journal_entries
    (entry_date, memo, source_type, source_id, reversal_of_id, posted_by, created_by)
  VALUES (p_date,
          'Reversal of entry #' || orig.entry_no || ' — ' || p_reason || COALESCE(' [' || orig.memo || ']', ''),
          orig.source_type, orig.source_id, p_entry_id, auth.uid(), auth.uid())
  RETURNING id INTO rid;

  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT rid, l.account_id, l.credit, l.debit, 'Reversal: ' || COALESCE(l.description, '')
  FROM public.journal_lines l WHERE l.entry_id = p_entry_id;

  RETURN rid;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_reverse_entry_on(uuid, date, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Expense categories (the approved list) with their ledger accounts
-- ─────────────────────────────────────────────────────────────────────────────
-- Retire everything first; the approved list is re-activated below. Old names
-- stay readable on historical rows.
UPDATE public.expense_categories SET is_active = false;

INSERT INTO public.expense_categories (name, account_code, sort_order, is_active) VALUES
  ('Proteins',                         '5000',  10, true),
  ('Fresh Produce',                    '5000',  20, true),
  ('Dry Goods & Seasonings',           '5000',  30, true),
  ('Packaging & Disposables',          '5000',  40, true),
  ('Cooking Fuel',                     '5000',  50, true),
  ('Kitchen Labour',                   '5050',  60, true),
  ('Event Labour',                     '5050',  70, true),
  ('Event Logistics',                  '5050',  80, true),
  ('Transport & Delivery',             '5400',  90, true),
  ('Vehicle Repairs & Maintenance',    '5400', 100, true),
  ('Premises Repairs & Maintenance',   '5400', 110, true),
  ('Cleaning & Hygiene',               '5400', 120, true),
  ('Kitchen Tools & Small Equipment',  '5400', 130, true),
  ('Office & Admin',                   '5400', 140, true),
  ('Commissions',                      '5120', 150, true),
  ('Imports & Shipping',               '5400', 160, true),
  ('Bank Charges',                     '5400', 170, true),
  ('Miscellaneous',                    '5900', 900, true)
ON CONFLICT (name) DO UPDATE
  SET account_code = EXCLUDED.account_code,
      sort_order   = EXCLUDED.sort_order,
      is_active    = true;

/** Suggest a category from free text (item names, descriptions). */
CREATE OR REPLACE FUNCTION public.fn_guess_expense_category(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN t ~ '(bank charge|pos charge|transfer charge|sms alert|stamp duty|maintenance fee)' THEN 'Bank Charges'
    WHEN t ~ '(commission|njc)'                                                    THEN 'Commissions'
    WHEN t ~ '(import|freight|shipping|clearing)'                                  THEN 'Imports & Shipping'
    WHEN t ~ '(waiter|usher|event staff|chef)'                                     THEN 'Event Labour'
    WHEN t ~ '(cook|chopping|helper|moi ?moi maker|snack maker|labou?r)'           THEN 'Kitchen Labour'
    WHEN t ~ '(canopy|chair|tent|hire|venue|decor)'                                THEN 'Event Logistics'
    WHEN t ~ '(vulcani|mechanic|tyre|tire|engine oil|bus repair|bike repair|car repair)' THEN 'Vehicle Repairs & Maintenance'
    WHEN t ~ '(plumb|security room|building|carpent|electrician|paint|roof)'       THEN 'Premises Repairs & Maintenance'
    WHEN t ~ '(detergent|hypo|bleach|soap|hair ?net|brush|sponge|disinfect|saniti|mop|broom|glove)' THEN 'Cleaning & Hygiene'
    WHEN t ~ '(sieve|chopping board|drum|sealing machine|knife|cooler|bowl|basin|pot\M)' THEN 'Kitchen Tools & Small Equipment'
    WHEN t ~ '(stationer|airtime|\mdata\M|printing|paper|ink)'                     THEN 'Office & Admin'
    WHEN t ~ '(\mgas\M|charcoal|coal|firewood)'                                    THEN 'Cooking Fuel'
    WHEN t ~ '(fuel|petrol|keke|bolt|uber|rider|pick ?up|barrow|transport|delivery|okada|bus fare)' THEN 'Transport & Delivery'
    WHEN t ~ '(chicken|beef|fish|prawn|shrimp|gizzard|lamb|goat|\megg|turkey|croaker|kidney|liver|meat|sausage|snail|catfish|mackerel|titus|tilapia|panla|ponmo|cow ?leg|offal)' THEN 'Proteins'
    WHEN t ~ '(pack|foil|cling|takeaway|take away|serviette|toothpick|nylon|container|plate|spoon|fork|straw|wrap|disposable)' THEN 'Packaging & Disposables'
    WHEN t ~ '(pepper|tomato|onion|cabbage|carrot|herb|parsley|plantain|\myam|potato|lettuce|cucumber|garlic|ginger|scent leaf|ugwu|spinach|vegetable|lemon|lime|fruit|coriander|spring onion|green beans)' THEN 'Fresh Produce'
    WHEN t ~ '(flour|\moil\M|spice|sauce|sugar|butter|bread|rice|beans|salt|seasoning|maggi|knorr|curry|thyme|pasta|spaghetti|noodle|milk|cream|mayonnaise|ketchup|vinegar|crayfish|semovita|garri|egusi|ogbono)' THEN 'Dry Goods & Seasonings'
    ELSE NULL
  END
  FROM (SELECT lower(COALESCE(p, '')) AS t) s;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Expense rules (category, account, settlement, self-approval, budget)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_source_known;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_source_known CHECK (source IN (
    'capture', 'claim', 'report', 'settlement', 'correction', 'import',
    'grn'          -- created from a goods receipt note (LPO received)
  ));

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS grn_id uuid REFERENCES public.lpo_receipts(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_grn_live
  ON public.expenses (grn_id) WHERE grn_id IS NOT NULL AND cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_amount_date ON public.expenses (amount_minor, date);

/** The budget an expense dated p_date belongs to: the monthly one first. */
CREATE OR REPLACE FUNCTION public.fn_budget_for_date(p_date date)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id FROM public.budgets b
   WHERE p_date BETWEEN b.start_date AND b.end_date
   ORDER BY (lower(COALESCE(b.type, '')) = 'monthly') DESC,
            (lower(COALESCE(b.type, '')) = 'event') ASC,
            (b.end_date - b.start_date) ASC,
            b.created_at ASC
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_expense_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cat        record;
  v_src      text := COALESCE(NEW.source, 'capture');
  v_cat_chg  boolean;
  v_limit    bigint;
  v_maker    uuid;
BEGIN
  -- Settling a payable moves money; it is never a new cost.
  IF TG_OP = 'INSERT' AND v_src = 'settlement' THEN
    RAISE EXCEPTION 'Settling a payable records a payment (Dr Accounts Payable / Cr Cash or Bank), not a new expense.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_cat_chg := TG_OP = 'INSERT'
            OR NEW.category    IS DISTINCT FROM OLD.category
            OR NEW.category_id IS DISTINCT FROM OLD.category_id;

  IF v_cat_chg THEN
    IF NEW.category_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.category_id IS DISTINCT FROM OLD.category_id) THEN
      SELECT * INTO cat FROM public.expense_categories WHERE id = NEW.category_id;
    ELSE
      SELECT * INTO cat FROM public.expense_categories
       WHERE lower(name) = lower(btrim(COALESCE(NEW.category, '')))
       ORDER BY is_active DESC LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION '"%" is not an expense category. Choose one from the list and put the item in the description.',
        COALESCE(NEW.category, '(blank)') USING ERRCODE = 'check_violation';
    END IF;

    IF lower(cat.name) = 'salaries & wages' THEN
      RAISE EXCEPTION 'Salaries are paid through Payroll, not recorded as expenses.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- Claims and corrections may carry a category chosen before it was retired.
    IF NOT cat.is_active AND (TG_OP = 'UPDATE' OR v_src NOT IN ('claim', 'correction')) THEN
      RAISE EXCEPTION '"%" is no longer an expense category. Choose a current one.', cat.name
        USING ERRCODE = 'check_violation';
    END IF;

    NEW.category    := cat.name;
    NEW.category_id := cat.id;

    -- The account follows the category unless Finance deliberately chose one.
    IF TG_OP = 'INSERT' THEN
      IF NEW.expense_account_code IS NULL OR NOT public.fn_is_finance(auth.uid()) THEN
        NEW.expense_account_code := COALESCE(cat.account_code, NEW.expense_account_code);
      END IF;
    ELSIF NEW.expense_account_code IS NOT DISTINCT FROM OLD.expense_account_code THEN
      NEW.expense_account_code := COALESCE(cat.account_code, NEW.expense_account_code);
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NOT v_cat_chg
     AND NEW.expense_account_code IS DISTINCT FROM OLD.expense_account_code
     AND NOT public.fn_is_finance(auth.uid()) THEN
    RAISE EXCEPTION 'Only Finance can change the expense account.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.expense_account_code IS NOT NULL THEN
    NEW.account_type := CASE WHEN NEW.expense_account_code BETWEEN '5000' AND '5099' THEN 'COGS' ELSE 'OpEX' END;
  END IF;

  -- Budget follows the date when none was chosen.
  IF NEW.budget_id IS NULL AND (TG_OP = 'INSERT' OR NEW.date IS DISTINCT FROM OLD.date) THEN
    NEW.budget_id := public.fn_budget_for_date(NEW.date);
  END IF;

  -- Separation of duties: above the limit, the maker cannot be the checker.
  SELECT self_approval_limit_minor INTO v_limit FROM public.expense_settings WHERE id;
  IF v_limit IS NOT NULL AND auth.uid() IS NOT NULL AND v_src IN ('capture', 'report')
     AND COALESCE(NEW.amount_minor, 0) > v_limit THEN
    v_maker := COALESCE(NEW.submitted_by, NEW.created_by, auth.uid());
    IF TG_OP = 'INSERT' THEN
      IF NEW.status = 'approved' AND v_maker = auth.uid() THEN
        NEW.status      := 'pending';
        NEW.approved_by := NULL;
        NEW.approved_at := NULL;
      END IF;
    ELSIF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' AND v_maker = auth.uid() THEN
      RAISE EXCEPTION 'You recorded this expense, so someone else must approve it (it is above %).',
        to_char(v_limit / 100.0, 'FM₦999,999,999') USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_rules ON public.expenses;
CREATE TRIGGER trg_expense_rules
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_expense_rules();

-- Expense lines (claims) use the same list.
CREATE OR REPLACE FUNCTION public.fn_expense_line_category_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cat record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN RETURN NEW; END IF;
  SELECT * INTO cat FROM public.expense_categories WHERE id = NEW.category_id;
  IF NOT FOUND OR NOT cat.is_active THEN
    RAISE EXCEPTION 'Choose a current expense category.' USING ERRCODE = 'check_violation';
  END IF;
  IF lower(cat.name) = 'salaries & wages' THEN
    RAISE EXCEPTION 'Salaries are paid through Payroll, not recorded as expenses.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_expense_line_category_rules ON public.expense_line;
CREATE TRIGGER trg_expense_line_category_rules
  BEFORE INSERT OR UPDATE OF category_id ON public.expense_line
  FOR EACH ROW EXECUTE FUNCTION public.fn_expense_line_category_rules();

/** Possible duplicates: same amount within ±3 days. */
CREATE OR REPLACE FUNCTION public.fn_find_duplicate_expenses(
  p_amount_minor bigint, p_date date, p_exclude uuid DEFAULT NULL)
RETURNS TABLE (id uuid, date date, amount numeric, description text, payee_name text, status text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT e.id, e.date, e.amount, e.description, e.payee_name, e.status
    FROM public.expenses e
   WHERE e.amount_minor = p_amount_minor
     AND e.date BETWEEN p_date - 3 AND p_date + 3
     AND e.cancelled_at IS NULL
     AND COALESCE(e.status, 'approved') <> 'rejected'
     AND (p_exclude IS NULL OR e.id <> p_exclude)
   ORDER BY e.date
   LIMIT 5;
$$;
GRANT EXECUTE ON FUNCTION public.fn_find_duplicate_expenses(bigint, date, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Suppliers: one record per supplier, LPOs and payees share it
-- ─────────────────────────────────────────────────────────────────────────────
-- Merge payees that differ only by case/spacing into the oldest one.
DO $$
DECLARE g record; keep uuid;
BEGIN
  FOR g IN
    SELECT lower(public.fn_clean_text(name)) AS k, array_agg(id ORDER BY created_at, id) AS ids
      FROM public.payees GROUP BY 1 HAVING count(*) > 1
  LOOP
    keep := g.ids[1];
    UPDATE public.expenses     SET payee_id = keep WHERE payee_id = ANY (g.ids[2:]);
    UPDATE public.expense_line SET payee_id = keep WHERE payee_id = ANY (g.ids[2:]);
    DELETE FROM public.payees WHERE id = ANY (g.ids[2:]);
  END LOOP;
END $$;
UPDATE public.payees SET name = public.fn_clean_text(name) WHERE name <> public.fn_clean_text(name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payees_name_ci ON public.payees (lower(name));

/** Find (or create) the supplier/payee record for a name, case-insensitively. */
CREATE OR REPLACE FUNCTION public.fn_payee_for(p_name text, p_kind text DEFAULT 'supplier')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text := public.fn_clean_text(p_name); v_id uuid;
BEGIN
  IF v_name = '' THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.payees WHERE lower(name) = lower(v_name);
  IF v_id IS NULL THEN
    INSERT INTO public.payees (name, kind) VALUES (v_name, p_kind)
    ON CONFLICT DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.payees WHERE lower(name) = lower(v_name);
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

ALTER TABLE public.lpos ADD COLUMN IF NOT EXISTS payee_id uuid REFERENCES public.payees(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.fn_lpo_supplier_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text := public.fn_clean_text(NEW.supplier_name);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.supplier_name IS NOT DISTINCT FROM OLD.supplier_name
     AND NEW.payee_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF lower(v_name) IN ('requisition', 'sizzling spices', 'sizzling', 'internal', 'n/a', 'na', '-') THEN
    RAISE EXCEPTION '"%" is not a supplier. Name the business you are buying from.', v_name
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.payee_id := public.fn_payee_for(v_name, 'supplier');
  -- Use the supplier's recorded spelling so "Market" and "MARKET" are one.
  SELECT name INTO NEW.supplier_name FROM public.payees WHERE id = NEW.payee_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_lpo_supplier_rules ON public.lpos;
CREATE TRIGGER trg_lpo_supplier_rules
  BEFORE INSERT OR UPDATE OF supplier_name, payee_id ON public.lpos
  FOR EACH ROW EXECUTE FUNCTION public.fn_lpo_supplier_rules();

-- Seed suppliers from LPOs (skipping the non-supplier names) and frequent payees.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT public.fn_clean_text(supplier_name) AS n FROM public.lpos
     WHERE lower(public.fn_clean_text(supplier_name)) NOT IN ('requisition', 'sizzling spices', 'sizzling', 'internal', 'n/a', 'na', '-', '')
  LOOP
    PERFORM public.fn_payee_for(r.n, 'supplier');
  END LOOP;

  FOR r IN
    SELECT public.fn_clean_text(payee_name) AS n FROM public.expenses
     WHERE payee_id IS NULL AND COALESCE(btrim(payee_name), '') <> ''
     GROUP BY lower(public.fn_clean_text(payee_name)), public.fn_clean_text(payee_name)
    HAVING count(*) >= 2
  LOOP
    PERFORM public.fn_payee_for(r.n, 'supplier');
  END LOOP;
END $$;

UPDATE public.lpos l SET payee_id = p.id
  FROM public.payees p
 WHERE l.payee_id IS NULL AND lower(p.name) = lower(public.fn_clean_text(l.supplier_name));

-- Link-only updates on history must not re-post journals (a re-post would date
-- its reversal today and move cost between months).
ALTER TABLE public.expenses DISABLE TRIGGER trg_auto_post_expense;
UPDATE public.expenses e SET payee_id = p.id
  FROM public.payees p
 WHERE e.payee_id IS NULL AND lower(p.name) = lower(public.fn_clean_text(e.payee_name));
ALTER TABLE public.expenses ENABLE TRIGGER trg_auto_post_expense;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Inventory units and categories
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_normalise_unit(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN u IN ('kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms')                         THEN 'kg'
    WHEN u IN ('l', 'lt', 'ltr', 'ltrs', 'liter', 'liters', 'litre', 'litres')                THEN 'litre'
    WHEN u IN ('pc', 'pcs', 'piece', 'pieces', 'unit', 'units', 'each', 'ea', 'no', 'nos')    THEN 'piece'
    WHEN u IN ('pack', 'packs', 'pk', 'pkt', 'pkts', 'packet', 'packets')                      THEN 'pack'
    WHEN u IN ('bag', 'bags', 'sack', 'sacks')                                                 THEN 'bag'
    WHEN u IN ('carton', 'cartons', 'ctn', 'ctns')                                             THEN 'carton'
    ELSE NULLIF(btrim(p), '')
  END
  FROM (SELECT lower(btrim(COALESCE(p, ''))) AS u) s;
$$;

CREATE OR REPLACE FUNCTION public.fn_normalise_inventory_category(p text, p_item text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN c IN ('protein', 'proteins', 'meat', 'poultry', 'seafood')                    THEN 'Proteins'
    WHEN c IN ('fresh produce', 'perishables', 'perishable', 'vegetables', 'produce')  THEN 'Fresh Produce'
    WHEN c IN ('dry goods & seasonings', 'dry goods', 'seasonings', 'spices', 'grocery', 'groceries') THEN 'Dry Goods & Seasonings'
    WHEN c IN ('packaging', 'packaging & disposables', 'disposables')                  THEN 'Packaging & Disposables'
    WHEN c IN ('gas', 'coal', 'charcoal', 'fuel', 'cooking fuel')                      THEN 'Cooking Fuel'
    WHEN c IN ('cleaning', 'cleaning & hygiene', 'hygiene')                            THEN 'Cleaning & Hygiene'
    WHEN c IN ('finished goods', 'finished_goods')                                     THEN 'Finished Goods'
    -- Generic buckets: decide from the item's name.
    WHEN c IN ('raw materials', 'raw material', 'raw_materials', 'procurement', 'general',
               'consumables', 'other', 'misc', 'miscellaneous', '')
      THEN COALESCE(
             CASE public.fn_guess_expense_category(p_item)
               WHEN 'Proteins'                THEN 'Proteins'
               WHEN 'Fresh Produce'           THEN 'Fresh Produce'
               WHEN 'Dry Goods & Seasonings'  THEN 'Dry Goods & Seasonings'
               WHEN 'Packaging & Disposables' THEN 'Packaging & Disposables'
               WHEN 'Cooking Fuel'            THEN 'Cooking Fuel'
               WHEN 'Cleaning & Hygiene'      THEN 'Cleaning & Hygiene'
             END,
             CASE WHEN c = 'consumables' THEN 'Cleaning & Hygiene' ELSE 'Dry Goods & Seasonings' END)
    ELSE btrim(p)
  END
  FROM (SELECT lower(btrim(COALESCE(p, ''))) AS c) s;
$$;

CREATE OR REPLACE FUNCTION public.fn_product_normalise()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.uom      := COALESCE(public.fn_normalise_unit(NEW.uom), NEW.uom);
  NEW.category := public.fn_normalise_inventory_category(NEW.category, NEW.name);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_a_product_normalise ON public.products;
CREATE TRIGGER trg_a_product_normalise
  BEFORE INSERT OR UPDATE OF uom, category, name ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fn_product_normalise();

CREATE OR REPLACE FUNCTION public.fn_sku_normalise()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.unit_of_measure := COALESCE(public.fn_normalise_unit(NEW.unit_of_measure), NEW.unit_of_measure);
  NEW.category        := public.fn_normalise_inventory_category(NEW.category, NEW.name);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_a_sku_normalise ON public.skus;
CREATE TRIGGER trg_a_sku_normalise
  BEFORE INSERT OR UPDATE OF unit_of_measure, category, name ON public.skus
  FOR EACH ROW EXECUTE FUNCTION public.fn_sku_normalise();

-- Normalise what is already there (the triggers above do the work).
UPDATE public.products SET uom = uom, category = category;
UPDATE public.skus     SET unit_of_measure = unit_of_measure, category = category;

-- GRN/LPO lines must use the item's unit or one of its defined pack sizes.
CREATE OR REPLACE FUNCTION public.fn_lpo_item_unit_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uom text; v_name text;
BEGIN
  NEW.unit_of_measure := COALESCE(public.fn_normalise_unit(NEW.unit_of_measure), NEW.unit_of_measure);
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  SELECT uom, name INTO v_uom, v_name FROM public.products WHERE id = NEW.product_id;
  IF v_uom IS NULL OR NEW.unit_of_measure = v_uom THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.product_units
              WHERE product_id = NEW.product_id
                AND lower(btrim(unit_name)) = lower(btrim(NEW.unit_of_measure))) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is stocked in %. Order it in % (or set up a pack size for "%" first).',
    v_name, v_uom, v_uom, NEW.unit_of_measure USING ERRCODE = 'check_violation';
END;
$$;
-- Named to run after fn_resolve_lpo_item_product fills product_id.
DROP TRIGGER IF EXISTS trg_z_lpo_item_unit_rules ON public.lpo_items;
CREATE TRIGGER trg_z_lpo_item_unit_rules
  BEFORE INSERT OR UPDATE OF unit_of_measure, product_id, sku_id ON public.lpo_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_lpo_item_unit_rules();

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Goods received → one expense per GRN
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_grn_expense(p_receipt_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        record;
  v_minor  bigint;
  v_cat    text;
  v_method text;
  v_items  text;
  v_exp    uuid;
  v_payee  uuid;
BEGIN
  SELECT rc.id, rc.receipt_number, rc.received_date, rc.received_by, rc.expense_id,
         lp.id AS lpo_id, lp.lpo_number, lp.supplier_name, lp.payee_id, lp.payment_method,
         lp.cost_center, lp.budget_id, lp.expense_category
    INTO r
    FROM public.lpo_receipts rc JOIN public.lpos lp ON lp.id = rc.lpo_id
   WHERE rc.id = p_receipt_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(sum(round(quantity_received * unit_price * 100)), 0)::bigint,
         left(string_agg(item_name, ', ' ORDER BY quantity_received * unit_price DESC), 180)
    INTO v_minor, v_items
    FROM public.lpo_receipt_items WHERE receipt_id = p_receipt_id;

  SELECT id INTO v_exp FROM public.expenses
   WHERE grn_id = p_receipt_id AND cancelled_at IS NULL LIMIT 1;

  IF v_minor <= 0 THEN RETURN v_exp; END IF;

  IF v_exp IS NOT NULL THEN
    UPDATE public.expenses SET amount_minor = v_minor
     WHERE id = v_exp AND amount_minor IS DISTINCT FROM v_minor;
    RETURN v_exp;
  END IF;

  -- Category: the LPO's if it is a current one, else from the biggest line.
  SELECT name INTO v_cat FROM public.expense_categories
   WHERE is_active AND lower(name) = lower(btrim(COALESCE(r.expense_category, '')));
  IF v_cat IS NULL THEN
    SELECT public.fn_guess_expense_category(item_name) INTO v_cat
      FROM public.lpo_receipt_items
     WHERE receipt_id = p_receipt_id AND public.fn_guess_expense_category(item_name) IS NOT NULL
     ORDER BY quantity_received * unit_price DESC LIMIT 1;
  END IF;
  v_cat := COALESCE(v_cat, 'Dry Goods & Seasonings');

  -- Paid on the spot → Cash/Bank. Anything else → on credit (Accounts Payable).
  v_method := CASE public.fn_money_account(r.payment_method)
                WHEN '1000' THEN 'Cash'
                WHEN '1010' THEN initcap(lower(btrim(r.payment_method)))
                ELSE 'Credit'
              END;
  IF lower(v_method) = 'pos' THEN v_method := 'POS'; END IF;

  v_payee := COALESCE(r.payee_id, public.fn_payee_for(r.supplier_name, 'supplier'));

  INSERT INTO public.expenses (
    amount_minor, description, category, date, budget_id, cost_center,
    payment_method, payee_id, payee_name, reference, grn_id,
    source, status, created_by, submitted_by, approved_by, approved_at
  ) VALUES (
    v_minor,
    'Goods received from ' || public.fn_clean_text(r.supplier_name)
      || COALESCE(': ' || regexp_replace(v_items, '\d', '', 'g'), ''),
    v_cat,
    r.received_date,
    COALESCE(r.budget_id, public.fn_budget_for_date(r.received_date)),
    COALESCE(NULLIF(r.cost_center, ''), 'Daily Orders'),
    v_method,
    v_payee,
    COALESCE((SELECT name FROM public.payees WHERE id = v_payee), public.fn_clean_text(r.supplier_name)),
    r.receipt_number || ' / ' || r.lpo_number,
    p_receipt_id,
    'grn', 'approved',
    COALESCE(auth.uid(), r.received_by), r.received_by,
    auth.uid(), now()
  ) RETURNING id INTO v_exp;

  UPDATE public.lpo_receipts SET expense_id = v_exp WHERE id = p_receipt_id;

  -- On credit: it is owed until "Pay supplier" settles it (Dr 2000 / Cr Cash|Bank).
  IF v_method = 'Credit' THEN
    INSERT INTO public.payables (supplier, description, category, amount_minor,
                                 incurred_date, status, expense_id, created_by)
    VALUES (public.fn_clean_text(r.supplier_name),
            r.receipt_number || ' / ' || r.lpo_number, v_cat, v_minor,
            r.received_date, 'unpaid', v_exp, COALESCE(auth.uid(), r.received_by));
  END IF;

  RETURN v_exp;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_grn_expense()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  FOR rid IN SELECT DISTINCT receipt_id FROM new_rows LOOP
    PERFORM public.fn_grn_expense(rid);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_grn_expense ON public.lpo_receipt_items;
CREATE TRIGGER trg_grn_expense
  AFTER INSERT ON public.lpo_receipt_items
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_grn_expense();

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Controls on invoices and payments
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_invoice_customer_rules()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_limit bigint;
BEGIN
  SELECT named_customer_threshold_minor INTO v_limit FROM public.expense_settings WHERE id;
  IF v_limit IS NULL OR NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.customer_name IS NOT DISTINCT FROM OLD.customer_name
     AND NEW.total_amount  IS NOT DISTINCT FROM OLD.total_amount
     AND NEW.status        IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.total_amount, 0) * 100 >= v_limit
     AND (COALESCE(btrim(NEW.customer_name), '') = '' OR NEW.customer_name ~* '^\s*walk[\s-]*in') THEN
    RAISE EXCEPTION 'A quotation or invoice of % or more needs the customer''s name, not Walk-in.',
      to_char(v_limit / 100.0, 'FM₦999,999,999') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_invoice_customer_rules ON public.invoices;
CREATE TRIGGER trg_invoice_customer_rules
  BEFORE INSERT OR UPDATE OF customer_name, total_amount, status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_customer_rules();

-- The same payment twice (same document, amount and day) is refused.
CREATE OR REPLACE FUNCTION public.fn_guard_duplicate_sale_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payments p
              WHERE p.sale_id = NEW.sale_id AND p.amount = NEW.amount
                AND p.payment_date::date = NEW.payment_date::date
                AND COALESCE(p.status, '') <> 'failed'
                AND p.id <> NEW.id) THEN
    RAISE EXCEPTION 'This payment is already recorded for this sale on that day.' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_duplicate_sale_payment ON public.payments;
CREATE TRIGGER trg_guard_duplicate_sale_payment
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_duplicate_sale_payment();

CREATE OR REPLACE FUNCTION public.fn_guard_duplicate_invoice_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoice_payments p
              WHERE p.invoice_id = NEW.invoice_id AND p.amount = NEW.amount
                AND p.payment_date::date = NEW.payment_date::date
                AND p.id <> NEW.id) THEN
    RAISE EXCEPTION 'This payment is already recorded for this invoice on that day.' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_duplicate_invoice_payment ON public.invoice_payments;
CREATE TRIGGER trg_guard_duplicate_invoice_payment
  BEFORE INSERT ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_duplicate_invoice_payment();

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. The P&L — one function, from the ledger
-- ─────────────────────────────────────────────────────────────────────────────
-- Groups (by account code):
--   revenue     income accounts (4xxx)
--   cogs        5000–5099  (purchases, inventory adjustment, production costs)
--   payroll     5100–5119  (salaries, employer pension)
--   commission  5120–5129
--   opex        every other expense account (rent, utilities, 5400, 5900 …)
-- net_profit = revenue − cogs − opex − payroll − commission, on every row.
CREATE OR REPLACE FUNCTION public.fn_profit_and_loss(p_from date, p_to date)
RETURNS TABLE (
  month        date,
  revenue      numeric,
  cogs         numeric,
  gross_profit numeric,
  opex         numeric,
  payroll      numeric,
  commission   numeric,
  net_profit   numeric
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
           (jl.debit - jl.credit) AS dr
      FROM public.journal_lines jl
      JOIN public.journal_entries je   ON je.id = jl.entry_id
      JOIN public.chart_of_accounts a  ON a.id  = jl.account_id
     WHERE je.entry_date BETWEEN p_from AND p_to
       AND a.type IN ('income', 'expense')
       AND je.source_type <> 'year_close'
  ),
  months AS (
    SELECT generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date AS m
  ),
  agg AS (
    SELECT mo.m,
      COALESCE(sum(l.cr) FILTER (WHERE l.type = 'income'), 0)                                   AS rev,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense' AND l.code BETWEEN '5000' AND '5099'), 0) AS cg,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense' AND l.code BETWEEN '5100' AND '5119'), 0) AS pr,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense' AND l.code BETWEEN '5120' AND '5129'), 0) AS cm,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense'
                                   AND NOT (l.code BETWEEN '5000' AND '5129')), 0)              AS ox
      FROM months mo LEFT JOIN lines l ON l.m = mo.m
     GROUP BY mo.m
  )
  SELECT agg.m,
         round(rev, 2), round(cg, 2), round(rev - cg, 2),
         round(ox, 2), round(pr, 2), round(cm, 2),
         round(rev - cg - ox - pr - cm, 2)
    FROM agg ORDER BY agg.m;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_profit_and_loss(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_profit_and_loss(date, date) TO authenticated;

/** Money actually received (Cash + Bank debits from sales and receipts). */
CREATE OR REPLACE FUNCTION public.fn_cash_collected(p_from date, p_to date)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v numeric;
BEGIN
  IF NOT public.fn_can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have access to finance figures.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT COALESCE(sum(jl.debit - jl.credit), 0) INTO v
    FROM public.journal_lines jl
    JOIN public.journal_entries je  ON je.id = jl.entry_id
    JOIN public.chart_of_accounts a ON a.id  = jl.account_id
   WHERE je.entry_date BETWEEN p_from AND p_to
     AND a.code IN ('1000', '1010')
     AND je.source_type IN ('sale', 'payment', 'invoice_payment');
  RETURN round(v, 2);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_collected(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_collected(date, date) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Inventory value: page vs ledger, and matching them
-- ─────────────────────────────────────────────────────────────────────────────
-- Stock value is defined exactly as the Inventory page shows it: items not
-- archived, positive quantities × cost per unit (a negative balance is not an
-- asset).
CREATE OR REPLACE FUNCTION public.fn_inventory_ledger_check()
RETURNS TABLE (stock_value numeric, ledger_value numeric, difference numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sv numeric; lv numeric;
BEGIN
  IF NOT public.fn_can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have access to finance figures.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT COALESCE(sum(round(GREATEST(stock_quantity, 0) * COALESCE(cost_per_unit, 0), 2)), 0)
    INTO sv FROM public.skus WHERE NOT COALESCE(is_archived, false);
  SELECT COALESCE(sum(jl.debit - jl.credit), 0) INTO lv
    FROM public.journal_lines jl
    JOIN public.chart_of_accounts a ON a.id = jl.account_id
   WHERE a.code IN ('1200', '1210');
  RETURN QUERY SELECT round(sv, 2), round(lv, 2), round(sv - lv, 2);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_inventory_ledger_check() TO authenticated;

-- Posts the difference to 1200. p_offset:
--   '5010' month-end stock count (closing stock adjusts cost of sales) — normal
--   '3000' first-time recognition of stock already on hand (opening balance)
CREATE OR REPLACE FUNCTION public.fn_sync_inventory_ledger(p_date date, p_offset text DEFAULT '5010')
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v_id uuid := gen_random_uuid(); d numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin can adjust ledger inventory.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_offset NOT IN ('5010', '3000') THEN
    RAISE EXCEPTION 'Offset must be 5010 (stock count) or 3000 (opening balance).';
  END IF;
  SELECT * INTO c FROM public.fn_inventory_ledger_check();
  d := c.difference;
  IF d = 0 THEN RETURN 0; END IF;

  PERFORM public.fn_post_entry(
    COALESCE(p_date, current_date),
    'Inventory valued at stock count: ' || to_char(c.stock_value, 'FM999,999,999,990.00'),
    'inventory_valuation', v_id,
    CASE WHEN d > 0 THEN jsonb_build_array(
      jsonb_build_object('code', '1200',   'debit', d, 'credit', 0, 'desc', 'Stock on hand'),
      jsonb_build_object('code', p_offset, 'debit', 0, 'credit', d, 'desc',
        CASE p_offset WHEN '3000' THEN 'Opening stock recognised' ELSE 'Closing stock adjustment' END))
    ELSE jsonb_build_array(
      jsonb_build_object('code', p_offset, 'debit', -d, 'credit', 0, 'desc',
        CASE p_offset WHEN '3000' THEN 'Opening stock correction' ELSE 'Stock used / shrinkage' END),
      jsonb_build_object('code', '1200',   'debit', 0, 'credit', -d, 'desc', 'Stock on hand'))
    END);
  RETURN d;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_sync_inventory_ledger(date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sync_inventory_ledger(date, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Year-end close (income/expense → 3100 Retained Earnings)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_close_year(p_year integer)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from date := make_date(p_year, 1, 1);
  v_to   date := make_date(p_year, 12, 31);
  lines  jsonb;
  v_net  numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin can close a year.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_to >= current_date THEN
    RAISE EXCEPTION 'The year % has not ended yet.', p_year;
  END IF;

  WITH bal AS (
    SELECT a.code, sum(jl.debit - jl.credit) AS b
      FROM public.journal_lines jl
      JOIN public.journal_entries je  ON je.id = jl.entry_id
      JOIN public.chart_of_accounts a ON a.id  = jl.account_id
     WHERE je.entry_date BETWEEN v_from AND v_to
       AND a.type IN ('income', 'expense')
       AND je.source_type <> 'year_close'
     GROUP BY a.code HAVING round(sum(jl.debit - jl.credit), 2) <> 0
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'code', code,
           'debit',  CASE WHEN b < 0 THEN round(-b, 2) ELSE 0 END,
           'credit', CASE WHEN b > 0 THEN round(b, 2)  ELSE 0 END,
           'desc', 'Year-end close ' || p_year)), '[]'::jsonb),
         COALESCE(round(-sum(b), 2), 0)
    INTO lines, v_net
    FROM bal;

  IF v_net <> 0 THEN
    lines := lines || jsonb_build_array(jsonb_build_object(
      'code', '3100',
      'debit',  CASE WHEN v_net < 0 THEN -v_net ELSE 0 END,
      'credit', CASE WHEN v_net > 0 THEN v_net  ELSE 0 END,
      'desc', CASE WHEN v_net >= 0 THEN 'Profit for ' ELSE 'Loss for ' END || p_year));
  END IF;

  PERFORM public.fn_post_entry(v_to, 'Year-end close ' || p_year, 'year_close',
                               md5('year_close:' || p_year)::uuid, lines);
  RETURN v_net;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_close_year(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_close_year(integer) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. Budgets: a real "monthly" type
-- ─────────────────────────────────────────────────────────────────────────────
-- The live table carries a CHECK (created outside these migrations) that only
-- allows week/event/activity. Replace it with one that also allows monthly.
-- NOT VALID: existing rows are not re-checked, only new and changed ones.
ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_type_check;
ALTER TABLE public.budgets
  ADD CONSTRAINT budgets_type_check
  CHECK (type IN ('monthly', 'week', 'event', 'activity')) NOT VALID;

UPDATE public.budgets
   SET type = 'monthly'
 WHERE start_date = date_trunc('month', start_date)::date
   AND end_date   = (date_trunc('month', start_date) + interval '1 month - 1 day')::date
   AND lower(COALESCE(type, '')) <> 'monthly';

-- ─────────────────────────────────────────────────────────────────────────────
-- 16. Restate history (runs once; every step is idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record; n_rev int := 0; n_link int := 0; n_new int := 0; n_skip int := 0;
BEGIN
  -- a) Stock-cost postings reversed on their own date, so each month nets to
  --    nil instead of piling the correction into November.
  FOR r IN
    SELECT je.id, je.entry_date
      FROM public.journal_entries je
     WHERE je.reversal_of_id IS NULL
       AND je.is_reversed = false
       AND public.fn_is_stock_cost_entry(je.source_type, je.source_id)
     ORDER BY je.entry_date
  LOOP
    IF public.fn_books_locked(r.entry_date) THEN
      n_skip := n_skip + 1;   -- closed period: left for a manual decision
      CONTINUE;
    END IF;
    PERFORM public.fn_reverse_entry_on(r.id, r.entry_date, 'periodic inventory: purchases are costed by their expense');
    n_rev := n_rev + 1;
  END LOOP;

  -- b) Link the GRN expenses that already exist (May–Aug: "Purchase receipt GRN-…").
  --    Linking is bookkeeping only; nothing is re-posted.
  ALTER TABLE public.expenses DISABLE TRIGGER trg_auto_post_expense;
  FOR r IN SELECT rc.id, rc.receipt_number, rc.expense_id FROM public.lpo_receipts rc
            WHERE NOT EXISTS (SELECT 1 FROM public.expenses e WHERE e.grn_id = rc.id)
  LOOP
    UPDATE public.expenses e SET grn_id = r.id
     WHERE e.id = (SELECT e2.id FROM public.expenses e2
                    WHERE e2.grn_id IS NULL AND e2.cancelled_at IS NULL
                      AND (e2.id = r.expense_id OR e2.description ILIKE '%' || r.receipt_number || '%')
                    ORDER BY (e2.id = r.expense_id) DESC LIMIT 1);
    IF FOUND THEN n_link := n_link + 1; END IF;
  END LOOP;
  ALTER TABLE public.expenses ENABLE TRIGGER trg_auto_post_expense;

  -- c) Create the missing ones from 1 Aug 2026 (the regression).
  FOR r IN SELECT rc.id, rc.received_date FROM public.lpo_receipts rc
            WHERE rc.received_date >= DATE '2026-08-01'
              AND NOT EXISTS (SELECT 1 FROM public.expenses e WHERE e.grn_id = rc.id)
            ORDER BY rc.received_date
  LOOP
    IF public.fn_books_locked(r.received_date) THEN n_skip := n_skip + 1; CONTINUE; END IF;
    PERFORM public.fn_grn_expense(r.id);
    n_new := n_new + 1;
  END LOOP;

  RAISE NOTICE 'Stock-cost entries reversed: %, GRN expenses linked: %, created: %, skipped (locked period): %',
    n_rev, n_link, n_new, n_skip;
END $$;

-- d) Sales converted from staff sales reports know how they were paid.
UPDATE public.sales s
   SET payment_method = lower(btrim(sr.payment_method))
  FROM public.staff_reports sr
 WHERE sr.report_type = 'sales'
   AND sr.converted_ref::text = s.id::text
   AND s.payment_method IS NULL
   AND COALESCE(btrim(sr.payment_method), '') <> '';

-- Re-post those that were banked: the old entry is reversed on its own date
-- (so revenue never leaves its month) and the sale posts again to 1010.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT s.id, je.id AS entry_id, je.entry_date
             FROM public.sales s
             JOIN public.journal_entries je
               ON je.source_type = 'sale' AND je.source_id = s.id
              AND je.reversal_of_id IS NULL AND je.is_reversed = false
            WHERE public.fn_money_account(s.payment_method) = '1010'
              AND s.status = 'completed'
              AND EXISTS (SELECT 1 FROM public.journal_lines jl
                            JOIN public.chart_of_accounts a ON a.id = jl.account_id
                           WHERE jl.entry_id = je.id AND a.code = '1000' AND jl.debit > 0)
  LOOP
    IF public.fn_books_locked(r.entry_date) THEN CONTINUE; END IF;
    PERFORM public.fn_reverse_entry_on(r.entry_id, r.entry_date, 'takings were banked, not cash');
    PERFORM public.fn_post_sale(r.id);
  END LOOP;
END $$;

-- e) Budgets for unbudgeted expenses (a link, not a posting).
ALTER TABLE public.expenses DISABLE TRIGGER trg_auto_post_expense;
UPDATE public.expenses SET budget_id = public.fn_budget_for_date(date)
 WHERE budget_id IS NULL AND public.fn_budget_for_date(date) IS NOT NULL;
ALTER TABLE public.expenses ENABLE TRIGGER trg_auto_post_expense;

COMMIT;
