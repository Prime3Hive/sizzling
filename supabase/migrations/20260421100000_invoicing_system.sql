-- Invoicing system: quotations → invoices for daily sales and events
--
-- RLS follows the same pattern as sales/products/payments in this codebase:
-- owner access via auth.uid() = user_id.
-- Admin/manager access is enforced at the application layer (BusinessRoute).
-- This keeps the migration self-contained with zero external dependencies.

-- ── Sequence tracker ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  prefix      TEXT    NOT NULL,
  year_month  TEXT    NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year_month)
);

-- ── Main invoices table ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID          NOT NULL REFERENCES auth.users(id),
  quotation_number       TEXT          UNIQUE NOT NULL,
  invoice_number         TEXT          UNIQUE,
  invoice_type           TEXT          NOT NULL CHECK (invoice_type IN ('daily_sales', 'event')),
  status                 TEXT          NOT NULL DEFAULT 'quotation'
                                       CHECK (status IN ('quotation', 'invoice', 'cancelled')),
  customer_name          TEXT          NOT NULL,
  customer_email         TEXT,
  customer_phone         TEXT,
  customer_address       TEXT,
  event_name             TEXT,
  event_date             DATE,
  event_venue            TEXT,
  number_of_guests       INTEGER,
  subtotal               NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_percent       NUMERIC(5,2)  NOT NULL DEFAULT 0,
  discount_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_percent            NUMERIC(5,2)  NOT NULL DEFAULT 0,
  tax_amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_charge_percent NUMERIC(5,2)  NOT NULL DEFAULT 0,
  service_charge_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid            NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status         TEXT          NOT NULL DEFAULT 'unpaid'
                                       CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  issue_date             DATE          NOT NULL DEFAULT CURRENT_DATE,
  valid_until            DATE,
  converted_at           TIMESTAMPTZ,
  notes                  TEXT,
  terms                  TEXT,
  recorded_in_finance    BOOLEAN       NOT NULL DEFAULT FALSE,
  finance_recorded_at    TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_by             UUID          REFERENCES auth.users(id)
);

-- ── Line items ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID          NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  product_id  UUID,
  sku_id      UUID,
  description TEXT          NOT NULL,
  quantity    NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit        TEXT          NOT NULL DEFAULT 'pcs',
  unit_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  sort_order  INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Auto-number generator ─────────────────────────────────────────────────────
-- SECURITY DEFINER so authenticated users can call it and it writes to
-- invoice_sequences under the function owner's privileges.
CREATE OR REPLACE FUNCTION public.generate_invoice_number(p_prefix TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year_month TEXT;
  v_new_num    INTEGER;
BEGIN
  v_year_month := to_char(NOW(), 'YYYY-MM');

  INSERT INTO public.invoice_sequences (prefix, year_month, last_number)
    VALUES (p_prefix, v_year_month, 1)
    ON CONFLICT (prefix, year_month)
    DO UPDATE SET last_number = public.invoice_sequences.last_number + 1
    RETURNING last_number INTO v_new_num;

  RETURN p_prefix || '-' || v_year_month || '-' || lpad(v_new_num::TEXT, 4, '0');
END;
$$;

-- ── updated_at trigger ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_invoices_updated_at ON public.invoices;
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_select"            ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert"            ON public.invoices;
DROP POLICY IF EXISTS "invoices_update"            ON public.invoices;
DROP POLICY IF EXISTS "invoices_delete"            ON public.invoices;
DROP POLICY IF EXISTS "invoice_items_select"       ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_insert"       ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_update"       ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_delete"       ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_sequences_select"   ON public.invoice_sequences;

-- invoices: same pattern as public.sales — owner can do everything
CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "invoices_delete" ON public.invoices
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- invoice_items: same pattern as public.sale_items — access follows parent invoice
CREATE POLICY "invoice_items_select" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "invoice_items_insert" ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "invoice_items_update" ON public.invoice_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "invoice_items_delete" ON public.invoice_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices
      WHERE id = invoice_id AND user_id = auth.uid()
    )
  );

-- invoice_sequences: only the generate_invoice_number() SECURITY DEFINER
-- function needs write access.  Authenticated users can read their own prefix rows.
CREATE POLICY "invoice_sequences_select" ON public.invoice_sequences
  FOR SELECT TO authenticated
  USING (true);

-- Grant execute so PostgREST includes this function in its schema cache for
-- authenticated API calls.  Without this the RPC returns "function not found".
GRANT EXECUTE ON FUNCTION public.generate_invoice_number(TEXT) TO authenticated;
