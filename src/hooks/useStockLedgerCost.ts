import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// The ledger sources that carry stock cost. Their reversals keep the same
// source_type, so summing debit − credit nets cancellations out.
const STOCK_SOURCES = ['stock_movement', 'invoice_cogs', 'stock_revaluation', 'production'];

interface Row {
  debit: number;
  credit: number;
  journal_entries: { entry_date: string };
  chart_of_accounts: { code: string };
}

/**
 * Stock cost as the ledger recognises it, by month:
 *   cogs    net 5000 from stock — usage and invoiced sales (+), less stock
 *           bought on an expense and moved into inventory until used (−)
 *   losses  net 5900 from stock — stock-take shrinkage, write-downs and
 *           revaluations
 * Added to the expense-based P&L, COGS lands in the month stock is USED rather
 * than the month it was bought.
 */
export function useStockLedgerCost(from: string, to: string, enabled = true) {
  const q = useQuery({
    queryKey: ['stock-ledger-cost', from, to],
    enabled: enabled && !!from && !!to,
    queryFn: async () => {
      const PAGE = 1000;
      const out: Row[] = [];
      for (let start = 0; ; start += PAGE) {
        const { data, error } = await (supabase as any)
          .from('journal_lines')
          .select('id, debit, credit, journal_entries!inner(entry_date, source_type), chart_of_accounts!inner(code)')
          .in('journal_entries.source_type', STOCK_SOURCES)
          .gte('journal_entries.entry_date', from)
          .lte('journal_entries.entry_date', to)
          .in('chart_of_accounts.code', ['5000', '5050', '5900'])
          .order('id', { ascending: true })
          .range(start, start + PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as Row[];
        out.push(...page);
        if (page.length < PAGE) break;
      }
      return out;
    },
  });

  const rows = q.data ?? [];
  const forMonth = (monthIndex: number) => {
    let cogs = 0;
    let losses = 0;
    for (const r of rows) {
      if (new Date(`${r.journal_entries.entry_date}T00:00:00`).getMonth() !== monthIndex) continue;
      const net = Number(r.debit || 0) - Number(r.credit || 0);
      // 5050 here is only ever the credit when a batch absorbs production
      // expenses; like a stock-in against 5000, it defers that cost until use.
      if (r.chart_of_accounts.code === '5900') losses += net; else cogs += net;
    }
    return { cogs, losses };
  };

  return { rows, forMonth, isLoading: q.isLoading, error: q.error };
}
