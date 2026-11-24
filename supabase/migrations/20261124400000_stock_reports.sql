-- ═════════════════════════════════════════════════════════════════════════════
-- Costing and reports (inventory redesign, build stage 4)
--
-- Needs 20261124300000_stock_out_and_count.sql first.
--
-- READ-ONLY FUNCTIONS. This migration adds reports and nothing else: it
-- changes no table, no record, and nothing about how the books post.
--
-- The costing the redesign asks for (purchases of stock raise stock value;
-- cost of goods is what was issued, wasted or found missing, at average cost)
-- is worked out here FROM THE STOCK MOVEMENTS, as a management report. The
-- ledger keeps the policy of 20261117100000: a purchase is a cost when it is
-- bought. The two answers differ by the change in stock value over the
-- period, and the report shows both so they can be compared before anyone
-- decides to move the ledger over.
--
-- How stock value is worked out for any date:
--   value today  = stock on hand × average cost, for every item
--   value on D   = value today − the value of every movement dated after D
-- Each movement is valued at the cost it carried when it was recorded
-- (purchases at what was paid, issues at the average cost at that moment).
-- So for any period, exactly:
--   opening + purchases − cost of goods ± other movements = closing
-- "Other movements" are corrections, production and opening balances; they
-- are shown, not hidden inside cost of goods.
--
-- What this cannot see: a cost typed over by hand (set_product_cost) changes
-- today's value without a movement, and that change lands in the opening
-- figure of earlier periods. Movements from before the opening count carry
-- costs in mixed units; the report says from what date it can be relied on.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- The route of a movement, for movements recorded before routes were stamped.
-- Mirrors fn_stamp_movement_route.
CREATE OR REPLACE FUNCTION public.fn_movement_route(p_route text, p_type text, p_reference_type text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(NULLIF(p_route, ''), CASE
    WHEN p_type = 'reversal'                                  THEN 'reversal'
    WHEN p_type = 'purchase'                                  THEN 'receive'
    WHEN p_type IN ('production_issue', 'production_output')  THEN 'production'
    WHEN p_type = 'stock_take'                                THEN 'count_difference'
    WHEN p_type = 'waste'                                     THEN 'waste'
    WHEN p_type = 'sale'                                      THEN 'sale'
    WHEN p_type = 'return'                                    THEN 'return'
    WHEN p_type = 'transfer'                                  THEN 'transfer'
    WHEN p_type = 'adjustment' THEN CASE WHEN p_reference_type = 'opening' THEN 'opening' ELSE 'correction' END
    ELSE 'usage'
  END);
$$;

CREATE OR REPLACE FUNCTION public.fn_can_read_stock_reports(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_user IS NOT NULL
     AND (public.fn_has_module_permission(p_user, 'inventory', 'view') OR public.fn_can_read_finance(p_user));
$$;

CREATE OR REPLACE FUNCTION public.fn_check_report_range(p_from date, p_to date)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF NOT public.fn_can_read_stock_reports(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have access to the stock reports.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Give a from and to date.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Food cost: opening + purchases − cost of goods ± other = closing
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_inventory_cost_report(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today   numeric;
  v_after   numeric;
  v_closing numeric;
  v_period  numeric;
  r         jsonb;
  v_rev     jsonb := NULL;
  v_cogs_ledger numeric := NULL;
  v_reliable date;
  v_nocost  integer;
BEGIN
  PERFORM public.fn_check_report_range(p_from, p_to);

  SELECT COALESCE(sum(i.quantity * COALESCE(p.cost_price, 0)), 0) INTO v_today
    FROM public.inventory i JOIN public.products p ON p.id = i.product_id;

  SELECT COALESCE(sum(m.quantity_change * COALESCE(m.unit_cost, 0)), 0) INTO v_after
    FROM public.inventory_movements m WHERE m.occurred_on > p_to;

  WITH mv AS (
    SELECT public.fn_movement_route(m.route, m.movement_type, m.reference_type) AS route,
           m.reference_type,
           m.quantity_change * COALESCE(m.unit_cost, 0) AS val
      FROM public.inventory_movements m
     WHERE m.occurred_on BETWEEN p_from AND p_to
  ), by_route AS (
    SELECT -- A reversed receipt is a purchase that did not happen.
           CASE WHEN route = 'reversal' AND reference_type = 'stock_receipt' THEN 'receive' ELSE route END AS route,
           sum(val) AS val
      FROM mv GROUP BY 1
  )
  SELECT COALESCE(jsonb_object_agg(route, round(val, 2)), '{}'::jsonb), COALESCE(sum(val), 0)
    INTO r, v_period FROM by_route;

  v_closing := v_today - v_after;

  SELECT max(changed_at)::date INTO v_reliable FROM public.product_unit_changes WHERE kind = 'opening_count';
  SELECT count(*) INTO v_nocost FROM public.inventory_movements m
   WHERE m.occurred_on BETWEEN p_from AND p_to AND COALESCE(m.unit_cost, 0) = 0 AND m.quantity_change <> 0;

  -- Revenue and the ledger's own cost of sales, for those allowed to see the P&L.
  IF public.fn_can_read_finance(auth.uid()) THEN
    SELECT jsonb_build_object(
             'daily', COALESCE(sum(COALESCE(sales_daily, 0) + COALESCE(invoice_daily, 0)), 0),
             'event', COALESCE(sum(COALESCE(sales_event, 0) + COALESCE(invoice_event, 0)), 0)),
           COALESCE(sum(cogs), 0)
      INTO v_rev, v_cogs_ledger
      FROM public.fn_profit_and_loss(p_from, p_to);
  END IF;

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'opening_value', round(v_closing - v_period, 2),
    'closing_value', round(v_closing, 2),
    'purchases', COALESCE((r->>'receive')::numeric, 0),
    -- Positive = cost. A count that finds more than expected reduces it.
    'cogs', jsonb_build_object(
      'kitchen',          -COALESCE((r->>'kitchen')::numeric, 0),
      'event',            -(COALESCE((r->>'event')::numeric, 0) + COALESCE((r->>'event_return')::numeric, 0)),
      'waste',            -COALESCE((r->>'waste')::numeric, 0),
      'count_difference', -COALESCE((r->>'count_difference')::numeric, 0),
      -- Stock out that does not say where it went: older "Used" entries, and
      -- stock sold straight off an invoice.
      'usage',            -COALESCE((r->>'usage')::numeric, 0),
      'sale',             -COALESCE((r->>'sale')::numeric, 0)),
    -- Signed: positive adds to stock value.
    'other', jsonb_build_object(
      'correction', COALESCE((r->>'correction')::numeric, 0),
      'production', COALESCE((r->>'production')::numeric, 0),
      'opening',    COALESCE((r->>'opening')::numeric, 0),
      'return',     COALESCE((r->>'return')::numeric, 0),
      'transfer',   COALESCE((r->>'transfer')::numeric, 0),
      'reversal',   COALESCE((r->>'reversal')::numeric, 0)),
    'revenue', v_rev,
    'ledger_cogs', v_cogs_ledger,
    'reliable_from', v_reliable,
    'movements_without_cost', v_nocost);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Usage by item, per week, by route
-- ─────────────────────────────────────────────────────────────────────────────
-- Quantity is what left stock (a return from an event is negative). Movements
-- from before an item's unit change or opening count are left out: they are
-- in the old unit.
CREATE OR REPLACE FUNCTION public.fn_stock_usage_report(p_from date, p_to date)
RETURNS TABLE (week_start date, product_id uuid, sku_id uuid, item_name text, stock_unit text,
               route text, quantity numeric, value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fn_check_report_range(p_from, p_to);
  RETURN QUERY
  WITH reset AS (
    SELECT c.product_id, max(c.changed_at) AS at FROM public.product_unit_changes c GROUP BY c.product_id
  ), mv AS (
    SELECT m.*, public.fn_movement_route(m.route, m.movement_type, m.reference_type) AS r
      FROM public.inventory_movements m
      LEFT JOIN reset x ON x.product_id = m.product_id
     WHERE m.occurred_on BETWEEN p_from AND p_to
       AND (x.at IS NULL OR m.created_at >= x.at)
       AND m.movement_type <> 'production_output'
  )
  SELECT date_trunc('week', mv.occurred_on)::date, p.id, p.sku_id, p.name::text, public.fn_normalise_unit(p.uom),
         mv.r, round(sum(-mv.quantity_change), 4), round(sum(-mv.quantity_change * COALESCE(mv.unit_cost, 0)), 2)
    FROM mv JOIN public.products p ON p.id = mv.product_id
   WHERE mv.r IN ('kitchen', 'event', 'event_return', 'waste', 'count_difference', 'usage', 'production', 'sale', 'correction')
   GROUP BY 1, p.id, p.sku_id, p.name, p.uom, mv.r
  HAVING sum(mv.quantity_change) <> 0
   ORDER BY 1 DESC, p.name, mv.r;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Waste: what, why, and what it cost
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_waste_report(p_from date, p_to date)
RETURNS TABLE (product_id uuid, sku_id uuid, item_name text, stock_unit text, reason text,
               entries integer, quantity numeric, value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fn_check_report_range(p_from, p_to);
  RETURN QUERY
  SELECT p.id, p.sku_id, p.name::text, public.fn_normalise_unit(p.uom), COALESCE(m.reason, 'Not said'),
         count(*)::integer, round(sum(-m.quantity_change), 4), round(sum(-m.quantity_change * COALESCE(m.unit_cost, 0)), 2)
    FROM public.inventory_movements m JOIN public.products p ON p.id = m.product_id
   WHERE m.occurred_on BETWEEN p_from AND p_to
     AND public.fn_movement_route(m.route, m.movement_type, m.reference_type) = 'waste'
   GROUP BY p.id, p.sku_id, p.name, p.uom, COALESCE(m.reason, 'Not said')
   ORDER BY 8 DESC;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Count differences: what went missing or was found at each count
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_count_difference_report(p_from date, p_to date)
RETURNS TABLE (count_id uuid, count_number text, count_date date, kind text, sku_id uuid, item_name text, stock_unit text,
               expected numeric, counted numeric, difference numeric, value numeric, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fn_check_report_range(p_from, p_to);
  RETURN QUERY
  SELECT c.id, c.count_number, c.count_date, c.kind, l.sku_id, l.item_name, l.stock_unit,
         l.expected_qty, l.counted_qty, l.difference, round(l.difference * l.unit_cost, 2), l.reason
    FROM public.stock_count_lines l JOIN public.stock_counts c ON c.id = l.count_id
   WHERE c.status = 'approved' AND c.count_date BETWEEN p_from AND p_to AND l.difference <> 0
   ORDER BY c.count_date DESC, abs(l.difference * l.unit_cost) DESC;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Food cost per event
-- ─────────────────────────────────────────────────────────────────────────────
-- What each event took in the period, less what came back. The invoiced
-- amount is shown to those allowed to see invoices' money.
CREATE OR REPLACE FUNCTION public.fn_event_food_cost_report(p_from date, p_to date)
RETURNS TABLE (event_invoice_id uuid, event_name text, invoice_number text, event_date date,
               invoiced numeric, food_cost numeric, first_issue date, last_issue date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fin boolean := public.fn_can_read_finance(auth.uid());
BEGIN
  PERFORM public.fn_check_report_range(p_from, p_to);
  RETURN QUERY
  SELECT m.event_invoice_id,
         COALESCE(max(NULLIF(btrim(i.event_name), '')), max(m.event_name), max(i.customer_name))::text,
         max(COALESCE(i.invoice_number, i.quotation_number))::text,
         max(i.event_date),
         CASE WHEN v_fin THEN max(i.total_amount) END,
         round(sum(-m.quantity_change * COALESCE(m.unit_cost, 0)), 2),
         min(m.occurred_on), max(m.occurred_on)
    FROM public.inventory_movements m
    LEFT JOIN public.invoices i ON i.id = m.event_invoice_id
   WHERE m.route IN ('event', 'event_return') AND m.occurred_on BETWEEN p_from AND p_to
   GROUP BY m.event_invoice_id, CASE WHEN m.event_invoice_id IS NULL THEN lower(btrim(COALESCE(m.event_name, ''))) END
   ORDER BY 6 DESC;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Purchases by supplier, and what is still owed
-- ─────────────────────────────────────────────────────────────────────────────
-- Stock purchases in the period, from the expenses that recorded them
-- (receipts, goods received notes, and expenses typed into a stock category),
-- beside everything still unpaid to that supplier today. Money owed is for
-- those who can see the books, and managers.
CREATE OR REPLACE FUNCTION public.fn_purchases_by_supplier(p_from date, p_to date)
RETURNS TABLE (supplier text, purchases numeric, entries integer, last_purchase date, owed numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.fn_check_report_range(p_from, p_to);
  IF NOT (public.fn_can_read_finance(auth.uid()) OR public.has_role(auth.uid(), 'manager')) THEN
    RAISE EXCEPTION 'Purchases by supplier is for managers and those who can see the books.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH bought AS (
    SELECT lower(btrim(COALESCE(py.name, e.payee_name, 'Not named'))) AS k,
           max(btrim(COALESCE(py.name, e.payee_name, 'Not named'))) AS name,
           sum(e.amount_minor) / 100.0 AS total, count(*)::integer AS n, max(e.date) AS last_on
      FROM public.expenses e
      LEFT JOIN public.payees py ON py.id = e.payee_id
     WHERE e.cancelled_at IS NULL
       AND COALESCE(e.status, 'approved') = 'approved'
       AND e.date BETWEEN p_from AND p_to
       AND (e.source IN ('receipt', 'grn')
            OR e.category IN ('Proteins', 'Fresh Produce', 'Dry Goods & Seasonings', 'Packaging & Disposables', 'Cooking Fuel'))
     GROUP BY 1
  ), owing AS (
    SELECT lower(btrim(p.supplier)) AS k, max(btrim(p.supplier)) AS name, sum(p.amount_minor) / 100.0 AS total
      FROM public.payables p WHERE p.status = 'unpaid' GROUP BY 1
  )
  SELECT COALESCE(b.name, o.name)::text, COALESCE(round(b.total, 2), 0), COALESCE(b.n, 0), b.last_on, COALESCE(round(o.total, 2), 0)
    FROM bought b FULL OUTER JOIN owing o ON o.k = b.k
   ORDER BY 2 DESC, 5 DESC;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Price changes: cost per stock unit, this month against last
-- ─────────────────────────────────────────────────────────────────────────────
-- From what was actually paid on receipts: the average price per stock unit
-- in the month of p_month and in the month before.
CREATE OR REPLACE FUNCTION public.fn_price_changes(p_month date)
RETURNS TABLE (product_id uuid, sku_id uuid, item_name text, stock_unit text,
               last_cost numeric, this_cost numeric, change_pct numeric, this_qty numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_this date := date_trunc('month', COALESCE(p_month, current_date))::date;
  v_last date := (date_trunc('month', COALESCE(p_month, current_date)) - interval '1 month')::date;
BEGIN
  PERFORM public.fn_check_report_range(v_last, v_this);
  RETURN QUERY
  WITH reset AS (
    SELECT c.product_id, max(c.changed_at) AS at FROM public.product_unit_changes c
     WHERE c.kind = 'unit_change' GROUP BY c.product_id
  ), buys AS (
    SELECT m.product_id, date_trunc('month', m.occurred_on)::date AS mth,
           sum(m.quantity_change) AS qty, sum(m.quantity_change * m.unit_cost) AS val
      FROM public.inventory_movements m
      LEFT JOIN reset x ON x.product_id = m.product_id
     WHERE m.movement_type = 'purchase' AND m.quantity_change > 0 AND COALESCE(m.unit_cost, 0) > 0
       AND m.occurred_on >= v_last AND m.occurred_on < (v_this + interval '1 month')
       -- A price from before the unit changed is a price per the old unit.
       AND (x.at IS NULL OR m.created_at >= x.at)
       -- A receipt that was reversed did not happen.
       AND NOT EXISTS (SELECT 1 FROM public.inventory_movements rv WHERE rv.reverses_movement_id = m.id)
     GROUP BY m.product_id, 2
  )
  SELECT p.id, p.sku_id, p.name::text, public.fn_normalise_unit(p.uom),
         round(l.val / l.qty, 4), round(t.val / t.qty, 4),
         round((t.val / t.qty - l.val / l.qty) / (l.val / l.qty) * 100, 1), round(t.qty, 4)
    FROM buys t
    JOIN buys l ON l.product_id = t.product_id AND l.mth = v_last
    JOIN public.products p ON p.id = t.product_id
   WHERE t.mth = v_this AND t.qty > 0 AND l.qty > 0
   ORDER BY 7 DESC;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'fn_inventory_cost_report(date, date)', 'fn_stock_usage_report(date, date)', 'fn_waste_report(date, date)',
    'fn_count_difference_report(date, date)', 'fn_event_food_cost_report(date, date)',
    'fn_purchases_by_supplier(date, date)', 'fn_price_changes(date)', 'fn_can_read_stock_reports(uuid)',
    'fn_check_report_range(date, date)', 'fn_movement_route(text, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
