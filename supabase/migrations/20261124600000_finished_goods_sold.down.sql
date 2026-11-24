-- Down for 20261124600000_finished_goods_sold.sql
--
-- The function is removed, so finished goods can no longer be recorded as
-- sold this way. Sales already recorded keep their movements.

BEGIN;

DROP FUNCTION IF EXISTS public.fn_record_goods_sold(jsonb, date, text);

COMMIT;
