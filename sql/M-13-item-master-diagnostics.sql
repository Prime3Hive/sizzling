-- ═════════════════════════════════════════════════════════════════════════════
-- M-13 — Inventory redesign, stage 1 (item master): checks and work lists
--
-- READ-ONLY. Run each block separately in the Supabase SQL editor AFTER
-- migration 20261124100000_item_master.sql. Nothing here writes.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. The item page fix: `inventory` should have ONE foreign key to products
--    and ONE to warehouses. Two of either is what made the item page fail.
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid = 'public.inventory'::regclass AND contype = 'f'
 ORDER BY conname;

-- 2. The owner's work list: every active item with what is still to be set.
--    Fill these in under Inventory → "Needs setup" → Edit item.
SELECT s.name, s.category, pr.item_kind AS type, pr.uom AS stock_unit, pr.purchase_unit,
       pr.storage_place, py.name AS usual_supplier, s.reorder_level AS minimum_level,
       pr.counted_weekly, s.stock_quantity AS on_hand
  FROM public.skus s
  JOIN public.products pr ON pr.sku_id = s.id
  LEFT JOIN public.payees py ON py.id = pr.default_payee_id
 WHERE NOT COALESCE(s.is_archived, false)
 ORDER BY (pr.item_kind IS NOT NULL), (pr.storage_place IS NOT NULL), s.category, s.name;

-- 3. Minimum levels left wrong by the unit change of 23 November (Chicken
--    Wings saved as 400 kg instead of 20 kg): the item's level and its stock
--    rows disagree. Correct these under Inventory → More → Minimum levels.
--    Nothing is corrected automatically.
SELECT s.name, s.unit_of_measure, s.reorder_level AS level_on_item,
       max(i.reorder_level) AS level_on_stock_rows
  FROM public.skus s
  JOIN public.products pr ON pr.sku_id = s.id
  JOIN public.inventory i ON i.product_id = pr.id
 GROUP BY s.id, s.name, s.unit_of_measure, s.reorder_level
HAVING s.reorder_level IS DISTINCT FROM max(i.reorder_level)
 ORDER BY s.name;

-- 4. Items still on the old blanket level of 10.
SELECT s.name, s.unit_of_measure, s.stock_quantity, s.reorder_level
  FROM public.skus s
 WHERE NOT COALESCE(s.is_archived, false) AND s.reorder_level = 10
 ORDER BY s.name;

-- 5. Names used by more than one item. New items can no longer share a name;
--    these older ones are left for the owner to merge or rename.
SELECT lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) AS name_key,
       count(*) AS items, string_agg(name, ' | ' ORDER BY created_at) AS names
  FROM public.products
 GROUP BY 1 HAVING count(*) > 1
 ORDER BY 2 DESC, 1;

-- 6. Archived items that still show stock (archiving is now blocked while
--    stock is on hand; these were archived before the rule).
SELECT s.name, s.stock_quantity, s.unit_of_measure
  FROM public.skus s
 WHERE COALESCE(s.is_archived, false) AND COALESCE(s.stock_quantity, 0) <> 0;

-- 7. Birthday notifications written more than once for the same person on the
--    same day (one was being created on every page load).
SELECT n.user_id, (n.created_at AT TIME ZONE 'Africa/Lagos')::date AS day, count(*) AS copies
  FROM public.notifications n
 WHERE n.type = 'birthday'
 GROUP BY 1, 2 HAVING count(*) > 1
 ORDER BY 2 DESC, 3 DESC;
