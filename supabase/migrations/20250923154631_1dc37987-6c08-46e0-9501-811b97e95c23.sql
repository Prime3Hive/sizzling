-- Create unit conversions table for simple unit relationships
CREATE TABLE public.unit_conversions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_unit VARCHAR NOT NULL,
  to_unit VARCHAR NOT NULL,
  conversion_factor DECIMAL NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(from_unit, to_unit, user_id)
);

-- Enable RLS
ALTER TABLE public.unit_conversions ENABLE ROW LEVEL SECURITY;

-- Create policies for unit conversions
CREATE POLICY "Users can view their own unit conversions" 
ON public.unit_conversions 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own unit conversions" 
ON public.unit_conversions 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own unit conversions" 
ON public.unit_conversions 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own unit conversions" 
ON public.unit_conversions 
FOR DELETE 
USING (auth.uid() = user_id);

-- Simplify SKUs table by removing complex types, just keep simple inventory
ALTER TABLE public.skus DROP COLUMN IF EXISTS sku_type;
ALTER TABLE public.skus ADD COLUMN IF NOT EXISTS category VARCHAR DEFAULT 'general';

-- Add trigger for unit conversions timestamps
CREATE TRIGGER update_unit_conversions_updated_at
BEFORE UPDATE ON public.unit_conversions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();