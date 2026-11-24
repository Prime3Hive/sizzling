-- ═════════════════════════════════════════════════════════════════════════════
-- Reordering: a target level per item (inventory redesign, build stage 5)
--
-- Needs 20261124100000_item_master.sql first. It does not depend on stages
-- 2 to 4, though the "To buy" list hands over to Receive when that is live.
--
-- An item at or below its minimum level goes on the "To buy" list with a
-- suggested quantity that brings it back up to its TARGET level, in whole
-- purchase units. The minimum level already exists (the reorder level on the
-- item). This adds the target.
--
--   products.target_level   in stock units. NULL = not set: twice the minimum
--                           is used until the owner sets one.
--
-- This migration changes NO stock quantity, cost, movement or level. Every
-- existing item starts with no target.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS target_level numeric(14,4)
    CHECK (target_level IS NULL OR target_level >= 0);

COMMENT ON COLUMN public.products.target_level IS
  'The level a reorder brings the item back up to, in stock units. NULL = twice the minimum level.';

-- Changing the stock unit restates the target with everything else. Stage 1
-- left fn_change_stock_unit restating the balance, cost, minimum level, pack
-- sizes and recipes; the target is a level in the same unit and follows them.
-- Done by trigger on the unit itself so that function need not be replaced
-- again: when products.uom changes under "Change stock unit", the factor is
-- the one that function was called with (new units per old unit), which is
-- the factor of the pack size it leaves behind for the old unit.
CREATE OR REPLACE FUNCTION public.fn_restate_target_level()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f numeric;
BEGIN
  IF NEW.target_level IS NULL
     OR NEW.target_level IS DISTINCT FROM OLD.target_level          -- set deliberately in the same update
     OR COALESCE(current_setting('app.unit_change', true), '') <> 'on' THEN
    RETURN NEW;
  END IF;
  -- 1 old unit = f new units. With f = 1 the old unit was only a label and no
  -- pack size is kept, so nothing needs restating.
  SELECT factor INTO f FROM public.product_units
   WHERE product_id = NEW.id
     AND public.fn_normalise_unit(unit_name) = public.fn_normalise_unit(OLD.uom)
   LIMIT 1;
  IF f IS NOT NULL AND f > 0 THEN
    NEW.target_level := round(NEW.target_level * f, 4);
  END IF;
  RETURN NEW;
END;
$$;
-- After trg_c_product_master_rules, before trg_zsync_product_to_sku.
DROP TRIGGER IF EXISTS trg_d_restate_target_level ON public.products;
CREATE TRIGGER trg_d_restate_target_level
  BEFORE UPDATE OF uom ON public.products
  FOR EACH ROW
  WHEN (public.fn_normalise_unit(OLD.uom) IS DISTINCT FROM public.fn_normalise_unit(NEW.uom))
  EXECUTE FUNCTION public.fn_restate_target_level();

COMMIT;

NOTIFY pgrst, 'reload schema';
