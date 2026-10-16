import { supabase } from '@/integrations/supabase/client';

export type MovementType = 'purchase' | 'usage' | 'adjustment' | 'stock_take' | 'sale' | 'return';

export interface StockLine {
  /** One of the two identifies the item; the other is resolved server-side. */
  sku_id?: string;
  product_id?: string;
  /** + in / - out */
  quantity_change: number;
  /**
   * Unit cost of a stock-in (purchase price, opening-stock cost). It values the
   * movement in the ledger and feeds the item's moving-average cost. Leave it
   * out for stock-outs: they are valued at the current average.
   */
  unit_price?: number;
}

/**
 * Apply one or many stock changes in a single database transaction: inventory,
 * the movement ledger and (optionally) the legacy `transactions` row. Either
 * every line lands or none does — a refused line (e.g. negative stock while it
 * is turned off) rolls back the whole batch.
 */
export async function recordStockMovements(opts: {
  lines: StockLine[];
  type: MovementType;
  note?: string;
  occurredOn?: string;
  transactionType?: 'PURCHASE' | 'SALE' | 'ADJUSTMENT';
  /** 'opening' posts Dr Inventory / Cr Owner's Equity instead of a COGS reclass. */
  referenceType?: 'manual' | 'opening' | 'request' | 'stock_take';
  referenceId?: string;
}): Promise<number> {
  const { data, error } = await (supabase as any).rpc('record_stock_movements', {
    p_lines: opts.lines,
    p_movement_type: opts.type,
    p_note: opts.note ?? null,
    p_occurred_on: opts.occurredOn ?? new Date().toISOString().slice(0, 10),
    p_transaction_type: opts.transactionType ?? null,
    p_reference_type: opts.referenceType ?? 'manual',
    p_reference_id: opts.referenceId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

/** Merge repeated items so "2 + 3 of the same thing" is checked as 5. */
export function mergeLines<T extends { sku_id: string; quantity: number }>(lines: T[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) out.set(l.sku_id, (out.get(l.sku_id) ?? 0) + l.quantity);
  return out;
}

/**
 * Change an item's cost deliberately. Stock already on hand is revalued in the
 * ledger (Dr/Cr 1200 against 5900) so the books and the Inventory page agree.
 * Returns the revaluation amount (0 when nothing was on hand).
 */
export async function setProductCost(skuId: string, cost: number, note?: string): Promise<number> {
  const { data, error } = await (supabase as any).rpc('set_product_cost', {
    p_sku_id: skuId, p_cost: cost, p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
