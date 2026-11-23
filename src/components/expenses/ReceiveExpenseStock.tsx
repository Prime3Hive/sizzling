import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useInventorySettings } from '@/hooks/useInventorySettings';
import RecordStockSheet, { type StockItem } from '@/components/inventory/RecordStockSheet';

// "Receive into stock" for a purchase that was entered as an expense.
//
// One purchase = one expense and one stock-in. The stock-in carries the
// expense's id and records quantity only, so the cost stays in the expense and
// is not counted a second time.

/** Expense categories that buy things kept in stock. */
export const STOCK_EXPENSE_CATEGORIES = [
  'Proteins', 'Fresh Produce', 'Dry Goods & Seasonings', 'Packaging & Disposables', 'Cooking Fuel',
];

export const isStockCategory = (category: string | null | undefined) =>
  !!category && STOCK_EXPENSE_CATEGORIES.includes(category);

export interface ExpenseForStock {
  id: string;
  amount: number;
  amount_minor?: number | null;
  description: string;
  date: string;
  payee_name?: string | null;
  reference?: string | null;
}

export default function ReceiveExpenseStock({ expense, onClose }: {
  expense: ExpenseForStock | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { settings } = useInventorySettings();
  const { data: skus = [] } = useQuery<StockItem[]>({
    queryKey: ['skus-for-stock-in'],
    enabled: !!expense,
    queryFn: async () => {
      const { data, error } = await supabase.from('skus')
        .select('id, name, unit_of_measure, stock_quantity, cost_per_unit, is_archived').order('name');
      if (error) throw error;
      return (data ?? []) as unknown as StockItem[];
    },
  });

  const paid = expense
    ? (expense.amount_minor != null ? Number(expense.amount_minor) / 100 : Number(expense.amount) || 0)
    : 0;

  return (
    <RecordStockSheet
      open={!!expense}
      onOpenChange={(o) => { if (!o) onClose(); }}
      skus={skus}
      allowNegative={settings.allow_negative_stock}
      prefill={expense ? {
        mode: 'in',
        total_price: paid,
        date: expense.date,
        note: [expense.payee_name, expense.description, expense.reference].filter(Boolean).join(' · ').slice(0, 200),
        reference: { type: 'expense', id: expense.id },
      } : null}
      onDone={() => {
        qc.invalidateQueries({ queryKey: ['expense-stock-received'] });
        qc.invalidateQueries({ queryKey: ['inventory-data'] });
        qc.invalidateQueries({ queryKey: ['skus-for-stock-in'] });
      }}
    />
  );
}
