-- Down for 20261124300000_stock_out_and_count.sql
--
-- The functions and the two guards are removed, so stock can no longer be
-- issued by route or counted this way, and corrections go back to whoever
-- could record stock. Counts already made, and the route, reason and event on
-- movements already recorded, are kept: dropping them would lose the record.
-- The 'waste' movement type stays allowed for the same reason.

BEGIN;

DROP TRIGGER IF EXISTS trg_zz_guard_manual_correction ON public.inventory_movements;
DROP TRIGGER IF EXISTS trg_stamp_movement_route       ON public.inventory_movements;

DROP FUNCTION IF EXISTS public.fn_decide_stock_count(uuid, boolean, jsonb, text);
DROP FUNCTION IF EXISTS public.fn_submit_stock_count(jsonb, date, text, text);
DROP FUNCTION IF EXISTS public.fn_issue_stock(text, jsonb, date, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.fn_count_line_needs_reason(numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.fn_event_food_cost(uuid, text);
DROP FUNCTION IF EXISTS public.fn_guard_manual_correction();
DROP FUNCTION IF EXISTS public.fn_stamp_movement_route();
DROP FUNCTION IF EXISTS public.fn_clear_movement_context();

COMMIT;
