-- Inventory requests can now carry miscellaneous (non-SKU) line items.
-- These don't restock inventory; instead they are captured as expenses when
-- the request is purchased. We extend the existing line-item table so SKU and
-- miscellaneous lines live side by side.

ALTER TABLE public.inventory_request_items
  ADD COLUMN IF NOT EXISTS kind      text   NOT NULL DEFAULT 'sku',   -- 'sku' | 'misc'
  ADD COLUMN IF NOT EXISTS item_name text,                            -- description for misc lines
  ADD COLUMN IF NOT EXISTS amount    numeric;                         -- cost (₦) for misc lines

COMMENT ON COLUMN public.inventory_request_items.kind IS 'sku = restocks inventory; misc = captured as an expense on purchase';
COMMENT ON COLUMN public.inventory_request_items.item_name IS 'Free-text item name for miscellaneous (non-SKU) lines';
COMMENT ON COLUMN public.inventory_request_items.amount IS 'Cost in Naira for miscellaneous lines; recorded as an expense when purchased';
