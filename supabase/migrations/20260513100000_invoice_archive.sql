-- Add archived flag to invoices
-- Cancelled invoices can be archived to hide them from the active list.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
