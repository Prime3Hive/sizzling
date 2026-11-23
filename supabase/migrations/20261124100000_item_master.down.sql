-- Down for 20261124100000_item_master.sql
--
-- The rules are removed. The columns (item_kind, storage_place,
-- default_payee_id, counted_weekly, storage_places) are kept: dropping them
-- would lose what the owner set up for each item.
--
-- fn_change_stock_unit is left at the corrected version; re-run section 6 of
-- 20261123200000_inventory_units.sql to restore the earlier text. The
-- duplicate foreign keys on `inventory` are not put back: each was an exact
-- copy of the one that remains.

BEGIN;

DROP TRIGGER IF EXISTS trg_c_product_master_rules ON public.products;
DROP TRIGGER IF EXISTS trg_a0_product_name_unique ON public.products;
DROP TRIGGER IF EXISTS trg_sku_archive_guard      ON public.skus;

DROP FUNCTION IF EXISTS public.fn_product_master_rules();
DROP FUNCTION IF EXISTS public.fn_product_name_unique();
DROP FUNCTION IF EXISTS public.fn_sku_archive_guard();

COMMIT;
