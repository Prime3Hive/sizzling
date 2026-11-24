import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

// Stock receipts (Receive). Until migration 20261124200000 is applied there is
// no receipts table: `ready` is false and the older ways of recording a
// purchase stay in place.

const db = supabase as any;

export interface StockReceiptLine {
  id: string;
  line_no: number;
  kind: 'stock' | 'other';
  description: string;
  category: string;
  entered_qty: number | null;
  entered_unit: string | null;
  stock_qty: number | null;
  stock_unit: string | null;
  amount_minor: number;
  unit_cost: number | null;
  sku_id: string | null;
}

export interface StockReceipt {
  id: string;
  receipt_number: string;
  lpo_id: string | null;
  supplier_name: string;
  received_date: string;
  payment_method: 'Cash' | 'Transfer' | 'Credit';
  receipt_path: string | null;
  no_receipt_reason: string | null;
  notes: string | null;
  total_minor: number;
  payable_id: string | null;
  status: 'posted' | 'reversed';
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  created_by: string | null;
  created_at: string;
  stock_receipt_lines: StockReceiptLine[];
  lpos: { lpo_number: string } | null;
}

/** true once the Receive screen can be used (the migration is applied). */
export function useReceiveReady() {
  const { user } = useAuth();
  const q = useQuery<boolean>({
    queryKey: ['stock-receipts', 'ready'],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { error } = await db.from('stock_receipts').select('id', { head: true, count: 'exact' }).limit(1);
      return !error;
    },
  });
  return q.data ?? false;
}

export function useStockReceipts(enabled = true) {
  const { user } = useAuth();
  return useQuery<{ receipts: StockReceipt[]; unpaid: Set<string> }>({
    queryKey: ['stock-receipts', 'list'],
    enabled: !!user && enabled,
    queryFn: async () => {
      const { data, error } = await db.from('stock_receipts')
        .select('*, stock_receipt_lines(id, line_no, kind, description, category, entered_qty, entered_unit, stock_qty, stock_unit, amount_minor, unit_cost, sku_id), lpos(lpo_number)')
        .order('received_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      const receipts = (data ?? []) as StockReceipt[];
      for (const r of receipts) r.stock_receipt_lines?.sort((a, b) => a.line_no - b.line_no);

      // Which credit receipts are still owed. Payables are visible to admins
      // and managers only; for anyone else this stays empty and is not shown.
      const ids = receipts.map((r) => r.payable_id).filter(Boolean) as string[];
      let unpaid = new Set<string>();
      if (ids.length) {
        const p = await db.from('payables').select('id, status').in('id', ids);
        unpaid = new Set((p.data ?? []).filter((x: any) => x.status === 'unpaid').map((x: any) => x.id));
      }
      return { receipts, unpaid };
    },
  });
}
