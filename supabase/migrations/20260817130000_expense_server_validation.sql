-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 3 — server-side validation.
--
-- Rule 3 of the fix instructions: "Validate on the server. Client-side
-- validation is a convenience, never the control. Every rule must hold if the
-- request is posted directly to the API."
--
-- These triggers are the control. The TypeScript validator in
-- src/lib/expenseValidation.ts exists so the user gets a useful message before
-- they submit; if the two ever disagree, this file wins.
--
-- New rows are held to the full standard. Existing rows are not retro-fitted —
-- an approver updating a 2026-03 record must not be blocked by a rule that did
-- not exist when it was captured; those are corrected through M-03 instead.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Configurable thresholds, so the server and client agree ──────────────

CREATE TABLE IF NOT EXISTS public.expense_settings (
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),
  receipt_threshold_minor   bigint  NOT NULL DEFAULT 1000000,     -- ₦10,000
  implausibility_factor     integer NOT NULL DEFAULT 100,         -- 100x
  amount_ceiling_minor      bigint  NOT NULL DEFAULT 5000000000,  -- ₦50,000,000
  future_date_tolerance_days integer NOT NULL DEFAULT 0,
  pasted_list_token_count   integer NOT NULL DEFAULT 3,
  pasted_list_token_floor   bigint  NOT NULL DEFAULT 1000,
  updated_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.expense_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.expense_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expense_settings_read" ON public.expense_settings;
CREATE POLICY "expense_settings_read" ON public.expense_settings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "expense_settings_admin" ON public.expense_settings;
CREATE POLICY "expense_settings_admin" ON public.expense_settings
  FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.expense_settings TO authenticated;

-- ── 2. Shared helpers ───────────────────────────────────────────────────────

/** Strip the directional and zero-width marks a chat paste carries. */
CREATE OR REPLACE FUNCTION public.fn_clean_text(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(regexp_replace(COALESCE(p, ''), '[‎‏﻿⁦⁧⁨⁩ ]', '', 'g'), '\s+', ' ', 'g'));
$$;

/** The largest number mentioned in a piece of prose, in major units. */
CREATE OR REPLACE FUNCTION public.fn_largest_number_in(p text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(MAX(replace(m[1], ',', '')::numeric), 0)
    FROM regexp_matches(COALESCE(p, ''), '\d[\d,]*(?:\.\d+)?', 'g') AS m;
$$;

/** How many numbers above a floor a piece of prose mentions. */
CREATE OR REPLACE FUNCTION public.fn_count_numbers_above(p text, p_floor numeric)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COUNT(*)::integer
    FROM regexp_matches(COALESCE(p, ''), '\d[\d,]*(?:\.\d+)?', 'g') AS m
   WHERE replace(m[1], ',', '')::numeric > p_floor;
$$;

-- ── 3. The validator ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_validate_expense_amounts(
  p_description  text,
  p_amount_minor bigint,
  p_date         date,
  p_receipt      text,
  p_label        text DEFAULT 'expense'
) RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  s        record;
  v_clean  text;
  v_largest numeric;
  v_amount_major numeric;
BEGIN
  SELECT * INTO s FROM public.expense_settings WHERE id;

  v_clean := public.fn_clean_text(p_description);
  v_amount_major := p_amount_minor / 100.0;

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

  -- The implausibility check: the defect that stored "Total amount 922,340"
  -- as ₦922.34 would have been caught here.
  v_largest := public.fn_largest_number_in(v_clean);
  IF v_largest >= v_amount_major * s.implausibility_factor THEN
    RAISE EXCEPTION 'The description mentions % but the amount is %. Please check.',
      to_char(v_largest, 'FM999,999,999.00'), to_char(v_amount_major, 'FM999,999,999.00')
      USING ERRCODE = 'check_violation';
  END IF;

  -- A pasted shopping list belongs in separate lines.
  IF public.fn_count_numbers_above(v_clean, s.pasted_list_token_floor) >= s.pasted_list_token_count THEN
    RAISE EXCEPTION 'This description holds several purchases. Split it so each purchase is its own line.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Dates.
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'A % needs a date.', p_label USING ERRCODE = 'check_violation';
  END IF;
  IF p_date > current_date + s.future_date_tolerance_days THEN
    RAISE EXCEPTION 'A % cannot be dated in the future (%).', p_label, p_date
      USING ERRCODE = 'check_violation';
  END IF;

  -- Receipts above the threshold.
  IF p_amount_minor >= s.receipt_threshold_minor AND COALESCE(btrim(p_receipt), '') = '' THEN
    RAISE EXCEPTION 'A receipt is required at % and above.',
      to_char(s.receipt_threshold_minor / 100.0, 'FM999,999,999.00')
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ── 4. Applied to new expense rows ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_guard_expense_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.description := public.fn_clean_text(NEW.description);
  NEW.payee_name  := NULLIF(public.fn_clean_text(NEW.payee_name), '');
  NEW.reference   := NULLIF(public.fn_clean_text(NEW.reference), '');

  PERFORM public.fn_validate_expense_amounts(
    NEW.description, NEW.amount_minor, NEW.date, NEW.receipt_path, 'expense');

  IF COALESCE(btrim(NEW.payment_method), '') = '' THEN
    RAISE EXCEPTION 'Choose how this expense was paid — the credit side of the journal follows it.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.payee_id IS NULL AND COALESCE(btrim(NEW.payee_name), '') = '' THEN
    RAISE EXCEPTION 'Name who was paid.' USING ERRCODE = 'check_violation';
  END IF;

  IF lower(btrim(NEW.payment_method)) IN ('transfer', 'card', 'pos')
     AND NEW.bank_account_id IS NULL THEN
    RAISE EXCEPTION 'A % payment needs the bank account it went through.', NEW.payment_method
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_insert ON public.expenses;
CREATE TRIGGER trg_guard_expense_insert
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_expense_insert();

-- An amount may still be corrected on an existing row (that is migration
-- M-03), but it must pass the same amount rules when it is.
CREATE OR REPLACE FUNCTION public.fn_guard_expense_amount_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor THEN
    IF NEW.amount_minor <= 0 THEN
      RAISE EXCEPTION 'An expense amount must be greater than zero.' USING ERRCODE = 'check_violation';
    END IF;
    -- Keep the before-image so a correction is always traceable.
    IF NEW.amount_corrected_from IS NULL THEN
      NEW.amount_corrected_from := OLD.amount_minor;
      NEW.amount_corrected_by   := COALESCE(NEW.amount_corrected_by, auth.uid());
      NEW.amount_corrected_at   := now();
    END IF;
    NEW.amount_suspect := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_amount_update ON public.expenses;
CREATE TRIGGER trg_guard_expense_amount_update
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_expense_amount_update();

-- ── 5. Applied to claim lines ───────────────────────────────────────────────

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
    NEW.description, NEW.amount_minor, v_claim.claim_date, v_receipt, 'expense line');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_line ON public.expense_line;
CREATE TRIGGER trg_guard_expense_line
  BEFORE INSERT OR UPDATE ON public.expense_line
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_expense_line();

-- ── 6. Approval controls on a claim ─────────────────────────────────────────
-- The approver must not be the submitter, and only an admin may approve.
-- (A CHECK constraint already covers approver <> submitter; this produces a
-- message a human can act on, and blocks self-approval by role too.)

CREATE OR REPLACE FUNCTION public.fn_guard_expense_claim_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved', 'rejected')
     AND auth.uid() IS NOT NULL THEN

    IF NOT public.is_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only an admin can approve or reject an expense claim.';
    END IF;

    IF auth.uid() = OLD.submitted_by THEN
      RAISE EXCEPTION 'You cannot approve a claim you submitted yourself.';
    END IF;

    IF NEW.status = 'approved' THEN
      IF NOT EXISTS (SELECT 1 FROM public.expense_line WHERE claim_id = NEW.id) THEN
        RAISE EXCEPTION 'A claim with no lines cannot be approved.';
      END IF;
      IF NEW.stated_total_minor IS NOT NULL
         AND NEW.stated_total_minor <> NEW.total_minor THEN
        RAISE EXCEPTION 'The lines total % but the stated total is %. Reconcile them before approving.',
          to_char(NEW.total_minor / 100.0, 'FM999,999,999.00'),
          to_char(NEW.stated_total_minor / 100.0, 'FM999,999,999.00');
      END IF;
      NEW.approved_by := auth.uid();
      NEW.approved_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_expense_claim_approval ON public.expense_claim;
CREATE TRIGGER trg_guard_expense_claim_approval
  BEFORE UPDATE ON public.expense_claim
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_expense_claim_approval();

-- ── 7. Approving a claim writes its lines into `expenses` ───────────────────
-- One line, one expense row, one journal. Identity is carried through:
-- submitted_by stays the staff member, created_by/approved_by the approver.

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
      expense_line_id, account_type
    )
    SELECT
      l.amount_minor, l.description, cat.name, l.category_id, c.claim_date, l.budget_id,
      coa.code, cc.name, l.payment_method, l.bank_account_id,
      l.vat_minor, l.wht_minor, l.reference,
      (SELECT storage_path FROM public.expense_receipts WHERE id = l.receipt_id),
      l.payee_id, l.payee_name,
      c.submitted_by, c.submitted_at, c.approved_by, 'approved', c.approved_by, c.approved_at,
      l.id,
      CASE WHEN coa.code = '5000' THEN 'COGS' ELSE 'OpEX' END
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

GRANT EXECUTE ON FUNCTION public.fn_post_expense_claim(uuid) TO authenticated;

COMMIT;
