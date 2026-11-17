// One low-stock rule for every screen (dashboard, inventory page, alerts).
//
//   negative  stock below zero
//   out       stock exactly zero
//   low       above zero but at or below its reorder level (reorder level > 0)
//   ok        everything else
//
// "Needs reorder" = negative + out + low. The dashboard count and the inventory
// page's "running low" + "out of stock" use this and only this.

export type StockStatus = 'negative' | 'out' | 'low' | 'ok';

interface StockLike {
  stock_quantity: number | string | null;
  reorder_level?: number | string | null;
}

export function stockStatus(s: StockLike): StockStatus {
  const q = Number(s.stock_quantity ?? 0);
  const r = Number(s.reorder_level ?? 0);
  if (q < 0) return 'negative';
  if (q === 0) return 'out';
  if (r > 0 && q <= r) return 'low';
  return 'ok';
}

export const needsReorder = (s: StockLike) => stockStatus(s) !== 'ok';

export function countStock(items: StockLike[]) {
  let low = 0, out = 0, negative = 0;
  for (const s of items) {
    const st = stockStatus(s);
    if (st === 'low') low++;
    else if (st === 'out') out++;
    else if (st === 'negative') negative++;
  }
  return { low, out, negative, needsReorder: low + out + negative };
}

/** Stock value as the ledger's inventory account should show it. */
export const stockValue = (items: { stock_quantity: number | string | null; cost_per_unit?: number | string | null }[]) =>
  items.reduce((t, s) => t + Math.round(Math.max(Number(s.stock_quantity ?? 0), 0) * Number(s.cost_per_unit ?? 0) * 100) / 100, 0);
