-- ─────────────────────────────────────────────────────────────────────────────
-- Double-entry accounting foundation
--
-- chart_of_accounts → journal_entries → journal_lines (debit/credit)
-- A deferred constraint trigger guarantees every journal entry balances
-- (sum of debits = sum of credits), which is what makes a real Trial Balance
-- possible. Admin-only access.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Chart of accounts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text        NOT NULL UNIQUE,
  name           text        NOT NULL,
  type           text        NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  normal_balance text        NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_active      boolean     NOT NULL DEFAULT true,
  sort_order     integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Journal entries (header) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no    bigserial,
  entry_date  date        NOT NULL DEFAULT current_date,
  memo        text,
  source_type text        NOT NULL DEFAULT 'manual',
  source_id   uuid,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON public.journal_entries(entry_date);

-- ── Journal lines (debit / credit) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_lines (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid          NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id  uuid          NOT NULL REFERENCES public.chart_of_accounts(id),
  debit       numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit      numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text,
  CONSTRAINT journal_lines_one_side  CHECK (NOT (debit > 0 AND credit > 0)),
  CONSTRAINT journal_lines_nonzero   CHECK (debit > 0 OR credit > 0)
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry   ON public.journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON public.journal_lines(account_id);

-- ── Balance enforcement: debits must equal credits per entry (checked at commit)
CREATE OR REPLACE FUNCTION public.check_journal_entry_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  eid uuid;
  d   numeric;
  c   numeric;
BEGIN
  eid := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
  INTO d, c
  FROM public.journal_lines
  WHERE entry_id = eid;

  IF d <> c THEN
    RAISE EXCEPTION 'Journal entry is not balanced: debits % <> credits %', d, c;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_balanced ON public.journal_lines;
CREATE CONSTRAINT TRIGGER trg_journal_balanced
  AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_journal_entry_balanced();

-- ── RLS: admin only ───────────────────────────────────────────────────────────
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chart_of_accounts', 'journal_entries', 'journal_lines'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_admin_all" ON public.%I', t, t);
    EXECUTE format($f$
      CREATE POLICY "%s_admin_all" ON public.%I
        FOR ALL TO authenticated
        USING     (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
        WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
    $f$, t, t);
  END LOOP;
END $$;

-- ── Seed a standard small-business chart of accounts ──────────────────────────
INSERT INTO public.chart_of_accounts (code, name, type, normal_balance, sort_order) VALUES
  ('1000', 'Cash',                 'asset',     'debit',  10),
  ('1010', 'Bank',                 'asset',     'debit',  20),
  ('1100', 'Accounts Receivable',  'asset',     'debit',  30),
  ('1200', 'Inventory',            'asset',     'debit',  40),
  ('2000', 'Accounts Payable',     'liability', 'credit', 50),
  ('2100', 'VAT Payable',          'liability', 'credit', 60),
  ('2200', 'Accruals',             'liability', 'credit', 70),
  ('3000', 'Owner''s Equity',      'equity',    'credit', 80),
  ('3100', 'Retained Earnings',    'equity',    'credit', 90),
  ('4000', 'Sales Revenue',        'income',    'credit', 100),
  ('4010', 'Event Revenue',        'income',    'credit', 110),
  ('4900', 'Other Income',         'income',    'credit', 120),
  ('5000', 'Cost of Goods Sold',   'expense',   'debit',  130),
  ('5100', 'Salaries & Wages',     'expense',   'debit',  140),
  ('5200', 'Rent',                 'expense',   'debit',  150),
  ('5300', 'Utilities',            'expense',   'debit',  160),
  ('5400', 'Operating Expenses',   'expense',   'debit',  170),
  ('5900', 'Other Expenses',       'expense',   'debit',  180)
ON CONFLICT (code) DO NOTHING;
