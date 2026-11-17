-- Down for 20261117100000_finance_single_source.
--
-- Removes the new rules and functions and switches stock postings back on
-- (perpetual inventory). It does NOT undo data changes: the dated reversals of
-- stock-cost entries, the GRN expenses/payables created by the backfill, the
-- category list, merged payees and normalised units stay as they are — reverse
-- those by hand if ever needed. fn_clean_text keeps its fix (the old version
-- deleted every space).
BEGIN;

UPDATE public.inventory_settings SET perpetual_inventory_ledger = true;

DROP TRIGGER IF EXISTS trg_grn_expense                    ON public.lpo_receipt_items;
DROP TRIGGER IF EXISTS trg_expense_rules                  ON public.expenses;
DROP TRIGGER IF EXISTS trg_expense_line_category_rules    ON public.expense_line;
DROP TRIGGER IF EXISTS trg_lpo_supplier_rules             ON public.lpos;
DROP TRIGGER IF EXISTS trg_z_lpo_item_unit_rules          ON public.lpo_items;
DROP TRIGGER IF EXISTS trg_a_product_normalise            ON public.products;
DROP TRIGGER IF EXISTS trg_a_sku_normalise                ON public.skus;
DROP TRIGGER IF EXISTS trg_invoice_customer_rules         ON public.invoices;
DROP TRIGGER IF EXISTS trg_guard_duplicate_sale_payment   ON public.payments;
DROP TRIGGER IF EXISTS trg_guard_duplicate_invoice_payment ON public.invoice_payments;

DROP FUNCTION IF EXISTS public.trg_grn_expense();
DROP FUNCTION IF EXISTS public.fn_grn_expense(uuid);
DROP FUNCTION IF EXISTS public.fn_expense_rules();
DROP FUNCTION IF EXISTS public.fn_expense_line_category_rules();
DROP FUNCTION IF EXISTS public.fn_lpo_supplier_rules();
DROP FUNCTION IF EXISTS public.fn_lpo_item_unit_rules();
DROP FUNCTION IF EXISTS public.fn_product_normalise();
DROP FUNCTION IF EXISTS public.fn_sku_normalise();
DROP FUNCTION IF EXISTS public.fn_invoice_customer_rules();
DROP FUNCTION IF EXISTS public.fn_guard_duplicate_sale_payment();
DROP FUNCTION IF EXISTS public.fn_guard_duplicate_invoice_payment();
DROP FUNCTION IF EXISTS public.fn_profit_and_loss(date, date);
DROP FUNCTION IF EXISTS public.fn_cash_collected(date, date);
DROP FUNCTION IF EXISTS public.fn_inventory_ledger_check();
DROP FUNCTION IF EXISTS public.fn_sync_inventory_ledger(date, text);
DROP FUNCTION IF EXISTS public.fn_close_year(integer);
DROP FUNCTION IF EXISTS public.fn_find_duplicate_expenses(bigint, date, uuid);

COMMIT;
