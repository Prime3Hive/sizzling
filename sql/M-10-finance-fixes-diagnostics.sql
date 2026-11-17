-- ═════════════════════════════════════════════════════════════════════════════
-- M-10 — Finance & inventory fixes: diagnostics for the data clean-up
--
-- READ-ONLY. Run each block separately in the Supabase SQL editor AFTER
-- migration 20261117100000_finance_single_source.sql. Nothing here writes.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. The one P&L, 2026 by month (Finance overview, P&L page and /business/finance
--    all show these numbers). TOTAL row must satisfy
--    gross_profit − opex − payroll − commission = net_profit.
SELECT * FROM public.fn_profit_and_loss('2026-01-01', '2026-12-31');

SELECT sum(revenue) revenue, sum(cogs) cogs, sum(gross_profit) gross_profit,
       sum(opex) opex, sum(payroll) payroll, sum(commission) commission,
       sum(net_profit) net_profit,
       sum(gross_profit) - sum(opex) - sum(payroll) - sum(commission) - sum(net_profit) AS must_be_zero
  FROM public.fn_profit_and_loss('2026-01-01', '2026-12-31');

-- 2. Any month with negative cost of sales, and what drove it.
WITH m AS (SELECT * FROM public.fn_profit_and_loss('2026-01-01', '2026-12-31') WHERE cogs < 0)
SELECT date_trunc('month', je.entry_date)::date AS month, je.source_type, a.code,
       sum(jl.debit - jl.credit) AS net_debit, count(*) AS lines
  FROM public.journal_lines jl
  JOIN public.journal_entries je  ON je.id = jl.entry_id
  JOIN public.chart_of_accounts a ON a.id = jl.account_id
 WHERE a.code BETWEEN '5000' AND '5099'
   AND date_trunc('month', je.entry_date)::date IN (SELECT month FROM m)
 GROUP BY 1, 2, 3 ORDER BY 1, 4;

-- 3. Stock-cost entries the migration could NOT reverse (closed periods).
SELECT je.entry_no, je.entry_date, je.source_type, je.memo
  FROM public.journal_entries je
 WHERE je.reversal_of_id IS NULL AND je.is_reversed = false
   AND public.fn_is_stock_cost_entry(je.source_type, je.source_id)
 ORDER BY je.entry_date;

-- 4. GRN expenses created by the backfill that may duplicate an expense someone
--    already typed in (same amount within ±3 days). Cancel the duplicate.
SELECT g.date AS grn_date, g.amount, g.reference AS grn, g.payee_name AS supplier,
       d.id AS possible_duplicate_id, d.date, d.description, d.source
  FROM public.expenses g
  JOIN public.expenses d
    ON d.amount_minor = g.amount_minor AND d.id <> g.id
   AND d.date BETWEEN g.date - 3 AND g.date + 3
   AND d.cancelled_at IS NULL AND d.grn_id IS NULL
 WHERE g.source = 'grn' AND g.cancelled_at IS NULL
 ORDER BY g.date;

-- 5. Credit purchases counted twice: a 'settlement' expense next to the
--    original credit-purchase expense for the same payable.
SELECT p.id AS payable_id, p.supplier, p.amount, p.incurred_date,
       e.id AS expense_id, e.source, e.description, e.date
  FROM public.payables p
  JOIN public.expenses e
    ON e.amount_minor = p.amount_minor
   AND e.date BETWEEN p.incurred_date - 3 AND p.incurred_date + 3
   AND e.cancelled_at IS NULL
 WHERE p.id IN (
   SELECT p2.id FROM public.payables p2
     JOIN public.expenses e2 ON e2.amount_minor = p2.amount_minor
      AND e2.date BETWEEN p2.incurred_date - 3 AND p2.incurred_date + 3
      AND e2.cancelled_at IS NULL
    GROUP BY p2.id HAVING count(*) > 1)
 ORDER BY p.incurred_date, p.id;

-- 6. Possible duplicate expenses (same amount within ±3 days).
SELECT a.date, a.amount, a.description, a.id AS id_a,
       b.date AS date_b, b.description AS description_b, b.id AS id_b
  FROM public.expenses a
  JOIN public.expenses b
    ON b.amount_minor = a.amount_minor AND b.id > a.id
   AND b.date BETWEEN a.date - 3 AND a.date + 3
   AND b.cancelled_at IS NULL
 WHERE a.cancelled_at IS NULL AND a.amount_minor >= 5000000   -- ₦50,000 and above
 ORDER BY a.amount DESC;

-- 7. Expenses on a category that is not on the approved list (clean-up list),
--    with a suggested category.
SELECT e.category, public.fn_guess_expense_category(e.category || ' ' || e.description) AS suggested,
       count(*) AS rows, sum(e.amount) AS amount
  FROM public.expenses e
  LEFT JOIN public.expense_categories c ON c.name = e.category AND c.is_active
 WHERE c.id IS NULL AND e.cancelled_at IS NULL
 GROUP BY 1, 2 ORDER BY 4 DESC;

-- 8. Salary expenses vs payroll (Jan–Feb ₦5,333,300 double-count check).
SELECT to_char(e.date, 'YYYY-MM') AS month, sum(e.amount) AS salary_expenses,
       (SELECT sum(COALESCE(p.basic_salary, p.net_pay) + COALESCE(p.allowances, 0))
          FROM public.payroll_records p
         WHERE p.status = 'paid' AND to_char(p.period_start, 'YYYY-MM') = to_char(e.date, 'YYYY-MM')) AS payroll_gross
  FROM public.expenses e
 WHERE e.cancelled_at IS NULL AND (e.category ILIKE '%salar%' OR e.category ILIKE '%wage%')
 GROUP BY 1 ORDER BY 1;

-- 9. Descriptions saved with their spaces stripped (the fn_clean_text bug).
SELECT id, date, amount, description FROM public.expenses
 WHERE length(description) > 25 AND description !~ '\s' AND cancelled_at IS NULL
 ORDER BY date;

-- 10. Receivables: ledger 1100 vs invoices outstanding, and where AR came from.
SELECT
  (SELECT sum(jl.debit - jl.credit) FROM public.journal_lines jl
     JOIN public.chart_of_accounts a ON a.id = jl.account_id WHERE a.code = '1100') AS ledger_ar,
  (SELECT sum(total_amount - amount_paid) FROM public.invoices
    WHERE status = 'invoice' AND payment_status IN ('unpaid', 'partial')) AS invoices_outstanding;

SELECT je.source_type, sum(jl.debit - jl.credit) AS ar_movement, count(*) AS lines
  FROM public.journal_lines jl
  JOIN public.journal_entries je  ON je.id = jl.entry_id
  JOIN public.chart_of_accounts a ON a.id = jl.account_id
 WHERE a.code = '1100'
 GROUP BY 1 ORDER BY 2 DESC;

-- Invoices marked paid with no (or too little) payment behind them.
SELECT i.invoice_number, i.customer_name, i.total_amount, i.amount_paid, i.payment_status,
       COALESCE(sum(ip.amount + COALESCE(ip.wht_amount, 0)), 0) AS payments_recorded
  FROM public.invoices i
  LEFT JOIN public.invoice_payments ip ON ip.invoice_id = i.id
 WHERE i.status = 'invoice'
 GROUP BY i.id
HAVING i.amount_paid > COALESCE(sum(ip.amount + COALESCE(ip.wht_amount, 0)), 0) + 0.01
 ORDER BY i.issue_date;

-- Sales still sitting in AR (credit/unpaid sales with no payment rows).
SELECT s.sale_number, s.sale_date, s.total_amount, s.status, s.customer_name
  FROM public.sales s
 WHERE s.status <> 'cancelled'
   AND EXISTS (SELECT 1 FROM public.journal_entries je JOIN public.journal_lines jl ON jl.entry_id = je.id
                JOIN public.chart_of_accounts a ON a.id = jl.account_id
               WHERE je.source_type = 'sale' AND je.source_id = s.id AND je.is_reversed = false
                 AND je.reversal_of_id IS NULL AND a.code = '1100')
   AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.sale_id = s.id AND p.status = 'completed')
 ORDER BY s.sale_date;

-- 11. Duplicate payments already recorded (same sale, amount, day).
SELECT s.sale_number, p.amount, p.payment_date::date, count(*) AS times, array_agg(p.id) AS payment_ids
  FROM public.payments p JOIN public.sales s ON s.id = p.sale_id
 GROUP BY 1, 2, 3 HAVING count(*) > 1;

-- 12. Cash vs Bank: where each came from.
SELECT a.code, je.source_type, sum(jl.debit - jl.credit) AS net
  FROM public.journal_lines jl
  JOIN public.journal_entries je  ON je.id = jl.entry_id
  JOIN public.chart_of_accounts a ON a.id = jl.account_id
 WHERE a.code IN ('1000', '1010')
 GROUP BY 1, 2 ORDER BY 1, 3 DESC;

-- Sales takings still in Cash with no recorded method (decide: cash or banked?).
SELECT to_char(sale_date, 'YYYY-MM') AS month, count(*) AS sales, sum(total_amount) AS amount
  FROM public.sales WHERE payment_method IS NULL AND status = 'completed'
 GROUP BY 1 ORDER BY 1;

-- 13. Inventory page value vs ledger.
SELECT * FROM public.fn_inventory_ledger_check();

-- Items with negative stock.
SELECT name, stock_quantity, unit_of_measure FROM public.skus WHERE stock_quantity < 0 ORDER BY stock_quantity;

-- Units / categories that are still outside the fixed lists.
SELECT 'unit' AS field, unit_of_measure AS value, count(*) FROM public.skus
 WHERE unit_of_measure NOT IN ('kg', 'litre', 'piece', 'pack', 'bag', 'carton') GROUP BY 2
UNION ALL
SELECT 'category', category, count(*) FROM public.skus
 WHERE category NOT IN ('Proteins', 'Fresh Produce', 'Dry Goods & Seasonings', 'Packaging & Disposables',
                        'Cooking Fuel', 'Cleaning & Hygiene', 'Finished Goods') GROUP BY 2
ORDER BY 1, 3 DESC;

-- 14. Accounts payable: what is still owed and to whom.
SELECT supplier, count(*), sum(amount) FROM public.payables WHERE status = 'unpaid' GROUP BY 1 ORDER BY 3 DESC;
SELECT sum(jl.credit - jl.debit) AS ledger_ap FROM public.journal_lines jl
  JOIN public.chart_of_accounts a ON a.id = jl.account_id WHERE a.code = '2000';

-- 15. LPO suppliers that are not real suppliers, and drafts older than 7 days.
SELECT lpo_number, supplier_name, status, order_date FROM public.lpos
 WHERE lower(supplier_name) IN ('requisition', 'sizzling spices', 'sizzling')
    OR (status = 'draft' AND created_at < now() - interval '7 days')
 ORDER BY order_date;
