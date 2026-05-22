-- Link inventory requests to LPOs (one request → one LPO)
-- Nullable so existing LPOs and the "Direct Purchase" path are unaffected.
alter table lpos
  add column if not exists inventory_request_id uuid
  references inventory_requests(id) on delete set null;

-- Index for fast look-ups from the InventoryRequests page
create index if not exists lpos_inventory_request_id_idx
  on lpos(inventory_request_id)
  where inventory_request_id is not null;
