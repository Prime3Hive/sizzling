-- Down for 20261124500000_reorder_targets.sql
--
-- The trigger is removed. The target_level column is kept: dropping it would
-- lose the targets the owner set. With no targets the "To buy" list falls
-- back to twice the minimum level.

BEGIN;

DROP TRIGGER IF EXISTS trg_d_restate_target_level ON public.products;
DROP FUNCTION IF EXISTS public.fn_restate_target_level();

COMMIT;
