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
