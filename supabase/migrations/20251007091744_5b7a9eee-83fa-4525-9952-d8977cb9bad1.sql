-- Create NJC supplies table
CREATE TABLE public.njc_supplies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supply_date DATE NOT NULL,
  number_of_supplies INTEGER NOT NULL,
  payment_status VARCHAR NOT NULL DEFAULT 'pending',
  supply_details TEXT NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.njc_supplies ENABLE ROW LEVEL SECURITY;

-- Create policies for NJC supplies
CREATE POLICY "Users can view their own NJC supplies or if admin"
ON public.njc_supplies
FOR SELECT
USING (auth.uid() = user_id OR is_admin(auth.uid()));

CREATE POLICY "Users can create their own NJC supplies"
ON public.njc_supplies
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own NJC supplies"
ON public.njc_supplies
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own NJC supplies"
ON public.njc_supplies
FOR DELETE
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_njc_supplies_updated_at
BEFORE UPDATE ON public.njc_supplies
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
