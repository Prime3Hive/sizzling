
-- Add P&L tracking fields to expenses table
ALTER TABLE public.expenses 
  ADD COLUMN IF NOT EXISTS account_type character varying DEFAULT 'COGS',
  ADD COLUMN IF NOT EXISTS cost_center character varying DEFAULT 'Daily Orders',
  ADD COLUMN IF NOT EXISTS bank_account character varying,
  ADD COLUMN IF NOT EXISTS payment_method character varying;

-- Add sale_type to sales table to distinguish daily vs event
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_type character varying DEFAULT 'daily';
