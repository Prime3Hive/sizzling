// Stock out by route, and the count (inventory redesign, stage 3).
//
// Stock leaves in one of four ways and every movement says which. Pure
// helpers: the route of a movement, the daily sheet's order, and the count's
// arithmetic. The database applies the same rules (20261124300000).

import { fmtQty, round4 } from '@/lib/units';

export type StockRoute =
  | 'receive' | 'kitchen' | 'event' | 'event_return' | 'waste' | 'production'
  | 'count_difference' | 'correction' | 'opening' | 'sale' | 'return' | 'transfer' | 'reversal' | 'usage';

export const ROUTE_META: Record<StockRoute, { label: string; cls: string }> = {
  receive:          { label: 'Received',          cls: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800' },
  kitchen:          { label: 'Issued to kitchen', cls: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800' },
  event:            { label: 'Event issue',       cls: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800' },
  event_return:     { label: 'Return from event', cls: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800' },
  waste:            { label: 'Waste',             cls: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800' },
  production:       { label: 'Production',        cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800' },
  count_difference: { label: 'Count difference',  cls: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800' },
  correction:       { label: 'Correction',        cls: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800' },
  opening:          { label: 'Opening stock',     cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700' },
  sale:             { label: 'Sale',              cls: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800' },
  return:           { label: 'Return',            cls: 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800' },
  transfer:         { label: 'Transfer',          cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700' },
  reversal:         { label: 'Reversal',          cls: 'bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800/50 dark:text-zinc-300 dark:border-zinc-700' },
  usage:            { label: 'Used (route not said)', cls: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800' },
};

/** The routes offered as a filter, in the order stock flows. */
export const ROUTE_FILTERS: StockRoute[] = [
  'receive', 'kitchen', 'event', 'event_return', 'waste', 'production', 'count_difference', 'correction', 'sale', 'reversal', 'usage',
];

/**
 * A movement's route. New movements carry one; older ones are worked out from
 * their type, the same way the database does for anything recorded without one.
 */
export function routeOf(m: { route?: string | null; movement_type: string; reference_type?: string | null }): StockRoute {
  if (m.route && m.route in ROUTE_META) return m.route as StockRoute;
  switch (m.movement_type) {
    case 'reversal': return 'reversal';
    case 'purchase': return 'receive';
    case 'production_issue':
    case 'production_output': return 'production';
    case 'stock_take': return 'count_difference';
    case 'waste': return 'waste';
    case 'sale': return 'sale';
    case 'return': return 'return';
    case 'transfer': return 'transfer';
    case 'adjustment': return m.reference_type === 'opening' ? 'opening' : 'correction';
    default: return 'usage';
  }
}

export const routeMeta = (m: Parameters<typeof routeOf>[0]) => ROUTE_META[routeOf(m)];

/** Used until the list is saved in Inventory setup. */
export const DEFAULT_WASTE_REASONS = ['Spoiled', 'Spilled', 'Burnt', 'Expired', 'Damaged', 'Other'];

// ── The daily sheet ──────────────────────────────────────────────────────────

/**
 * Items for the daily sheet: by storage place in the order the places are
 * listed, and within a place the items the kitchen uses most come first.
 */
export function orderDailySheet<T extends { id: string; name: string }>(
  items: T[],
  placeOf: (item: T) => string | null | undefined,
  places: string[],
  timesUsed: Map<string, number>,
): { place: string; items: T[] }[] {
  const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const rank = new Map(places.map((p, i) => [key(p), i]));
  const groups = new Map<string, { place: string; order: number; items: T[] }>();
  for (const it of items) {
    const p = (placeOf(it) ?? '').trim();
    const k = key(p);
    if (!groups.has(k)) {
      groups.set(k, { place: p || 'No storage place set', order: !k ? places.length + 1 : rank.get(k) ?? places.length, items: [] });
    }
    groups.get(k)!.items.push(it);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.place.localeCompare(b.place))
    .map((g) => ({
      place: g.place,
      items: g.items.sort((a, b) => (timesUsed.get(b.id) ?? 0) - (timesUsed.get(a.id) ?? 0) || a.name.localeCompare(b.name)),
    }));
}

// ── The count ────────────────────────────────────────────────────────────────

const num = (s: string | null | undefined) => {
  const n = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export interface CountEntry {
  /** Whole packs counted ("2" bags); '' when the item has no pack size or none were counted. */
  packs: string;
  /** Loose quantity in stock units ("6" kg). */
  loose: string;
}

/** Nothing typed: the item was not counted, which is not the same as counting zero. */
export const isUncounted = (e: CountEntry | undefined) => !e || (e.packs.trim() === '' && e.loose.trim() === '');

/** "2 bags and 6 kg" with 1 bag = 20 kg is 46 kg. */
export function countedQty(e: CountEntry, packFactor: number | null | undefined): number {
  return round4(num(e.packs) * (packFactor && packFactor > 0 ? packFactor : 0) + num(e.loose));
}

/** How it was counted, kept beside the total: "2 bag + 6 kg". */
export function countedAs(e: CountEntry, packUnit: string | null | undefined, stockUnit: string): string {
  const parts: string[] = [];
  if (packUnit && num(e.packs) > 0) parts.push(`${fmtQty(num(e.packs))} ${packUnit}`);
  if (num(e.loose) > 0 || parts.length === 0) parts.push(`${fmtQty(num(e.loose))} ${stockUnit}`);
  return parts.join(' + ');
}

export interface CountRule {
  /** A difference above this share of the expected quantity needs a reason … */
  pct: number;
  /** … or one worth more than this, in kobo. */
  valueMinor: number;
}
export const DEFAULT_COUNT_RULE: CountRule = { pct: 10, valueMinor: 2_000_000 };

/** Does a difference need a reason before the count is approved? */
export function needsReason(expected: number, counted: number, unitCost: number, rule: CountRule = DEFAULT_COUNT_RULE): boolean {
  const diff = counted - expected;
  if (diff === 0) return false;
  if (Math.abs(diff) * (unitCost || 0) * 100 > rule.valueMinor) return true;
  if (expected <= 0) return rule.pct < 100;
  return Math.abs(diff) > (expected * rule.pct) / 100;
}

export interface CountLine {
  expected_qty: number | string;
  counted_qty: number | string;
  unit_cost: number | string;
  reason?: string | null;
}

/** Totals for the review: how many items differ, what is short and what is over, in naira. */
export function countSummary(lines: CountLine[], rule: CountRule = DEFAULT_COUNT_RULE, reasons: Record<string, string> = {}, idOf?: (l: CountLine) => string) {
  let differ = 0, shortValue = 0, overValue = 0, unexplained = 0;
  for (const l of lines) {
    const e = Number(l.expected_qty), c = Number(l.counted_qty), cost = Number(l.unit_cost);
    const diff = c - e;
    if (diff === 0) continue;
    differ++;
    if (diff < 0) shortValue += -diff * cost; else overValue += diff * cost;
    const why = (idOf ? reasons[idOf(l)] : undefined)?.trim() || (l.reason ?? '').trim();
    if (needsReason(e, c, cost, rule) && !why) unexplained++;
  }
  return { counted: lines.length, differ, shortValue, overValue, netValue: overValue - shortValue, unexplained };
}
