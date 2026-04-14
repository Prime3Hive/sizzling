-- Add foreign key constraints for inventory_requests table
ALTER TABLE public.inventory_requests 
ADD CONSTRAINT inventory_requests_product_id_fkey 
FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.inventory_requests 
ADD CONSTRAINT inventory_requests_warehouse_id_fkey 
FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;

-- Add foreign key constraints for inventory table  
ALTER TABLE public.inventory 
ADD CONSTRAINT inventory_product_id_fkey 
FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.inventory 
ADD CONSTRAINT inventory_warehouse_id_fkey 
FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE CASCADE;

-- Create inventory records for existing products and warehouses
INSERT INTO public.inventory (product_id, warehouse_id, quantity, reorder_level)
SELECT p.id, w.id, 0, 10
FROM public.products p
CROSS JOIN public.warehouses w
WHERE NOT EXISTS (
  SELECT 1 FROM public.inventory i 
  WHERE i.product_id = p.id AND i.warehouse_id = w.id
);