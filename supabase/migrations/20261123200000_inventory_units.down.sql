-- Down for 20261123200000_inventory_units.sql
--
-- The replaced functions (fn_normalise_unit, record_stock_movements,
-- fn_restock_receipt_item, fn_inventory_negative_guard) are supersets of the
-- versions before them: with no unit on a line and no pack size on an item
-- they behave as they did. They are left in place; re-run
-- 20261027120000_inventory_access.sql and 20261117100000_finance_single_source.sql
-- sections 9 to restore the exact earlier text if needed.
--
-- Columns and the record of unit changes are kept: dropping them would lose
-- what people typed. Unit changes already made are NOT undone.

BEGIN;

DROP TRIGGER IF EXISTS trg_b_product_unit_rules ON public.products;
DROP TRIGGER IF EXISTS trg_product_unit_removed ON public.product_units;
DROP TRIGGER IF EXISTS trg_stamp_movement_unit  ON public.inventory_movements;

DROP FUNCTION IF EXISTS public.fn_product_unit_rules();
DROP FUNCTION IF EXISTS public.fn_product_unit_removed();
DROP FUNCTION IF EXISTS public.fn_stamp_movement_unit();
DROP FUNCTION IF EXISTS public.fn_change_stock_unit(uuid, text, numeric, text);
DROP FUNCTION IF EXISTS public.fn_mark_opening_count(text);

COMMIT;
