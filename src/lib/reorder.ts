// Reordering (inventory redesign, stage 5): which items go on the "To buy"
// list and how much of each to buy, in whole purchase units.

import { factorOf, round4, type ItemUnits } from '@/lib/units';

export interface ReorderInput {
  onHand: number;
  /** The minimum level, in stock units. */
  minimum: number;
  /** The level a reorder brings the item back to, in stock units. null = not set. */
  target: number | null | undefined;
  units?: ItemUnits;
  /** The item's unit when its pack sizes are not known. */
  stockUnit?: string;
}

export interface ReorderSuggestion {
  /** The target used: the item's own, or twice the minimum until one is set. */
  target: number;
  /** true when the target is the fallback, not one the owner set. */
  targetAssumed: boolean;
  /** Stock units needed to reach the target. */
  needed: number;
  /** The unit it is bought in, and how many stock units one holds. */
  unit: string;
  factor: number;
  /** Whole purchase units to buy, rounded up. */
  packs: number;
  /** What that comes to in stock units. */
  stockQty: number;
}

/** An item is on the list when it is at or below its minimum level. */
export const needsBuying = (onHand: number, minimum: number) => onHand <= Math.max(minimum, 0);

/**
 * How much to buy: enough to bring stock up to the target, in whole purchase
 * units, rounded up. Wings at 15 kg with a minimum of 20 kg and a target of
 * 60 kg, bought in 20 kg bags: 45 kg short, so 3 bags.
 */
export function suggestOrder(i: ReorderInput): ReorderSuggestion {
  const minimum = Math.max(Number(i.minimum) || 0, 0);
  const own = i.target != null && Number(i.target) > 0 ? Number(i.target) : null;
  // A target below the minimum would leave the item on the list straight
  // after buying; never suggest less than gets it clear of the minimum.
  const target = Math.max(own ?? minimum * 2, minimum);
  const needed = round4(Math.max(target - Number(i.onHand || 0), 0));

  const stockUnit = i.units?.stockUnit ?? i.stockUnit ?? '';
  const unit = i.units?.purchaseUnit || stockUnit;
  const f = factorOf(i.units, unit);
  const factor = f && f > 0 ? f : 1;
  // The tiny subtraction keeps 2.0000000001 from rounding up to 3.
  const packs = needed > 0 ? Math.ceil(needed / factor - 1e-9) : 0;
  return { target, targetAssumed: own == null, needed, unit, factor, packs, stockQty: round4(packs * factor) };
}

export interface ToBuyRow<T> {
  item: T;
  suggestion: ReorderSuggestion;
  /** Out of stock comes before running low. */
  out: boolean;
  /** How far below the minimum, as a share of it: the most urgent first. */
  shortfall: number;
}

/** The "To buy" list: every active item at or below its minimum, most urgent first. */
export function toBuyList<T extends { id: string; name: string; stock_quantity: number | string; reorder_level: number | string; is_archived?: boolean }>(
  items: T[],
  infoOf: (item: T) => { units?: ItemUnits; target?: number | null; stockUnit?: string } | undefined,
): ToBuyRow<T>[] {
  const rows: ToBuyRow<T>[] = [];
  for (const item of items) {
    if (item.is_archived) continue;
    const onHand = Number(item.stock_quantity) || 0;
    const minimum = Number(item.reorder_level) || 0;
    if (!needsBuying(onHand, minimum)) continue;
    const info = infoOf(item);
    rows.push({
      item,
      suggestion: suggestOrder({ onHand, minimum, target: info?.target, units: info?.units, stockUnit: info?.stockUnit }),
      out: onHand <= 0,
      shortfall: minimum > 0 ? (minimum - onHand) / minimum : 1,
    });
  }
  return rows.sort((a, b) => Number(b.out) - Number(a.out) || b.shortfall - a.shortfall || a.item.name.localeCompare(b.item.name));
}

/** Rows grouped by usual supplier, the unnamed group last. */
export function groupBySupplier<R>(rows: R[], supplierOf: (row: R) => { id: string; name: string } | null): { id: string | null; name: string; rows: R[] }[] {
  const groups = new Map<string, { id: string | null; name: string; rows: R[] }>();
  for (const r of rows) {
    const s = supplierOf(r);
    const key = s?.id ?? '';
    if (!groups.has(key)) groups.set(key, { id: s?.id ?? null, name: s?.name ?? 'No usual supplier (market)', rows: [] });
    groups.get(key)!.rows.push(r);
  }
  return [...groups.values()].sort((a, b) => Number(a.id == null) - Number(b.id == null) || a.name.localeCompare(b.name));
}
