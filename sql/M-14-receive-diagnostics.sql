-- ═════════════════════════════════════════════════════════════════════════════
-- M-14 — Inventory redesign, stage 2 (Receive): checks
--
-- READ-ONLY. Run each block separately in the Supabase SQL editor AFTER
-- migration 20261124200000_stock_receipts.sql. Nothing here writes.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Every receipt with its stock and its expenses side by side. For a posted
--    receipt, expenses_total must equal receipt_total; for a reversed one,
--    live_expenses must be 0. Any row in the last column is a fault.
SELECT r.receipt_number, r.received_date, r.supplier_name, r.payment_method, r.status,
       r.total_minor / 100.0 AS receipt_total,
       (SELECT COALESCE(sum(l.amount_minor), 0) FROM public.stock_receipt_lines l WHERE l.receipt_id = r.id) / 100.0 AS lines_total,
       (SELECT COALESCE(sum(e.amount_minor), 0) FROM public.expenses e
         WHERE e.stock_receipt_id = r.id AND e.cancelled_at IS NULL) / 100.0 AS live_expenses,
       CASE
         WHEN r.status = 'posted' AND r.total_minor IS DISTINCT FROM
              (SELECT COALESCE(sum(e.amount_minor), 0) FROM public.expenses e
                WHERE e.stock_receipt_id = r.id AND e.cancelled_at IS NULL) THEN 'expenses do not match'
         WHEN r.status = 'reversed' AND EXISTS (SELECT 1 FROM public.expenses e
                WHERE e.stock_receipt_id = r.id AND e.cancelled_at IS NULL) THEN 'reversed but an expense is live'
       END AS fault
  FROM public.stock_receipts r
 ORDER BY r.received_date DESC, r.created_at DESC;

-- 2. Each stock line against its movement: the quantity received and what
--    reached stock must be the same, and a reversed receipt nets to zero.
SELECT r.receipt_number, r.status, l.description, l.entered_qty, l.entered_unit, l.stock_qty, l.stock_unit,
       (SELECT COALESCE(sum(m.quantity_change), 0) FROM public.inventory_movements m
         WHERE m.reference_type = 'stock_receipt' AND m.reference_id = l.id) AS net_in_stock
  FROM public.stock_receipt_lines l
  JOIN public.stock_receipts r ON r.id = l.receipt_id
 WHERE l.kind = 'stock'
 ORDER BY r.received_date DESC, r.receipt_number, l.line_no;

-- 3. What is owed to each supplier from receipts on credit.
SELECT r.supplier_name, count(*) AS receipts, sum(p.amount_minor) / 100.0 AS owed
  FROM public.stock_receipts r
  JOIN public.payables p ON p.id = r.payable_id
 WHERE r.status = 'posted' AND p.status = 'unpaid'
 GROUP BY r.supplier_name
 ORDER BY owed DESC;

-- 4. Purchases still being recorded the old ways since Receive went live:
--    expenses typed straight into a stock category, and manual stock-ins.
--    Both should stop appearing once everyone uses Receive.
SELECT 'expense in a stock category' AS what, e.date, e.description, e.category, e.amount_minor / 100.0 AS amount
  FROM public.expenses e
 WHERE e.cancelled_at IS NULL AND e.source = 'capture'
   AND e.category IN ('Proteins', 'Fresh Produce', 'Dry Goods & Seasonings', 'Packaging & Disposables', 'Cooking Fuel')
   AND e.created_at >= (SELECT min(created_at) FROM public.stock_receipts)
UNION ALL
SELECT 'manual stock-in', m.occurred_on, pr.name, pr.category, round(m.quantity_change * COALESCE(m.unit_cost, 0), 2)
  FROM public.inventory_movements m
  JOIN public.products pr ON pr.id = m.product_id
 WHERE m.movement_type = 'purchase' AND COALESCE(m.reference_type, 'manual') = 'manual'
   AND m.created_at >= (SELECT min(created_at) FROM public.stock_receipts)
 ORDER BY 2 DESC;
