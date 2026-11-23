-- ═════════════════════════════════════════════════════════════════════════════
-- M-12 — Inventory and units fix list (23 November 2026): checks and work lists
--
-- READ-ONLY. Run each block separately in the Supabase SQL editor AFTER
-- migration 20261123200000_inventory_units.sql. Nothing here writes.
--
-- Blocks 1–3 check the fix. Blocks 4–10 are the lists the owner works through:
-- the migration itself changes no quantity, cost, unit or movement.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. The work sheet for migration step 3: every item with its stock unit, pack
--    sizes and purchase unit. Fill these in under Inventory → Edit item.
SELECT s.name, s.category, pr.uom AS stock_unit, pr.purchase_unit,
       (SELECT string_agg('1 ' || u.unit_name || ' = ' || trim(to_char(u.factor, 'FM999999990.####')) || ' ' || pr.uom, ' · ' ORDER BY u.factor DESC)
          FROM public.product_units u WHERE u.product_id = pr.id) AS pack_sizes,
       s.stock_quantity AS on_hand, s.reorder_level, s.cost_per_unit,
       (SELECT count(*) FROM public.inventory_movements m WHERE m.product_id = pr.id) AS movements
  FROM public.skus s
  JOIN public.products pr ON pr.sku_id = s.id
 WHERE NOT COALESCE(s.is_archived, false)
 ORDER BY s.category, s.name;

-- 2. Acceptance checks 1–3 on real data: movements recorded in a purchase
--    unit, with what was typed, what reached stock and the cost per stock unit.
SELECT m.occurred_on, pr.name, m.movement_type,
       m.entered_qty, m.entered_unit, m.quantity_change AS stock_qty, m.stock_unit,
       m.unit_cost AS cost_per_stock_unit,
       round(abs(m.quantity_change) * COALESCE(m.unit_cost, 0), 2) AS value
  FROM public.inventory_movements m
  JOIN public.products pr ON pr.id = m.product_id
 WHERE m.entered_unit IS NOT NULL
 ORDER BY m.created_at DESC
 LIMIT 100;

-- 3. Fix 3.3 — how stock reaches the accounts today. Expect
--    perpetual_inventory_ledger = false (purchases are costed by their
--    expense; stock movements post nothing), and no LIVE journal entry from a
--    stock movement other than opening stock. Any row in the second query is a
--    stock-in or usage still moving cost in the ledger.
SELECT perpetual_inventory_ledger, allow_negative_stock FROM public.inventory_settings;

SELECT je.entry_date, je.source_type, je.memo, sum(jl.debit) AS amount
  FROM public.journal_entries je
  JOIN public.journal_lines jl ON jl.entry_id = je.id
 WHERE je.is_reversed = false AND je.reversal_of_id IS NULL
   AND public.fn_is_stock_cost_entry(je.source_type, je.source_id)
 GROUP BY je.id, je.entry_date, je.source_type, je.memo
 ORDER BY je.entry_date DESC
 LIMIT 100;

--    Cost of goods by month from the one profit function. It should not be
--    negative; a month that is shows up here with what posted to it.
SELECT month, cogs, opex FROM public.fn_profit_and_loss('2026-01-01', '2026-12-31') WHERE cogs < 0;

--    Stock value on the page against the ledger (difference is cleared by the
--    "match ledger to stock" posting after the opening count).
SELECT * FROM public.fn_inventory_ledger_check();

-- 4. Unit mismatches — usage far above the largest delivery on record for the
--    item (160 "bags" of chicken breast, 330 kg of gas, 196 "pieces" of fuel).
WITH biggest AS (
  SELECT product_id, max(quantity_change) AS largest_in
    FROM public.inventory_movements
   WHERE movement_type = 'purchase' AND quantity_change > 0
   GROUP BY product_id
)
SELECT m.occurred_on, pr.name, pr.uom, -m.quantity_change AS used, b.largest_in, m.note, m.id
  FROM public.inventory_movements m
  JOIN public.products pr ON pr.id = m.product_id
  LEFT JOIN biggest b ON b.product_id = m.product_id
 WHERE m.movement_type = 'usage' AND m.quantity_change < 0
   AND -m.quantity_change > COALESCE(b.largest_in, 0)
 ORDER BY -m.quantity_change DESC;

-- 5. Items stocked in a unit that is probably a container, received one or two
--    at a time (ONION, FRESH PEPPER, TATTASHE, SHOMBO as "+1 piece").
SELECT pr.name, pr.uom, count(*) AS receipts, max(m.quantity_change) AS largest, round(avg(m.unit_cost), 2) AS avg_cost_per_unit
  FROM public.inventory_movements m
  JOIN public.products pr ON pr.id = m.product_id
 WHERE m.movement_type = 'purchase' AND m.quantity_change > 0
   AND pr.uom IN ('piece', 'pack', 'bag', 'carton')
 GROUP BY pr.name, pr.uom
HAVING max(m.quantity_change) <= 2
 ORDER BY pr.name;

-- 6. Clean-up — items below zero (GAS, PRAWNS, KIDNEY PROTEIN, CROACKER FISH).
--    Corrected by the opening count, not by editing the balance.
SELECT name, stock_quantity, unit_of_measure FROM public.skus
 WHERE stock_quantity < 0 AND NOT COALESCE(is_archived, false) ORDER BY stock_quantity;

-- 7. Clean-up — likely duplicate items: names that share a word (PRAWNS /
--    PUD PRAWNS / JUMBO PRAWNS; CHICKEN / Chicken Breast / CHICKEN WINGS), and
--    catch-all items. The owner decides which to keep; merging is not automatic.
WITH w AS (
  SELECT s.id, s.name, s.unit_of_measure, s.stock_quantity,
         regexp_split_to_table(lower(regexp_replace(s.name, '[^A-Za-z ]', ' ', 'g')), '\s+') AS word
    FROM public.skus s WHERE NOT COALESCE(s.is_archived, false)
)
SELECT word, count(*) AS items,
       string_agg(name || ' (' || trim(to_char(stock_quantity, 'FM999999990.##')) || ' ' || unit_of_measure || ')', ' · ' ORDER BY name) AS which
  FROM w
 WHERE length(word) > 3 AND word NOT IN ('fresh', 'fish', 'with', 'regular')
 GROUP BY word HAVING count(*) > 1
 ORDER BY count(*) DESC, word;

SELECT name, stock_quantity, unit_of_measure,
       (SELECT count(*) FROM public.products pr JOIN public.inventory_movements m ON m.product_id = pr.id WHERE pr.sku_id = s.id) AS movements
  FROM public.skus s
 WHERE lower(name) ~ '(misc|miscellaneous|other|sundry|general)' AND NOT COALESCE(is_archived, false);

-- 8. Fix 2.8 — why an item page could say "no stock movements": an item
--    linked to more than one product, or movements on a product the item is
--    not linked to. (The page now reads every linked product.)
SELECT s.name, count(pr.id) AS linked_products, array_agg(pr.id) AS product_ids
  FROM public.skus s JOIN public.products pr ON pr.sku_id = s.id
 GROUP BY s.id, s.name HAVING count(pr.id) > 1;

SELECT pr.name, pr.id AS product_id, pr.sku_id, count(m.id) AS movements
  FROM public.products pr JOIN public.inventory_movements m ON m.product_id = pr.id
 WHERE pr.sku_id IS NULL
 GROUP BY pr.id, pr.name, pr.sku_id;

-- 9. Clean-up — purchases of stock items entered as expenses that have not
--    been received into stock (the 7 November batch: prawns, teriyaki, Titus
--    fish, charcoal, plantain). Use "Receive into stock" on each in Expenses.
SELECT e.date, e.category, e.amount_minor / 100.0 AS amount, e.payee_name, left(e.description, 80) AS description,
       e.reference, e.id
  FROM public.expenses e
 WHERE e.cancelled_at IS NULL AND COALESCE(e.status, 'approved') <> 'rejected'
   AND e.grn_id IS NULL
   AND e.category IN ('Proteins', 'Fresh Produce', 'Dry Goods & Seasonings', 'Packaging & Disposables', 'Cooking Fuel')
   AND NOT EXISTS (SELECT 1 FROM public.inventory_movements m
                    WHERE m.reference_type = 'expense' AND m.reference_id = e.id)
   AND e.date >= '2026-11-01'
 ORDER BY e.date, e.amount_minor DESC;

-- 10. How often usage is recorded: entries and distinct days per month, and
--     the days since the last one (the dashboard warns at 7).
SELECT date_trunc('month', occurred_on)::date AS month,
       count(*) FILTER (WHERE movement_type = 'usage')       AS usage_entries,
       count(DISTINCT occurred_on) FILTER (WHERE movement_type = 'usage') AS days_with_usage,
       count(*) FILTER (WHERE movement_type = 'purchase')    AS stock_ins,
       count(*) FILTER (WHERE movement_type = 'stock_take')  AS count_lines
  FROM public.inventory_movements
 GROUP BY 1 ORDER BY 1;

SELECT current_date - max(occurred_on) AS days_since_last_usage_or_count
  FROM public.inventory_movements
 WHERE movement_type IN ('usage', 'stock_take', 'production_issue');

-- 11. Every reorder level, with its unit (the old default was 10 for everything).
SELECT name, reorder_level, unit_of_measure, stock_quantity
  FROM public.skus WHERE NOT COALESCE(is_archived, false) ORDER BY reorder_level DESC, name;

-- 12. Unit changes and opening counts made so far.
SELECT c.changed_at, pr.name, c.kind, c.old_unit, c.new_unit, c.factor, c.note
  FROM public.product_unit_changes c JOIN public.products pr ON pr.id = c.product_id
 ORDER BY c.changed_at DESC;
