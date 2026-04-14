-- Create stock_takes table for periodic inventory reconciliation
CREATE TABLE public.stock_takes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  created_by UUID,
  take_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR NOT NULL DEFAULT 'in_progress',
  notes TEXT,
  total_items_counted INTEGER NOT NULL DEFAULT 0,
  total_variance_value NUMERIC NOT NULL DEFAULT 0,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create stock_take_items table for individual item counts
CREATE TABLE public.stock_take_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stock_take_id UUID NOT NULL REFERENCES public.stock_takes(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  system_quantity NUMERIC NOT NULL DEFAULT 0,
  counted_quantity NUMERIC NOT NULL DEFAULT 0,
  variance NUMERIC NOT NULL DEFAULT 0,
  variance_value NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  counted_by UUID,
  counted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.stock_takes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_take_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for stock_takes
CREATE POLICY "Admins can manage stock takes"
ON public.stock_takes
FOR ALL
USING (is_admin(auth.uid()));

CREATE POLICY "All users can view stock takes"
ON public.stock_takes
FOR SELECT
USING (true);

-- RLS Policies for stock_take_items
CREATE POLICY "Admins can manage stock take items"
ON public.stock_take_items
FOR ALL
USING (is_admin(auth.uid()));

CREATE POLICY "All users can view stock take items"
ON public.stock_take_items
FOR SELECT
USING (true);

-- Add trigger for updated_at
CREATE TRIGGER update_stock_takes_updated_at
BEFORE UPDATE ON public.stock_takes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_stock_take_items_updated_at
BEFORE UPDATE ON public.stock_take_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();