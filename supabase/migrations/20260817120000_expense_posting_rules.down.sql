-- Reverse of 20260817120000_expense_posting_rules.sql.
-- Restores the previous fn_post_expense (single expense/cash-or-bank pair)
-- and removes payable settlement posting.

BEGIN;

DROP TRIGGER IF EXISTS trg_auto_post_payable_settlement ON public.payables;
DROP TRIGGER IF EXISTS trg_guard_payable_settlement ON public.payables;
DROP FUNCTION IF EXISTS public.trg_post_payable_settlement();
DROP FUNCTION IF EXISTS public.fn_post_payable_settlement(uuid);
DROP FUNCTION IF EXISTS public.fn_guard_payable_settlement();

DELETE FROM public.journal_entries WHERE source_type = 'payable_settlement';

CREATE OR REPLACE FUNCTION public.fn_post_expense(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
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
    WHEN e.account_type = 'OpEX'                   THEN '5400'
    ELSE '5900'
  END;
  cash_code := (SELECT code FROM public.chart_of_accounts WHERE id = public.fn_cash_acct(e.payment_method));
  lines := jsonb_build_array(
    jsonb_build_object('code', exp_code,  'debit', e.amount, 'credit', 0, 'desc', e.category),
    jsonb_build_object('code', cash_code, 'debit', 0, 'credit', e.amount, 'desc', 'Paid')
  );
  PERFORM public.fn_post_entry(e.date, 'Expense — ' || e.description, 'expense', e.id, lines);
END;
$fn$;

DROP FUNCTION IF EXISTS public.fn_expense_credit_code(text);

COMMIT;
