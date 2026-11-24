-- Down for 20261124400000_stock_reports.sql
--
-- The migration added read-only report functions and nothing else, so this
-- removes them and leaves every record as it is.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_inventory_cost_report(date, date);
DROP FUNCTION IF EXISTS public.fn_stock_usage_report(date, date);
DROP FUNCTION IF EXISTS public.fn_waste_report(date, date);
DROP FUNCTION IF EXISTS public.fn_count_difference_report(date, date);
DROP FUNCTION IF EXISTS public.fn_event_food_cost_report(date, date);
DROP FUNCTION IF EXISTS public.fn_purchases_by_supplier(date, date);
DROP FUNCTION IF EXISTS public.fn_price_changes(date);
DROP FUNCTION IF EXISTS public.fn_check_report_range(date, date);
DROP FUNCTION IF EXISTS public.fn_can_read_stock_reports(uuid);
DROP FUNCTION IF EXISTS public.fn_movement_route(text, text, text);

COMMIT;
