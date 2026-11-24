-- ════════════════════════════════════════════════════════════════════════════
-- Unit change restates the reorder level once (fix list of 24 November 2026)
--
-- Needs 20261123200000_inventory_units.sql first.
--
-- Changing an item's stock unit multiplied its reorder level twice: Chicken
-- Wings went from bag to kg at 1 bag = 20 kg, the form previewed 20 kg and
-- 400 kg was saved. The stock rows were multiplied, a mirror trigger carried
-- that figure to the item, and the function then multiplied the item again.
--
-- Identical to the function in 20261123200000 except for the reorder level
-- (marked CHANGED). 20261124100000_item_master.sql carries the same text, so
-- running that later changes nothing here.
--
-- Levels already saved wrong are not touched: set them again on the item.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_change_stock_unit(
  p_sku_id uuid, p_new_unit text, p_factor numeric, p_note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p        record;
  v_old    text;
  v_new    text := public.fn_normalise_unit(p_new_unit);
  v_level  numeric;
BEGIN
  IF NOT public.fn_has_module_permission(auth.uid(), 'inventory', 'update') THEN
    RAISE EXCEPTION 'You don''t have permission to change an item''s unit.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_new IS NULL THEN RAISE EXCEPTION 'Choose the new stock unit.'; END IF;
  IF p_factor IS NULL OR p_factor <= 0 THEN RAISE EXCEPTION 'The conversion factor must be greater than zero.'; END IF;

  SELECT * INTO p FROM public.products WHERE sku_id = p_sku_id ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item is not linked to an inventory product.'; END IF;
  v_old := public.fn_normalise_unit(p.uom);
  IF v_old = v_new THEN RAISE EXCEPTION '% is already stocked in %.', p.name, v_new; END IF;

  -- Made items carry lots, yields and run records in their unit; those are
  -- not restated here.
  IF p.item_class <> 'raw_material'
     OR EXISTS (SELECT 1 FROM public.stock_lots WHERE product_id = p.id AND status <> 'void') THEN
    RAISE EXCEPTION '% is made in production; its unit cannot be changed here.', p.name;
  END IF;
  IF EXISTS (SELECT 1 FROM public.production_run_inputs i
               JOIN public.production_runs r ON r.id = i.run_id
              WHERE i.product_id = p.id AND r.status = 'submitted') THEN
    RAISE EXCEPTION '% is in a production run waiting for approval. Approve or reject it first.', p.name;
  END IF;

  -- The level as it stands, in the old unit, read before anything moves.
  SELECT COALESCE(reorder_level, 0) INTO v_level FROM public.skus WHERE id = p_sku_id;
  v_level := round(COALESCE(v_level, 0) * p_factor);

  PERFORM set_config('app.unit_change', 'on', true);

  UPDATE public.inventory
     SET quantity      = round(quantity * p_factor, 4),
         reorder_level = v_level,
         last_updated  = now(), updated_at = now()
   WHERE product_id = p.id;

  -- Pack sizes were "old units per pack"; they become "new units per pack".
  DELETE FROM public.product_units
   WHERE product_id = p.id AND public.fn_normalise_unit(unit_name) = v_new;
  UPDATE public.product_units SET factor = factor * p_factor WHERE product_id = p.id;
  IF p_factor <> 1 THEN
    INSERT INTO public.product_units (product_id, unit_name, factor, created_by)
    VALUES (p.id, v_old, p_factor, auth.uid())
    ON CONFLICT (product_id, lower(btrim(unit_name))) DO UPDATE SET factor = EXCLUDED.factor;
  END IF;

  -- Recipes keep saying what they said: "2 bag" stays 2 bags, now 20 kg.
  UPDATE public.recipe_lines
     SET factor    = factor * p_factor,
         unit_name = COALESCE(NULLIF(btrim(unit_name), ''), v_old)
   WHERE product_id = p.id;

  UPDATE public.products
     SET uom           = v_new,
         cost_price    = round(COALESCE(cost_price, 0) / p_factor, 4),
         purchase_unit = CASE
                           WHEN p_factor = 1 THEN NULL
                           WHEN purchase_unit IS NULL OR purchase_unit = v_new THEN v_old
                           ELSE purchase_unit
                         END
   WHERE id = p.id;

  -- CHANGED: the item's level is SET to the restated figure, not multiplied.
  -- The stock rows above already carried it to the item through the mirror
  -- trigger; multiplying here as well turned 1 bag into 400 kg instead of 20.
  UPDATE public.skus SET reorder_level = v_level WHERE id = p_sku_id;

  PERFORM set_config('app.unit_change', '', true);

  INSERT INTO public.product_unit_changes (product_id, kind, old_unit, new_unit, factor, note, changed_by)
  VALUES (p.id, 'unit_change', v_old, v_new, p_factor, NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.fn_change_stock_unit(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_change_stock_unit(uuid, text, numeric, text) TO authenticated;

COMMIT;
