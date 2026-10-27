-- ═════════════════════════════════════════════════════════════════════════════
-- PRODUCTION (made-to-stock: snacks, sauces)
--
-- Needs 20261017100000_inventory_finance_fixes.sql first.
--
-- Flow
--   recipe (standard inputs per batch, standard other costs per batch)
--     → production run recorded (status 'submitted'; a lot number is issued)
--     → approved by someone holding production·update  (or rejected/cancelled)
--         raw materials out   'production_issue'  at their moving-average cost
--         finished goods in   'production_output' into the run's lot
--         Dr 1210 Finished Goods       materials + production expenses
--            Cr 1200 / 1210 Inventory  materials (by the input's class)
--            Cr 5050 Production Exp.   the run's other costs
--     → finished goods leave by usage / invoice / write-off, oldest expiry
--       first (FEFO), Dr 5000 (or 5900) / Cr 1210.
--
-- Production expenses (gas, diesel, packaging labour…) are paid through
-- Expenses under account 5050. Absorbing them into a batch moves that cost
-- into stock until the batch is used, the same way a manual stock-in moves a
-- raw-material expense out of 5000. COGS is recognised once, on use.
--
-- Also here:
--   • inventory.quantity and inventory_movements.quantity_change become
--     numeric(14,4). inventory.quantity was INTEGER, so 2.5 kg was stored as
--     3 (or 2). Production in grams and half-bags needs real decimals.
--   • product_units: pack sizes per item (1 bag = 50 kg, 1 carton = 24 packs).
--   • items are classed raw_material / finished_good / semi_finished; the
--     class picks the inventory account (1200 vs 1210) everywhere stock is
--     posted, and a change of class moves the stock on hand between them.
--   • permission module 'production': view, create (= record), update
--     (= approve, and manage recipes), granted per department or per user.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Accounts and the expense category ────────────────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, normal_balance, sort_order) VALUES
  ('1210', 'Finished Goods',      'asset',   'debit', 41),
  ('5050', 'Production Expenses', 'expense', 'debit', 135)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.expense_categories (name, account_code, sort_order) VALUES
  ('Production Expenses', '5050', 35)
ON CONFLICT (name) DO UPDATE SET account_code = EXCLUDED.account_code;

-- ── 2. Real decimals for stock quantities ───────────────────────────────────
-- A column named in a trigger's UPDATE OF list (or read by a view) can't change
-- type; lift them off, widen, and put them back unchanged.
DROP TRIGGER IF EXISTS trg_sync_inventory_to_sku     ON public.inventory;
DROP TRIGGER IF EXISTS trg_inventory_negative_guard  ON public.inventory;
DROP TRIGGER IF EXISTS trg_inventory_negative_alert  ON public.inventory;
DROP VIEW IF EXISTS public.product_stock_used;

ALTER TABLE public.inventory           ALTER COLUMN quantity        TYPE numeric(14,4);
ALTER TABLE public.inventory_movements ALTER COLUMN quantity_change TYPE numeric(14,4);

CREATE TRIGGER trg_sync_inventory_to_sku
  AFTER INSERT OR UPDATE OF quantity, reorder_level OR DELETE ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_inventory_to_sku();
CREATE TRIGGER trg_inventory_negative_guard
  BEFORE INSERT OR UPDATE OF quantity ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_negative_guard();
CREATE TRIGGER trg_inventory_negative_alert
  AFTER INSERT OR UPDATE OF quantity ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_negative_alert();

CREATE OR REPLACE VIEW public.product_stock_used AS
SELECT
  product_id,
  COALESCE(SUM(-quantity_change) FILTER (WHERE quantity_change < 0 AND movement_type IN ('sale', 'usage')), 0) AS stock_used
FROM public.inventory_movements
GROUP BY product_id;

-- ── 3. Permission check: admin, then per-user override, then department ─────
CREATE OR REPLACE FUNCTION public.fn_has_module_permission(_user_id uuid, _module text, _action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS NULL THEN false
    WHEN public.is_admin(_user_id) THEN true
    WHEN NOT EXISTS (SELECT 1 FROM public.user_roles
                     WHERE user_id = _user_id AND role_status = 'approved') THEN false
    WHEN EXISTS (SELECT 1 FROM public.user_permissions
                 WHERE user_id = _user_id AND module_name = _module) THEN
      (SELECT CASE _action
                WHEN 'view'   THEN can_view
                WHEN 'create' THEN can_create
                WHEN 'update' THEN can_update
                WHEN 'delete' THEN can_delete
                ELSE false END
       FROM public.user_permissions
       WHERE user_id = _user_id AND module_name = _module)
    ELSE public.has_department_permission(_user_id, _module, _action)
  END;
$$;

REVOKE ALL ON FUNCTION public.fn_has_module_permission(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_has_module_permission(uuid, text, text) TO authenticated;

-- ── 4. Item class, lot code, shelf life, pack sizes ─────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS item_class      text NOT NULL DEFAULT 'raw_material',
  ADD COLUMN IF NOT EXISTS lot_code        text,
  ADD COLUMN IF NOT EXISTS shelf_life_days integer;

DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_item_class_check
    CHECK (item_class IN ('raw_material', 'finished_good', 'semi_finished'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_shelf_life_check
    CHECK (shelf_life_days IS NULL OR shelf_life_days > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per larger (or smaller) unit an item is counted in. `factor` is how
-- many of the item's base unit (products.uom) one of these holds:
--   Flour (kg):     bag = 50, g = 0.001
--   Chin-chin (pack): carton = 24
CREATE TABLE IF NOT EXISTS public.product_units (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid          NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_name  text          NOT NULL CHECK (btrim(unit_name) <> ''),
  factor     numeric(18,6) NOT NULL CHECK (factor > 0),
  created_by uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_units_name
  ON public.product_units(product_id, lower(btrim(unit_name)));

ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_units_read" ON public.product_units;
CREATE POLICY "product_units_read" ON public.product_units
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "product_units_write" ON public.product_units;
CREATE POLICY "product_units_write" ON public.product_units
  FOR ALL TO authenticated
  USING ((SELECT public.fn_has_module_permission((SELECT auth.uid()), 'inventory', 'update'))
      OR (SELECT public.fn_has_module_permission((SELECT auth.uid()), 'production', 'update')))
  WITH CHECK ((SELECT public.fn_has_module_permission((SELECT auth.uid()), 'inventory', 'update'))
      OR (SELECT public.fn_has_module_permission((SELECT auth.uid()), 'production', 'update')));

-- Which inventory account holds an item.
CREATE OR REPLACE FUNCTION public.fn_inventory_account(p_product_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT CASE WHEN item_class IN ('finished_good', 'semi_finished') THEN '1210' ELSE '1200' END
     FROM public.products WHERE id = p_product_id),
    '1200');
$$;

-- A change of class moves the stock on hand to the other inventory account.
CREATE OR REPLACE FUNCTION public.fn_reclass_product_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_acct text := CASE WHEN OLD.item_class IN ('finished_good', 'semi_finished') THEN '1210' ELSE '1200' END;
  new_acct text := CASE WHEN NEW.item_class IN ('finished_good', 'semi_finished') THEN '1210' ELSE '1200' END;
  on_hand  numeric;
  val      numeric;
BEGIN
  IF old_acct = new_acct THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(quantity), 0) INTO on_hand FROM public.inventory WHERE product_id = NEW.id;
  val := round(GREATEST(on_hand, 0) * COALESCE(NEW.cost_price, 0), 2);
  IF val > 0 THEN
    PERFORM public.fn_post_entry(
      current_date,
      'Stock reclassified — ' || NEW.name,
      'stock_reclass', gen_random_uuid(),
      jsonb_build_array(
        jsonb_build_object('code', new_acct, 'debit', val, 'credit', 0,   'desc', 'Stock reclassified in'),
        jsonb_build_object('code', old_acct, 'debit', 0,   'credit', val, 'desc', 'Stock reclassified out')));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_reclass_product_stock ON public.products;
CREATE TRIGGER trg_reclass_product_stock
  AFTER UPDATE OF item_class ON public.products
  FOR EACH ROW WHEN (OLD.item_class IS DISTINCT FROM NEW.item_class)
  EXECUTE FUNCTION public.fn_reclass_product_stock();

-- Set an item up for production. Approvers and inventory editors only.
CREATE OR REPLACE FUNCTION public.set_production_item(
  p_product_id uuid, p_item_class text, p_lot_code text DEFAULT NULL, p_shelf_life_days integer DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.fn_has_module_permission(auth.uid(), 'production', 'update')
          OR public.fn_has_module_permission(auth.uid(), 'inventory', 'update')) THEN
    RAISE EXCEPTION 'You don''t have permission to change production settings.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.products
  SET item_class      = p_item_class,
      lot_code        = NULLIF(upper(regexp_replace(COALESCE(p_lot_code, ''), '[^A-Za-z0-9]', '', 'g')), ''),
      shelf_life_days = NULLIF(p_shelf_life_days, 0)
  WHERE id = p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item not found.'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_production_item(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_production_item(uuid, text, text, integer) TO authenticated;

-- RLS note: every permission check below is wrapped in (SELECT …) so Postgres
-- evaluates it once per query (an initplan) instead of once per row.

-- ── 5. Recipes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recipes (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text          NOT NULL,
  output_product_id uuid          NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- What one batch yields, in the output's base unit.
  batch_yield       numeric(14,4) NOT NULL CHECK (batch_yield > 0),
  -- How the yield was entered (e.g. 2 cartons), for display.
  yield_unit        text,
  yield_factor      numeric(18,6) NOT NULL DEFAULT 1 CHECK (yield_factor > 0),
  is_active         boolean       NOT NULL DEFAULT true,
  notes             text,
  created_by        uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recipes_output ON public.recipes(output_product_id);

CREATE TABLE IF NOT EXISTS public.recipe_lines (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id   uuid          NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  product_id  uuid          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  -- Quantity per batch in `unit_name`; base quantity = quantity × factor.
  quantity    numeric(14,4) NOT NULL CHECK (quantity > 0),
  unit_name   text,
  factor      numeric(18,6) NOT NULL DEFAULT 1 CHECK (factor > 0),
  sort_order  integer       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_recipe_lines_recipe ON public.recipe_lines(recipe_id);

-- Standard production expenses per batch (gas, diesel…), pre-filled on a run.
CREATE TABLE IF NOT EXISTS public.recipe_costs (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id   uuid          NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  description text          NOT NULL CHECK (btrim(description) <> ''),
  amount      numeric(14,2) NOT NULL CHECK (amount >= 0),
  sort_order  integer       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_recipe_costs_recipe ON public.recipe_costs(recipe_id);

ALTER TABLE public.recipes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_costs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recipes', 'recipe_lines', 'recipe_costs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING ((SELECT public.fn_has_module_permission((SELECT auth.uid()), 'production', 'view'))
          OR (SELECT public.fn_has_module_permission((SELECT auth.uid()), 'production', 'create')))$p$, t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING ((SELECT public.fn_has_module_permission((SELECT auth.uid()), 'production', 'update')))
      WITH CHECK ((SELECT public.fn_has_module_permission((SELECT auth.uid()), 'production', 'update')))$p$, t || '_write', t);
  END LOOP;
END $$;

-- ── 6. Production runs and lots ─────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.production_run_seq;

CREATE TABLE IF NOT EXISTS public.production_runs (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_number        text          NOT NULL UNIQUE
                                  DEFAULT 'PRD-' || lpad(nextval('public.production_run_seq')::text, 5, '0'),
  recipe_id         uuid          REFERENCES public.recipes(id) ON DELETE SET NULL,
  output_product_id uuid          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  production_date   date          NOT NULL DEFAULT current_date,
  batches           numeric(10,3),
  -- Quantity produced in the output's base unit, and how it was entered.
  output_qty        numeric(14,4) NOT NULL CHECK (output_qty > 0),
  output_unit       text,
  output_factor     numeric(18,6) NOT NULL DEFAULT 1 CHECK (output_factor > 0),
  warehouse_id      uuid          REFERENCES public.warehouses(id) ON DELETE SET NULL,
  lot_id            uuid,
  status            text          NOT NULL DEFAULT 'submitted'
                                  CHECK (status IN ('submitted', 'approved', 'rejected', 'cancelled', 'reversed')),
  -- Stamped at approval, from the cost of each material at that moment.
  material_cost     numeric(14,2),
  other_cost        numeric(14,2),
  total_cost        numeric(14,2),
  unit_cost         numeric(14,4),
  notes             text,
  recorded_by       uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at       timestamptz   NOT NULL DEFAULT now(),
  decided_by        uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  decision_note     text,
  reversed_by       uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  reversed_at       timestamptz,
  reversal_reason   text
);
CREATE INDEX IF NOT EXISTS idx_production_runs_status ON public.production_runs(status);
CREATE INDEX IF NOT EXISTS idx_production_runs_date   ON public.production_runs(production_date DESC);
CREATE INDEX IF NOT EXISTS idx_production_runs_output ON public.production_runs(output_product_id);
CREATE INDEX IF NOT EXISTS idx_production_runs_recorder ON public.production_runs(recorded_by, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.production_run_inputs (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid          NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
  product_id   uuid          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  -- Both in the input's base unit. standard = recipe × batches.
  standard_qty numeric(14,4),
  actual_qty   numeric(14,4) NOT NULL CHECK (actual_qty >= 0),
  unit_name    text,
  factor       numeric(18,6) NOT NULL DEFAULT 1 CHECK (factor > 0),
  unit_cost    numeric(14,4),
  line_cost    numeric(14,2),
  sort_order   integer       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_production_inputs_run     ON public.production_run_inputs(run_id);
CREATE INDEX IF NOT EXISTS idx_production_inputs_product ON public.production_run_inputs(product_id);

CREATE TABLE IF NOT EXISTS public.production_run_costs (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid          NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
  description text          NOT NULL CHECK (btrim(description) <> ''),
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  sort_order  integer       NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_production_costs_run ON public.production_run_costs(run_id);

CREATE TABLE IF NOT EXISTS public.stock_lots (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_number        text          NOT NULL UNIQUE,
  product_id        uuid          NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  production_run_id uuid          REFERENCES public.production_runs(id) ON DELETE SET NULL,
  produced_on       date          NOT NULL,
  expires_on        date,
  qty_produced      numeric(14,4) NOT NULL DEFAULT 0,
  -- Kept by trigger from the movements that carry this lot.
  qty_remaining     numeric(14,4) NOT NULL DEFAULT 0 CHECK (qty_remaining >= 0),
  unit_cost         numeric(14,4),
  -- pending: run awaiting approval · active: in stock · void: run rejected,
  -- cancelled or reversed.
  status            text          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'void')),
  created_at        timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_lots_product ON public.stock_lots(product_id, status);

DO $$ BEGIN
  ALTER TABLE public.production_runs ADD CONSTRAINT production_runs_lot_fk
    FOREIGN KEY (lot_id) REFERENCES public.stock_lots(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS lot_id uuid REFERENCES public.stock_lots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inv_moves_lot ON public.inventory_movements(lot_id);

ALTER TABLE public.production_runs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_costs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lots            ENABLE ROW LEVEL SECURITY;

-- Read-only from the browser; every write goes through the functions below.
-- Who may read production at all, worked out once per query.
CREATE OR REPLACE FUNCTION public.fn_can_read_production(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.fn_has_module_permission(_user_id, 'production', 'view')
      OR public.fn_has_module_permission(_user_id, 'production', 'update');
$$;
REVOKE ALL ON FUNCTION public.fn_can_read_production(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_read_production(uuid) TO authenticated;

DROP POLICY IF EXISTS "production_runs_read" ON public.production_runs;
CREATE POLICY "production_runs_read" ON public.production_runs
  FOR SELECT TO authenticated
  USING ((SELECT public.fn_can_read_production((SELECT auth.uid())))
      OR recorded_by = (SELECT auth.uid()));

-- Lines follow their run. The permission check comes first so, for readers
-- with access, the per-row lookup of the run is never reached.
DROP POLICY IF EXISTS "production_run_inputs_read" ON public.production_run_inputs;
CREATE POLICY "production_run_inputs_read" ON public.production_run_inputs
  FOR SELECT TO authenticated
  USING ((SELECT public.fn_can_read_production((SELECT auth.uid())))
      OR EXISTS (SELECT 1 FROM public.production_runs r
                 WHERE r.id = run_id AND r.recorded_by = (SELECT auth.uid())));

DROP POLICY IF EXISTS "production_run_costs_read" ON public.production_run_costs;
CREATE POLICY "production_run_costs_read" ON public.production_run_costs
  FOR SELECT TO authenticated
  USING ((SELECT public.fn_can_read_production((SELECT auth.uid())))
      OR EXISTS (SELECT 1 FROM public.production_runs r
                 WHERE r.id = run_id AND r.recorded_by = (SELECT auth.uid())));

DROP POLICY IF EXISTS "stock_lots_read" ON public.stock_lots;
CREATE POLICY "stock_lots_read" ON public.stock_lots
  FOR SELECT TO authenticated USING (true);

-- Lot balance follows the movements that carry the lot.
CREATE OR REPLACE FUNCTION public.fn_apply_lot_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.lot_id IS NOT NULL THEN
    UPDATE public.stock_lots SET qty_remaining = qty_remaining + NEW.quantity_change WHERE id = NEW.lot_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_lot_movement ON public.inventory_movements;
CREATE TRIGGER trg_apply_lot_movement
  AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_apply_lot_movement();

-- Lot number: <CODE>-<YYMMDD>-<NN>, e.g. CC-261027-01. CODE is the item's lot
-- code, or the first three letters of its name.
CREATE OR REPLACE FUNCTION public.fn_next_lot_number(p_product_id uuid, p_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  prefix text;
  base   text;
  seq    integer;
BEGIN
  SELECT upper(COALESCE(
           NULLIF(regexp_replace(COALESCE(lot_code, ''), '[^A-Za-z0-9]', '', 'g'), ''),
           NULLIF(left(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'), 3), ''),
           'LOT'))
  INTO prefix FROM public.products WHERE id = p_product_id;
  base := COALESCE(prefix, 'LOT') || '-' || to_char(p_date, 'YYMMDD') || '-';

  -- Two runs posted at the same instant must not draw the same number.
  PERFORM pg_advisory_xact_lock(hashtext('stock_lot:' || base));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(substr(lot_number, length(base) + 1), '\D', '', 'g'), '')::int), 0) + 1
  INTO seq
  FROM public.stock_lots WHERE lot_number LIKE base || '%';

  RETURN base || lpad(seq::text, 2, '0');
END;
$$;

-- ── 7. Movement types ───────────────────────────────────────────────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.inventory_movements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%movement_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.inventory_movements DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_movement_type_check CHECK (movement_type IN
    ('purchase', 'sale', 'usage', 'adjustment', 'stock_take', 'transfer', 'return', 'reversal',
     'production_issue', 'production_output'));

-- ── 8. Stock-outs draw lots oldest-expiry first ─────────────────────────────
-- Same as 20261017100000, plus: for an item with active lots, the quantity is
-- first allocated to lots (a chosen lot first, then earliest expiry, then
-- oldest), and every movement carries its lot. What the lots can't cover goes
-- out unlotted.
DROP FUNCTION IF EXISTS public.fn_deplete_stock(uuid, numeric, text, text, uuid, date, text, numeric, uuid);

CREATE OR REPLACE FUNCTION public.fn_deplete_stock(
  p_product_id     uuid,
  p_qty            numeric,
  p_movement_type  text,
  p_reference_type text,
  p_reference_id   uuid,
  p_occurred_on    date,
  p_note           text,
  p_unit_cost      numeric,
  p_created_by     uuid,
  p_lot_id         uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  l          record;
  r          record;
  alloc_lot  uuid[]    := '{}';
  alloc_qty  numeric[] := '{}';
  need       numeric   := p_qty;
  i          integer;
  remaining  numeric;
  take       numeric;
  first_id   uuid;
  first_wh   uuid;
BEGIN
  FOR l IN
    SELECT id, qty_remaining FROM public.stock_lots
    WHERE product_id = p_product_id AND status = 'active' AND qty_remaining > 0
    ORDER BY COALESCE(id = p_lot_id, false) DESC, expires_on NULLS LAST, produced_on, lot_number
  LOOP
    EXIT WHEN need <= 0;
    take := LEAST(need, l.qty_remaining);
    alloc_lot := alloc_lot || l.id;
    alloc_qty := alloc_qty || take;
    need := need - take;
  END LOOP;
  IF need > 0 THEN
    alloc_lot := alloc_lot || NULL::uuid;
    alloc_qty := alloc_qty || need;
  END IF;

  FOR i IN 1 .. COALESCE(array_length(alloc_qty, 1), 0) LOOP
    remaining := alloc_qty[i];
    first_id := NULL; first_wh := NULL;

    FOR r IN
      SELECT id, warehouse_id, quantity FROM public.inventory
      WHERE product_id = p_product_id ORDER BY quantity DESC, id
    LOOP
      IF first_id IS NULL THEN first_id := r.id; first_wh := r.warehouse_id; END IF;
      EXIT WHEN remaining <= 0;
      CONTINUE WHEN r.quantity <= 0;
      take := LEAST(remaining, r.quantity);
      UPDATE public.inventory SET quantity = quantity - take, last_updated = now(), updated_at = now() WHERE id = r.id;
      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost, created_by, lot_id)
      VALUES (p_product_id, r.warehouse_id, p_movement_type, -take, p_reference_type, p_reference_id, p_occurred_on, p_note, p_unit_cost, p_created_by, alloc_lot[i]);
      remaining := remaining - take;
    END LOOP;

    IF remaining > 0 THEN
      IF first_id IS NULL THEN
        SELECT id INTO first_wh FROM public.warehouses ORDER BY created_at LIMIT 1;
        IF first_wh IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before recording stock.'; END IF;
        INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level)
        VALUES (p_product_id, first_wh, -remaining, 10);
      ELSE
        UPDATE public.inventory SET quantity = quantity - remaining, last_updated = now(), updated_at = now() WHERE id = first_id;
      END IF;
      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost, created_by, lot_id)
      VALUES (p_product_id, first_wh, p_movement_type, -remaining, p_reference_type, p_reference_id, p_occurred_on, p_note, p_unit_cost, p_created_by, alloc_lot[i]);
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_deplete_stock(uuid, numeric, text, text, uuid, date, text, numeric, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_deplete_stock(uuid, numeric, text, text, uuid, date, text, numeric, uuid, uuid) TO authenticated;

-- record_stock_movements: unchanged except a stock-out line may name a lot.
CREATE OR REPLACE FUNCTION public.record_stock_movements(
  p_lines            jsonb,
  p_movement_type    text,
  p_note             text DEFAULT NULL,
  p_occurred_on      date DEFAULT current_date,
  p_transaction_type text DEFAULT NULL,
  p_reference_type   text DEFAULT 'manual',
  p_reference_id     uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  line    jsonb;
  pid     uuid;
  sid     uuid;
  delta   numeric;
  price   numeric;
  inv_id  uuid;
  wh_id   uuid;
  d       date := COALESCE(p_occurred_on, current_date);
  ref     text := COALESCE(p_reference_type, 'manual');
  n       integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to record stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'No items to record.';
  END IF;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    delta := NULLIF(line->>'quantity_change', '')::numeric;
    IF delta IS NULL OR delta = 0 THEN CONTINUE; END IF;

    pid := NULLIF(line->>'product_id', '')::uuid;
    sid := NULLIF(line->>'sku_id', '')::uuid;
    IF pid IS NULL THEN
      SELECT id INTO pid FROM public.products WHERE sku_id = sid LIMIT 1;
    ELSIF sid IS NULL THEN
      SELECT sku_id INTO sid FROM public.products WHERE id = pid;
    END IF;
    IF pid IS NULL THEN
      RAISE EXCEPTION 'Item % is not linked to an inventory product.', COALESCE(sid::text, '?');
    END IF;

    price := NULLIF(line->>'unit_price', '')::numeric;

    IF delta < 0 THEN
      PERFORM public.fn_deplete_stock(pid, -delta, p_movement_type, ref, p_reference_id, d, p_note, NULL, auth.uid(),
                                      NULLIF(line->>'lot_id', '')::uuid);
    ELSE
      inv_id := NULL; wh_id := NULL;
      SELECT id, warehouse_id INTO inv_id, wh_id FROM public.inventory
      WHERE product_id = pid ORDER BY quantity DESC, id LIMIT 1;
      IF inv_id IS NOT NULL THEN
        UPDATE public.inventory SET quantity = quantity + delta, last_updated = now(), updated_at = now() WHERE id = inv_id;
      ELSE
        SELECT id INTO wh_id FROM public.warehouses ORDER BY created_at LIMIT 1;
        IF wh_id IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before recording stock.'; END IF;
        INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level) VALUES (pid, wh_id, delta, 10);
      END IF;
      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost, created_by)
      VALUES (pid, wh_id, p_movement_type, delta, ref, p_reference_id, d, p_note, NULLIF(price, 0), auth.uid());
    END IF;

    IF p_transaction_type IS NOT NULL AND sid IS NOT NULL THEN
      price := COALESCE(price, public.fn_product_cost(pid), 0);
      INSERT INTO public.transactions
        (transaction_type, sku_id, quantity, unit_price, total_amount, notes, user_id, created_by, reference_id)
      VALUES
        (p_transaction_type, sid, delta, price, abs(delta) * price, COALESCE(p_note, ''), auth.uid(), auth.uid(), p_reference_id);
    END IF;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

-- Invoice reversals put stock back into the lot it came from.
CREATE OR REPLACE FUNCTION public.fn_reverse_invoice_movements(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE mv record;
BEGIN
  FOR mv IN
    SELECT m.* FROM public.inventory_movements m
    WHERE m.reference_type = 'invoice' AND m.reference_id = p_invoice_id
      AND m.reverses_movement_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.inventory_movements r
        WHERE r.reverses_movement_id = m.id
      )
  LOOP
    IF mv.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET quantity = quantity + (-mv.quantity_change), last_updated = now(), updated_at = now()
      WHERE product_id = mv.product_id AND warehouse_id = mv.warehouse_id;
    END IF;

    INSERT INTO public.inventory_movements
      (product_id, warehouse_id, movement_type, quantity_change, reference_type,
       reference_id, occurred_on, note, unit_cost, reverses_movement_id, lot_id)
    VALUES
      (mv.product_id, mv.warehouse_id, 'reversal', -mv.quantity_change, 'invoice',
       p_invoice_id, current_date,
       'Reversal of movement ' || mv.id || ' — invoice no longer consumes stock',
       mv.unit_cost, mv.id, mv.lot_id);
  END LOOP;

  PERFORM public.fn_unpost('invoice_cogs', p_invoice_id);
END;
$$;

-- ── 9. Postings use the item's own inventory account ────────────────────────
CREATE OR REPLACE FUNCTION public.fn_post_stock_movement(p_movement_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m         record;
  mtype     text;
  cost      numeric;
  val       numeric;
  exp_code  text;
  inv_code  text;
BEGIN
  SELECT * INTO m FROM public.inventory_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN RETURN; END IF;
  mtype := lower(COALESCE(m.movement_type, ''));

  -- Posted by their own documents: invoice COGS, LPO receipts, production runs.
  IF COALESCE(m.reference_type, '') IN ('invoice', 'lpo_receipt', 'production') THEN RETURN; END IF;
  IF mtype IN ('sale', 'transfer', 'reversal', 'production_issue', 'production_output') THEN RETURN; END IF;

  IF COALESCE(m.quantity_change, 0) = 0 THEN
    PERFORM public.fn_unpost('stock_movement', p_movement_id);
    RETURN;
  END IF;

  cost := COALESCE(NULLIF(m.unit_cost, 0), public.fn_product_cost(m.product_id), 0);
  val  := round(abs(m.quantity_change) * cost, 2);

  IF val <= 0 THEN
    PERFORM public.fn_unpost('stock_movement', p_movement_id);
    RETURN;
  END IF;

  inv_code := public.fn_inventory_account(m.product_id);

  IF m.reference_type = 'opening' THEN
    PERFORM public.fn_post_entry(
      COALESCE(m.occurred_on, current_date),
      'Opening stock — ' || COALESCE(m.note, ''),
      'stock_movement', p_movement_id,
      CASE WHEN m.quantity_change > 0 THEN jsonb_build_array(
        jsonb_build_object('code', inv_code, 'debit', val, 'credit', 0, 'desc', 'Opening stock'),
        jsonb_build_object('code', '3000',   'debit', 0, 'credit', val, 'desc', 'Opening stock'))
      ELSE jsonb_build_array(
        jsonb_build_object('code', '3000',   'debit', val, 'credit', 0, 'desc', 'Opening stock correction'),
        jsonb_build_object('code', inv_code, 'debit', 0, 'credit', val, 'desc', 'Opening stock correction'))
      END);
    RETURN;
  END IF;

  IF mtype = 'purchase' THEN
    PERFORM public.fn_post_entry(
      COALESCE(m.occurred_on, current_date),
      'Stock received — ' || COALESCE(m.note, 'purchase'),
      'stock_movement', p_movement_id,
      CASE WHEN m.quantity_change > 0 THEN jsonb_build_array(
        jsonb_build_object('code', inv_code, 'debit', val, 'credit', 0, 'desc', 'Stock received into inventory'),
        jsonb_build_object('code', '5000',   'debit', 0, 'credit', val, 'desc', 'Held in stock until used'))
      ELSE jsonb_build_array(
        jsonb_build_object('code', '5000',   'debit', val, 'credit', 0, 'desc', 'Purchase returned'),
        jsonb_build_object('code', inv_code, 'debit', 0, 'credit', val, 'desc', 'Purchase returned'))
      END);
    RETURN;
  END IF;

  exp_code := public.fn_stock_issue_expense_code(m.movement_type);

  IF m.quantity_change < 0 THEN
    PERFORM public.fn_post_entry(
      COALESCE(m.occurred_on, current_date),
      'Stock issued — ' || COALESCE(m.note, m.movement_type),
      'stock_movement', p_movement_id,
      jsonb_build_array(
        jsonb_build_object('code', exp_code, 'debit', val, 'credit', 0,
                           'desc', CASE WHEN exp_code = '5000' THEN 'Cost of goods sold' ELSE 'Stock write-off' END),
        jsonb_build_object('code', inv_code, 'debit', 0, 'credit', val, 'desc', 'Inventory issued')));
  ELSE
    PERFORM public.fn_post_entry(
      COALESCE(m.occurred_on, current_date),
      'Stock adjustment in — ' || COALESCE(m.note, m.movement_type),
      'stock_movement', p_movement_id,
      jsonb_build_array(
        jsonb_build_object('code', inv_code, 'debit', val, 'credit', 0, 'desc', 'Inventory adjustment'),
        jsonb_build_object('code', exp_code, 'debit', 0, 'credit', val, 'desc', 'Stock adjustment credit')));
  END IF;
END;
$$;

-- Moving average also learns from production (a batch's cost per unit).
CREATE OR REPLACE FUNCTION public.fn_update_moving_average_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  total    numeric;
  prev_qty numeric;
  cur_cost numeric;
  new_cost numeric;
BEGIN
  IF NEW.movement_type NOT IN ('purchase', 'production_output') OR NEW.quantity_change <= 0
     OR COALESCE(NEW.unit_cost, 0) <= 0 OR NEW.reverses_movement_id IS NOT NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO total FROM public.inventory WHERE product_id = NEW.product_id;
  prev_qty := total - NEW.quantity_change;
  SELECT COALESCE(cost_price, 0) INTO cur_cost FROM public.products WHERE id = NEW.product_id;

  IF prev_qty <= 0 OR cur_cost <= 0 OR total <= 0 THEN
    new_cost := NEW.unit_cost;
  ELSE
    new_cost := (prev_qty * cur_cost + NEW.quantity_change * NEW.unit_cost) / total;
  END IF;

  UPDATE public.products SET cost_price = round(new_cost, 4)
  WHERE id = NEW.product_id AND cost_price IS DISTINCT FROM round(new_cost, 4);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_product_cost(p_sku_id uuid, p_cost numeric, p_note text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  pid      uuid;
  pname    text;
  old_cost numeric;
  on_hand  numeric;
  delta    numeric;
  inv_code text;
BEGIN
  IF NOT (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'manager')) THEN
    RAISE EXCEPTION 'Only an admin or manager can change an item''s cost.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_cost IS NULL OR p_cost < 0 THEN RAISE EXCEPTION 'Cost must be zero or more.'; END IF;

  SELECT id, name, COALESCE(cost_price, 0) INTO pid, pname, old_cost
  FROM public.products WHERE sku_id = p_sku_id LIMIT 1;
  IF pid IS NULL THEN RAISE EXCEPTION 'Item is not linked to an inventory product.'; END IF;
  IF round(p_cost, 4) = round(old_cost, 4) THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO on_hand FROM public.inventory WHERE product_id = pid;
  delta := round(GREATEST(on_hand, 0) * (p_cost - old_cost), 2);
  inv_code := public.fn_inventory_account(pid);

  IF delta <> 0 THEN
    PERFORM public.fn_post_entry(
      current_date,
      'Stock revaluation — ' || pname || ' ' || old_cost || ' → ' || p_cost || COALESCE(' (' || p_note || ')', ''),
      'stock_revaluation', gen_random_uuid(),
      CASE WHEN delta > 0 THEN jsonb_build_array(
        jsonb_build_object('code', inv_code, 'debit', delta, 'credit', 0, 'desc', 'Stock revalued up'),
        jsonb_build_object('code', '5900',   'debit', 0, 'credit', delta, 'desc', 'Stock revaluation gain'))
      ELSE jsonb_build_array(
        jsonb_build_object('code', '5900',   'debit', -delta, 'credit', 0, 'desc', 'Stock revaluation loss'),
        jsonb_build_object('code', inv_code, 'debit', 0, 'credit', -delta, 'desc', 'Stock revalued down'))
      END);
  END IF;

  UPDATE public.products SET cost_price = round(p_cost, 4) WHERE id = pid;
  RETURN delta;
END;
$$;

-- Invoices: COGS credits each item's own inventory account.
CREATE OR REPLACE FUNCTION public.fn_consume_invoice_stock(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv        record;
  it         record;
  has_moves  boolean;
  available  numeric;
  cost       numeric;
  amt        numeric;
  cogs_total numeric := 0;
  cogs_rm    numeric := 0;
  cogs_fg    numeric := 0;
  pname      text;
  allowed    boolean;
  d          date;
  lines      jsonb;
BEGIN
  SELECT * INTO inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN; END IF;

  has_moves := EXISTS (
    SELECT 1 FROM public.inventory_movements m
    WHERE m.reference_type = 'invoice' AND m.reference_id = p_invoice_id
      AND m.reverses_movement_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.inventory_movements r WHERE r.reverses_movement_id = m.id)
  );

  IF inv.status = 'invoice' AND NOT has_moves THEN
    SELECT allow_negative_stock INTO allowed FROM public.inventory_settings WHERE singleton;
    d := COALESCE(inv.converted_at::date, inv.issue_date);

    FOR it IN
      SELECT product_id, SUM(quantity) AS quantity
      FROM public.invoice_items
      WHERE invoice_id = p_invoice_id AND product_id IS NOT NULL AND quantity > 0
      GROUP BY product_id
    LOOP
      SELECT SUM(quantity) INTO available FROM public.inventory WHERE product_id = it.product_id;
      IF available IS NULL THEN CONTINUE; END IF;

      IF available < it.quantity AND NOT COALESCE(allowed, false) THEN
        SELECT name INTO pname FROM public.products WHERE id = it.product_id;
        RAISE EXCEPTION 'Insufficient stock to issue this invoice: % has % on hand but % is being invoiced. Adjust stock or the line quantity first.',
          COALESCE(pname, it.product_id::text), available, it.quantity;
      END IF;

      cost := public.fn_product_cost(it.product_id);
      PERFORM public.fn_deplete_stock(
        it.product_id, it.quantity, 'sale', 'invoice', p_invoice_id, d,
        'Invoice ' || COALESCE(inv.invoice_number, inv.quotation_number), cost, NULL);

      amt := round(it.quantity * COALESCE(cost, 0), 2);
      cogs_total := cogs_total + amt;
      IF public.fn_inventory_account(it.product_id) = '1210' THEN
        cogs_fg := cogs_fg + amt;
      ELSE
        cogs_rm := cogs_rm + amt;
      END IF;
    END LOOP;

    IF cogs_total > 0 THEN
      lines := jsonb_build_array(
        jsonb_build_object('code', '5000', 'debit', cogs_total, 'credit', 0, 'desc', 'Cost of goods sold'));
      IF cogs_rm > 0 THEN
        lines := lines || jsonb_build_array(
          jsonb_build_object('code', '1200', 'debit', 0, 'credit', cogs_rm, 'desc', 'Inventory consumed'));
      END IF;
      IF cogs_fg > 0 THEN
        lines := lines || jsonb_build_array(
          jsonb_build_object('code', '1210', 'debit', 0, 'credit', cogs_fg, 'desc', 'Finished goods sold'));
      END IF;
      PERFORM public.fn_post_entry(
        d,
        'COGS — Invoice ' || COALESCE(inv.invoice_number, inv.quotation_number),
        'invoice_cogs', p_invoice_id, lines);
    END IF;

  ELSIF inv.status <> 'invoice' AND has_moves THEN
    PERFORM public.fn_reverse_invoice_movements(p_invoice_id);
  END IF;
END;
$$;

-- Goods receipt: into the item's own inventory account.
CREATE OR REPLACE FUNCTION public.fn_restock_receipt_item(p_receipt_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE ri record; pid uuid; wh uuid; qty numeric; cost numeric; val numeric; d date;
BEGIN
  SELECT * INTO ri FROM public.lpo_receipt_items WHERE id = p_receipt_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  qty := ri.quantity_received;
  IF qty IS NULL OR qty <= 0 THEN RETURN; END IF;

  SELECT product_id INTO pid FROM public.lpo_items WHERE id = ri.lpo_item_id;
  IF pid IS NULL THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.inventory_movements
             WHERE reference_type = 'lpo_receipt' AND reference_id = ri.id) THEN
    RETURN;
  END IF;

  SELECT COALESCE(received_date, current_date) INTO d FROM public.lpo_receipts WHERE id = ri.receipt_id;
  d := COALESCE(d, current_date);
  cost := COALESCE(NULLIF(ri.unit_price, 0), public.fn_product_cost(pid), 0);

  SELECT warehouse_id INTO wh FROM public.inventory WHERE product_id = pid ORDER BY quantity DESC LIMIT 1;
  IF wh IS NOT NULL THEN
    UPDATE public.inventory SET quantity = quantity + qty, last_updated = now(), updated_at = now()
    WHERE product_id = pid AND warehouse_id = wh;
  ELSE
    SELECT id INTO wh FROM public.warehouses ORDER BY created_at LIMIT 1;
    IF wh IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before receiving goods.'; END IF;
    INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level) VALUES (pid, wh, qty, 10);
  END IF;

  INSERT INTO public.inventory_movements
    (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost)
  VALUES
    (pid, wh, 'purchase', qty, 'lpo_receipt', ri.id, d, 'Goods received: ' || COALESCE(ri.item_name, ''), cost);

  val := round(qty * cost, 2);
  IF val > 0 THEN
    PERFORM public.fn_post_entry(
      d,
      'Goods received — ' || COALESCE(ri.item_name, ''),
      'inventory_purchase', ri.id,
      jsonb_build_array(
        jsonb_build_object('code', public.fn_inventory_account(pid), 'debit', val, 'credit', 0, 'desc', 'Inventory received'),
        jsonb_build_object('code', '2000', 'debit', 0, 'credit', val, 'desc', 'Supplier payable')));
  END IF;
END;
$$;

-- ── 10. Recording and deciding production runs ─────────────────────────────

-- Who hears that a run is waiting: everyone who may approve it, but not the
-- person who recorded it.
CREATE OR REPLACE FUNCTION public.fn_notify_production_approvers(p_run_id uuid, p_title text, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec uuid;
BEGIN
  SELECT recorded_by INTO rec FROM public.production_runs WHERE id = p_run_id;
  INSERT INTO public.notifications (user_id, title, message, type, related_id)
  SELECT DISTINCT ur.user_id, p_title, p_message, 'production', p_run_id
  FROM public.user_roles ur
  WHERE ur.role_status = 'approved'
    AND ur.user_id IS DISTINCT FROM rec
    AND public.fn_has_module_permission(ur.user_id, 'production', 'update');
END;
$$;

-- p_run: {
--   recipe_id?, output_product_id, production_date, batches?,
--   output_qty (base unit), output_unit?, output_factor?, warehouse_id?, notes?,
--   inputs: [{ product_id, standard_qty?, actual_qty, unit_name?, factor? }],
--   costs:  [{ description, amount }]
-- }
CREATE OR REPLACE FUNCTION public.submit_production_run(p_run jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid      uuid := auth.uid();
  out_pid  uuid;
  prod     record;
  d        date;
  qty      numeric;
  actual   numeric;
  v_run    uuid;
  run_no   text;
  v_lot    uuid;
  lot_no   text;
  ln       jsonb;
  used     integer := 0;
  pos      integer := 0;
BEGIN
  IF NOT public.fn_has_module_permission(uid, 'production', 'create') THEN
    RAISE EXCEPTION 'You don''t have permission to record production.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  out_pid := NULLIF(p_run->>'output_product_id', '')::uuid;
  SELECT id, name, uom, item_class, shelf_life_days INTO prod FROM public.products WHERE id = out_pid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose what was produced.'; END IF;
  IF prod.item_class NOT IN ('finished_good', 'semi_finished') THEN
    RAISE EXCEPTION '% is set up as a raw material. Mark it as a finished or semi-finished item before recording production of it.', prod.name;
  END IF;

  d := COALESCE(NULLIF(p_run->>'production_date', '')::date, current_date);
  IF d > current_date THEN RAISE EXCEPTION 'Production can''t be dated in the future.'; END IF;
  qty := NULLIF(p_run->>'output_qty', '')::numeric;
  IF qty IS NULL OR qty <= 0 THEN RAISE EXCEPTION 'Enter how much was produced.'; END IF;
  IF jsonb_typeof(p_run->'inputs') IS DISTINCT FROM 'array' OR jsonb_array_length(p_run->'inputs') = 0 THEN
    RAISE EXCEPTION 'Add the raw materials used.';
  END IF;

  INSERT INTO public.production_runs
    (recipe_id, output_product_id, production_date, batches, output_qty, output_unit, output_factor,
     warehouse_id, notes, recorded_by)
  VALUES
    (NULLIF(p_run->>'recipe_id', '')::uuid, out_pid, d, NULLIF(p_run->>'batches', '')::numeric, qty,
     NULLIF(p_run->>'output_unit', ''), COALESCE(NULLIF(p_run->>'output_factor', '')::numeric, 1),
     NULLIF(p_run->>'warehouse_id', '')::uuid, NULLIF(btrim(COALESCE(p_run->>'notes', '')), ''), uid)
  RETURNING id, run_number INTO v_run, run_no;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_run->'inputs') LOOP
    IF NULLIF(ln->>'product_id', '') IS NULL THEN CONTINUE; END IF;
    IF (ln->>'product_id')::uuid = out_pid THEN
      RAISE EXCEPTION 'An item can''t be an ingredient of itself.';
    END IF;
    actual := COALESCE(NULLIF(ln->>'actual_qty', '')::numeric, 0);
    IF actual < 0 THEN RAISE EXCEPTION 'Quantities used can''t be negative.'; END IF;
    pos := pos + 1;
    INSERT INTO public.production_run_inputs
      (run_id, product_id, standard_qty, actual_qty, unit_name, factor, sort_order)
    VALUES
      (v_run, (ln->>'product_id')::uuid, NULLIF(ln->>'standard_qty', '')::numeric, actual,
       NULLIF(ln->>'unit_name', ''), COALESCE(NULLIF(ln->>'factor', '')::numeric, 1), pos);
    IF actual > 0 THEN used := used + 1; END IF;
  END LOOP;
  IF used = 0 THEN RAISE EXCEPTION 'Enter the quantity used for at least one raw material.'; END IF;

  pos := 0;
  IF jsonb_typeof(p_run->'costs') = 'array' THEN
    FOR ln IN SELECT * FROM jsonb_array_elements(p_run->'costs') LOOP
      CONTINUE WHEN COALESCE(NULLIF(ln->>'amount', '')::numeric, 0) <= 0;
      pos := pos + 1;
      INSERT INTO public.production_run_costs (run_id, description, amount, sort_order)
      VALUES (v_run, COALESCE(NULLIF(btrim(ln->>'description'), ''), 'Production expense'),
              round((ln->>'amount')::numeric, 2), pos);
    END LOOP;
  END IF;

  lot_no := public.fn_next_lot_number(out_pid, d);
  INSERT INTO public.stock_lots (lot_number, product_id, production_run_id, produced_on, expires_on, qty_produced, status)
  VALUES (lot_no, out_pid, v_run, d,
          CASE WHEN prod.shelf_life_days IS NOT NULL THEN d + prod.shelf_life_days END,
          qty, 'pending')
  RETURNING id INTO v_lot;
  UPDATE public.production_runs SET lot_id = v_lot WHERE id = v_run;

  PERFORM public.fn_notify_production_approvers(v_run,
    'Production waiting for approval',
    format('%s: %s %s of %s, lot %s.', run_no, rtrim(rtrim(to_char(qty, 'FM9999999990.9999'), '0'), '.'),
           COALESCE(prod.uom, 'unit'), prod.name, lot_no));

  RETURN v_run;
END;
$$;

-- Approve: consume materials, receive the batch into its lot, post the ledger.
-- Returns the batch's cost per base unit.
CREATE OR REPLACE FUNCTION public.approve_production_run(p_run_id uuid, p_note text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid      uuid := auth.uid();
  r        record;
  i        record;
  pname    text;
  lot_no   text;
  cost     numeric;
  lc       numeric;
  mat      numeric := 0;
  oth      numeric := 0;
  total    numeric;
  ucost    numeric;
  wh       uuid;
  inv_id   uuid;
  acct     text;
  credits  jsonb := '{}'::jsonb;
  lines    jsonb;
  k        text;
BEGIN
  IF NOT public.fn_has_module_permission(uid, 'production', 'update') THEN
    RAISE EXCEPTION 'You don''t have permission to approve production.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO r FROM public.production_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found.'; END IF;
  IF r.status <> 'submitted' THEN RAISE EXCEPTION 'This production run is already %.', r.status; END IF;
  IF r.recorded_by = uid AND NOT public.is_admin(uid) THEN
    RAISE EXCEPTION 'Someone other than the person who recorded this run must approve it.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT name INTO pname FROM public.products WHERE id = r.output_product_id;
  SELECT lot_number INTO lot_no FROM public.stock_lots WHERE id = r.lot_id;

  -- Materials out, each at its current moving-average cost.
  FOR i IN SELECT * FROM public.production_run_inputs WHERE run_id = r.id ORDER BY sort_order LOOP
    CONTINUE WHEN COALESCE(i.actual_qty, 0) <= 0;
    cost := COALESCE(public.fn_product_cost(i.product_id), 0);
    PERFORM public.fn_deplete_stock(
      i.product_id, i.actual_qty, 'production_issue', 'production', r.id, r.production_date,
      'Used in ' || r.run_number || COALESCE(' — ' || pname, ''), cost, uid, NULL);
    lc := round(i.actual_qty * cost, 2);
    UPDATE public.production_run_inputs SET unit_cost = round(cost, 4), line_cost = lc WHERE id = i.id;
    mat := mat + lc;
    acct := public.fn_inventory_account(i.product_id);
    credits := jsonb_set(credits, ARRAY[acct], to_jsonb(COALESCE((credits->>acct)::numeric, 0) + lc));
  END LOOP;

  SELECT COALESCE(SUM(amount), 0) INTO oth FROM public.production_run_costs WHERE run_id = r.id;
  total := mat + oth;
  ucost := round(total / r.output_qty, 4);

  -- Batch in.
  wh := r.warehouse_id;
  IF wh IS NULL THEN
    SELECT warehouse_id INTO wh FROM public.inventory
    WHERE product_id = r.output_product_id ORDER BY quantity DESC, id LIMIT 1;
  END IF;
  IF wh IS NULL THEN SELECT id INTO wh FROM public.warehouses ORDER BY created_at LIMIT 1; END IF;
  IF wh IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before recording production.'; END IF;

  SELECT id INTO inv_id FROM public.inventory
  WHERE product_id = r.output_product_id AND warehouse_id = wh LIMIT 1;
  IF inv_id IS NOT NULL THEN
    UPDATE public.inventory SET quantity = quantity + r.output_qty, last_updated = now(), updated_at = now()
    WHERE id = inv_id;
  ELSE
    INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level)
    VALUES (r.output_product_id, wh, r.output_qty, 10);
  END IF;

  INSERT INTO public.inventory_movements
    (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id,
     occurred_on, note, unit_cost, created_by, lot_id)
  VALUES
    (r.output_product_id, wh, 'production_output', r.output_qty, 'production', r.id,
     r.production_date, 'Produced — ' || r.run_number || COALESCE(', lot ' || lot_no, ''),
     NULLIF(ucost, 0), uid, r.lot_id);

  -- Ledger: value moves from materials (and absorbed expenses) into the batch.
  IF total > 0 THEN
    lines := jsonb_build_array(jsonb_build_object(
      'code', public.fn_inventory_account(r.output_product_id), 'debit', total, 'credit', 0,
      'desc', 'Produced into stock' || COALESCE(' — lot ' || lot_no, '')));
    FOR k IN SELECT jsonb_object_keys(credits) LOOP
      IF (credits->>k)::numeric > 0 THEN
        lines := lines || jsonb_build_array(jsonb_build_object(
          'code', k, 'debit', 0, 'credit', (credits->>k)::numeric, 'desc', 'Materials used in production'));
      END IF;
    END LOOP;
    IF oth > 0 THEN
      lines := lines || jsonb_build_array(jsonb_build_object(
        'code', '5050', 'debit', 0, 'credit', oth, 'desc', 'Production expenses absorbed into stock'));
    END IF;
    PERFORM public.fn_post_entry(
      r.production_date, 'Production ' || r.run_number || COALESCE(' — ' || pname, ''),
      'production', r.id, lines);
  END IF;

  UPDATE public.stock_lots SET status = 'active', unit_cost = ucost WHERE id = r.lot_id;
  UPDATE public.production_runs
  SET status = 'approved', material_cost = mat, other_cost = oth, total_cost = total, unit_cost = ucost,
      decided_by = uid, decided_at = now(), decision_note = NULLIF(btrim(COALESCE(p_note, '')), '')
  WHERE id = r.id;

  IF r.recorded_by IS NOT NULL AND r.recorded_by <> uid THEN
    INSERT INTO public.notifications (user_id, title, message, type, related_id)
    VALUES (r.recorded_by, 'Production approved',
            format('%s (%s%s) was approved and is now in stock.', r.run_number, pname, COALESCE(', lot ' || lot_no, ''))
              || COALESCE(' ' || NULLIF(btrim(COALESCE(p_note, '')), ''), ''),
            'production', r.id);
  END IF;

  RETURN ucost;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_production_run(p_run_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r record; pname text;
BEGIN
  IF NOT public.fn_has_module_permission(uid, 'production', 'update') THEN
    RAISE EXCEPTION 'You don''t have permission to reject production.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO r FROM public.production_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found.'; END IF;
  IF r.status <> 'submitted' THEN RAISE EXCEPTION 'This production run is already %.', r.status; END IF;

  UPDATE public.production_runs
  SET status = 'rejected', decided_by = uid, decided_at = now(),
      decision_note = NULLIF(btrim(COALESCE(p_note, '')), '')
  WHERE id = r.id;
  UPDATE public.stock_lots SET status = 'void' WHERE id = r.lot_id;

  SELECT name INTO pname FROM public.products WHERE id = r.output_product_id;
  IF r.recorded_by IS NOT NULL AND r.recorded_by <> uid THEN
    INSERT INTO public.notifications (user_id, title, message, type, related_id)
    VALUES (r.recorded_by, 'Production rejected',
            format('%s (%s) was rejected.', r.run_number, pname)
              || COALESCE(' Reason: ' || NULLIF(btrim(COALESCE(p_note, '')), ''), ''),
            'production', r.id);
  END IF;
END;
$$;

-- The recorder (or an approver) withdraws a run that is still waiting.
CREATE OR REPLACE FUNCTION public.cancel_production_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r record;
BEGIN
  SELECT * INTO r FROM public.production_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found.'; END IF;
  IF NOT (r.recorded_by = uid OR public.fn_has_module_permission(uid, 'production', 'update')) THEN
    RAISE EXCEPTION 'Only the person who recorded this run can withdraw it.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.status <> 'submitted' THEN RAISE EXCEPTION 'This production run is already %.', r.status; END IF;

  UPDATE public.production_runs SET status = 'cancelled', decided_by = uid, decided_at = now() WHERE id = r.id;
  UPDATE public.stock_lots SET status = 'void' WHERE id = r.lot_id;
END;
$$;

-- Undo an approved run whose batch is still untouched: materials go back,
-- the batch comes out, the journal is reversed. Movements stay on file with
-- their reversals beside them.
CREATE OR REPLACE FUNCTION public.reverse_production_run(p_run_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r record; l record; mv record;
BEGIN
  IF NOT public.fn_has_module_permission(uid, 'production', 'update') THEN
    RAISE EXCEPTION 'You don''t have permission to reverse production.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for reversing this run.';
  END IF;

  SELECT * INTO r FROM public.production_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found.'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved run can be reversed (this one is %).', r.status; END IF;

  SELECT * INTO l FROM public.stock_lots WHERE id = r.lot_id FOR UPDATE;
  IF FOUND AND l.qty_remaining < r.output_qty THEN
    RAISE EXCEPTION 'Lot % has already been partly used or sold (% of % left). Reverse those movements first, or write the rest off instead.',
      l.lot_number,
      rtrim(rtrim(to_char(l.qty_remaining, 'FM9999999990.9999'), '0'), '.'),
      rtrim(rtrim(to_char(r.output_qty, 'FM9999999990.9999'), '0'), '.');
  END IF;

  -- Batch out first, then materials back.
  FOR mv IN
    SELECT m.* FROM public.inventory_movements m
    WHERE m.reference_type = 'production' AND m.reference_id = r.id
      AND m.reverses_movement_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.inventory_movements x WHERE x.reverses_movement_id = m.id)
    ORDER BY (m.movement_type = 'production_output') DESC, m.created_at
  LOOP
    IF mv.warehouse_id IS NOT NULL THEN
      UPDATE public.inventory
      SET quantity = quantity - mv.quantity_change, last_updated = now(), updated_at = now()
      WHERE product_id = mv.product_id AND warehouse_id = mv.warehouse_id;
    END IF;
    INSERT INTO public.inventory_movements
      (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id,
       occurred_on, note, unit_cost, reverses_movement_id, lot_id, created_by)
    VALUES
      (mv.product_id, mv.warehouse_id, 'reversal', -mv.quantity_change, 'production', r.id,
       current_date, 'Reversal of ' || r.run_number || ': ' || btrim(p_reason),
       mv.unit_cost, mv.id, mv.lot_id, uid);
  END LOOP;

  PERFORM public.fn_unpost('production', r.id);

  UPDATE public.stock_lots SET status = 'void' WHERE id = r.lot_id;
  UPDATE public.production_runs
  SET status = 'reversed', reversed_by = uid, reversed_at = now(), reversal_reason = btrim(p_reason)
  WHERE id = r.id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_notify_production_approvers(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_next_lot_number(uuid, date)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_production_run(jsonb)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_production_run(uuid, text)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_production_run(uuid, text)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_production_run(uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_production_run(uuid, text)              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_production_run(jsonb)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_production_run(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_production_run(uuid, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_production_run(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_production_run(uuid, text) TO authenticated;

COMMIT;
