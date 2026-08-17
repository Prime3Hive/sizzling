-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 5 — the posting rules of section 8. One event, one journal.
--
-- Fixes E-04, E-07, E-08, E-14:
--   • The expense account is taken from the line, not inferred from a two-value
--     "Account Type" column. 5000/5100/5110/5200/5300/5400/5900 are all
--     reachable; Rent and Utilities previously were not.
--   • The credit leg follows the PAYMENT METHOD. Every expense used to credit
--     Bank regardless, so cash spending was recorded as bank spending.
--   • VAT is split from the gross, and WHT is withheld from what is paid out.
--
-- ⚠ ACCOUNTING NOTE ON WHT, RAISED FOR REVIEW, IMPLEMENTED AS SPECIFIED.
--   The section 8 table places withholding tax in the CREDIT column against
--   account 1150, and that is what is implemented below. 1150 is defined in
--   this chart as "WHT Receivable", an asset with a debit normal balance —
--   which is right for tax a CUSTOMER withholds from us (see fn_post_sale),
--   but tax we withhold from a SUPPLIER is money owed onward to FIRS, i.e. a
--   liability. Crediting 1150 nets the two against each other. The entry
--   balances either way; the classification is the question. If the finance
--   lead agrees, the fix is a new liability account (e.g. 2110 WHT Payable)
--   and a one-line change to v_wht_code below.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Which account the credit leg lands on ────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_expense_credit_code(p_method text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(btrim(COALESCE(p_method, '')))
           WHEN 'cash'     THEN '1000'   -- Cash
           WHEN 'transfer' THEN '1010'   -- Bank
           WHEN 'card'     THEN '1010'
           WHEN 'pos'      THEN '1010'
           WHEN 'credit'   THEN '2000'   -- Accounts Payable
           -- No method recorded: fall back to Cash rather than silently
           -- assuming Bank, which is the defect this replaces.
           ELSE '1000'
         END;
$$;

COMMENT ON FUNCTION public.fn_expense_credit_code(text) IS
  'Section 8: the credit leg of an expense follows the payment method.';

-- ── 2. Post an expense ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_post_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e            record;
  v_exp_code   text;
  v_credit     text;
  v_vat_code   text := '2100';
  v_wht_code   text := '1150';
  v_net_debit  bigint;
  v_net_credit bigint;
  lines        jsonb;
BEGIN
  SELECT * INTO e FROM public.expenses WHERE id = p_id;

  -- Nothing to post: missing, cancelled, non-positive, or not approved.
  IF NOT FOUND
     OR COALESCE(e.amount_minor, 0) <= 0
     OR e.cancelled_at IS NOT NULL
     OR COALESCE(e.status, 'approved') <> 'approved' THEN
    PERFORM public.fn_unpost('expense', p_id);
    RETURN;
  END IF;

  -- The expense account comes from the line. account_type is retained only as
  -- a fallback for rows captured before this migration.
  v_exp_code := COALESCE(
    e.expense_account_code,
    (SELECT c.account_code FROM public.expense_categories c WHERE c.id = e.category_id),
    CASE
      WHEN e.category ILIKE '%rent%'                  THEN '5200'
      WHEN e.category ILIKE '%util%'                  THEN '5300'
      WHEN e.category ILIKE '%salar%'
        OR e.category ILIKE '%wage%'                  THEN '5100'
      WHEN COALESCE(e.account_type, 'COGS') = 'COGS'  THEN '5000'
      WHEN e.account_type = 'OpEX'                    THEN '5400'
      ELSE '5900'
    END);

  v_credit := public.fn_expense_credit_code(e.payment_method);

  -- VAT is split out of the gross; WHT is withheld from what is paid out.
  v_net_debit  := e.amount_minor - COALESCE(e.vat_minor, 0);
  v_net_credit := e.amount_minor - COALESCE(e.wht_minor, 0);

  lines := jsonb_build_array(
    jsonb_build_object('code', v_exp_code, 'debit', v_net_debit / 100.0, 'credit', 0,
                       'desc', COALESCE(e.category, 'Expense'))
  );

  IF COALESCE(e.vat_minor, 0) > 0 THEN
    lines := lines || jsonb_build_array(
      jsonb_build_object('code', v_vat_code, 'debit', e.vat_minor / 100.0, 'credit', 0,
                         'desc', 'Input VAT'));
  END IF;

  lines := lines || jsonb_build_array(
    jsonb_build_object('code', v_credit, 'debit', 0, 'credit', v_net_credit / 100.0,
                       'desc', CASE WHEN v_credit = '2000' THEN 'On credit' ELSE 'Paid' END));

  IF COALESCE(e.wht_minor, 0) > 0 THEN
    lines := lines || jsonb_build_array(
      jsonb_build_object('code', v_wht_code, 'debit', 0, 'credit', e.wht_minor / 100.0,
                         'desc', 'WHT withheld from supplier'));
  END IF;

  PERFORM public.fn_post_entry(
    e.date,
    'Expense — ' || COALESCE(e.description, ''),
    'expense', e.id, lines);
END;
$$;

-- ── 3. Settling a credit expense ────────────────────────────────────────────
-- Dr 2000 Accounts Payable / Cr Cash or Bank. Once, and only against an open
-- payable. The cost itself was recognised when the credit was incurred, so no
-- second expense is created here (that double-counted before).

CREATE OR REPLACE FUNCTION public.fn_post_payable_settlement(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; v_cash text; lines jsonb;
BEGIN
  SELECT * INTO p FROM public.payables WHERE id = p_id;

  IF NOT FOUND OR p.status <> 'paid' OR COALESCE(p.amount_minor, 0) <= 0 THEN
    PERFORM public.fn_unpost('payable_settlement', p_id);
    RETURN;
  END IF;

  v_cash := public.fn_expense_credit_code(COALESCE(p.payment_method, 'cash'));
  -- A settlement must move money, never re-open a payable against itself.
  IF v_cash = '2000' THEN v_cash := '1000'; END IF;

  lines := jsonb_build_array(
    jsonb_build_object('code', '2000', 'debit', p.amount_minor / 100.0, 'credit', 0,
                       'desc', 'Settled ' || COALESCE(p.supplier, '')),
    jsonb_build_object('code', v_cash, 'debit', 0, 'credit', p.amount_minor / 100.0,
                       'desc', 'Payment')
  );

  PERFORM public.fn_post_entry(
    COALESCE(p.paid_at::date, current_date),
    'Payable settled — ' || COALESCE(p.supplier, ''),
    'payable_settlement', p.id, lines);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_post_payable_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.fn_unpost('payable_settlement', OLD.id);
    RETURN OLD;
  END IF;
  PERFORM public.fn_post_payable_settlement(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_post_payable_settlement ON public.payables;
CREATE TRIGGER trg_auto_post_payable_settlement
  AFTER INSERT OR UPDATE OR DELETE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.trg_post_payable_settlement();

-- A payable may only be settled once.
CREATE OR REPLACE FUNCTION public.fn_guard_payable_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'paid' AND NEW.status = 'paid'
     AND OLD.paid_at IS DISTINCT FROM NEW.paid_at THEN
    RAISE EXCEPTION 'This payable to % was already settled on %. Reverse the settlement before recording another.',
      OLD.supplier, OLD.paid_at;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'paid' AND OLD.status <> 'paid' AND NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_payable_settlement ON public.payables;
CREATE TRIGGER trg_guard_payable_settlement
  BEFORE UPDATE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_payable_settlement();

-- ── 4. Re-post everything under the corrected rules ─────────────────────────
-- Every expense's journal is rebuilt so cash spending stops appearing as bank
-- spending, and so Rent/Utilities land where they belong. Journals in closed
-- periods are left alone — the period guard would reject them anyway.

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, date FROM public.expenses WHERE cancelled_at IS NULL LOOP
    IF NOT public.fn_books_locked(r.date) THEN
      PERFORM public.fn_post_expense(r.id);
    END IF;
  END LOOP;

  FOR r IN SELECT id, paid_at FROM public.payables WHERE status = 'paid' LOOP
    IF NOT public.fn_books_locked(COALESCE(r.paid_at::date, current_date)) THEN
      PERFORM public.fn_post_payable_settlement(r.id);
    END IF;
  END LOOP;
END $$;

COMMIT;
