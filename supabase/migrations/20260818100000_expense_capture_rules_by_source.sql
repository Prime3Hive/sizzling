-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: capture-time rules were being applied to system postings.
--
-- 20260817130000 put every rule in fn_guard_expense_insert, so they fired on
-- EVERY insert into `expenses`. Two of those rules only make sense when a
-- human is typing into a form:
--
--   • "A receipt is required at ₦10,000 and above."
--   • "This description holds several purchases."
--
-- Four code paths write expenses without a receipt, from a document that was
-- already reviewed and approved:
--
--   staff expense report approval   → one row per approved line
--   credit report approval          → the payable's matching expense
--   settling a legacy payable       → the cost that was never recognised
--   M-03 correction split           → historical narrative broken into lines
--
-- All four were rejected outright, because a real expense is nearly always
-- over ₦10,000. Approving a staff expense report was impossible.
--
-- The rules were right; their scope was wrong. `source` now says how a row
-- arrived, and the capture-time rules apply only to rows a person typed.
-- Integrity rules — amount positive, under the ceiling, real date, description
-- present, and the implausibility check that catches the parser defect — still
-- apply to every writer, exactly as rule 3 requires.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. How did this row get here? ───────────────────────────────────────────

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'capture';

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_source_known;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_source_known CHECK (source IN (
    'capture',     -- a person typed it into the expense form or bulk grid
    'claim',       -- posted from an approved expense_claim line
    'report',      -- posted from an approved staff report (legacy JSON lines)
    'settlement',  -- recognised when a legacy payable was settled
    'correction',  -- written by the M-03 correction screen
    'import'       -- reserved for bulk loads
  ));

COMMENT ON COLUMN public.expenses.source IS
  'How the row arrived. Capture-time rules (receipt threshold, pasted-list '
  'rejection) apply only to source = ''capture''; everything else was already '
  'reviewed upstream. Integrity rules apply to every source.';

-- Existing rows predate the distinction and must not be judged by it.
UPDATE public.expenses SET source = 'capture' WHERE source IS NULL;

-- ── 2. Split the validator: integrity always, capture rules conditionally ───

CREATE OR REPLACE FUNCTION public.fn_validate_expense_amounts(
  p_description  text,
  p_amount_minor bigint,
  p_date         date,
  p_receipt      text,
  p_label        text DEFAULT 'expense',
  -- NEW: when false, the receipt threshold and the pasted-list rule are not
  -- applied. Defaulted to true so any existing caller keeps the old behaviour.
  p_capture_rules boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  s              record;
  v_clean        text;
  v_largest      numeric;
  v_amount_major numeric;
BEGIN
  SELECT * INTO s FROM public.expense_settings WHERE id;

  v_clean        := public.fn_clean_text(p_description);
  v_amount_major := p_amount_minor / 100.0;

  -- ── Integrity: every writer, every source ──

  IF v_clean = '' THEN
    RAISE EXCEPTION 'A % needs a description. A field of nothing but spaces or control characters is not one.', p_label
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'A % amount must be greater than zero.', p_label
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_amount_minor > s.amount_ceiling_minor THEN
    RAISE EXCEPTION 'A % of % is above the review ceiling of %.',
      p_label, to_char(v_amount_major, 'FM999,999,999.00'),
      to_char(s.amount_ceiling_minor / 100.0, 'FM999,999,999.00')
      USING ERRCODE = 'check_violation';
  END IF;

  -- The implausibility check stays universal: it is the guard against the
  -- parser defect, and a system posting can carry a wrong number just as a
  -- typed one can.
  v_largest := public.fn_largest_number_in(v_clean);
  IF v_largest >= v_amount_major * s.implausibility_factor THEN
    RAISE EXCEPTION 'The description mentions % but the amount is %. Please check.',
      to_char(v_largest, 'FM999,999,999.00'), to_char(v_amount_major, 'FM999,999,999.00')
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'A % needs a date.', p_label USING ERRCODE = 'check_violation';
  END IF;
  IF p_date > current_date + s.future_date_tolerance_days THEN
    RAISE EXCEPTION 'A % cannot be dated in the future (%).', p_label, p_date
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── Capture-time only ──

  IF NOT p_capture_rules THEN
    RETURN;
  END IF;

  -- A pasted shopping list belongs in separate lines. A posting summarising an
  -- already-approved document is not a pasted list.
  IF public.fn_count_numbers_above(v_clean, s.pasted_list_token_floor) >= s.pasted_list_token_count THEN
    RAISE EXCEPTION 'This description holds several purchases. Split it so each purchase is its own line.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The receipt is demanded of the person spending the money, at the moment
  -- they record it — not of a posting derived from a document that was already
  -- reviewed and approved.
  IF p_amount_minor >= s.receipt_threshold_minor AND COALESCE(btrim(p_receipt), '') = '' THEN
    RAISE EXCEPTION 'A receipt is required at % and above.',
      to_char(s.receipt_threshold_minor / 100.0, 'FM999,999,999.00')
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ── 3. The expense guard consults `source` ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_guard_expense_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.description := public.fn_clean_text(NEW.description);
  NEW.payee_name  := NULLIF(public.fn_clean_text(NEW.payee_name), '');
  NEW.reference   := NULLIF(public.fn_clean_text(NEW.reference), '');

  PERFORM public.fn_validate_expense_amounts(
    NEW.description, NEW.amount_minor, NEW.date, NEW.receipt_path, 'expense',
    COALESCE(NEW.source, 'capture') = 'capture');

  IF COALESCE(btrim(NEW.payment_method), '') = '' THEN
    RAISE EXCEPTION 'Choose how this expense was paid — the credit side of the journal follows it.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.payee_id IS NULL AND COALESCE(btrim(NEW.payee_name), '') = '' THEN
    RAISE EXCEPTION 'Name who was paid.' USING ERRCODE = 'check_violation';
  END IF;

  -- A bank reference is only meaningful for money that moved through a bank,
  -- and only where the person recording it chose the method.
  IF COALESCE(NEW.source, 'capture') = 'capture'
     AND lower(btrim(NEW.payment_method)) IN ('transfer', 'card', 'pos')
     AND NEW.bank_account_id IS NULL THEN
    RAISE EXCEPTION 'A % payment needs the bank account it went through.', NEW.payment_method
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. Claim lines keep the full capture standard ───────────────────────────
-- A line IS the point of capture, so nothing is relaxed here. This is what
-- guarantees that a row posted with source = 'claim' was already held to the
-- receipt rule upstream.

CREATE OR REPLACE FUNCTION public.fn_guard_expense_line()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_claim record; v_receipt text;
BEGIN
  NEW.description := public.fn_clean_text(NEW.description);
  NEW.payee_name  := NULLIF(public.fn_clean_text(NEW.payee_name), '');
  NEW.reference   := NULLIF(public.fn_clean_text(NEW.reference), '');

  SELECT * INTO v_claim FROM public.expense_claim WHERE id = NEW.claim_id;
  SELECT storage_path INTO v_receipt FROM public.expense_receipts WHERE id = NEW.receipt_id;

  PERFORM public.fn_validate_expense_amounts(
    NEW.description, NEW.amount_minor, v_claim.claim_date, v_receipt, 'expense line', true);

  RETURN NEW;
END;
$$;

-- ── 5. Claim postings identify themselves ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_post_expense_claim(p_claim uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; l record; v_expense uuid; v_count integer := 0;
BEGIN
  SELECT * INTO c FROM public.expense_claim WHERE id = p_claim;
  IF NOT FOUND OR c.status <> 'approved' OR c.posted_at IS NOT NULL THEN
    RETURN 0;
  END IF;

  FOR l IN SELECT * FROM public.expense_line WHERE claim_id = p_claim ORDER BY line_no LOOP
    INSERT INTO public.expenses (
      amount_minor, description, category, category_id, date, budget_id,
      expense_account_code, cost_center, payment_method, bank_account_id,
      vat_minor, wht_minor, reference, receipt_path,
      payee_id, payee_name,
      submitted_by, submitted_at, created_by, status, approved_by, approved_at,
      expense_line_id, account_type, source
    )
    SELECT
      l.amount_minor, l.description, cat.name, l.category_id, c.claim_date, l.budget_id,
      coa.code, cc.name, l.payment_method, l.bank_account_id,
      l.vat_minor, l.wht_minor, l.reference,
      (SELECT storage_path FROM public.expense_receipts WHERE id = l.receipt_id),
      l.payee_id, l.payee_name,
      c.submitted_by, c.submitted_at, c.approved_by, 'approved', c.approved_by, c.approved_at,
      l.id,
      CASE WHEN coa.code = '5000' THEN 'COGS' ELSE 'OpEX' END,
      'claim'
    FROM public.expense_categories cat
    JOIN public.chart_of_accounts coa ON coa.id = l.expense_account_id
    JOIN public.cost_centres cc       ON cc.id  = l.cost_centre_id
    WHERE cat.id = l.category_id
    RETURNING id INTO v_expense;

    UPDATE public.expense_line SET expense_id = v_expense WHERE id = l.id;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.expense_claim SET posted_at = now() WHERE id = p_claim;
  RETURN v_count;
END;
$$;

COMMIT;
