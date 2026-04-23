-- Finance ledger: append-only log connecting sales, invoices, expenses and payments
-- into a single auditable financial record.

CREATE TABLE IF NOT EXISTS public.finance_ledger (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID           NOT NULL REFERENCES auth.users(id),
  entry_date       DATE           NOT NULL,
  entry_type       TEXT           NOT NULL CHECK (entry_type IN ('revenue', 'payment_received')),
  source_type      TEXT           NOT NULL CHECK (source_type IN ('sale', 'invoice', 'payment')),
  source_id        UUID           NOT NULL,
  description      TEXT           NOT NULL,
  amount           NUMERIC(12,2)  NOT NULL,
  cost_center      TEXT,          -- 'Daily Orders' | 'Event Account'
  invoice_type     TEXT,          -- 'daily_sales' | 'event' (when source is invoice)
  reference_number TEXT,          -- sale_number / invoice_number / quotation_number
  recorded_by      UUID           REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

ALTER TABLE public.finance_ledger ENABLE ROW LEVEL SECURITY;

-- Append: authenticated users insert under their own user_id
CREATE POLICY "finance_ledger_insert" ON public.finance_ledger
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Read: all authenticated users can see all entries (shared finance view)
CREATE POLICY "finance_ledger_select" ON public.finance_ledger
  FOR SELECT TO authenticated USING (true);

-- No UPDATE / DELETE policies — ledger is append-only for audit integrity

GRANT SELECT, INSERT ON public.finance_ledger TO authenticated;
