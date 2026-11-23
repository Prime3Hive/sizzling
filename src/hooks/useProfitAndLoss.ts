import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

import { sumPL, toPLRow, type PLRow } from '@/lib/profitAndLoss';

export { sumPL, toPLRow, ytdRange, EMPTY_PL, totalCost, monthChange } from '@/lib/profitAndLoss';
export type { PLRow, PLTotals } from '@/lib/profitAndLoss';

/** One row of money received: a sale payment, an invoice payment, or takings. */
export interface MoneyReceived {
  id: string;
  kind: 'sale_payment' | 'invoice_payment' | 'takings';
  received_on: string;
  amount: number;
  method: string;
  reference: string | null;
  document: string | null;
  customer: string | null;
  source_id: string;
}

/**
 * Every payment received in a period, from one database function. The Payments
 * page lists these rows and "cash collected" is their sum, so the two agree.
 */
export function useMoneyReceived(from: string, to: string, enabled = true) {
  const q = useQuery({
    queryKey: ['money-received', from, to],
    enabled: enabled && !!from && !!to,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('fn_money_received', { p_from: from, p_to: to });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({ ...r, amount: Number(r.amount ?? 0) })) as MoneyReceived[];
    },
    staleTime: 60_000,
  });
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + Math.round(r.amount * 100), 0) / 100;
  return { rows, total, isLoading: q.isLoading, error: q.error as Error | null, refetch: q.refetch };
}

export function useProfitAndLoss(from: string, to: string, enabled = true) {
  const q = useQuery({
    queryKey: ['profit-and-loss', from, to],
    enabled: enabled && !!from && !!to,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('fn_profit_and_loss', { p_from: from, p_to: to });
      if (error) throw error;
      return ((data ?? []) as any[]).map(toPLRow);
    },
    staleTime: 60_000,
  });

  const rows = q.data ?? [];
  const totals = sumPL(rows);
  /** Row for a month index (0 = Jan) within the range's year. */
  const forMonth = (monthIndex: number): PLRow | undefined =>
    rows.find(r => Number(r.month.slice(5, 7)) - 1 === monthIndex);

  return { rows, totals, forMonth, isLoading: q.isLoading, error: q.error as Error | null, refetch: q.refetch };
}

export function useCashCollected(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['cash-collected', from, to],
    enabled: enabled && !!from && !!to,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('fn_cash_collected', { p_from: from, p_to: to });
      if (error) throw error;
      return Number(data ?? 0);
    },
    staleTime: 60_000,
  });
}
