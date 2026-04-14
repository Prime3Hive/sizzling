-- Make sku_code optional since we're removing it from the interface
ALTER TABLE skus ALTER COLUMN sku_code DROP NOT NULL;

-- Add notes column to skus table
ALTER TABLE skus ADD COLUMN IF NOT EXISTS notes text;