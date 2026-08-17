-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2/3 — one purchase is one row.
--
-- Fixes E-03, E-02, E-09. An expense claim held many purchases in a single
-- description string, so a day's market shopping arrived as one narrative with
-- the amounts embedded in prose. This gives claims proper line items, and puts
-- category, payee, cost centre and expense account behind controlled tables
-- instead of free text.
--
-- The existing `expenses` table is NOT dropped. It remains the posting surface
-- the ledger reads; an approved claim writes its lines into it. That keeps the
-- P&L, budgets and journals working while the capture side is restructured.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Controlled reference tables ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  -- Default expense account for this category. NULL means the user must
  -- choose: section 5.4 requires the account field to have no default until
  -- the finance lead supplies the mapping.
  account_code text       REFERENCES public.chart_of_accounts(code),
  is_active   boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.expense_categories (name, sort_order) VALUES
  ('Raw Materials', 10), ('Packaging', 20), ('Production Labour', 30),
  ('Shipping & Transportation', 40), ('Repairs & Maintenance', 50),
  ('Salaries & Wages', 60), ('Catering Services', 70), ('Event Staff', 80),
  ('Proteins', 90), ('Snacks', 100), ('Chefs Payment', 110),
  ('Waiters Payment', 120), ('Petty Cash', 130), ('Credit Purchase', 140),
  ('Miscellaneous', 900)
ON CONFLICT (name) DO NOTHING;

-- Cost centres, previously a free-text column with three conventional values.
CREATE TABLE IF NOT EXISTS public.cost_centres (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  is_active  boolean     NOT NULL DEFAULT true,
  sort_order integer     NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.cost_centres (name, sort_order) VALUES
  ('Daily Orders', 10), ('Event Account', 20), ('Operations Account', 30)
ON CONFLICT (name) DO NOTHING;

-- Payee / vendor master.
--
-- NOTE: EXPENSE-FIX-INSTRUCTIONS.md §5.4 requires the payee field to be a
-- typeahead "against the vendor master", and defers the vendor master itself
-- to FIX-INSTRUCTIONS.md, which is not present in this repository. This is a
-- minimal master sufficient for expense capture — name, contact, TIN, active
-- flag. If the procure-to-pay work later brings its own vendor table, these
-- rows are the migration source.
CREATE TABLE IF NOT EXISTS public.payees (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  kind       text        NOT NULL DEFAULT 'supplier' CHECK (kind IN ('supplier', 'staff', 'one-off', 'other')),
  phone      text,
  tin        text,
  notes      text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payees_name ON public.payees (lower(name));

-- Receipts, so a line can point at one and the same image can back several.
CREATE TABLE IF NOT EXISTS public.expense_receipts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path  text        NOT NULL,
  mime_type     text,
  byte_size     integer,
  uploaded_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Claims and lines ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.expense_claim (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_date    date        NOT NULL DEFAULT current_date,
  submitted_by  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  submitted_at  timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  approved_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at   timestamptz,
  review_note   text,
  -- Kept in step with the lines by trigger. Never entered directly.
  total_minor   bigint      NOT NULL DEFAULT 0,
  -- A total the staff member stated, to reconcile the lines against.
  stated_total_minor bigint,
  -- The accounting period the claim falls in, derived from the claim date.
  --
  -- The cast to `timestamp` is required, not decorative. There is no
  -- date_trunc(text, date) overload, so a bare `claim_date` resolves to
  -- date_trunc(text, timestamptz), which is STABLE rather than IMMUTABLE
  -- because it depends on the session TimeZone — and a generated column
  -- rejects a non-immutable expression:
  --   ERROR: 42P17: generation expression is not immutable
  period_month  date        GENERATED ALWAYS AS (date_trunc('month', claim_date::timestamp)::date) STORED,
  notes         text,
  -- Set when an approved claim has been written into `expenses`.
  posted_at     timestamptz,
  source_report_id uuid     REFERENCES public.staff_reports(id) ON DELETE SET NULL,
  cancelled_at  timestamptz,
  cancelled_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  cancellation_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- The approver may not be the submitter.
  CONSTRAINT expense_claim_approver_not_submitter
    CHECK (approved_by IS NULL OR approved_by <> submitted_by)
);

CREATE INDEX IF NOT EXISTS idx_expense_claim_status ON public.expense_claim (status);
CREATE INDEX IF NOT EXISTS idx_expense_claim_submitter ON public.expense_claim (submitted_by);
CREATE INDEX IF NOT EXISTS idx_expense_claim_period ON public.expense_claim (period_month);

CREATE TABLE IF NOT EXISTS public.expense_line (
  id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id           uuid    NOT NULL REFERENCES public.expense_claim(id) ON DELETE CASCADE,
  line_no            integer NOT NULL,
  description        text    NOT NULL,
  amount_minor       bigint  NOT NULL,
  category_id        uuid    NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  payee_id           uuid    REFERENCES public.payees(id) ON DELETE RESTRICT,
  -- A one-off payee that is not worth a master record still needs a name.
  payee_name         text,
  expense_account_id uuid    NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  cost_centre_id     uuid    NOT NULL REFERENCES public.cost_centres(id) ON DELETE RESTRICT,
  budget_id          uuid    REFERENCES public.budgets(id) ON DELETE SET NULL,
  vat_minor          bigint  NOT NULL DEFAULT 0,
  wht_minor          bigint  NOT NULL DEFAULT 0,
  receipt_id         uuid    REFERENCES public.expense_receipts(id) ON DELETE SET NULL,
  reference          text,
  payment_method     text,
  bank_account_id    uuid,
  -- The `expenses` row this line produced on approval, so the two stay linked.
  expense_id         uuid    REFERENCES public.expenses(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT expense_line_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT expense_line_amount_ceiling  CHECK (amount_minor <= 5000000000),
  CONSTRAINT expense_line_vat_sane        CHECK (vat_minor >= 0 AND vat_minor <= amount_minor),
  CONSTRAINT expense_line_wht_sane        CHECK (wht_minor >= 0 AND wht_minor <= amount_minor),
  CONSTRAINT expense_line_description_present CHECK (btrim(description) <> ''),
  CONSTRAINT expense_line_payee_present
    CHECK (payee_id IS NOT NULL OR btrim(COALESCE(payee_name, '')) <> ''),
  CONSTRAINT expense_line_unique_no UNIQUE (claim_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_expense_line_claim ON public.expense_line (claim_id);
CREATE INDEX IF NOT EXISTS idx_expense_line_category ON public.expense_line (category_id);
CREATE INDEX IF NOT EXISTS idx_expense_line_payee ON public.expense_line (payee_id);

-- A reference may not be reused for the same payee (§5.4 duplicate check).
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_line_payee_reference
  ON public.expense_line (COALESCE(payee_id::text, lower(payee_name)), lower(reference))
  WHERE reference IS NOT NULL AND btrim(reference) <> '';

-- ── 3. Derived total ────────────────────────────────────────────────────────
-- total_minor is the sum of the lines and is never entered directly.

CREATE OR REPLACE FUNCTION public.fn_expense_claim_retotal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claim uuid;
BEGIN
  v_claim := COALESCE(NEW.claim_id, OLD.claim_id);
  UPDATE public.expense_claim c
     SET total_minor = COALESCE((SELECT SUM(l.amount_minor) FROM public.expense_line l WHERE l.claim_id = v_claim), 0),
         updated_at  = now()
   WHERE c.id = v_claim;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_line_retotal ON public.expense_line;
CREATE TRIGGER trg_expense_line_retotal
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_line
  FOR EACH ROW EXECUTE FUNCTION public.fn_expense_claim_retotal();

-- Refuse a direct write to total_minor that disagrees with the lines.
CREATE OR REPLACE FUNCTION public.fn_expense_claim_guard_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sum bigint;
BEGIN
  SELECT COALESCE(SUM(amount_minor), 0) INTO v_sum
    FROM public.expense_line WHERE claim_id = NEW.id;
  IF NEW.total_minor IS DISTINCT FROM v_sum THEN
    NEW.total_minor := v_sum;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_claim_guard_total ON public.expense_claim;
CREATE TRIGGER trg_expense_claim_guard_total
  BEFORE UPDATE ON public.expense_claim
  FOR EACH ROW EXECUTE FUNCTION public.fn_expense_claim_guard_total();

-- ── 4. Row level security ───────────────────────────────────────────────────

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_centres       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payees             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_receipts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_claim      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_line       ENABLE ROW LEVEL SECURITY;

-- Reference data: everyone reads, admins maintain.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_categories', 'cost_centres', 'payees'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_read" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "%1$s_read" ON public.%1$I FOR SELECT TO authenticated USING (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_admin" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "%1$s_admin" ON public.%1$I FOR ALL TO authenticated USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%1$I TO authenticated', t);
  END LOOP;
END $$;

-- A staff member may add a payee while capturing (the "one-off payee" path).
DROP POLICY IF EXISTS "payees_insert_authenticated" ON public.payees;
CREATE POLICY "payees_insert_authenticated" ON public.payees
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- Receipts: the uploader and admins.
DROP POLICY IF EXISTS "expense_receipts_own" ON public.expense_receipts;
CREATE POLICY "expense_receipts_own" ON public.expense_receipts
  FOR ALL TO authenticated
  USING (uploaded_by = auth.uid() OR is_admin(auth.uid()))
  WITH CHECK (uploaded_by = auth.uid() OR is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_receipts TO authenticated;

-- Claims: a staff member sees and edits their own while it is a draft;
-- admins see everything.
DROP POLICY IF EXISTS "expense_claim_own_read" ON public.expense_claim;
CREATE POLICY "expense_claim_own_read" ON public.expense_claim
  FOR SELECT TO authenticated
  USING (submitted_by = auth.uid() OR is_admin(auth.uid()));

DROP POLICY IF EXISTS "expense_claim_own_insert" ON public.expense_claim;
CREATE POLICY "expense_claim_own_insert" ON public.expense_claim
  FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid());

DROP POLICY IF EXISTS "expense_claim_own_update" ON public.expense_claim;
CREATE POLICY "expense_claim_own_update" ON public.expense_claim
  FOR UPDATE TO authenticated
  USING ((submitted_by = auth.uid() AND status IN ('draft', 'rejected')) OR is_admin(auth.uid()))
  WITH CHECK ((submitted_by = auth.uid() AND status IN ('draft', 'submitted')) OR is_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.expense_claim TO authenticated;

DROP POLICY IF EXISTS "expense_line_via_claim" ON public.expense_line;
CREATE POLICY "expense_line_via_claim" ON public.expense_line
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.expense_claim c
     WHERE c.id = expense_line.claim_id
       AND (c.submitted_by = auth.uid() OR is_admin(auth.uid()))))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.expense_claim c
     WHERE c.id = expense_line.claim_id
       AND ((c.submitted_by = auth.uid() AND c.status IN ('draft', 'rejected'))
            OR is_admin(auth.uid()))));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_line TO authenticated;

-- ── 5. Link `expenses` back to the line that produced it ────────────────────

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_line_id uuid REFERENCES public.expense_line(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payee_id  uuid REFERENCES public.payees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payee_name text,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS expense_account_code text REFERENCES public.chart_of_accounts(code),
  ADD COLUMN IF NOT EXISTS vat_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wht_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

COMMENT ON COLUMN public.expenses.submitted_by IS
  'Who actually incurred/submitted this, carried through from the staff claim. '
  'Distinct from created_by, which is whoever keyed or approved it.';

-- ── 6. M-05 — map the existing free-text categories ─────────────────────────
-- Every distinct category already in `expenses` gets a row so the FK can be
-- applied. Known values map onto the controlled list; anything unrecognised
-- lands on Miscellaneous and is flagged for review rather than silently kept.

CREATE TABLE IF NOT EXISTS public.expense_category_migration (
  raw_value    text PRIMARY KEY,
  mapped_to    text NOT NULL,
  row_count    integer NOT NULL DEFAULT 0,
  needs_review boolean NOT NULL DEFAULT false,
  reviewed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.expense_category_migration (raw_value, mapped_to, row_count, needs_review)
SELECT
  e.category,
  CASE
    WHEN c.name IS NOT NULL                      THEN e.category
    WHEN e.category ILIKE '%credit%'             THEN 'Credit Purchase'
    WHEN e.category ILIKE '%petty%'              THEN 'Petty Cash'
    WHEN e.category ILIKE '%transport%'
      OR e.category ILIKE '%fuel%'
      OR e.category ILIKE '%keke%'
      OR e.category ILIKE '%bus%'                THEN 'Shipping & Transportation'
    WHEN e.category ILIKE '%salar%'
      OR e.category ILIKE '%wage%'               THEN 'Salaries & Wages'
    WHEN e.category ILIKE '%repair%'
      OR e.category ILIKE '%maintenance%'        THEN 'Repairs & Maintenance'
    WHEN e.category ILIKE '%packag%'             THEN 'Packaging'
    ELSE 'Miscellaneous'
  END,
  COUNT(*)::integer,
  -- Anything that did not match the controlled list by name needs a human to
  -- confirm where it landed. "Parsley", "Eggs", "Kulikuli", "Salad cucumbers"
  -- and "1" are all ingredients or noise, not categories.
  (c.name IS NULL)
FROM public.expenses e
LEFT JOIN public.expense_categories c ON c.name = e.category
WHERE e.category IS NOT NULL
GROUP BY e.category, c.name
ON CONFLICT (raw_value) DO NOTHING;

-- Apply the mapping to the existing rows.
UPDATE public.expenses e
   SET category_id = c.id
  FROM public.expense_category_migration m
  JOIN public.expense_categories c ON c.name = m.mapped_to
 WHERE e.category = m.raw_value
   AND e.category_id IS NULL;

-- Anything still unmatched (NULL category) goes to Miscellaneous.
UPDATE public.expenses
   SET category_id = (SELECT id FROM public.expense_categories WHERE name = 'Miscellaneous')
 WHERE category_id IS NULL;

ALTER TABLE public.expense_category_migration ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "expense_category_migration_admin" ON public.expense_category_migration;
CREATE POLICY "expense_category_migration_admin" ON public.expense_category_migration
  FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_category_migration TO authenticated;

-- ── 7. M-06 — normalise text ────────────────────────────────────────────────
-- Strip the directional and zero-width marks that arrive with a chat paste.
-- Rows left empty once stripped are flagged, not deleted.

UPDATE public.expenses
   SET description = btrim(regexp_replace(description, '[‎‏﻿⁦⁧⁨⁩]', '', 'g'))
 WHERE description ~ '[‎‏﻿⁦⁧⁨⁩]';

UPDATE public.payables
   SET supplier    = btrim(regexp_replace(supplier, '[‎‏﻿⁦⁧⁨⁩]', '', 'g')),
       description = btrim(regexp_replace(COALESCE(description, ''), '[‎‏﻿⁦⁧⁨⁩]', '', 'g'))
 WHERE supplier ~ '[‎‏﻿⁦⁧⁨⁩]' OR description ~ '[‎‏⁦⁧⁨⁩﻿]';

-- M-08: a supplier that is empty once stripped is marked, not left blank.
UPDATE public.payables
   SET supplier = 'Unattributed — pre-migration'
 WHERE btrim(COALESCE(supplier, '')) = '';

COMMIT;
