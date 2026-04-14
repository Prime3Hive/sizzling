-- Drop existing policies for sales table
DROP POLICY IF EXISTS "All users can view all sales" ON public.sales;
DROP POLICY IF EXISTS "Users can view their own sales" ON public.sales;

-- Drop existing policies for sale_items table
DROP POLICY IF EXISTS "All users can view all sale items" ON public.sale_items;
DROP POLICY IF EXISTS "Users can view sale items for their sales" ON public.sale_items;

-- Drop existing policies for payments table
DROP POLICY IF EXISTS "All users can view all payments" ON public.payments;
DROP POLICY IF EXISTS "Users can view payments for their sales" ON public.payments;

-- Create new policies allowing all users to view all records
CREATE POLICY "All users can view all sales" 
ON public.sales 
FOR SELECT 
USING (true);

CREATE POLICY "All users can view all sale items" 
ON public.sale_items 
FOR SELECT 
USING (true);

CREATE POLICY "All users can view all payments" 
ON public.payments 
FOR SELECT 
USING (true);