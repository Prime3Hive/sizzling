-- Event invoice enhancements: flexible item details, waiter cost, account details

-- item_details: multi-line description of sub-items within a single cost line (events)
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS item_details TEXT;

-- Waiter fields on invoice (event-specific but stored generically)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS waiter_required    BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS number_of_waiters  INTEGER,
  ADD COLUMN IF NOT EXISTS cost_per_waiter    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS waiter_total       NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Payment account details (shown on invoice for bank transfers)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS account_name       TEXT,
  ADD COLUMN IF NOT EXISTS account_number     TEXT,
  ADD COLUMN IF NOT EXISTS bank_name          TEXT;
