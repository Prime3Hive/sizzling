-- Down for 20261123100000_fix_list_nov23.
--
-- Puts the functions back as 20261117100000 left them. It does NOT undo the
-- invoice re-postings (each is an append-only reversal plus a new entry; run
-- fn_post_invoice again after restoring the old function if they must move
-- back), and it keeps the new columns (no_receipt_reason, budget_over_policy,
-- quotation_validity_days) so no data is lost.
BEGIN;

DROP TRIGGER IF EXISTS trg_sale_needs_method          ON public.sales;
DROP TRIGGER IF EXISTS trg_expense_rules_z_budget     ON public.expenses;
DROP TRIGGER IF EXISTS trg_inventory_inherit_reorder  ON public.inventory;
DROP FUNCTION IF EXISTS public.fn_sale_needs_method();
DROP FUNCTION IF EXISTS public.fn_expense_budget_guard();
DROP FUNCTION IF EXISTS public.fn_inventory_inherit_reorder();
DROP FUNCTION IF EXISTS public.fn_set_reorder_levels(jsonb);

-- Reversals dated today again.
CREATE OR REPLACE FUNCTION public.fn_reverse_entry(p_entry_id uuid, p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE orig record; rid uuid;
BEGIN
  SELECT * INTO orig FROM public.journal_entries WHERE id = p_entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cannot reverse journal entry %: no such entry.', p_entry_id; END IF;
  IF orig.is_reversed THEN RETURN NULL; END IF;
  UPDATE public.journal_entries SET is_reversed = true, reversed_at = now() WHERE id = p_entry_id;
  INSERT INTO public.journal_entries
    (entry_date, memo, source_type, source_id, reversal_of_id, posted_by, created_by)
  VALUES (current_date,
          'Reversal of entry #' || orig.entry_no || COALESCE(' — ' || p_reason, '') || COALESCE(' [' || orig.memo || ']', ''),
          orig.source_type, orig.source_id, p_entry_id, auth.uid(), auth.uid())
  RETURNING id INTO rid;
  INSERT INTO public.journal_lines (entry_id, account_id, debit, credit, description)
  SELECT rid, l.account_id, l.credit, l.debit, 'Reversal: ' || COALESCE(l.description, '')
    FROM public.journal_lines l WHERE l.entry_id = p_entry_id;
  RETURN rid;
END;
$$;

-- The P&L without the revenue split and counting every journal line.
DROP FUNCTION IF EXISTS public.fn_profit_and_loss(date, date);
CREATE FUNCTION public.fn_profit_and_loss(p_from date, p_to date)
RETURNS TABLE (month date, revenue numeric, cogs numeric, gross_profit numeric,
               opex numeric, payroll numeric, commission numeric, net_profit numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.fn_can_read_finance(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have access to the profit and loss.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH lines AS (
    SELECT date_trunc('month', je.entry_date)::date AS m, a.code, a.type,
           (jl.credit - jl.debit) AS cr, (jl.debit - jl.credit) AS dr
      FROM public.journal_lines jl
      JOIN public.journal_entries je  ON je.id = jl.entry_id
      JOIN public.chart_of_accounts a ON a.id  = jl.account_id
     WHERE je.entry_date BETWEEN p_from AND p_to
       AND a.type IN ('income', 'expense')
       AND je.source_type <> 'year_close'
  ),
  months AS (
    SELECT generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date AS m
  ),
  agg AS (
    SELECT mo.m,
      COALESCE(sum(l.cr) FILTER (WHERE l.type = 'income'), 0) AS rev,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense' AND l.code BETWEEN '5000' AND '5099'), 0) AS cg,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense' AND l.code BETWEEN '5100' AND '5119'), 0) AS pr,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense' AND l.code BETWEEN '5120' AND '5129'), 0) AS cm,
      COALESCE(sum(l.dr) FILTER (WHERE l.type = 'expense' AND NOT (l.code BETWEEN '5000' AND '5129')), 0) AS ox
      FROM months mo LEFT JOIN lines l ON l.m = mo.m
     GROUP BY mo.m
  )
  SELECT agg.m, round(rev, 2), round(cg, 2), round(rev - cg, 2),
         round(ox, 2), round(pr, 2), round(cm, 2), round(rev - cg - ox - pr - cm, 2)
    FROM agg ORDER BY agg.m;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_profit_and_loss(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_profit_and_loss(date, date) TO authenticated;

-- Cash collected from the ledger again.
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
DROP FUNCTION IF EXISTS public.fn_money_received(date, date);

-- fn_post_invoice, fn_guard_expense_insert and fn_invoice_customer_rules keep
-- their new bodies: each is a superset of the old behaviour and none depends on
-- anything dropped above. Re-apply 20260609120000 / 20260818100000 /
-- 20261117100000 for the exact earlier text if it is ever needed.

COMMIT;
