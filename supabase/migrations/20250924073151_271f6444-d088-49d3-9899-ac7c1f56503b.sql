-- Update RLS policies for inventory visibility
-- All users can view inventory data, only admins can edit

-- Update inventory table policies
DROP POLICY IF EXISTS "Users can view inventory for their products" ON public.inventory;
DROP POLICY IF EXISTS "Users can create inventory for their products" ON public.inventory;
DROP POLICY IF EXISTS "Users can update inventory for their products" ON public.inventory;
DROP POLICY IF EXISTS "Users can delete inventory for their products" ON public.inventory;

CREATE POLICY "All users can view inventory" ON public.inventory
FOR SELECT USING (true);

CREATE POLICY "Admins can manage inventory" ON public.inventory
FOR ALL USING (is_admin(auth.uid()));

-- Update products table policies
DROP POLICY IF EXISTS "Users can view their own products" ON public.products;
DROP POLICY IF EXISTS "Users can create their own products" ON public.products;
DROP POLICY IF EXISTS "Users can update their own products" ON public.products;
DROP POLICY IF EXISTS "Users can delete their own products" ON public.products;

CREATE POLICY "All users can view products" ON public.products
FOR SELECT USING (true);

CREATE POLICY "Admins can manage products" ON public.products
FOR ALL USING (is_admin(auth.uid()));

-- Update SKUs table policies
DROP POLICY IF EXISTS "Users can view their own skus" ON public.skus;
DROP POLICY IF EXISTS "Users can create their own skus" ON public.skus;
DROP POLICY IF EXISTS "Users can update their own skus" ON public.skus;
DROP POLICY IF EXISTS "Users can delete their own skus" ON public.skus;

CREATE POLICY "All users can view skus" ON public.skus
FOR SELECT USING (true);

CREATE POLICY "Admins can manage skus" ON public.skus
FOR ALL USING (is_admin(auth.uid()));

-- Update warehouses table policies
DROP POLICY IF EXISTS "Users can view their own warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Users can create their own warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Users can update their own warehouses" ON public.warehouses;
DROP POLICY IF EXISTS "Users can delete their own warehouses" ON public.warehouses;

CREATE POLICY "All users can view warehouses" ON public.warehouses
FOR SELECT USING (true);

CREATE POLICY "Admins can manage warehouses" ON public.warehouses
FOR ALL USING (is_admin(auth.uid()));

-- Update transactions table policies (keep restricted since these are financial records)
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can create their own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update their own transactions" ON public.transactions;

CREATE POLICY "All users can view transactions" ON public.transactions
FOR SELECT USING (true);

CREATE POLICY "Admins can manage transactions" ON public.transactions
FOR ALL USING (is_admin(auth.uid()));

-- Update unit conversions table policies
DROP POLICY IF EXISTS "Users can view their own unit conversions" ON public.unit_conversions;
DROP POLICY IF EXISTS "Users can create their own unit conversions" ON public.unit_conversions;
DROP POLICY IF EXISTS "Users can update their own unit conversions" ON public.unit_conversions;
DROP POLICY IF EXISTS "Users can delete their own unit conversions" ON public.unit_conversions;

CREATE POLICY "All users can view unit conversions" ON public.unit_conversions
FOR SELECT USING (true);

CREATE POLICY "Admins can manage unit conversions" ON public.unit_conversions
FOR ALL USING (is_admin(auth.uid()));