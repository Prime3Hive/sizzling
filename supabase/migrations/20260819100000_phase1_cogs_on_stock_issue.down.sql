-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK for 20260819100000_phase1_cogs_on_stock_issue.sql
--
-- Stops stock issues posting to the ledger and restores the two invoice paths
-- that deleted stock movements outright.
--
-- As with the append-only rollback: this returns the CODE, not the DATA. The
-- COGS entries posted while the migration was in force are real postings
-- against real consumption. They are not removed here, and removing them would
-- restate cost of sales to a figure everyone already knows to be wrong. If they
-- must come off, reverse them forward with fn_reverse_entry and agree the
-- resulting P&L.
--
-- reverses_movement_id and the stamped unit_cost values are left in place. Both
-- are additive and both hold information that exists nowhere else.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Stop posting stock movements.
DROP TRIGGER IF EXISTS trg_post_stock_movement  ON public.inventory_movements;
DROP TRIGGER IF EXISTS trg_stamp_movement_cost  ON public.inventory_movements;
DROP TRIGGER IF EXISTS trg_block_movement_delete ON public.inventory_movements;

DROP FUNCTION IF EXISTS public.trg_post_stock_movement();
DROP FUNCTION IF EXISTS public.trg_stamp_movement_cost();
DROP FUNCTION IF EXISTS public.fn_block_movement_delete();
DROP FUNCTION IF EXISTS public.fn_post_stock_movement(uuid);
DROP FUNCTION IF EXISTS public.fn_stock_issue_expense_code(text);

-- 2. Restore the delete-based invoice reversal paths exactly as they were in
--    20260723120000. Re-run that migration's sections 4 to recreate
--    fn_consume_invoice_stock and trg_consume_invoice_stock verbatim:
--
--      \i supabase/migrations/20260723120000_phase3_inventory_costing_bankrec_tin.sql
--
--    That file is idempotent (CREATE OR REPLACE throughout) and re-applying it
--    restores both function bodies, including the DELETE FROM
--    inventory_movements blocks this migration replaced.
--
--    fn_reverse_invoice_movements is left defined but unreferenced once those
--    bodies are restored. It is harmless, and it is the safer of the two
--    behaviours should anyone want it back.

COMMIT;
