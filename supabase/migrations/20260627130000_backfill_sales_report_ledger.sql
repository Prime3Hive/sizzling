-- Backfill: converted sales reports that hit the finance ledger but never the P&L.
--
-- The original sales-report conversion wrote a finance_ledger 'sale' entry whose
-- source_id pointed at the staff_report (not a sale row), so the revenue showed
-- in the Finance Feed but never reached Profit & Loss (which reads the `sales`
-- table). It also left the feed row un-clickable (source_id resolved to nothing).
--
-- This migration, for every finance_ledger 'sale' entry with no matching sale:
--   1. creates the missing `sales` row from the linked staff_report, and
--   2. repoints the ledger entry's source_id at that new sale.
-- Idempotent: entries already backed by a real sale are skipped, so re-running
-- (and newly converted reports, which now create both rows) are unaffected.

with candidates as (
  select
    e.id            as ledger_id,
    e.source_id     as report_id,
    e.cost_center   as cost_center,
    e.amount        as amount,
    sr.user_id      as user_id,
    sr.report_date  as report_date,
    sr.title        as title,
    sr.payment_method as payment_method,
    sr.summary      as summary,
    gen_random_uuid() as new_sale_id
  from public.finance_ledger e
  join public.staff_reports sr on sr.id = e.source_id
  where e.source_type = 'sale'
    and not exists (select 1 from public.sales s where s.id = e.source_id)
),
ins_sales as (
  insert into public.sales (
    id, user_id, created_by, sale_number, sale_date, sale_type,
    total_amount, customer_name, notes, status
  )
  select
    c.new_sale_id, c.user_id, c.user_id,
    'WS-' || replace(c.report_date::text, '-', '') || '-' || upper(substr(c.report_id::text, 1, 8)),
    c.report_date,
    case when c.cost_center = 'Event Account' then 'event' else 'daily' end,
    c.amount,
    coalesce(c.title, 'Sales report'),
    concat_ws(' · ',
      'Staff sales report (backfilled from finance ledger)',
      c.payment_method, c.summary),
    'completed'
  from candidates c
  returning id
),
upd_reports as (
  update public.staff_reports sr
  set converted_ref = c.new_sale_id
  from candidates c
  where sr.id = c.report_id
)
update public.finance_ledger e
set source_id = c.new_sale_id
from candidates c
where e.id = c.ledger_id;

-- Refresh the PostgREST schema cache (harmless if already current).
notify pgrst, 'reload schema';
