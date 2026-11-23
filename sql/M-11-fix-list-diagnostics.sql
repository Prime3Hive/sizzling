-- ═════════════════════════════════════════════════════════════════════════════
-- M-11 — Fix list of 23 November 2026: checks and clean-up lists
--
-- READ-ONLY. Run each block separately in the Supabase SQL editor AFTER
-- migration 20261123100000_fix_list_nov23.sql. Nothing here writes.
-- Blocks 1–3 are the Priority 1 acceptance checks. Blocks 4–11 produce the
-- lists the owner has to decide on before any record is changed.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Acceptance checks 2 and 3: every month's revenue is the sum of its parts,
--    and nothing is negative. Both "must_be_zero" columns must be 0 on each row.
SELECT month, sales_daily, sales_event, invoice_daily + invoice_event AS invoice_revenue,
       other_revenue, revenue,
       revenue - (sales_daily + sales_event + invoice_daily + invoice_event + other_revenue) AS must_be_zero,
       cogs, opex, payroll, commission, net_profit,
       net_profit - (revenue - cogs - opex - payroll - commission) AS must_be_zero_too,
       (revenue < 0 OR cogs < 0 OR opex < 0) AS has_negative
  FROM public.fn_profit_and_loss('2026-01-01', '2026-12-31');

-- 2. Acceptance check 5: November 2026 against the source documents.
--    ledger_revenue should equal sales_net + invoices_net; ledger_expenses
--    (cogs + opex) should equal approved_expenses unless a manual journal or a
--    stock count posted to an expense account that month (block 3 shows them).
SELECT
  (SELECT revenue      FROM public.fn_profit_and_loss('2026-11-01', '2026-11-30')) AS ledger_revenue,
  (SELECT COALESCE(sum(total_amount - COALESCE(vat_amount, 0)), 0) FROM public.sales
    WHERE sale_date BETWEEN '2026-11-01' AND '2026-11-30' AND status <> 'cancelled' AND cancelled_at IS NULL) AS sales_net,
  (SELECT COALESCE(sum(total_amount - COALESCE(tax_amount, 0)), 0) FROM public.invoices
    WHERE issue_date BETWEEN '2026-11-01' AND '2026-11-30' AND status = 'invoice') AS invoices_net,
  (SELECT cogs + opex  FROM public.fn_profit_and_loss('2026-11-01', '2026-11-30')) AS ledger_expenses,
  (SELECT COALESCE(sum(amount_minor), 0) / 100.0 FROM public.expenses
    WHERE date BETWEEN '2026-11-01' AND '2026-11-30' AND status = 'approved' AND cancelled_at IS NULL) AS approved_expenses;

-- 3. Anything in the P&L for a month that is not a sale, an invoice, an expense,
--    payroll or commission (manual journals, stock counts, remittances).
SELECT date_trunc('month', je.entry_date)::date AS month, je.source_type, a.code, a.name,
       sum(jl.credit - jl.debit) AS net_credit, count(DISTINCT je.id) AS entries
  FROM public.journal_lines jl
  JOIN public.journal_entries je  ON je.id = jl.entry_id
  JOIN public.chart_of_accounts a ON a.id = jl.account_id
 WHERE je.entry_date BETWEEN '2026-01-01' AND '2026-12-31'
   AND a.type IN ('income', 'expense')
   AND je.is_reversed = false AND je.reversal_of_id IS NULL
   AND je.source_type NOT IN ('sale', 'invoice', 'expense', 'payroll', 'commission', 'year_close')
 GROUP BY 1, 2, 3, 4 ORDER BY 1, 2;

-- 4. Clean-up task 1 — what was behind the −₦59.5m and −₦8.3m in November and
--    the negative costs in August: reversals dated in a different month from
--    the entry they cancel. Listed by the month they landed in. (The P&L now
--    ignores these pairs; the rows themselves are untouched.)
SELECT date_trunc('month', r.entry_date)::date AS landed_in,
       date_trunc('month', o.entry_date)::date AS belongs_to,
       r.source_type, a.type AS account_type,
       sum(jl.credit - jl.debit) AS net_credit_in_landed_month,
       count(DISTINCT r.id) AS reversals, min(r.created_at)::date AS first_made, max(r.created_at)::date AS last_made
  FROM public.journal_entries r
  JOIN public.journal_entries o   ON o.id = r.reversal_of_id
  JOIN public.journal_lines jl    ON jl.entry_id = r.id
  JOIN public.chart_of_accounts a ON a.id = jl.account_id
 WHERE a.type IN ('income', 'expense')
   AND date_trunc('month', r.entry_date) <> date_trunc('month', o.entry_date)
 GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3;

-- 5. Clean-up task 2a — suspected duplicate expenses: same date and amount.
SELECT e.date, e.amount_minor / 100.0 AS amount, count(*) AS times,
       string_agg(COALESCE(e.reference, '—') || ' · ' || COALESCE(e.payee_name, '') || ' · ' || left(e.description, 60),
                  E'\n' ORDER BY e.created_at) AS entries,
       array_agg(e.id ORDER BY e.created_at) AS ids
  FROM public.expenses e
 WHERE e.cancelled_at IS NULL AND COALESCE(e.status, 'approved') <> 'rejected'
 GROUP BY e.date, e.amount_minor HAVING count(*) > 1
 ORDER BY e.amount_minor DESC;

-- 5b. Near-duplicates: same date, amounts within ₦5,000 of each other and above
--     ₦100,000 (the ₦849,149 / ₦846,149 pair on 17 July).
SELECT a.date, a.amount_minor / 100.0 AS amount_a, b.amount_minor / 100.0 AS amount_b,
       left(a.description, 60) AS description_a, left(b.description, 60) AS description_b, a.id AS id_a, b.id AS id_b
  FROM public.expenses a
  JOIN public.expenses b ON b.date = a.date AND b.id > a.id
   AND b.amount_minor <> a.amount_minor
   AND abs(b.amount_minor - a.amount_minor) <= 500000
 WHERE a.amount_minor >= 10000000
   AND a.cancelled_at IS NULL AND b.cancelled_at IS NULL
 ORDER BY a.date;

-- 6. Clean-up task 2b — credit bought and then "settled" as a second expense:
--    the same amount again within 14 days where either line mentions credit.
SELECT a.date AS bought, b.date AS settled, a.amount_minor / 100.0 AS amount,
       a.payment_method AS method_a, b.payment_method AS method_b, b.source AS source_b,
       left(a.description, 60) AS description_a, left(b.description, 60) AS description_b, a.id AS id_a, b.id AS id_b
  FROM public.expenses a
  JOIN public.expenses b ON b.amount_minor = a.amount_minor
   AND b.date > a.date AND b.date <= a.date + 14
 WHERE a.cancelled_at IS NULL AND b.cancelled_at IS NULL
   AND (lower(COALESCE(a.payment_method, '')) = 'credit'
        OR b.source = 'settlement'
        OR a.description ~* 'credit' OR b.description ~* '(credit|settle)')
 ORDER BY a.date;

-- 7. Clean-up task 3 — payments recorded twice against one sale.
SELECT s.sale_number, p.amount, p.payment_date::date, count(*) AS times, array_agg(p.id ORDER BY p.created_at) AS ids
  FROM public.payments p JOIN public.sales s ON s.id = p.sale_id
 WHERE COALESCE(p.status, '') <> 'failed'
 GROUP BY 1, 2, 3 HAVING count(*) > 1;

-- 8. Clean-up task 4 — expenses that share one receipt file (a placeholder
--    image attached to many rows), and the 7 November batch by reference.
SELECT receipt_path, count(*) AS expenses, min(date) AS first_date, max(date) AS last_date,
       sum(amount_minor) / 100.0 AS total
  FROM public.expenses
 WHERE receipt_path IS NOT NULL AND cancelled_at IS NULL
 GROUP BY receipt_path HAVING count(*) > 1 ORDER BY count(*) DESC;

SELECT reference, date, amount_minor / 100.0 AS amount, description, receipt_path
  FROM public.expenses
 WHERE reference LIKE 'NOV-W1-%' AND cancelled_at IS NULL ORDER BY reference;

-- 9. Expenses at or above the receipt threshold with no receipt and no reason.
SELECT e.date, e.amount_minor / 100.0 AS amount, e.payee_name, left(e.description, 70) AS description, e.source, e.id
  FROM public.expenses e, public.expense_settings s
 WHERE e.cancelled_at IS NULL AND e.receipt_path IS NULL AND e.no_receipt_reason IS NULL
   AND e.amount_minor >= s.receipt_threshold_minor
 ORDER BY e.amount_minor DESC;

-- 10. Clean-up tasks 6 and 7 — negative stock, and expenses with no category
--     or a description saved with its spaces stripped.
SELECT name, stock_quantity, unit_of_measure, reorder_level FROM public.skus
 WHERE stock_quantity < 0 AND NOT COALESCE(is_archived, false) ORDER BY stock_quantity;

SELECT date, amount_minor / 100.0 AS amount, category, payee_name, left(description, 80) AS description, id
  FROM public.expenses
 WHERE cancelled_at IS NULL
   AND (COALESCE(btrim(category), '') = ''
        OR (length(description) > 25 AND description !~ '\s'))
 ORDER BY date;

-- 11. Open quotations past their validity, and event documents under "Walk-in".
SELECT quotation_number, customer_name, invoice_type, issue_date, valid_until, total_amount
  FROM public.invoices
 WHERE status = 'quotation'
   AND COALESCE(valid_until, issue_date + 14) < current_date
 ORDER BY issue_date;

SELECT COALESCE(invoice_number, quotation_number) AS document, status, customer_name, customer_phone, total_amount, issue_date
  FROM public.invoices
 WHERE invoice_type = 'event' AND status <> 'cancelled'
   AND (customer_name ~* '^\s*walk[\s-]*in' OR COALESCE(btrim(customer_phone), '') = '')
 ORDER BY total_amount DESC;
