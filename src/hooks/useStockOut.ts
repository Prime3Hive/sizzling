import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// Stock out by route, and counts. Until migration 20261124300000 is applied
// there are no routes or counts: `ready` is false and the older Record stock
// form and stock take stay in place.

const db = supabase as any;

/** true once stock can be issued by route and counts are approved. */
export function useStockOutReady() {
  const { user } = useAuth();
  const q = useQuery<boolean>({
    queryKey: ['stock-counts', 'ready'],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { error } = await db.from('stock_counts').select('id', { head: true, count: 'exact' }).limit(1);
      return !error;
    },
  });
  return q.data ?? false;
}

export interface StockCountLine {
  id: string;
  product_id: string;
  sku_id: string | null;
  item_name: string;
  storage_place: string | null;
  stock_unit: string | null;
  expected_qty: number;
  counted_qty: number;
  counted_as: string | null;
  unit_cost: number;
  difference: number;
  reason: string | null;
}

export interface StockCount {
  id: string;
  count_number: string;
  count_date: string;
  kind: 'weekly' | 'opening';
  status: 'submitted' | 'approved' | 'rejected';
  notes: string | null;
  counted_by: string | null;
  submitted_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  stock_count_lines: StockCountLine[];
}

export function useStockCounts(enabled = true) {
  const { user } = useAuth();
  return useQuery<StockCount[]>({
    queryKey: ['stock-counts', 'list'],
    enabled: !!user && enabled,
    queryFn: async () => {
      const { data, error } = await db.from('stock_counts')
        .select('*, stock_count_lines(*)')
        .order('submitted_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as StockCount[];
    },
  });
}

export interface EventInvoice {
  id: string;
  label: string;
  hint: string;
}

/** Event invoices and quotations an event issue can be charged to. */
export function useEventInvoices(enabled = true) {
  const { user } = useAuth();
  return useQuery<EventInvoice[]>({
    queryKey: ['event-invoices-for-stock'],
    enabled: !!user && enabled,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const { data, error } = await db.from('invoices')
        .select('id, invoice_number, quotation_number, customer_name, event_name, event_date, status')
        .eq('invoice_type', 'event')
        .neq('status', 'cancelled')
        .order('event_date', { ascending: false, nullsFirst: false })
        .limit(150);
      // Someone who records stock may not be allowed to see invoices: they
      // type the event's name instead.
      if (error) return [];
      return (data ?? []).map((r: any) => ({
        id: r.id,
        label: r.event_name?.trim() || r.customer_name || 'Event',
        hint: [r.invoice_number ?? r.quotation_number, r.customer_name, r.event_date].filter(Boolean).join(' · '),
      }));
    },
  });
}

/** true once finished goods can be recorded as sold (migration 20261124600000). */
export function useGoodsSoldReady() {
  const { user } = useAuth();
  const q = useQuery<boolean>({
    queryKey: ['goods-sold', 'ready'],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      // An empty list is refused by the function itself; "function not found"
      // means the migration is not applied.
      const { error } = await db.rpc('fn_record_goods_sold', { p_lines: [] });
      if (!error) return true;
      return error.code !== 'PGRST202' && !/could not find the function/i.test(error.message ?? '');
    },
  });
  return q.data ?? false;
}

export interface StockLot {
  id: string;
  product_id: string;
  lot_number: string;
  produced_on: string;
  expires_on: string | null;
  qty_remaining: number;
  unit_cost: number | null;
  products?: { name: string; uom: string | null; sku_id: string | null } | null;
}

/** Lots of finished goods with something left, oldest expiry first. */
export function useStockLots(enabled = true) {
  const { user } = useAuth();
  return useQuery<StockLot[]>({
    queryKey: ['stock-lots-in-stock'],
    enabled: !!user && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.from('stock_lots')
        .select('id, product_id, lot_number, produced_on, expires_on, qty_remaining, unit_cost, products(name, uom, sku_id)')
        .eq('status', 'active').gt('qty_remaining', 0)
        .order('expires_on', { ascending: true, nullsFirst: false }).order('produced_on').limit(1000);
      // Before the production migration there are no lots.
      if (error) return [];
      return (data ?? []).map((r: any) => ({ ...r, qty_remaining: Number(r.qty_remaining), unit_cost: r.unit_cost == null ? null : Number(r.unit_cost) }));
    },
  });
}
