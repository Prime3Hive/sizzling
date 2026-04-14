-- Create tables for the business management module

-- Products table for inventory items
CREATE TABLE public.products (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    name VARCHAR NOT NULL,
    description TEXT,
    category VARCHAR NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    sku VARCHAR UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Warehouses/locations table
CREATE TABLE public.warehouses (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    name VARCHAR NOT NULL,
    location TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Inventory tracking table
CREATE TABLE public.inventory (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    product_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 0,
    last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Sales transactions table
CREATE TABLE public.sales (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    sale_number VARCHAR NOT NULL,
    sale_date DATE NOT NULL,
    customer_name VARCHAR,
    customer_email VARCHAR,
    total_amount NUMERIC(10,2) NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Sale items (line items for each sale)
CREATE TABLE public.sale_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    sale_id UUID NOT NULL,
    product_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL,
    total_price NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Payment tracking table
CREATE TABLE public.payments (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    sale_id UUID NOT NULL,
    payment_method VARCHAR NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'pending',
    payment_date DATE,
    bank_reference VARCHAR,
    transaction_id VARCHAR,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Reconciliation reports table
CREATE TABLE public.reconciliation_reports (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    report_date DATE NOT NULL,
    report_type VARCHAR NOT NULL,
    total_discrepancies INTEGER NOT NULL DEFAULT 0,
    total_amount_discrepancy NUMERIC(10,2) NOT NULL DEFAULT 0,
    status VARCHAR NOT NULL DEFAULT 'pending',
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Discrepancies tracking table
CREATE TABLE public.discrepancies (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    reconciliation_report_id UUID NOT NULL,
    discrepancy_type VARCHAR NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(10,2),
    reference_id UUID,
    status VARCHAR NOT NULL DEFAULT 'open',
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add foreign key constraints
ALTER TABLE public.products ADD CONSTRAINT fk_products_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.warehouses ADD CONSTRAINT fk_warehouses_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.inventory ADD CONSTRAINT fk_inventory_product_id FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE public.inventory ADD CONSTRAINT fk_inventory_warehouse_id FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;
ALTER TABLE public.sales ADD CONSTRAINT fk_sales_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.sale_items ADD CONSTRAINT fk_sale_items_sale_id FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;
ALTER TABLE public.sale_items ADD CONSTRAINT fk_sale_items_product_id FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
ALTER TABLE public.payments ADD CONSTRAINT fk_payments_sale_id FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE CASCADE;
ALTER TABLE public.reconciliation_reports ADD CONSTRAINT fk_reconciliation_reports_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.discrepancies ADD CONSTRAINT fk_discrepancies_reconciliation_report_id FOREIGN KEY (reconciliation_report_id) REFERENCES public.reconciliation_reports(id) ON DELETE CASCADE;

-- Enable Row Level Security
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discrepancies ENABLE ROW LEVEL SECURITY;

-- RLS Policies for products
CREATE POLICY "Users can view their own products" ON public.products FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own products" ON public.products FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own products" ON public.products FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own products" ON public.products FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for warehouses
CREATE POLICY "Users can view their own warehouses" ON public.warehouses FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own warehouses" ON public.warehouses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own warehouses" ON public.warehouses FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own warehouses" ON public.warehouses FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for inventory
CREATE POLICY "Users can view inventory for their products" ON public.inventory FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.products WHERE products.id = inventory.product_id AND products.user_id = auth.uid())
);
CREATE POLICY "Users can create inventory for their products" ON public.inventory FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.products WHERE products.id = inventory.product_id AND products.user_id = auth.uid())
);
CREATE POLICY "Users can update inventory for their products" ON public.inventory FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.products WHERE products.id = inventory.product_id AND products.user_id = auth.uid())
);
CREATE POLICY "Users can delete inventory for their products" ON public.inventory FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.products WHERE products.id = inventory.product_id AND products.user_id = auth.uid())
);

-- RLS Policies for sales
CREATE POLICY "Users can view their own sales" ON public.sales FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own sales" ON public.sales FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own sales" ON public.sales FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own sales" ON public.sales FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for sale_items
CREATE POLICY "Users can view sale items for their sales" ON public.sale_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.sales WHERE sales.id = sale_items.sale_id AND sales.user_id = auth.uid())
);
CREATE POLICY "Users can create sale items for their sales" ON public.sale_items FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.sales WHERE sales.id = sale_items.sale_id AND sales.user_id = auth.uid())
);
CREATE POLICY "Users can update sale items for their sales" ON public.sale_items FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.sales WHERE sales.id = sale_items.sale_id AND sales.user_id = auth.uid())
);
CREATE POLICY "Users can delete sale items for their sales" ON public.sale_items FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.sales WHERE sales.id = sale_items.sale_id AND sales.user_id = auth.uid())
);

-- RLS Policies for payments
CREATE POLICY "Users can view payments for their sales" ON public.payments FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.sales WHERE sales.id = payments.sale_id AND sales.user_id = auth.uid())
);
CREATE POLICY "Users can create payments for their sales" ON public.payments FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.sales WHERE sales.id = payments.sale_id AND sales.user_id = auth.uid())
);
CREATE POLICY "Users can update payments for their sales" ON public.payments FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.sales WHERE sales.id = payments.sale_id AND sales.user_id = auth.uid())
);
CREATE POLICY "Users can delete payments for their sales" ON public.payments FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.sales WHERE sales.id = payments.sale_id AND sales.user_id = auth.uid())
);

-- RLS Policies for reconciliation_reports
CREATE POLICY "Users can view their own reconciliation reports" ON public.reconciliation_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own reconciliation reports" ON public.reconciliation_reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own reconciliation reports" ON public.reconciliation_reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own reconciliation reports" ON public.reconciliation_reports FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for discrepancies
CREATE POLICY "Users can view discrepancies for their reports" ON public.discrepancies FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.reconciliation_reports WHERE reconciliation_reports.id = discrepancies.reconciliation_report_id AND reconciliation_reports.user_id = auth.uid())
);
CREATE POLICY "Users can create discrepancies for their reports" ON public.discrepancies FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.reconciliation_reports WHERE reconciliation_reports.id = discrepancies.reconciliation_report_id AND reconciliation_reports.user_id = auth.uid())
);
CREATE POLICY "Users can update discrepancies for their reports" ON public.discrepancies FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.reconciliation_reports WHERE reconciliation_reports.id = discrepancies.reconciliation_report_id AND reconciliation_reports.user_id = auth.uid())
);
CREATE POLICY "Users can delete discrepancies for their reports" ON public.discrepancies FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.reconciliation_reports WHERE reconciliation_reports.id = discrepancies.reconciliation_report_id AND reconciliation_reports.user_id = auth.uid())
);

-- Create updated_at triggers
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_warehouses_updated_at BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_discrepancies_updated_at BEFORE UPDATE ON public.discrepancies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_products_user_id ON public.products(user_id);
CREATE INDEX idx_products_category ON public.products(category);
CREATE INDEX idx_inventory_product_id ON public.inventory(product_id);
CREATE INDEX idx_inventory_warehouse_id ON public.inventory(warehouse_id);
CREATE INDEX idx_sales_user_id ON public.sales(user_id);
CREATE INDEX idx_sales_date ON public.sales(sale_date);
CREATE INDEX idx_sale_items_sale_id ON public.sale_items(sale_id);
CREATE INDEX idx_payments_sale_id ON public.payments(sale_id);
CREATE INDEX idx_payments_status ON public.payments(status);
CREATE INDEX idx_reconciliation_reports_user_id ON public.reconciliation_reports(user_id);
CREATE INDEX idx_discrepancies_reconciliation_report_id ON public.discrepancies(reconciliation_report_id);