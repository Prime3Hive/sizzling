-- Create SKUs table for detailed inventory management
CREATE TABLE public.skus (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  sku_type VARCHAR(10) NOT NULL CHECK (sku_type IN ('RAW', 'FP', 'CB')),
  unit_of_measure VARCHAR(50) NOT NULL,
  stock_quantity DECIMAL(12,4) NOT NULL DEFAULT 0,
  reorder_level DECIMAL(12,4) DEFAULT 0,
  cost_per_unit DECIMAL(10,2) DEFAULT 0,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

-- Enable RLS on SKUs
ALTER TABLE public.skus ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for SKUs
CREATE POLICY "Users can view their own skus" 
ON public.skus 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own skus" 
ON public.skus 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own skus" 
ON public.skus 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own skus" 
ON public.skus 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create Bill of Materials table
CREATE TABLE public.bill_of_materials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_sku_id UUID NOT NULL,
  component_sku_id UUID NOT NULL,
  quantity DECIMAL(12,4) NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(parent_sku_id, component_sku_id)
);

-- Enable RLS on BOM
ALTER TABLE public.bill_of_materials ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for BOM
CREATE POLICY "Users can view their own bom" 
ON public.bill_of_materials 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own bom" 
ON public.bill_of_materials 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own bom" 
ON public.bill_of_materials 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own bom" 
ON public.bill_of_materials 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create transactions table for all inventory movements
CREATE TABLE public.transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('PURCHASE', 'PRODUCTION', 'SALE', 'ADJUSTMENT')),
  sku_id UUID NOT NULL,
  quantity DECIMAL(12,4) NOT NULL,
  unit_price DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(12,2) DEFAULT 0,
  reference_id UUID, -- Can reference sales.id, purchase orders, etc.
  notes TEXT,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

-- Enable RLS on transactions
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for transactions
CREATE POLICY "Users can view their own transactions" 
ON public.transactions 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own transactions" 
ON public.transactions 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions" 
ON public.transactions 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Add indexes for better performance
CREATE INDEX idx_skus_user_id ON public.skus(user_id);
CREATE INDEX idx_skus_sku_type ON public.skus(sku_type);
CREATE INDEX idx_skus_stock_quantity ON public.skus(stock_quantity);
CREATE INDEX idx_bom_parent_sku ON public.bill_of_materials(parent_sku_id);
CREATE INDEX idx_bom_component_sku ON public.bill_of_materials(component_sku_id);
CREATE INDEX idx_transactions_sku_id ON public.transactions(sku_id);
CREATE INDEX idx_transactions_type ON public.transactions(transaction_type);
CREATE INDEX idx_transactions_created_at ON public.transactions(created_at);

-- Create trigger for updating timestamps
CREATE TRIGGER update_skus_updated_at
BEFORE UPDATE ON public.skus
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bom_updated_at
BEFORE UPDATE ON public.bill_of_materials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add foreign key constraints (referencing skus table)
ALTER TABLE public.bill_of_materials 
ADD CONSTRAINT fk_bom_parent_sku 
FOREIGN KEY (parent_sku_id) REFERENCES public.skus(id) ON DELETE CASCADE;

ALTER TABLE public.bill_of_materials 
ADD CONSTRAINT fk_bom_component_sku 
FOREIGN KEY (component_sku_id) REFERENCES public.skus(id) ON DELETE CASCADE;

ALTER TABLE public.transactions 
ADD CONSTRAINT fk_transactions_sku 
FOREIGN KEY (sku_id) REFERENCES public.skus(id) ON DELETE CASCADE;

-- Extend products table to link with SKUs (backward compatibility)
ALTER TABLE public.products ADD COLUMN sku_id UUID;
ALTER TABLE public.products ADD CONSTRAINT fk_products_sku 
FOREIGN KEY (sku_id) REFERENCES public.skus(id) ON DELETE SET NULL;