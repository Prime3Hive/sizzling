-- ─────────────────────────────────────────────────────────────────────────────
-- invoice_payments — dated, per-payment history for invoices
--
-- Replaces reliance on the single cumulative invoices.amount_paid scalar so that
-- cash collected can be attributed to the actual payment date (cash basis),
-- independent of whether the invoice was "Recorded in Finance".
--
-- invoices.amount_paid and payment_status are kept in sync automatically by a
-- trigger, so existing readers keep working — but invoice_payments is the
-- authoritative, dated source of cash receipts.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     uuid        NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount         numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_date   date        NOT NULL DEFAULT current_date,
  payment_method text,
  reference      text,
  notes          text,
  recorded_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON public.invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_date    ON public.invoice_payments(payment_date);

ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

-- Access is scoped to the owner of the parent invoice (mirrors invoice_items).
DROP POLICY IF EXISTS "invoice_payments_select" ON public.invoice_payments;
DROP POLICY IF EXISTS "invoice_payments_insert" ON public.invoice_payments;
DROP POLICY IF EXISTS "invoice_payments_update" ON public.invoice_payments;
DROP POLICY IF EXISTS "invoice_payments_delete" ON public.invoice_payments;

CREATE POLICY "invoice_payments_select" ON public.invoice_payments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE id = invoice_id AND user_id = auth.uid()));

CREATE POLICY "invoice_payments_insert" ON public.invoice_payments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.invoices WHERE id = invoice_id AND user_id = auth.uid()));

CREATE POLICY "invoice_payments_update" ON public.invoice_payments
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE id = invoice_id AND user_id = auth.uid()));

CREATE POLICY "invoice_payments_delete" ON public.invoice_payments
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices WHERE id = invoice_id AND user_id = auth.uid()));

-- ── Keep invoices.amount_paid / payment_status in sync ────────────────────────
CREATE OR REPLACE FUNCTION public.sync_invoice_amount_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv_id uuid;
  inv_total numeric;
  paid_sum  numeric;
BEGIN
  inv_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT COALESCE(SUM(amount), 0) INTO paid_sum
  FROM public.invoice_payments WHERE invoice_id = inv_id;

  SELECT total_amount INTO inv_total
  FROM public.invoices WHERE id = inv_id;

  UPDATE public.invoices
  SET amount_paid    = paid_sum,
      payment_status = CASE
        WHEN paid_sum <= 0            THEN 'unpaid'
        WHEN paid_sum >= inv_total    THEN 'paid'
        ELSE 'partial'
      END,
      updated_at = now()
  WHERE id = inv_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_invoice_paid ON public.invoice_payments;
CREATE TRIGGER trg_sync_invoice_paid
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_invoice_amount_paid();

-- ── Backfill: one dated payment row per invoice that already shows amount_paid ─
-- Dated at converted_at → issue_date → created_at. Guarded so re-running the
-- migration cannot create duplicates.
INSERT INTO public.invoice_payments (invoice_id, amount, payment_date, payment_method, reference, notes, recorded_by)
SELECT
  i.id,
  i.amount_paid,
  COALESCE(i.converted_at::date, i.issue_date, i.created_at::date),
  'backfill',
  i.invoice_number,
  'Backfilled from amount_paid at migration',
  i.updated_by
FROM public.invoices i
WHERE i.amount_paid > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.invoice_payments ip WHERE ip.invoice_id = i.id
  );
