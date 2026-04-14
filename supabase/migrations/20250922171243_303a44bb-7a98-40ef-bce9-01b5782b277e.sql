-- Create inventory_requests table
CREATE TABLE public.inventory_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  requested_quantity INTEGER NOT NULL,
  current_quantity INTEGER NOT NULL DEFAULT 0,
  fulfilled_quantity INTEGER NOT NULL DEFAULT 0,
  status VARCHAR NOT NULL DEFAULT 'pending',
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  fulfilled_date DATE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.inventory_requests ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own inventory requests" 
ON public.inventory_requests 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own inventory requests" 
ON public.inventory_requests 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own inventory requests" 
ON public.inventory_requests 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own inventory requests" 
ON public.inventory_requests 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_inventory_requests_updated_at
BEFORE UPDATE ON public.inventory_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();