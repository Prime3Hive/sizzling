
-- Create njc_supply_items table for line items within an NJC supply invoice
CREATE TABLE public.njc_supply_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supply_id UUID NOT NULL REFERENCES public.njc_supplies(id) ON DELETE CASCADE,
  item_date DATE NOT NULL,
  description TEXT NOT NULL,
  per_head_price NUMERIC NOT NULL DEFAULT 0,
  number_of_persons INTEGER NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add service_charge_percent and vat_percent to njc_supplies
ALTER TABLE public.njc_supplies
  ADD COLUMN IF NOT EXISTS service_charge_percent NUMERIC NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS vat_percent NUMERIC NOT NULL DEFAULT 7.5,
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_charge_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_title TEXT DEFAULT 'PROVISION OF SNACKS';

-- Enable RLS on njc_supply_items
ALTER TABLE public.njc_supply_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for njc_supply_items - inherit from parent njc_supplies
CREATE POLICY "Users can view their own supply items or admin"
  ON public.njc_supply_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.njc_supplies ns
    WHERE ns.id = njc_supply_items.supply_id
    AND (ns.user_id = auth.uid() OR is_admin(auth.uid()))
  ));

CREATE POLICY "Users can create items for their own supplies"
  ON public.njc_supply_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.njc_supplies ns
    WHERE ns.id = njc_supply_items.supply_id
    AND (ns.user_id = auth.uid() OR is_admin(auth.uid()))
  ));

CREATE POLICY "Users can update items for their own supplies"
  ON public.njc_supply_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.njc_supplies ns
    WHERE ns.id = njc_supply_items.supply_id
    AND (ns.user_id = auth.uid() OR is_admin(auth.uid()))
  ));

CREATE POLICY "Users can delete items for their own supplies"
  ON public.njc_supply_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.njc_supplies ns
    WHERE ns.id = njc_supply_items.supply_id
    AND (ns.user_id = auth.uid() OR is_admin(auth.uid()))
  ));

-- Create trigger for updated_at on njc_supply_items
CREATE TRIGGER update_njc_supply_items_updated_at
  BEFORE UPDATE ON public.njc_supply_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
