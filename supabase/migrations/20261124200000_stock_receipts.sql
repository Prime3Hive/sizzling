-- ═════════════════════════════════════════════════════════════════════════════
-- Receive: one step for every purchase (inventory redesign, build stage 2)
--
-- Needs 20261124100000_item_master.sql first.
--
-- Until now a purchase could be typed three ways (an expense, a goods received
-- note, a manual stock-in) and the three did not agree. From here one call,
-- fn_receive_stock, writes all of it in a single transaction:
--
--   one receipt            stock_receipts, numbered RCV-2026-00001
--   one line per item      stock_receipt_lines (stock lines and non-stock
--                          lines such as transport on the same receipt)
--   one stock-in per       inventory + inventory_movements, in stock units,
--     stock line           with what was typed kept beside it
--   one expense per line   expenses, source 'receipt', linked to the receipt
--   a payable              when the receipt is on credit; paying it later is
--                          a payment (Dr 2000 / Cr Cash|Bank), not an expense
--
-- A receipt made against a purchase order updates the order's received
-- quantities and marks it received or part received. fn_reverse_stock_receipt
-- undoes a receipt: reversing movements, cancelled expenses, the payable
-- removed, average cost restored, and the reason kept on the receipt.
--
-- ACCOUNTING: nothing about how the books post is changed. Cost reaches the
-- profit and loss through the expense, once, as it does for a goods received
-- note today (periodic inventory, 20261117100000). The stock movement carries
-- quantity and unit cost only.
--
-- This migration changes NO existing record. Goods received notes and
-- expenses already entered stay exactly as they are.
-- ═════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Settings and the expense source
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.inventory_settings
  -- A receipt above this total needs a photo of the supplier's receipt (or a
  -- typed reason). NULL = never asked for. Set by the owner.
  ADD COLUMN IF NOT EXISTS receipt_photo_above_minor bigint
    CHECK (receipt_photo_above_minor IS NULL OR receipt_photo_above_minor >= 0);

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_source_known;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_source_known CHECK (source IN (
    'capture', 'claim', 'report', 'settlement', 'correction', 'import', 'grn',
    'receipt'      -- created by a stock receipt (Receive)
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Receipts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.stock_receipt_number_seq;

CREATE TABLE IF NOT EXISTS public.stock_receipts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number    text        NOT NULL UNIQUE,
  -- The purchase order it was received against; NULL for a market run.
  lpo_id            uuid        REFERENCES public.lpos(id) ON DELETE SET NULL,
  payee_id          uuid        REFERENCES public.payees(id) ON DELETE SET NULL,
  supplier_name     text        NOT NULL,
  received_date     date        NOT NULL,
  payment_method    text        NOT NULL CHECK (payment_method IN ('Cash', 'Transfer', 'Credit')),
  bank_account_id   uuid,
  budget_id         uuid,
  cost_center       text,
  -- Photo of the supplier's receipt, in the `receipts` storage bucket.
  receipt_path      text,
  no_receipt_reason text,
  notes             text,
  total_minor       bigint      NOT NULL DEFAULT 0,
  -- The amount owed, when on credit. Kept after a reversal for the record.
  payable_id        uuid,
  status            text        NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reversed_at       timestamptz,
  reversed_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reversal_reason   text,
  created_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_date  ON public.stock_receipts(received_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_lpo   ON public.stock_receipts(lpo_id);
CREATE INDEX IF NOT EXISTS idx_stock_receipts_payee ON public.stock_receipts(payee_id);

CREATE TABLE IF NOT EXISTS public.stock_receipt_lines (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id   uuid          NOT NULL REFERENCES public.stock_receipts(id) ON DELETE CASCADE,
  line_no      integer       NOT NULL,
  -- stock: an item kept in stock. other: transport, bus fuel, repairs.
  kind         text          NOT NULL CHECK (kind IN ('stock', 'other')),
  product_id   uuid          REFERENCES public.products(id) ON DELETE RESTRICT,
  sku_id       uuid,
  lpo_item_id  uuid          REFERENCES public.lpo_items(id) ON DELETE SET NULL,
  -- What this receipt added to the order line, in the order's unit.
  lpo_qty      numeric(14,4),
  description  text          NOT NULL,
  category     text          NOT NULL,
  -- As typed: 2 bag. And what it came to in stock units: 40 kg.
  entered_qty  numeric(14,4),
  entered_unit text,
  factor       numeric(18,6),
  stock_qty    numeric(14,4),
  stock_unit   text,
  amount_minor bigint        NOT NULL CHECK (amount_minor > 0),
  -- Per stock unit, from this receipt.
  unit_cost    numeric(14,4),
  -- The item's average cost before this receipt, so a reversal can restore it.
  cost_before  numeric(14,4),
  expense_id   uuid          REFERENCES public.expenses(id) ON DELETE SET NULL,
  movement_id  uuid          REFERENCES public.inventory_movements(id) ON DELETE SET NULL,
  CHECK (kind = 'other' OR (product_id IS NOT NULL AND stock_qty > 0))
);
CREATE INDEX IF NOT EXISTS idx_stock_receipt_lines_receipt ON public.stock_receipt_lines(receipt_id, line_no);
CREATE INDEX IF NOT EXISTS idx_stock_receipt_lines_product ON public.stock_receipt_lines(product_id);

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS stock_receipt_id uuid REFERENCES public.stock_receipts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_stock_receipt ON public.expenses(stock_receipt_id) WHERE stock_receipt_id IS NOT NULL;

-- Read by anyone who can see inventory or the books. Written only by the two
-- functions below: there is no direct insert, update or delete.
ALTER TABLE public.stock_receipts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_receipt_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_receipts_read" ON public.stock_receipts;
CREATE POLICY "stock_receipts_read" ON public.stock_receipts
  FOR SELECT TO authenticated
  USING ((SELECT public.fn_has_module_permission((SELECT auth.uid()), 'inventory', 'view'))
      OR (SELECT public.fn_can_read_finance((SELECT auth.uid())))
      OR created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "stock_receipt_lines_read" ON public.stock_receipt_lines;
CREATE POLICY "stock_receipt_lines_read" ON public.stock_receipt_lines
  FOR SELECT TO authenticated
  USING ((SELECT public.fn_has_module_permission((SELECT auth.uid()), 'inventory', 'view'))
      OR (SELECT public.fn_can_read_finance((SELECT auth.uid())))
      OR EXISTS (SELECT 1 FROM public.stock_receipts r
                  WHERE r.id = receipt_id AND r.created_by = (SELECT auth.uid())));

REVOKE ALL ON public.stock_receipts, public.stock_receipt_lines FROM anon, authenticated;
GRANT SELECT ON public.stock_receipts, public.stock_receipt_lines TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Receive
-- ─────────────────────────────────────────────────────────────────────────────
-- p_header: { lpo_id?, payee_id?, supplier_name?, received_date, payment_method
--             (cash | transfer | credit), bank_account_id?, budget_id?,
--             cost_center?, receipt_path?, no_receipt_reason?, notes? }
-- p_lines:  [ { kind: 'stock', sku_id | product_id, quantity, unit?, factor?,
--               total? | unit_price?, lpo_item_id? },
--             { kind: 'other', category, description, amount, lpo_item_id?, quantity? } ]
-- A stock line's quantity and unit_price are in `unit` (the stock unit when
-- left out); `total` is what was paid for the whole line and wins over
-- unit_price; `factor` overrides the item's pack size for this delivery.
-- Returns { id, receipt_number, total_minor }.
CREATE OR REPLACE FUNCTION public.fn_receive_stock(p_header jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_date      date := COALESCE(NULLIF(p_header->>'received_date', '')::date, current_date);
  v_method    text;
  v_payee     uuid := NULLIF(p_header->>'payee_id', '')::uuid;
  v_supplier  text := public.fn_clean_text(p_header->>'supplier_name');
  v_lpo_id    uuid := NULLIF(p_header->>'lpo_id', '')::uuid;
  v_lpo       record;
  v_photo     text := NULLIF(btrim(COALESCE(p_header->>'receipt_path', '')), '');
  v_reason    text := NULLIF(public.fn_clean_text(p_header->>'no_receipt_reason'), '');
  v_budget    uuid := NULLIF(p_header->>'budget_id', '')::uuid;
  v_centre    text := COALESCE(NULLIF(btrim(COALESCE(p_header->>'cost_center', '')), ''), 'Daily Orders');
  v_bank      uuid := NULLIF(p_header->>'bank_account_id', '')::uuid;
  v_number    text;
  v_id        uuid;
  v_total     bigint := 0;
  v_first_exp uuid;
  v_first_cat text;
  v_limit     bigint;
  v_payable   uuid;
  line        jsonb;
  n           integer := 0;
  v_kind      text;
  v_line_id   uuid;
  v_exp       uuid;
  v_mov       uuid;
  v_minor     bigint;
  v_cat       text;
  v_desc      text;
  pr          record;
  pid         uuid;
  sid         uuid;
  qty         numeric;
  unit        text;
  factor      numeric;
  stock_qty   numeric;
  unit_cost   numeric;
  inv_id      uuid;
  wh_id       uuid;
  v_li_id     uuid;
  v_li_unit   text;
  f_order     numeric;
  v_lpo_qty   numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to receive stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (public.fn_has_module_permission(v_uid, 'inventory', 'create')
          OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'You don''t have permission to receive stock.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Add at least one line to the receipt.' USING ERRCODE = 'check_violation';
  END IF;
  IF v_date > current_date THEN
    RAISE EXCEPTION 'A receipt cannot be dated in the future (%).', v_date USING ERRCODE = 'check_violation';
  END IF;

  v_method := CASE lower(btrim(COALESCE(p_header->>'payment_method', '')))
                WHEN 'cash'     THEN 'Cash'
                WHEN 'transfer' THEN 'Transfer'
                WHEN 'credit'   THEN 'Credit'
              END;
  IF v_method IS NULL THEN
    RAISE EXCEPTION 'Choose how it was paid: cash, transfer or credit.' USING ERRCODE = 'check_violation';
  END IF;

  -- The purchase order, when there is one.
  IF v_lpo_id IS NOT NULL THEN
    SELECT * INTO v_lpo FROM public.lpos WHERE id = v_lpo_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That purchase order no longer exists.'; END IF;
    IF v_lpo.status = 'cancelled' THEN
      RAISE EXCEPTION 'Purchase order % is cancelled.', v_lpo.lpo_number USING ERRCODE = 'check_violation';
    END IF;
    v_payee    := COALESCE(v_payee, v_lpo.payee_id);
    v_supplier := COALESCE(NULLIF(v_supplier, ''), public.fn_clean_text(v_lpo.supplier_name));
    v_budget   := COALESCE(v_budget, v_lpo.budget_id);
  END IF;

  -- The supplier: a payee on the list, or a name that becomes one.
  IF v_payee IS NOT NULL THEN
    SELECT name INTO v_supplier FROM public.payees WHERE id = v_payee;
    IF NOT FOUND THEN RAISE EXCEPTION 'That supplier is no longer on the list.'; END IF;
  ELSIF COALESCE(v_supplier, '') <> '' THEN
    v_payee := public.fn_payee_for(v_supplier, 'supplier');
    SELECT COALESCE((SELECT name FROM public.payees WHERE id = v_payee), v_supplier) INTO v_supplier;
  ELSE
    RAISE EXCEPTION 'Say who it was bought from. Use "Market" for a market run.' USING ERRCODE = 'check_violation';
  END IF;

  IF v_reason IS NOT NULL AND length(v_reason) < 10 THEN
    RAISE EXCEPTION 'Say why there is no receipt (at least 10 characters).' USING ERRCODE = 'check_violation';
  END IF;

  v_number := 'RCV-' || to_char(v_date, 'YYYY') || '-' || lpad(nextval('public.stock_receipt_number_seq')::text, 5, '0');

  INSERT INTO public.stock_receipts
    (receipt_number, lpo_id, payee_id, supplier_name, received_date, payment_method, bank_account_id,
     budget_id, cost_center, receipt_path, no_receipt_reason, notes, created_by)
  VALUES
    (v_number, v_lpo_id, v_payee, v_supplier, v_date, v_method, v_bank,
     v_budget, v_centre, v_photo, v_reason,
     NULLIF(public.fn_clean_text(p_header->>'notes'), ''), v_uid)
  RETURNING id INTO v_id;

  FOR line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    n := n + 1;
    v_kind := COALESCE(NULLIF(line->>'kind', ''), 'stock');

    IF v_kind = 'other' THEN
      -- ── A cost that is not stock: transport, bus fuel, repairs ────────────
      v_minor := round(COALESCE(NULLIF(line->>'amount', '')::numeric, 0) * 100)::bigint;
      v_cat   := btrim(COALESCE(line->>'category', ''));
      v_desc  := public.fn_clean_text(line->>'description');
      IF v_cat = '' THEN
        RAISE EXCEPTION 'Line %: choose a category.', n USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(v_desc, '') = '' THEN
        RAISE EXCEPTION 'Line %: say what it was for.', n USING ERRCODE = 'check_violation';
      END IF;
      IF v_minor <= 0 THEN
        RAISE EXCEPTION 'Line % (%): enter the amount paid.', n, v_desc USING ERRCODE = 'check_violation';
      END IF;

      -- A purchase order line that is not a stock item (a service, a one-off)
      -- still fills the order, in the order's own unit.
      v_li_id := NULL; v_lpo_qty := NULL;
      IF NULLIF(line->>'lpo_item_id', '') IS NOT NULL THEN
        IF v_lpo_id IS NULL THEN
          RAISE EXCEPTION 'A line refers to a purchase order, but the receipt does not.' USING ERRCODE = 'check_violation';
        END IF;
        SELECT id INTO v_li_id FROM public.lpo_items
         WHERE id = (line->>'lpo_item_id')::uuid AND lpo_id = v_lpo_id FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION '%: that line is not on purchase order %.', v_desc, v_lpo.lpo_number USING ERRCODE = 'check_violation';
        END IF;
        v_lpo_qty := NULLIF(line->>'quantity', '')::numeric;
        IF v_lpo_qty IS NULL OR v_lpo_qty <= 0 THEN
          RAISE EXCEPTION '%: enter the quantity received.', v_desc USING ERRCODE = 'check_violation';
        END IF;
        UPDATE public.lpo_items SET quantity_received = COALESCE(quantity_received, 0) + v_lpo_qty WHERE id = v_li_id;
      END IF;

      INSERT INTO public.stock_receipt_lines (receipt_id, line_no, kind, lpo_item_id, lpo_qty, description, category, amount_minor)
      VALUES (v_id, n, 'other', v_li_id, v_lpo_qty, v_desc, v_cat, v_minor)
      RETURNING id INTO v_line_id;
      v_mov := NULL;

    ELSIF v_kind = 'stock' THEN
      -- ── An item kept in stock ────────────────────────────────────────────
      pid := NULLIF(line->>'product_id', '')::uuid;
      sid := NULLIF(line->>'sku_id', '')::uuid;
      IF pid IS NULL AND sid IS NOT NULL THEN
        SELECT id INTO pid FROM public.products WHERE sku_id = sid ORDER BY created_at LIMIT 1;
      END IF;
      SELECT p.id, p.sku_id, p.name, p.category, p.cost_price,
             public.fn_normalise_unit(p.uom) AS uom,
             COALESCE(s.is_archived, false) AS archived
        INTO pr
        FROM public.products p LEFT JOIN public.skus s ON s.id = p.sku_id
       WHERE p.id = pid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Line %: choose the item received.', n USING ERRCODE = 'check_violation';
      END IF;
      IF pr.archived THEN
        RAISE EXCEPTION '% is archived. Restore it before receiving it.', pr.name USING ERRCODE = 'check_violation';
      END IF;
      sid := pr.sku_id;

      qty := NULLIF(line->>'quantity', '')::numeric;
      IF qty IS NULL OR qty <= 0 THEN
        RAISE EXCEPTION '%: enter the quantity received.', pr.name USING ERRCODE = 'check_violation';
      END IF;

      -- What was typed, in stock units.
      unit   := COALESCE(public.fn_normalise_unit(line->>'unit'), pr.uom);
      factor := NULLIF(line->>'factor', '')::numeric;
      IF factor IS NOT NULL AND factor <= 0 THEN
        RAISE EXCEPTION 'The conversion factor must be greater than zero.' USING ERRCODE = 'check_violation';
      END IF;
      IF unit = pr.uom THEN
        factor := 1;
      ELSIF factor IS NULL THEN
        factor := public.fn_unit_factor(pid, unit, true);
      END IF;
      stock_qty := round(qty * factor, 4);
      IF stock_qty <= 0 THEN
        RAISE EXCEPTION '%: the quantity is too small to record.', pr.name USING ERRCODE = 'check_violation';
      END IF;

      -- What was paid: the line total, or the price per unit typed.
      v_minor := round(COALESCE(
                   NULLIF(line->>'total', '')::numeric,
                   NULLIF(line->>'unit_price', '')::numeric * qty,
                   0) * 100)::bigint;
      IF v_minor <= 0 THEN
        RAISE EXCEPTION '%: enter what was paid, as a price per % or a total.', pr.name, unit USING ERRCODE = 'check_violation';
      END IF;
      unit_cost := round((v_minor / 100.0) / stock_qty, 4);

      -- The expense category is the item's own category when that is one of
      -- the approved expense categories, else worked out from the name.
      SELECT name INTO v_cat FROM public.expense_categories
       WHERE is_active AND lower(name) = lower(btrim(COALESCE(pr.category, '')));
      v_cat := COALESCE(v_cat, public.fn_guess_expense_category(pr.name), 'Dry Goods & Seasonings');

      -- No figures in the description: the quantity is on the receipt line,
      -- and a number here could be read as an amount by the expense checks.
      v_desc := btrim(regexp_replace(public.fn_clean_text(pr.name), '\d', '', 'g'));
      v_desc := COALESCE(NULLIF(v_desc, ''), 'Stock received') || ' from '
                || COALESCE(NULLIF(btrim(regexp_replace(v_supplier, '\d', '', 'g')), ''), 'supplier');

      -- Against a purchase order line: how much of the order this fills.
      v_lpo_qty := NULL;
      v_li_id := NULL; v_li_unit := NULL;
      IF NULLIF(line->>'lpo_item_id', '') IS NOT NULL THEN
        IF v_lpo_id IS NULL THEN
          RAISE EXCEPTION 'A line refers to a purchase order, but the receipt does not.' USING ERRCODE = 'check_violation';
        END IF;
        SELECT id, unit_of_measure INTO v_li_id, v_li_unit FROM public.lpo_items
         WHERE id = (line->>'lpo_item_id')::uuid AND lpo_id = v_lpo_id FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION '%: that line is not on purchase order %.', pr.name, v_lpo.lpo_number USING ERRCODE = 'check_violation';
        END IF;
        f_order   := COALESCE(public.fn_unit_factor(pid, v_li_unit, false), 1);
        v_lpo_qty := round(stock_qty / NULLIF(f_order, 0), 4);
      END IF;

      INSERT INTO public.stock_receipt_lines
        (receipt_id, line_no, kind, product_id, sku_id, lpo_item_id, lpo_qty, description, category,
         entered_qty, entered_unit, factor, stock_qty, stock_unit, amount_minor, unit_cost, cost_before)
      VALUES
        (v_id, n, 'stock', pid, sid, v_li_id, v_lpo_qty, pr.name, v_cat,
         qty, unit, factor, stock_qty, pr.uom, v_minor, unit_cost, pr.cost_price)
      RETURNING id INTO v_line_id;

      -- Stock on the shelf.
      inv_id := NULL; wh_id := NULL;
      SELECT id, warehouse_id INTO inv_id, wh_id FROM public.inventory
       WHERE product_id = pid ORDER BY quantity DESC, id LIMIT 1;
      IF inv_id IS NOT NULL THEN
        UPDATE public.inventory SET quantity = quantity + stock_qty, last_updated = now(), updated_at = now()
         WHERE id = inv_id;
      ELSE
        SELECT id INTO wh_id FROM public.warehouses ORDER BY created_at LIMIT 1;
        IF wh_id IS NULL THEN RAISE EXCEPTION 'Set up a warehouse before receiving stock.'; END IF;
        INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level) VALUES (pid, wh_id, stock_qty, 0);
      END IF;

      -- The movement. Its unit cost moves the item's average cost
      -- (trg_zz_moving_average_cost); it posts nothing to the books.
      PERFORM set_config('app.entered_unit',   CASE WHEN unit = pr.uom THEN '' ELSE unit END, true);
      PERFORM set_config('app.entered_factor', factor::text, true);
      INSERT INTO public.inventory_movements
        (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id,
         occurred_on, note, unit_cost, created_by)
      VALUES
        (pid, wh_id, 'purchase', stock_qty, 'stock_receipt', v_line_id,
         v_date, v_number || ' · ' || v_supplier, unit_cost, v_uid)
      RETURNING id INTO v_mov;
      PERFORM set_config('app.entered_unit',   '', true);
      PERFORM set_config('app.entered_factor', '', true);

      -- The older purchases list the analytics page still reads.
      IF sid IS NOT NULL THEN
        INSERT INTO public.transactions
          (transaction_type, sku_id, quantity, unit_price, total_amount, notes, user_id, created_by, reference_id)
        VALUES
          ('PURCHASE', sid, stock_qty, unit_cost, round(v_minor / 100.0, 2), v_number || ' · ' || v_supplier, v_uid, v_uid, v_id);
      END IF;

      IF v_li_id IS NOT NULL THEN
        UPDATE public.lpo_items SET quantity_received = COALESCE(quantity_received, 0) + v_lpo_qty WHERE id = v_li_id;
      END IF;
    ELSE
      RAISE EXCEPTION 'Line %: unknown kind "%".', n, v_kind;
    END IF;

    -- One expense per line, approved, supported by the receipt.
    INSERT INTO public.expenses (
      amount_minor, description, category, date, budget_id, cost_center,
      payment_method, bank_account_id, payee_id, payee_name, reference,
      receipt_path, no_receipt_reason, stock_receipt_id,
      source, status, created_by, submitted_by, approved_by, approved_at
    ) VALUES (
      v_minor, v_desc, v_cat, v_date, v_budget, v_centre,
      v_method, CASE WHEN v_method = 'Transfer' THEN v_bank END, v_payee, v_supplier, v_number,
      v_photo,
      CASE WHEN v_photo IS NULL THEN COALESCE(v_reason, 'Supported by stock receipt ' || v_number) END,
      v_id,
      'receipt', 'approved', v_uid, v_uid, v_uid, now()
    ) RETURNING id INTO v_exp;

    UPDATE public.stock_receipt_lines SET expense_id = v_exp, movement_id = v_mov WHERE id = v_line_id;

    v_total := v_total + v_minor;
    IF v_first_exp IS NULL THEN v_first_exp := v_exp; v_first_cat := v_cat; END IF;
  END LOOP;

  -- A photo of the supplier's receipt above the amount the owner set.
  SELECT receipt_photo_above_minor INTO v_limit FROM public.inventory_settings LIMIT 1;
  IF v_limit IS NOT NULL AND v_total > v_limit AND v_photo IS NULL AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A receipt above % needs a photo of the supplier''s receipt, or the reason there is none.',
      to_char(v_limit / 100.0, 'FM₦999,999,999,990') USING ERRCODE = 'check_violation';
  END IF;

  -- On credit: owed to the supplier until it is paid. Paying it is a payment
  -- (Dr 2000 / Cr Cash|Bank), never a second expense.
  IF v_method = 'Credit' THEN
    INSERT INTO public.payables (supplier, description, category, amount_minor, incurred_date, status, expense_id, created_by)
    VALUES (v_supplier, 'Stock receipt ' || v_number, v_first_cat, v_total, v_date, 'unpaid', v_first_exp, v_uid)
    RETURNING id INTO v_payable;
  END IF;

  UPDATE public.stock_receipts SET total_minor = v_total, payable_id = v_payable WHERE id = v_id;

  -- The order: received when every line is filled, part received otherwise.
  IF v_lpo_id IS NOT NULL THEN
    UPDATE public.lpos
       SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM public.lpo_items
                                           WHERE lpo_id = v_lpo_id AND COALESCE(quantity_received, 0) < quantity)
                         THEN 'received' ELSE 'partially_received' END
     WHERE id = v_lpo_id;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'receipt_number', v_number, 'total_minor', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_receive_stock(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_receive_stock(jsonb, jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Reverse a receipt
-- ─────────────────────────────────────────────────────────────────────────────
-- A manager or the owner. Stock and expenses go back together or not at all:
--   • each stock line gets a reversing movement (nothing is edited or deleted)
--   • the item's average cost goes back to what it was before the receipt
--   • every expense of the receipt is cancelled, which reverses its posting on
--     the expense's own date
--   • an unpaid payable is removed; a PAID one stops the reversal
--   • the purchase order's received quantities go back
-- Refused when some of the stock has already been used: that needs a count or
-- a correction, not a reversal.
CREATE OR REPLACE FUNCTION public.fn_reverse_stock_receipt(p_receipt_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_reason   text := NULLIF(public.fn_clean_text(p_reason), '');
  r          record;
  l          record;
  v_paid     text;
  v_allow    boolean;
  on_hand    numeric;
  cur_cost   numeric;
  new_cost   numeric;
  inv_id     uuid;
  wh_id      uuid;
  v_created  timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT (public.is_admin(v_uid) OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'Only a manager or the owner can reverse a receipt.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Say why the receipt is being reversed.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO r FROM public.stock_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found.'; END IF;
  IF r.status = 'reversed' THEN
    RAISE EXCEPTION 'Receipt % has already been reversed.', r.receipt_number USING ERRCODE = 'check_violation';
  END IF;

  IF r.payable_id IS NOT NULL THEN
    SELECT status INTO v_paid FROM public.payables WHERE id = r.payable_id;
    IF v_paid = 'paid' THEN
      RAISE EXCEPTION 'Receipt % has been paid to %. Agree the refund with the supplier and record it before anything is reversed.',
        r.receipt_number, r.supplier_name USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT COALESCE(allow_negative_stock, false) INTO v_allow FROM public.inventory_settings LIMIT 1;

  FOR l IN SELECT * FROM public.stock_receipt_lines
            WHERE receipt_id = p_receipt_id AND kind = 'stock' ORDER BY line_no LOOP
    SELECT COALESCE(sum(quantity), 0) INTO on_hand FROM public.inventory WHERE product_id = l.product_id;
    IF on_hand < l.stock_qty AND NOT COALESCE(v_allow, false) THEN
      RAISE EXCEPTION '%: % % was received on % but only % is left, so some has been used. A receipt can only be reversed while its stock is still there.',
        l.description, rtrim(rtrim(to_char(l.stock_qty, 'FM999999990.0000'), '0'), '.'), COALESCE(l.stock_unit, ''),
        r.receipt_number, rtrim(rtrim(to_char(on_hand, 'FM999999990.0000'), '0'), '.')
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT id, warehouse_id INTO inv_id, wh_id FROM public.inventory
     WHERE product_id = l.product_id ORDER BY quantity DESC, id LIMIT 1;
    UPDATE public.inventory SET quantity = quantity - l.stock_qty, last_updated = now(), updated_at = now()
     WHERE id = inv_id;

    -- Dated with the receipt, so the stock history and the books agree on
    -- which period the purchase left.
    INSERT INTO public.inventory_movements
      (product_id, warehouse_id, movement_type, quantity_change, reference_type, reference_id,
       occurred_on, note, unit_cost, reverses_movement_id, created_by)
    VALUES
      (l.product_id, wh_id, 'reversal', -l.stock_qty, 'stock_receipt', l.id,
       r.received_date, r.receipt_number || ' reversed: ' || v_reason, l.unit_cost, l.movement_id, v_uid);

    -- Average cost. With no later purchase it goes back to exactly what it
    -- was. With a later one, this receipt's share is taken out of the average.
    SELECT COALESCE(cost_price, 0) INTO cur_cost FROM public.products WHERE id = l.product_id;
    SELECT created_at INTO v_created FROM public.inventory_movements WHERE id = l.movement_id;
    new_cost := cur_cost;
    IF NOT EXISTS (SELECT 1 FROM public.inventory_movements m
                    WHERE m.product_id = l.product_id
                      AND m.movement_type IN ('purchase', 'production_output')
                      AND m.quantity_change > 0
                      AND m.id IS DISTINCT FROM l.movement_id
                      AND m.created_at > COALESCE(v_created, r.created_at)) THEN
      new_cost := COALESCE(l.cost_before, cur_cost);
    ELSIF on_hand - l.stock_qty > 0 AND COALESCE(l.unit_cost, 0) > 0 THEN
      new_cost := (on_hand * cur_cost - l.stock_qty * l.unit_cost) / (on_hand - l.stock_qty);
      IF new_cost <= 0 THEN new_cost := cur_cost; END IF;
    END IF;
    UPDATE public.products SET cost_price = round(new_cost, 4)
     WHERE id = l.product_id AND cost_price IS DISTINCT FROM round(new_cost, 4);

    IF l.sku_id IS NOT NULL THEN
      INSERT INTO public.transactions
        (transaction_type, sku_id, quantity, unit_price, total_amount, notes, user_id, created_by, reference_id)
      VALUES
        ('ADJUSTMENT', l.sku_id, -l.stock_qty, COALESCE(l.unit_cost, 0), round(l.amount_minor / 100.0, 2),
         r.receipt_number || ' reversed: ' || v_reason, v_uid, v_uid, r.id);
    END IF;

  END LOOP;

  -- The purchase order's received quantities, for every line of the receipt.
  UPDATE public.lpo_items i
     SET quantity_received = GREATEST(COALESCE(i.quantity_received, 0) - x.qty, 0)
    FROM (SELECT lpo_item_id, sum(lpo_qty) AS qty FROM public.stock_receipt_lines
           WHERE receipt_id = p_receipt_id AND lpo_item_id IS NOT NULL AND lpo_qty IS NOT NULL
           GROUP BY lpo_item_id) x
   WHERE i.id = x.lpo_item_id;

  -- The expenses: cancelled, never deleted. Cancelling reverses the posting.
  UPDATE public.expenses
     SET cancelled_at = now(), cancelled_by = v_uid,
         cancellation_reason = 'Stock receipt ' || r.receipt_number || ' reversed: ' || v_reason
   WHERE stock_receipt_id = p_receipt_id AND cancelled_at IS NULL;

  -- Nothing is owed for a purchase that did not happen.
  IF r.payable_id IS NOT NULL THEN
    DELETE FROM public.payables WHERE id = r.payable_id AND status = 'unpaid';
  END IF;

  IF r.lpo_id IS NOT NULL THEN
    UPDATE public.lpos lp
       SET status = CASE
             WHEN NOT EXISTS (SELECT 1 FROM public.lpo_items i
                               WHERE i.lpo_id = lp.id AND COALESCE(i.quantity_received, 0) < i.quantity) THEN 'received'
             WHEN EXISTS (SELECT 1 FROM public.lpo_items i
                           WHERE i.lpo_id = lp.id AND COALESCE(i.quantity_received, 0) > 0) THEN 'partially_received'
             ELSE 'sent' END
     WHERE lp.id = r.lpo_id AND lp.status IN ('received', 'partially_received');
  END IF;

  UPDATE public.stock_receipts
     SET status = 'reversed', reversed_at = now(), reversed_by = v_uid, reversal_reason = v_reason
   WHERE id = p_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reverse_stock_receipt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reverse_stock_receipt(uuid, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
