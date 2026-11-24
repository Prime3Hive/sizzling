-- ═════════════════════════════════════════════════════════════════════════════
-- M-15 — Inventory redesign, stage 3 (stock out and count): checks
--
-- READ-ONLY. Run each block separately in the Supabase SQL editor AFTER
-- migration 20261124300000_stock_out_and_count.sql. Nothing here writes.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Stock out by route, per week, at the cost the stock carried when it left.
--    Movements from before the routes show as 'usage' (route not said).
SELECT date_trunc('week', m.occurred_on)::date AS week,
       COALESCE(m.route, 'before routes: ' || m.movement_type) AS route,
       count(*) AS movements,
       round(sum(-m.quantity_change * COALESCE(m.unit_cost, 0)), 2) AS value_out
  FROM public.inventory_movements m
 WHERE m.quantity_change < 0
 GROUP BY 1, 2
 ORDER BY 1 DESC, 2;

-- 2. Food cost per event: what each event took, less what came back.
SELECT COALESCE(i.invoice_number, i.quotation_number, 'no invoice') AS invoice,
       COALESCE(m.event_name, i.event_name, i.customer_name) AS event,
       round(sum(-m.quantity_change * COALESCE(m.unit_cost, 0)), 2) AS food_cost,
       i.total_amount AS invoiced
  FROM public.inventory_movements m
  LEFT JOIN public.invoices i ON i.id = m.event_invoice_id
 WHERE m.route IN ('event', 'event_return')
 GROUP BY 1, 2, i.total_amount
 ORDER BY 3 DESC;

-- 3. Waste, by reason.
SELECT m.reason, count(*) AS entries,
       round(sum(-m.quantity_change * COALESCE(m.unit_cost, 0)), 2) AS value
  FROM public.inventory_movements m
 WHERE m.route = 'waste'
 GROUP BY m.reason
 ORDER BY 3 DESC;

-- 4. Every count with what it found. For an approved count, `posted` must
--    equal `differed`: one count-difference movement per item that differed.
SELECT c.count_number, c.count_date, c.kind, c.status,
       count(l.*) AS counted,
       count(l.*) FILTER (WHERE l.difference <> 0) AS differed,
       round(sum(l.difference * l.unit_cost) FILTER (WHERE l.difference < 0), 2) AS short_value,
       round(sum(l.difference * l.unit_cost) FILTER (WHERE l.difference > 0), 2) AS over_value,
       (SELECT count(DISTINCT m.reference_id) FROM public.inventory_movements m
         WHERE m.reference_type = 'stock_count'
           AND m.reference_id IN (SELECT id FROM public.stock_count_lines WHERE count_id = c.id)) AS posted
  FROM public.stock_counts c
  JOIN public.stock_count_lines l ON l.count_id = c.id
 GROUP BY c.id
 ORDER BY c.submitted_at DESC;

-- 5. Count differences with their reasons, largest first.
SELECT c.count_number, c.count_date, l.item_name, l.expected_qty, l.counted_qty, l.difference, l.stock_unit,
       round(l.difference * l.unit_cost, 2) AS value, l.reason
  FROM public.stock_count_lines l
  JOIN public.stock_counts c ON c.id = l.count_id
 WHERE c.status = 'approved' AND l.difference <> 0
 ORDER BY abs(l.difference * l.unit_cost) DESC;

-- 6. Corrections made outside a count, with who made them and why.
SELECT m.occurred_on, pr.name, m.quantity_change, m.stock_unit,
       round(abs(m.quantity_change) * COALESCE(m.unit_cost, 0), 2) AS value,
       COALESCE(m.reason, m.note) AS reason, p.full_name AS recorded_by
  FROM public.inventory_movements m
  JOIN public.products pr ON pr.id = m.product_id
  LEFT JOIN public.profiles p ON p.user_id = m.created_by
 WHERE m.route = 'correction'
 ORDER BY m.created_at DESC;

-- 7. Plain "Used" entries recorded after the routes went live: these came
--    through an old screen and say nothing about where the stock went.
SELECT m.occurred_on, pr.name, m.quantity_change, m.note
  FROM public.inventory_movements m
  JOIN public.products pr ON pr.id = m.product_id
 WHERE m.route = 'usage'
 ORDER BY m.created_at DESC;
