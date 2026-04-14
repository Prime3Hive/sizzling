-- Add invoiced_at column to sales table for tracking when invoice was created/sent
ALTER TABLE public.sales
ADD COLUMN invoiced_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Update existing records to set invoiced_at to created_at
UPDATE public.sales SET invoiced_at = created_at WHERE invoiced_at IS NULL;