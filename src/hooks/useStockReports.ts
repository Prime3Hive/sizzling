import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toCostReport, type CostReport, type UsageRow } from '@/lib/stockReports';

// The stock reports. Each is one read-only database function
// (20261124400000_stock_reports.sql). Until that migration is applied `ready`
// is false and the older Analytics tab stays.

const db = supabase as any;
const num = (v: unknown) => Number(v ?? 0) || 0;

/** true once the report functions exist. */
export function useStockReportsReady() {
  const { user } = useAuth();
  const q = useQuery<boolean>({
    queryKey: ['stock-reports', 'ready'],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { error } = await db.rpc('fn_movement_route', { p_route: null, p_type: 'purchase', p_reference_type: null });
      return !error;
    },
  });
  return q.data ?? false;
}

function useReport<T>(name: string, fn: string, args: Record<string, unknown>, enabled: boolean, map: (rows: any) => T) {
  return useQuery<T>({
    queryKey: ['stock-reports', name, args],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw new Error(error.message);
      return map(data);
    },
  });
}

export const useCostReport = (from: string, to: string, enabled = true) =>
  useReport<CostReport>('cost', 'fn_inventory_cost_report', { p_from: from, p_to: to }, enabled && !!from && !!to, toCostReport);

export const useUsageReport = (from: string, to: string, enabled = true) =>
  useReport<UsageRow[]>('usage', 'fn_stock_usage_report', { p_from: from, p_to: to }, enabled && !!from && !!to,
    (rows) => (rows ?? []).map((r: any) => ({ ...r, quantity: num(r.quantity), value: num(r.value) })));

export interface WasteRow { product_id: string; sku_id: string | null; item_name: string; stock_unit: string | null; reason: string; entries: number; quantity: number; value: number }
export const useWasteReport = (from: string, to: string, enabled = true) =>
  useReport<WasteRow[]>('waste', 'fn_waste_report', { p_from: from, p_to: to }, enabled && !!from && !!to,
    (rows) => (rows ?? []).map((r: any) => ({ ...r, entries: num(r.entries), quantity: num(r.quantity), value: num(r.value) })));

export interface CountDiffRow {
  count_id: string; count_number: string; count_date: string; kind: string; sku_id: string | null; item_name: string; stock_unit: string | null;
  expected: number; counted: number; difference: number; value: number; reason: string | null;
}
export const useCountDifferenceReport = (from: string, to: string, enabled = true) =>
  useReport<CountDiffRow[]>('count-differences', 'fn_count_difference_report', { p_from: from, p_to: to }, enabled && !!from && !!to,
    (rows) => (rows ?? []).map((r: any) => ({ ...r, expected: num(r.expected), counted: num(r.counted), difference: num(r.difference), value: num(r.value) })));

export interface EventCostRow {
  event_invoice_id: string | null; event_name: string | null; invoice_number: string | null; event_date: string | null;
  invoiced: number | null; food_cost: number; first_issue: string; last_issue: string;
}
export const useEventCostReport = (from: string, to: string, enabled = true) =>
  useReport<EventCostRow[]>('events', 'fn_event_food_cost_report', { p_from: from, p_to: to }, enabled && !!from && !!to,
    (rows) => (rows ?? []).map((r: any) => ({ ...r, invoiced: r.invoiced == null ? null : num(r.invoiced), food_cost: num(r.food_cost) })));

export interface SupplierRow { supplier: string; purchases: number; entries: number; last_purchase: string | null; owed: number }
export const useSupplierReport = (from: string, to: string, enabled = true) =>
  useReport<SupplierRow[]>('suppliers', 'fn_purchases_by_supplier', { p_from: from, p_to: to }, enabled && !!from && !!to,
    (rows) => (rows ?? []).map((r: any) => ({ ...r, purchases: num(r.purchases), entries: num(r.entries), owed: num(r.owed) })));

export interface PriceChangeRow {
  product_id: string; sku_id: string | null; item_name: string; stock_unit: string | null;
  last_cost: number; this_cost: number; change_pct: number; this_qty: number;
}
export const usePriceChanges = (monthStart: string, enabled = true) =>
  useReport<PriceChangeRow[]>('prices', 'fn_price_changes', { p_month: monthStart }, enabled && !!monthStart,
    (rows) => (rows ?? []).map((r: any) => ({ ...r, last_cost: num(r.last_cost), this_cost: num(r.this_cost), change_pct: num(r.change_pct), this_qty: num(r.this_qty) })));
