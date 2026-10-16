-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK of 20261016100000_inventory_negative_stock.sql
--
-- Drops the negative-stock guard and alert, the multi-item RPC and the
-- settings row. Stock already below zero stays as it is; movements and
-- notifications already written are kept.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DROP TRIGGER IF EXISTS trg_inventory_negative_alert ON public.inventory;
DROP TRIGGER IF EXISTS trg_inventory_negative_guard ON public.inventory;
DROP FUNCTION IF EXISTS public.fn_inventory_negative_alert();
DROP FUNCTION IF EXISTS public.fn_inventory_negative_guard();
DROP FUNCTION IF EXISTS public.record_stock_movements(jsonb, text, text, date, text);
DROP TABLE IF EXISTS public.inventory_settings;

COMMIT;
