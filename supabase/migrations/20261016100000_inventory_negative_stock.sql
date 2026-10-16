-- ═════════════════════════════════════════════════════════════════════════════
-- INVENTORY SETUP: NEGATIVE STOCK + MULTI-ITEM MOVEMENTS
--
--   inventory_settings     one row. allow_negative_stock decides whether a
--                          stock-out may take an item below zero;
--                          notify_on_negative alerts admins and managers when
--                          an item's stock crosses below zero.
--   fn_inventory_negative_guard   BEFORE trigger on inventory. Refuses a
--                          decrease that ends below zero while negative stock
--                          is off. Every path that writes inventory goes
--                          through it, not just the Inventory page.
--   fn_inventory_negative_alert   AFTER trigger on inventory. Fires once, at
--                          the moment the item's TOTAL (all warehouses)
--                          crosses from >= 0 to < 0 — not on every further
--                          movement while it stays negative.
--   record_stock_movements  applies many lines in ONE transaction: each line
--                          updates inventory, appends its movement, and
--                          optionally its legacy `transactions` row. If any
--                          line is refused, none of them land, so the ledger
--                          and the stock figure can no longer drift apart.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Settings (one row) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_settings (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton            boolean     NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  allow_negative_stock boolean     NOT NULL DEFAULT false,
  notify_on_negative   boolean     NOT NULL DEFAULT true,
  updated_by           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.inventory_settings (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.inventory_settings ENABLE ROW LEVEL SECURITY;

-- Everyone who records stock needs to know the rule; only admins change it.
DROP POLICY IF EXISTS "inventory_settings_read" ON public.inventory_settings;
CREATE POLICY "inventory_settings_read" ON public.inventory_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_settings_admin_update" ON public.inventory_settings;
CREATE POLICY "inventory_settings_admin_update" ON public.inventory_settings
  FOR UPDATE TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

REVOKE ALL ON public.inventory_settings FROM anon;
GRANT SELECT, UPDATE ON public.inventory_settings TO authenticated;

DROP TRIGGER IF EXISTS trg_audit_inventory_settings ON public.inventory_settings;
CREATE TRIGGER trg_audit_inventory_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_settings
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_row();

-- ── 2. Guard: no stock below zero unless allowed ─────────────────────────────
-- Only a DECREASE that ends below zero is refused. A row that is already
-- negative (from when it was allowed) can still be corrected upwards, and
-- untouched columns never trip it.
CREATE OR REPLACE FUNCTION public.fn_inventory_negative_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  allowed boolean;
  pname   text;
BEGIN
  IF NEW.quantity >= 0 THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.quantity >= OLD.quantity THEN RETURN NEW; END IF;

  SELECT allow_negative_stock INTO allowed FROM public.inventory_settings WHERE singleton;
  IF COALESCE(allowed, false) THEN RETURN NEW; END IF;

  SELECT name INTO pname FROM public.products WHERE id = NEW.product_id;
  RAISE EXCEPTION 'Insufficient stock: % has % on hand, this would take it to %. Negative stock is turned off in Inventory setup.',
    COALESCE(pname, NEW.product_id::text),
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.quantity ELSE 0 END,
    NEW.quantity
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_negative_guard ON public.inventory;
CREATE TRIGGER trg_inventory_negative_guard
  BEFORE INSERT OR UPDATE OF quantity ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_negative_guard();

-- ── 3. Alert: stock crossed below zero ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_inventory_negative_alert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  do_notify  boolean;
  total      numeric;
  prev_total numeric;
  p          record;
BEGIN
  SELECT notify_on_negative INTO do_notify FROM public.inventory_settings WHERE singleton;
  IF NOT COALESCE(do_notify, true) THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO total FROM public.inventory WHERE product_id = NEW.product_id;
  prev_total := total - (NEW.quantity - CASE WHEN TG_OP = 'UPDATE' THEN OLD.quantity ELSE 0 END);
  IF NOT (prev_total >= 0 AND total < 0) THEN RETURN NULL; END IF;

  SELECT name, uom, sku_id INTO p FROM public.products WHERE id = NEW.product_id;

  INSERT INTO public.notifications (user_id, title, message, type, related_id)
  SELECT DISTINCT ur.user_id,
         'Stock went negative',
         format('%s is now at %s %s. Record the missing stock-in or a stock take to correct it.',
                COALESCE(p.name, 'An item'), rtrim(to_char(total, 'FM999999990.##'), '.'), COALESCE(p.uom, 'unit')),
         'inventory_stock',
         p.sku_id
  FROM public.user_roles ur
  WHERE ur.role IN ('admin', 'manager') AND ur.role_status = 'approved';

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_negative_alert ON public.inventory;
CREATE TRIGGER trg_inventory_negative_alert
  AFTER INSERT OR UPDATE OF quantity ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventory_negative_alert();

-- ── 4. Record many movements atomically ──────────────────────────────────────
-- p_lines: [{ "sku_id" | "product_id": uuid, "quantity_change": number,
--             "unit_price"?: number }]
-- p_transaction_type: when set ('PURCHASE' / 'SALE'), each line also writes
--   the legacy `transactions` row the analytics/history tabs read.
-- SECURITY INVOKER: the caller's own RLS applies, exactly as when the page
-- wrote these tables directly.
CREATE OR REPLACE FUNCTION public.record_stock_movements(
  p_lines            jsonb,
  p_movement_type    text,
  p_note             text DEFAULT NULL,
  p_occurred_on      date DEFAULT current_date,
  p_transaction_type text DEFAULT NULL
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

    -- the warehouse holding the most stock for this product, else the first
    inv_id := NULL; wh_id := NULL;
    SELECT id, warehouse_id INTO inv_id, wh_id FROM public.inventory
    WHERE product_id = pid ORDER BY quantity DESC LIMIT 1;

    IF inv_id IS NOT NULL THEN
      UPDATE public.inventory
      SET quantity = quantity + delta, last_updated = now(), updated_at = now()
      WHERE id = inv_id;
    ELSE
      SELECT id INTO wh_id FROM public.warehouses ORDER BY created_at LIMIT 1;
      IF wh_id IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before recording stock.'; END IF;
      INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level)
      VALUES (pid, wh_id, delta, 10);
    END IF;

    INSERT INTO public.inventory_movements
      (product_id, warehouse_id, movement_type, quantity_change, reference_type, occurred_on, note, created_by)
    VALUES
      (pid, wh_id, p_movement_type, delta, 'manual', COALESCE(p_occurred_on, current_date), p_note, auth.uid());

    IF p_transaction_type IS NOT NULL AND sid IS NOT NULL THEN
      price := COALESCE(NULLIF(line->>'unit_price', '')::numeric,
                        (SELECT cost_per_unit FROM public.skus WHERE id = sid), 0);
      INSERT INTO public.transactions
        (transaction_type, sku_id, quantity, unit_price, total_amount, notes, user_id, created_by)
      VALUES
        (p_transaction_type, sid, delta, price, abs(delta) * price, COALESCE(p_note, ''), auth.uid(), auth.uid());
    END IF;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_stock_movements(jsonb, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_stock_movements(jsonb, text, text, date, text) TO authenticated;

COMMIT;
