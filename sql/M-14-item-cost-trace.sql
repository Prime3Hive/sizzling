-- ═════════════════════════════════════════════════════════════════════════════
-- M-14 — Why did an item's cost change? (fix list of 24 November 2026)
--
-- READ-ONLY. Run each block separately in the Supabase SQL editor. Nothing
-- here writes. Change the name in each block to trace another item.
--
-- An item's cost per stock unit changes in exactly three ways:
--   a. stock comes in with a price: the cost becomes the average of what was
--      on hand and what arrived (block 2);
--   b. somebody types a new cost on the item form (block 3);
--   c. the stock unit is changed: the cost is divided by the factor (block 4).
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. The item as it stands.
SELECT pr.id AS product_id, s.name, pr.uom AS stock_unit, pr.purchase_unit,
       pr.cost_price, s.cost_per_unit, s.stock_quantity AS on_hand,
       (SELECT string_agg('1 ' || u.unit_name || ' = ' || u.factor || ' ' || pr.uom, ' · ')
          FROM public.product_units u WHERE u.product_id = pr.id) AS pack_sizes
  FROM public.skus s
  JOIN public.products pr ON pr.sku_id = s.id
 WHERE s.name ILIKE 'chicken breast%';

-- 2. Every movement since 20 November, oldest first, with the balance before
--    and after it. A stock-in row with a unit_cost is what moves the average:
--    look for one whose unit_cost is far from 6,700, or whose quantity is far
--    larger than what was really delivered (a price or quantity typed for the
--    wrong unit: per bag instead of per kg, grams instead of kg).
WITH mv AS (
  SELECT m.*, sum(m.quantity_change) OVER (PARTITION BY m.product_id ORDER BY m.created_at, m.id) AS running
    FROM public.inventory_movements m
    JOIN public.products pr ON pr.id = m.product_id
    JOIN public.skus s ON s.id = pr.sku_id
   WHERE s.name ILIKE 'chicken breast%'
), base AS (
  -- Today's balance less everything recorded, so "running" lines up with it.
  SELECT (SELECT COALESCE(sum(i.quantity), 0) FROM public.inventory i
           WHERE i.product_id = (SELECT product_id FROM mv LIMIT 1))
       - COALESCE((SELECT sum(quantity_change) FROM mv), 0) AS opening
)
SELECT mv.created_at, mv.occurred_on, mv.movement_type, mv.reference_type,
       mv.entered_qty, mv.entered_unit, mv.quantity_change AS stock_qty, mv.stock_unit,
       mv.unit_cost,
       round(mv.quantity_change * mv.unit_cost, 2)        AS line_value,
       base.opening + mv.running - mv.quantity_change    AS on_hand_before,
       base.opening + mv.running                         AS on_hand_after,
       mv.note,
       (SELECT full_name FROM public.profiles p WHERE p.user_id = mv.created_by) AS recorded_by,
       mv.id, mv.reference_id
  FROM mv, base
 WHERE mv.created_at >= DATE '2026-11-20'
 ORDER BY mv.created_at, mv.id;

-- 3. A cost typed on the item form. Each one posts a "Stock revaluation" entry
--    that names the item and shows old → new (only when stock was on hand).
SELECT e.created_at, e.entry_date, e.memo,
       (SELECT full_name FROM public.profiles p WHERE p.user_id = e.created_by) AS by
  FROM public.journal_entries e
 WHERE e.source_type = 'stock_revaluation'
   AND e.memo ILIKE '%chicken breast%'
   AND e.created_at >= DATE '2026-11-20'
 ORDER BY e.created_at;

-- 4. A change of stock unit: the cost is divided by "factor".
SELECT c.changed_at, c.kind, c.old_unit, c.new_unit, c.factor, c.note,
       (SELECT full_name FROM public.profiles p WHERE p.user_id = c.changed_by) AS by
  FROM public.product_unit_changes c
  JOIN public.products pr ON pr.id = c.product_id
  JOIN public.skus s ON s.id = pr.sku_id
 WHERE s.name ILIKE 'chicken breast%'
 ORDER BY c.changed_at;
