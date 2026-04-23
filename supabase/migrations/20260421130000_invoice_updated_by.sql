-- Track who last edited an invoice/quotation (internal audit trail)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);
