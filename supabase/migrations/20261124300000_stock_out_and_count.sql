-- ═════════════════════════════════════════════════════════════════════════════
-- Stock out by route, and a count that is approved (inventory redesign, stage 3)
--
-- Needs 20261124200000_stock_receipts.sql first.
--
-- Until now stock left through one general "Used" entry, so waste, event use
-- and daily cooking could not be told apart, and a count changed stock the
-- moment it was saved, with what was missing relabelled as usage.
--
--   1. Every movement carries its ROUTE: receive, kitchen, event, event
--      return, waste, production, count difference, correction, sale.
--      Stamped by a trigger, so movements made by the existing functions get
--      one too. Movements already recorded are left as they are (no route);
--      screens work theirs out from the movement type.
--   2. fn_issue_stock: issue to kitchen, event issue, waste, return from
--      event. Waste needs a reason from the list. An event issue names the
--      event, so each event has a food cost.
--   3. Counts: stock_counts / stock_count_lines. A count is submitted, then a
--      manager or the owner approves it. Approval posts one count-difference
--      movement per item that differs. A large difference needs a reason.
--   4. A correction outside a count is made by a manager or the owner, with a
--      reason; above a value the owner sets, by the owner only.
--
-- This migration changes NO existing stock quantity, cost, movement or count.
-- Nothing here posts to the books: stock movements carry quantity and cost
-- only, as before (periodic inventory, 20261117100000).
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Settings
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.inventory_settings
  -- A count difference larger than this share of the expected quantity …
  ADD COLUMN IF NOT EXISTS count_reason_pct numeric(6,2) NOT NULL DEFAULT 10
    CHECK (count_reason_pct >= 0),
  -- … or worth more than this (kobo) needs a reason before approval.
  ADD COLUMN IF NOT EXISTS count_reason_value_minor bigint NOT NULL DEFAULT 2000000
    CHECK (count_reason_value_minor >= 0),
  -- A correction outside a count worth more than this (kobo) is the owner's
  -- to make. NULL = no limit set yet.
  ADD COLUMN IF NOT EXISTS correction_owner_above_minor bigint
    CHECK (correction_owner_above_minor IS NULL OR correction_owner_above_minor >= 0),
  ADD COLUMN IF NOT EXISTS waste_reasons text[] NOT NULL
    DEFAULT ARRAY['Spoiled', 'Spilled', 'Burnt', 'Expired', 'Damaged', 'Other'];

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Movements say which route they took
-- ─────────────────────────────────────────────────────────────────────────────
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
     'production_issue', 'production_output',
     'waste'));   -- thrown away: reported apart from usage

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS route            text,
  -- Waste: the reason from the list. Count difference and correction: why.
  ADD COLUMN IF NOT EXISTS reason           text,
  -- Event issue and return: the event it was for.
  ADD COLUMN IF NOT EXISTS event_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_name       text,
  ADD COLUMN IF NOT EXISTS cost_center      text,
  ADD COLUMN IF NOT EXISTS photo_path       text;

CREATE INDEX IF NOT EXISTS idx_inv_moves_route ON public.inventory_movements(route, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_inv_moves_event ON public.inventory_movements(event_invoice_id) WHERE event_invoice_id IS NOT NULL;

-- The functions that move stock set transaction-local settings before they
-- insert (app.route, app.reason, app.event_invoice, app.event_name,
-- app.cost_center, app.photo). With none set, the route follows the type.
CREATE OR REPLACE FUNCTION public.fn_stamp_movement_route()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.route IS NULL THEN
    NEW.route := COALESCE(
      NULLIF(current_setting('app.route', true), ''),
      CASE
        WHEN NEW.movement_type = 'reversal'                               THEN 'reversal'
        WHEN NEW.movement_type = 'purchase'                               THEN 'receive'
        WHEN NEW.movement_type IN ('production_issue', 'production_output') THEN 'production'
        WHEN NEW.movement_type = 'stock_take'                             THEN 'count_difference'
        WHEN NEW.movement_type = 'waste'                                  THEN 'waste'
        WHEN NEW.movement_type = 'sale'                                   THEN 'sale'
        WHEN NEW.movement_type = 'return'                                 THEN 'return'
        WHEN NEW.movement_type = 'transfer'                               THEN 'transfer'
        WHEN NEW.movement_type = 'adjustment'
          THEN CASE WHEN NEW.reference_type = 'opening' THEN 'opening' ELSE 'correction' END
        -- A plain "Used" entry from before the routes: not said which.
        ELSE 'usage'
      END);
  END IF;
  IF NEW.reason IS NULL THEN NEW.reason := NULLIF(current_setting('app.reason', true), ''); END IF;
  IF NEW.event_invoice_id IS NULL THEN
    NEW.event_invoice_id := NULLIF(current_setting('app.event_invoice', true), '')::uuid;
  END IF;
  IF NEW.event_name IS NULL THEN NEW.event_name := NULLIF(current_setting('app.event_name', true), ''); END IF;
  IF NEW.cost_center IS NULL THEN NEW.cost_center := NULLIF(current_setting('app.cost_center', true), ''); END IF;
  IF NEW.photo_path IS NULL THEN NEW.photo_path := NULLIF(current_setting('app.photo', true), ''); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_stamp_movement_route ON public.inventory_movements;
CREATE TRIGGER trg_stamp_movement_route
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_stamp_movement_route();

CREATE OR REPLACE FUNCTION public.fn_clear_movement_context()
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM set_config('app.route', '', true);
  PERFORM set_config('app.reason', '', true);
  PERFORM set_config('app.event_invoice', '', true);
  PERFORM set_config('app.event_name', '', true);
  PERFORM set_config('app.cost_center', '', true);
  PERFORM set_config('app.photo', '', true);
  PERFORM set_config('app.entered_unit', '', true);
  PERFORM set_config('app.entered_factor', '', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A correction outside a count
-- ─────────────────────────────────────────────────────────────────────────────
-- Named to run after trg_stamp_movement_cost, so the value is known.
CREATE OR REPLACE FUNCTION public.fn_guard_manual_correction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_limit bigint; v_value numeric;
BEGIN
  IF NEW.movement_type <> 'adjustment' OR COALESCE(NEW.reference_type, 'manual') <> 'manual' OR v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'A correction outside a count is made by a manager or the owner. Record a count instead, or ask a manager.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(btrim(NEW.note), '') = '' THEN
    RAISE EXCEPTION 'Say why the stock is being corrected.' USING ERRCODE = 'check_violation';
  END IF;
  SELECT correction_owner_above_minor INTO v_limit FROM public.inventory_settings LIMIT 1;
  v_value := abs(NEW.quantity_change) * COALESCE(NEW.unit_cost, 0);
  IF v_limit IS NOT NULL AND v_value * 100 > v_limit AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'This correction is worth %, above the % a manager can correct. The owner has to record it.',
      to_char(v_value, 'FM₦999,999,999,990'), to_char(v_limit / 100.0, 'FM₦999,999,999,990')
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.reason := COALESCE(NEW.reason, btrim(NEW.note));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_zz_guard_manual_correction ON public.inventory_movements;
CREATE TRIGGER trg_zz_guard_manual_correction
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_manual_correction();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Stock out: kitchen, event, waste, and a return from an event
-- ─────────────────────────────────────────────────────────────────────────────
-- What an event has taken, at the cost the stock carried when it left, less
-- what came back. Named by its invoice, or by name when there is none.
CREATE OR REPLACE FUNCTION public.fn_event_food_cost(p_invoice_id uuid, p_event_name text DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(round(sum(-m.quantity_change * COALESCE(m.unit_cost, 0)), 2), 0)
    FROM public.inventory_movements m
   WHERE m.route IN ('event', 'event_return')
     AND CASE WHEN p_invoice_id IS NOT NULL THEN m.event_invoice_id = p_invoice_id
              ELSE m.event_invoice_id IS NULL
                   AND lower(btrim(COALESCE(m.event_name, ''))) = lower(btrim(COALESCE(p_event_name, ''))) END;
$$;
REVOKE ALL ON FUNCTION public.fn_event_food_cost(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_event_food_cost(uuid, text) TO authenticated;

-- p_route: kitchen | event | waste | event_return
-- p_lines: [ { sku_id | product_id, quantity, unit? } ]  quantity in `unit`
--          (the stock unit when left out; a pack size otherwise).
-- Returns { batch_id, lines, value, event_food_cost? }.
CREATE OR REPLACE FUNCTION public.fn_issue_stock(
  p_route            text,
  p_lines            jsonb,
  p_occurred_on      date DEFAULT current_date,
  p_note             text DEFAULT NULL,
  p_reason           text DEFAULT NULL,
  p_event_invoice_id uuid DEFAULT NULL,
  p_event_name       text DEFAULT NULL,
  p_photo_path       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_date    date := COALESCE(p_occurred_on, current_date);
  v_route   text := lower(btrim(COALESCE(p_route, '')));
  v_note    text := NULLIF(public.fn_clean_text(p_note), '');
  v_reason  text := NULLIF(public.fn_clean_text(p_reason), '');
  v_event   text := NULLIF(public.fn_clean_text(p_event_name), '');
  v_inv     record;
  v_centre  text;
  v_type    text;
  v_batch   uuid := gen_random_uuid();
  v_reasons text[];
  line      jsonb;
  pr        record;
  pid       uuid;
  sid       uuid;
  qty       numeric;
  unit      text;
  factor    numeric;
  stock_qty numeric;
  cost      numeric;
  net_out   numeric;
  inv_id    uuid;
  wh_id     uuid;
  n         integer := 0;
  v_value   numeric := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to record stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.fn_has_module_permission(v_uid, 'inventory', 'create') OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'You don''t have permission to record stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_route NOT IN ('kitchen', 'event', 'waste', 'event_return') THEN
    RAISE EXCEPTION 'Choose where the stock went: kitchen, an event, or waste.' USING ERRCODE = 'check_violation';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Choose an item and a quantity.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_date > current_date THEN
    RAISE EXCEPTION 'Stock cannot be recorded for a future date (%).', v_date USING ERRCODE = 'check_violation';
  END IF;

  IF v_route = 'waste' THEN
    SELECT waste_reasons INTO v_reasons FROM public.inventory_settings LIMIT 1;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Choose why it was thrown away.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT x INTO v_reason FROM unnest(COALESCE(v_reasons, ARRAY[]::text[])) x WHERE lower(x) = lower(v_reason) LIMIT 1;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Choose a waste reason from the list.' USING ERRCODE = 'check_violation';
    END IF;
    IF lower(v_reason) = 'other' AND v_note IS NULL THEN
      RAISE EXCEPTION 'Say what happened in the note.' USING ERRCODE = 'check_violation';
    END IF;
    v_type := 'waste';
  ELSIF v_route IN ('event', 'event_return') THEN
    IF p_event_invoice_id IS NOT NULL THEN
      SELECT id, invoice_number, quotation_number, customer_name, event_name, status INTO v_inv
        FROM public.invoices WHERE id = p_event_invoice_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'That event invoice no longer exists.'; END IF;
      IF v_inv.status = 'cancelled' THEN
        RAISE EXCEPTION 'That invoice is cancelled.' USING ERRCODE = 'check_violation';
      END IF;
      v_event := COALESCE(v_event, NULLIF(btrim(COALESCE(v_inv.event_name, '')), ''), v_inv.customer_name);
    ELSIF v_event IS NULL THEN
      RAISE EXCEPTION 'Say which event it is for: choose its invoice or type its name.' USING ERRCODE = 'check_violation';
    END IF;
    v_centre := 'Event Account';
    v_type := CASE WHEN v_route = 'event' THEN 'usage' ELSE 'return' END;
  ELSE
    v_centre := 'Daily Orders';
    v_type := 'usage';
  END IF;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    qty := NULLIF(line->>'quantity', '')::numeric;
    IF qty IS NULL OR qty = 0 THEN CONTINUE; END IF;
    IF qty < 0 THEN RAISE EXCEPTION 'A quantity cannot be negative.' USING ERRCODE = 'check_violation'; END IF;

    pid := NULLIF(line->>'product_id', '')::uuid;
    sid := NULLIF(line->>'sku_id', '')::uuid;
    IF pid IS NULL AND sid IS NOT NULL THEN
      SELECT id INTO pid FROM public.products WHERE sku_id = sid ORDER BY created_at LIMIT 1;
    END IF;
    SELECT p.id, p.sku_id, p.name, public.fn_normalise_unit(p.uom) AS uom INTO pr FROM public.products p WHERE p.id = pid;
    IF NOT FOUND THEN RAISE EXCEPTION 'An item on the list no longer exists.' USING ERRCODE = 'check_violation'; END IF;
    sid := pr.sku_id;

    unit := COALESCE(public.fn_normalise_unit(line->>'unit'), pr.uom);
    factor := CASE WHEN unit = pr.uom THEN 1 ELSE public.fn_unit_factor(pid, unit, true) END;
    stock_qty := round(qty * factor, 4);
    IF stock_qty <= 0 THEN CONTINUE; END IF;
    cost := COALESCE(public.fn_product_cost(pid), 0);

    PERFORM public.fn_clear_movement_context();
    PERFORM set_config('app.route', v_route, true);
    PERFORM set_config('app.reason', COALESCE(v_reason, ''), true);
    PERFORM set_config('app.event_invoice', COALESCE(p_event_invoice_id::text, ''), true);
    PERFORM set_config('app.event_name', COALESCE(v_event, ''), true);
    PERFORM set_config('app.cost_center', COALESCE(v_centre, ''), true);
    PERFORM set_config('app.photo', COALESCE(NULLIF(btrim(COALESCE(p_photo_path, '')), ''), ''), true);
    PERFORM set_config('app.entered_unit', CASE WHEN unit = pr.uom THEN '' ELSE unit END, true);
    PERFORM set_config('app.entered_factor', factor::text, true);

    IF v_route = 'event_return' THEN
      -- Only what that event took, and has not already sent back.
      SELECT COALESCE(sum(-m.quantity_change), 0) INTO net_out
        FROM public.inventory_movements m
       WHERE m.product_id = pid AND m.route IN ('event', 'event_return')
         AND CASE WHEN p_event_invoice_id IS NOT NULL THEN m.event_invoice_id = p_event_invoice_id
                  ELSE m.event_invoice_id IS NULL AND lower(btrim(COALESCE(m.event_name, ''))) = lower(v_event) END;
      IF stock_qty > net_out THEN
        RAISE EXCEPTION '%: only % % was issued to this event and not yet returned.',
          pr.name, rtrim(rtrim(to_char(GREATEST(net_out, 0), 'FM999999990.0000'), '0'), '.'), pr.uom
          USING ERRCODE = 'check_violation';
      END IF;
      inv_id := NULL; wh_id := NULL;
      SELECT id, warehouse_id INTO inv_id, wh_id FROM public.inventory
       WHERE product_id = pid ORDER BY quantity DESC, id LIMIT 1;
      IF inv_id IS NULL THEN RAISE EXCEPTION '% has no stock record to return into.', pr.name; END IF;
      UPDATE public.inventory SET quantity = quantity + stock_qty, last_updated = now(), updated_at = now() WHERE id = inv_id;
      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, created_by)
      VALUES (pid, wh_id, 'return', stock_qty, 'stock_issue', v_batch, v_date, COALESCE(v_note, 'Returned from ' || v_event), v_uid);
      v_value := v_value - stock_qty * cost;
    ELSE
      -- The negative-stock rule applies here as everywhere (trigger on inventory).
      PERFORM public.fn_deplete_stock(
        pid, stock_qty, v_type, 'stock_issue', v_batch, v_date,
        COALESCE(v_note, CASE v_route WHEN 'kitchen' THEN 'Issued to kitchen'
                                      WHEN 'event'   THEN 'Issued to ' || v_event
                                      ELSE 'Waste: ' || v_reason END),
        NULL, v_uid, NULL);
      v_value := v_value + stock_qty * cost;
    END IF;

    -- The older list the analytics page still reads: usage as SALE, the rest
    -- as ADJUSTMENT, so waste and returns are not counted as usage there.
    IF sid IS NOT NULL THEN
      INSERT INTO public.transactions
        (transaction_type, sku_id, quantity, unit_price, total_amount, notes, user_id, created_by, reference_id)
      VALUES
        (CASE WHEN v_type = 'usage' THEN 'SALE' ELSE 'ADJUSTMENT' END, sid,
         CASE WHEN v_route = 'event_return' THEN stock_qty ELSE -stock_qty END,
         round(cost, 4), round(stock_qty * cost, 2),
         COALESCE(v_note, initcap(replace(v_route, '_', ' '))), v_uid, v_uid, v_batch);
    END IF;

    n := n + 1;
  END LOOP;

  PERFORM public.fn_clear_movement_context();

  IF n = 0 THEN
    RAISE EXCEPTION 'Enter a quantity for at least one item.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN jsonb_build_object(
    'batch_id', v_batch, 'lines', n, 'value', round(v_value, 2),
    'event_food_cost', CASE WHEN v_route IN ('event', 'event_return')
                            THEN public.fn_event_food_cost(p_event_invoice_id, v_event) END);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_issue_stock(text, jsonb, date, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_issue_stock(text, jsonb, date, text, text, uuid, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Counts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.stock_count_number_seq;

CREATE TABLE IF NOT EXISTS public.stock_counts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number  text        NOT NULL UNIQUE,
  count_date    date        NOT NULL,
  -- weekly: the regular count. opening: a full count posted as a fresh start.
  kind          text        NOT NULL DEFAULT 'weekly' CHECK (kind IN ('weekly', 'opening')),
  status        text        NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
  notes         text,
  counted_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS idx_stock_counts_status ON public.stock_counts(status, submitted_at DESC);
-- One count waiting for approval at a time: two would both be measured
-- against the same expected figures.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_counts_one_open ON public.stock_counts((true)) WHERE status = 'submitted';

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id      uuid          NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  product_id    uuid          NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  sku_id        uuid,
  item_name     text          NOT NULL,
  storage_place text,
  stock_unit    text,
  -- What the records showed when the count was submitted.
  expected_qty  numeric(14,4) NOT NULL,
  counted_qty   numeric(14,4) NOT NULL CHECK (counted_qty >= 0),
  -- As it was counted: "2 bag + 6 kg".
  counted_as    text,
  unit_cost     numeric(14,4) NOT NULL DEFAULT 0,
  difference    numeric(14,4) GENERATED ALWAYS AS (counted_qty - expected_qty) STORED,
  reason        text,
  UNIQUE (count_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_count_lines_count ON public.stock_count_lines(count_id);

ALTER TABLE public.stock_counts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_counts_read" ON public.stock_counts;
CREATE POLICY "stock_counts_read" ON public.stock_counts
  FOR SELECT TO authenticated
  USING ((SELECT public.fn_has_module_permission((SELECT auth.uid()), 'inventory', 'view'))
      OR counted_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS "stock_count_lines_read" ON public.stock_count_lines;
CREATE POLICY "stock_count_lines_read" ON public.stock_count_lines
  FOR SELECT TO authenticated
  USING ((SELECT public.fn_has_module_permission((SELECT auth.uid()), 'inventory', 'view'))
      OR EXISTS (SELECT 1 FROM public.stock_counts c WHERE c.id = count_id AND c.counted_by = (SELECT auth.uid())));

REVOKE ALL ON public.stock_counts, public.stock_count_lines FROM anon, authenticated;
GRANT SELECT ON public.stock_counts, public.stock_count_lines TO authenticated;

-- Does this line's difference need a reason before the count is approved?
CREATE OR REPLACE FUNCTION public.fn_count_line_needs_reason(p_expected numeric, p_counted numeric, p_unit_cost numeric)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_counted = p_expected THEN false
    ELSE abs(p_counted - p_expected) * COALESCE(p_unit_cost, 0) * 100 > s.count_reason_value_minor
      OR (p_expected <= 0 AND s.count_reason_pct < 100)
      OR (p_expected > 0 AND abs(p_counted - p_expected) > p_expected * s.count_reason_pct / 100.0)
  END
  FROM (SELECT COALESCE(max(count_reason_pct), 10) AS count_reason_pct,
               COALESCE(max(count_reason_value_minor), 2000000) AS count_reason_value_minor
          FROM public.inventory_settings) s;
$$;
REVOKE ALL ON FUNCTION public.fn_count_line_needs_reason(numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_count_line_needs_reason(numeric, numeric, numeric) TO authenticated;

-- p_lines: [ { sku_id | product_id, counted, counted_as?, reason? } ]
-- `counted` is in stock units. Items left off the list are not counted and
-- are not changed. Stock does not move until the count is approved.
CREATE OR REPLACE FUNCTION public.fn_submit_stock_count(
  p_lines      jsonb,
  p_count_date date DEFAULT current_date,
  p_kind       text DEFAULT 'weekly',
  p_notes      text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_date   date := COALESCE(p_count_date, current_date);
  v_kind   text := lower(btrim(COALESCE(p_kind, 'weekly')));
  v_open   text;
  v_id     uuid;
  v_number text;
  line     jsonb;
  pr       record;
  pid      uuid;
  sid      uuid;
  counted  numeric;
  expected numeric;
  n        integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to submit a count.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.fn_has_module_permission(v_uid, 'inventory', 'create') OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'You don''t have permission to submit a count.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_kind NOT IN ('weekly', 'opening') THEN RAISE EXCEPTION 'Unknown kind of count.'; END IF;
  IF v_kind = 'opening' AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Only the owner can post an opening count.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_date > current_date THEN
    RAISE EXCEPTION 'A count cannot be dated in the future (%).', v_date USING ERRCODE = 'check_violation';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Count at least one item.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count_number INTO v_open FROM public.stock_counts WHERE status = 'submitted' LIMIT 1;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'Count % is waiting for approval. It has to be approved or rejected before another is submitted.', v_open
      USING ERRCODE = 'check_violation';
  END IF;

  v_number := 'CNT-' || to_char(v_date, 'YYYY') || '-' || lpad(nextval('public.stock_count_number_seq')::text, 5, '0');
  INSERT INTO public.stock_counts (count_number, count_date, kind, notes, counted_by)
  VALUES (v_number, v_date, v_kind, NULLIF(public.fn_clean_text(p_notes), ''), v_uid)
  RETURNING id INTO v_id;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF NULLIF(line->>'counted', '') IS NULL THEN CONTINUE; END IF;
    counted := round((line->>'counted')::numeric, 4);
    IF counted < 0 THEN RAISE EXCEPTION 'A counted quantity cannot be negative.' USING ERRCODE = 'check_violation'; END IF;

    pid := NULLIF(line->>'product_id', '')::uuid;
    sid := NULLIF(line->>'sku_id', '')::uuid;
    IF pid IS NULL AND sid IS NOT NULL THEN
      SELECT id INTO pid FROM public.products WHERE sku_id = sid ORDER BY created_at LIMIT 1;
    END IF;
    SELECT p.id, p.sku_id, p.name, p.storage_place, public.fn_normalise_unit(p.uom) AS uom INTO pr
      FROM public.products p WHERE p.id = pid;
    IF NOT FOUND THEN RAISE EXCEPTION 'An item on the count no longer exists.' USING ERRCODE = 'check_violation'; END IF;

    SELECT COALESCE(sum(quantity), 0) INTO expected FROM public.inventory WHERE product_id = pid;

    INSERT INTO public.stock_count_lines
      (count_id, product_id, sku_id, item_name, storage_place, stock_unit, expected_qty, counted_qty, counted_as, unit_cost, reason)
    VALUES
      (v_id, pid, pr.sku_id, pr.name, pr.storage_place, pr.uom, expected, counted,
       NULLIF(public.fn_clean_text(line->>'counted_as'), ''), COALESCE(public.fn_product_cost(pid), 0),
       NULLIF(public.fn_clean_text(line->>'reason'), ''));
    n := n + 1;
  END LOOP;

  IF n = 0 THEN
    RAISE EXCEPTION 'Count at least one item.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_submit_stock_count(jsonb, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_submit_stock_count(jsonb, date, text, text) TO authenticated;

-- Approve or reject. p_reasons: { "<line id>": "why" } for lines whose
-- difference needs one. Approval posts one count-difference movement per item
-- that differs: counted − expected, so anything received or used since the
-- count was submitted stays in the balance.
CREATE OR REPLACE FUNCTION public.fn_decide_stock_count(
  p_count_id uuid,
  p_approve  boolean,
  p_reasons  jsonb DEFAULT '{}'::jsonb,
  p_note     text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_note  text := NULLIF(public.fn_clean_text(p_note), '');
  c       record;
  l       record;
  v_why   text;
  inv_id  uuid;
  wh_id   uuid;
  n       integer := 0;
  v_label text;
BEGIN
  IF v_uid IS NULL OR NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'A count is approved by a manager or the owner.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO c FROM public.stock_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Count not found.'; END IF;
  IF c.status <> 'submitted' THEN
    RAISE EXCEPTION 'Count % has already been %.', c.count_number, c.status USING ERRCODE = 'check_violation';
  END IF;
  IF c.counted_by = v_uid AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'You did this count, so someone else has to approve it.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT COALESCE(p_approve, false) THEN
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'Say why the count is being sent back.' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE public.stock_counts SET status = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = v_note
     WHERE id = p_count_id;
    IF c.counted_by IS NOT NULL AND c.counted_by <> v_uid THEN
      INSERT INTO public.notifications (user_id, title, message, type)
      VALUES (c.counted_by, 'Stock count sent back', 'Count ' || c.count_number || ' was not approved: ' || v_note, 'inventory');
    END IF;
    RETURN 0;
  END IF;

  IF c.kind = 'opening' AND NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'Only the owner can approve an opening count.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_label := CASE WHEN c.kind = 'opening' THEN 'Opening count ' ELSE 'Count ' END || c.count_number;

  FOR l IN SELECT * FROM public.stock_count_lines WHERE count_id = p_count_id ORDER BY item_name LOOP
    v_why := COALESCE(NULLIF(public.fn_clean_text(p_reasons->>(l.id::text)), ''), l.reason);
    IF v_why IS DISTINCT FROM l.reason THEN
      UPDATE public.stock_count_lines SET reason = v_why WHERE id = l.id;
    END IF;
    IF l.difference = 0 THEN CONTINUE; END IF;

    -- An opening count is a fresh start; its differences are not explained
    -- line by line.
    IF c.kind = 'weekly' AND v_why IS NULL
       AND public.fn_count_line_needs_reason(l.expected_qty, l.counted_qty, l.unit_cost) THEN
      RAISE EXCEPTION '%: a difference of % % needs a reason before the count is approved.',
        l.item_name, rtrim(rtrim(to_char(l.difference, 'FM999999990.0000'), '0'), '.'), COALESCE(l.stock_unit, '')
        USING ERRCODE = 'check_violation';
    END IF;

    PERFORM public.fn_clear_movement_context();
    PERFORM set_config('app.route', 'count_difference', true);
    PERFORM set_config('app.reason', COALESCE(v_why, ''), true);

    IF l.difference < 0 THEN
      PERFORM public.fn_deplete_stock(l.product_id, -l.difference, 'stock_take', 'stock_count', l.id, c.count_date,
                                      v_label, l.unit_cost, v_uid, NULL);
    ELSE
      inv_id := NULL; wh_id := NULL;
      SELECT id, warehouse_id INTO inv_id, wh_id FROM public.inventory
       WHERE product_id = l.product_id ORDER BY quantity DESC, id LIMIT 1;
      IF inv_id IS NOT NULL THEN
        UPDATE public.inventory SET quantity = quantity + l.difference, last_updated = now(), updated_at = now() WHERE id = inv_id;
      ELSE
        SELECT id INTO wh_id FROM public.warehouses ORDER BY created_at LIMIT 1;
        IF wh_id IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before posting a count.'; END IF;
        INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level) VALUES (l.product_id, wh_id, l.difference, 0);
      END IF;
      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id, occurred_on, note, unit_cost, created_by)
      VALUES (l.product_id, wh_id, 'stock_take', l.difference, 'stock_count', l.id, c.count_date, v_label, l.unit_cost, v_uid);
    END IF;

    IF l.sku_id IS NOT NULL THEN
      INSERT INTO public.transactions
        (transaction_type, sku_id, quantity, unit_price, total_amount, notes, user_id, created_by, reference_id)
      VALUES ('ADJUSTMENT', l.sku_id, l.difference, l.unit_cost, round(abs(l.difference) * l.unit_cost, 2), v_label, v_uid, v_uid, c.id);
    END IF;
    n := n + 1;
  END LOOP;

  PERFORM public.fn_clear_movement_context();

  -- A fresh start: earlier movements are marked as before the opening count.
  IF c.kind = 'opening' THEN
    PERFORM public.fn_mark_opening_count(COALESCE(c.notes, v_label));
  END IF;

  UPDATE public.stock_counts SET status = 'approved', decided_by = v_uid, decided_at = now(), decision_note = v_note
   WHERE id = p_count_id;
  IF c.counted_by IS NOT NULL AND c.counted_by <> v_uid THEN
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (c.counted_by, 'Stock count approved',
            'Count ' || c.count_number || ' was approved. ' || n || ' item' || CASE WHEN n = 1 THEN '' ELSE 's' END || ' corrected to the count.',
            'inventory');
  END IF;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_decide_stock_count(uuid, boolean, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_decide_stock_count(uuid, boolean, jsonb, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
