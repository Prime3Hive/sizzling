-- ============================================================
-- PROCUREMENT TABLES MIGRATION
-- Run this in your Supabase SQL Editor before using the
-- Procurement module.
-- ============================================================

-- 1. Local Purchase Orders (LPOs)
create table if not exists lpos (
  id               uuid primary key default gen_random_uuid(),
  lpo_number       text not null unique,
  supplier_name    text not null,
  supplier_email   text,
  supplier_phone   text,
  supplier_address text,
  status           text not null default 'draft'
                     check (status in ('draft','sent','received','partially_received','cancelled')),
  order_date       date not null default current_date,
  expected_delivery date,
  notes            text,
  total_amount     numeric(14,2) not null default 0,
  account_type     text default 'COGS' check (account_type in ('COGS','OpEX')),
  cost_center      text,
  expense_category text,
  payment_method   text,
  budget_id        uuid,
  created_by       uuid references auth.users(id),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- 2. LPO Line Items
create table if not exists lpo_items (
  id               uuid primary key default gen_random_uuid(),
  lpo_id           uuid not null references lpos(id) on delete cascade,
  item_name        text not null,
  sku_id           uuid references skus(id),
  description      text,
  quantity         numeric(14,4) not null default 1,
  unit_of_measure  text not null default 'unit',
  unit_price       numeric(14,2) not null default 0,
  total_price      numeric(14,2) not null default 0,
  quantity_received numeric(14,4) not null default 0,
  created_at       timestamptz default now()
);

-- 3. Goods Received Notes (GRN)
create table if not exists lpo_receipts (
  id                   uuid primary key default gen_random_uuid(),
  lpo_id               uuid not null references lpos(id) on delete cascade,
  receipt_number       text not null unique,
  received_date        date not null default current_date,
  received_by          uuid references auth.users(id),
  notes                text,
  total_received_amount numeric(14,2) not null default 0,
  expense_id           uuid,
  created_at           timestamptz default now()
);

-- 4. GRN Line Items
create table if not exists lpo_receipt_items (
  id               uuid primary key default gen_random_uuid(),
  receipt_id       uuid not null references lpo_receipts(id) on delete cascade,
  lpo_item_id      uuid not null references lpo_items(id),
  item_name        text not null,
  quantity_received numeric(14,4) not null,
  unit_price       numeric(14,2) not null,
  total_price      numeric(14,2) not null,
  created_at       timestamptz default now()
);

-- 5. Enable Row Level Security
alter table lpos             enable row level security;
alter table lpo_items        enable row level security;
alter table lpo_receipts     enable row level security;
alter table lpo_receipt_items enable row level security;

-- 6. RLS Policies (authenticated users — tighten per role as needed)
create policy "lpos_all"              on lpos              for all to authenticated using (true) with check (true);
create policy "lpo_items_all"         on lpo_items         for all to authenticated using (true) with check (true);
create policy "lpo_receipts_all"      on lpo_receipts      for all to authenticated using (true) with check (true);
create policy "lpo_receipt_items_all" on lpo_receipt_items  for all to authenticated using (true) with check (true);

-- 7. Auto-update updated_at on lpos
create or replace function update_lpo_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lpos_updated_at
  before update on lpos
  for each row execute function update_lpo_updated_at();
