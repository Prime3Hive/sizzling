// Units for stock items.
//
// An item is stocked in ONE unit (its stock unit: kg, litre, piece). Goods can
// arrive in other units (bag, carton, basket); each of those has a factor: how
// many stock units one of them holds. Balances and movements are always kept
// in the stock unit, and a movement also remembers what the person typed.

export const STANDARD_UNITS = [
  'kg', 'gram', 'litre', 'millilitre', 'piece',
  'pack', 'bag', 'carton', 'basket', 'crate', 'bottle', 'tin', 'sachet',
] as const;

const ALIASES: Record<string, string> = {
  kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'gram', gm: 'gram', gms: 'gram', grams: 'gram', gramme: 'gram', grammes: 'gram',
  l: 'litre', lt: 'litre', ltr: 'litre', ltrs: 'litre', liter: 'litre', liters: 'litre', litres: 'litre',
  ml: 'millilitre', mls: 'millilitre', millilitres: 'millilitre', milliliter: 'millilitre', milliliters: 'millilitre',
  pc: 'piece', pcs: 'piece', pieces: 'piece', unit: 'piece', units: 'piece', each: 'piece', ea: 'piece', no: 'piece', nos: 'piece',
  packs: 'pack', pk: 'pack', pkt: 'pack', pkts: 'pack', packet: 'pack', packets: 'pack',
  bags: 'bag', sack: 'bag', sacks: 'bag',
  cartons: 'carton', ctn: 'carton', ctns: 'carton',
  baskets: 'basket', crates: 'crate',
  bottles: 'bottle', btl: 'bottle', btls: 'bottle',
  tins: 'tin', can: 'tin', cans: 'tin',
  sachets: 'sachet',
};

/** The same spelling the database stores (fn_normalise_unit). '' when empty. */
export function normaliseUnit(u: string | null | undefined): string {
  const s = (u ?? '').trim().toLowerCase();
  return ALIASES[s] ?? s;
}

/** Standard units plus the ones an admin added, without repeats. */
export function allUnits(custom: string[] = [], alsoInclude: (string | null | undefined)[] = []): string[] {
  const out: string[] = [...STANDARD_UNITS];
  for (const u of [...custom, ...alsoInclude]) {
    const n = normaliseUnit(u);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export interface ItemUnit {
  name: string;
  /** Stock units in one of these. The stock unit itself is 1. */
  factor: number;
}

export interface ItemUnits {
  /** The unit balances are kept in. */
  stockUnit: string;
  /** The unit goods usually arrive in; equals stockUnit when none is set. */
  purchaseUnit: string;
  /** Stock unit first (factor 1), then pack sizes, largest first. */
  units: ItemUnit[];
}

export function buildItemUnits(
  stockUnit: string | null | undefined,
  packs: { unit_name: string; factor: number | string }[] = [],
  purchaseUnit?: string | null,
): ItemUnits {
  const base = normaliseUnit(stockUnit) || 'piece';
  const seen = new Set([base]);
  const extra: ItemUnit[] = [];
  for (const p of packs) {
    const name = normaliseUnit(p.unit_name);
    const factor = Number(p.factor);
    if (!name || seen.has(name) || !(factor > 0)) continue;
    seen.add(name);
    extra.push({ name, factor });
  }
  extra.sort((a, b) => b.factor - a.factor);
  const pu = normaliseUnit(purchaseUnit);
  return {
    stockUnit: base,
    purchaseUnit: pu && seen.has(pu) ? pu : base,
    units: [{ name: base, factor: 1 }, ...extra],
  };
}

export const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** "2.5", "240", "0.125": up to 4 places, no trailing zeros. */
export function fmtQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return round4(Number(n)).toLocaleString('en-NG', { maximumFractionDigits: 4 });
}

/** Stock units in one `unit` of this item; null when the item has no such unit. */
export function factorOf(item: ItemUnits | undefined, unit: string | null | undefined): number | null {
  const u = normaliseUnit(unit);
  if (!item || !u) return 1;
  return item.units.find((x) => x.name === u)?.factor ?? null;
}

/** What was typed, in stock units. */
export const toStock = (qty: number, factor: number) => round4(qty * factor);

/**
 * Cost per stock unit from either figure on a receipt.
 * Paying ₦50,000 for 2 bags of 10 kg gives ₦2,500 per kg.
 */
export function costPerStockUnit(opts: { qty: number; factor: number; total?: number; pricePerUnit?: number }): number {
  const stockQty = opts.qty * opts.factor;
  if (!(stockQty > 0)) return 0;
  if (opts.total != null && opts.total > 0) return opts.total / stockQty;
  if (opts.pricePerUnit != null && opts.pricePerUnit > 0 && opts.factor > 0) return opts.pricePerUnit / opts.factor;
  return 0;
}

/**
 * A stock quantity with its purchase-unit equivalent: "28 kg, about 2.8 bag".
 * Just "28 kg" when the item is bought in its stock unit.
 */
export function withPurchaseEquivalent(stockQty: number, item: ItemUnits | undefined): string {
  if (!item) return fmtQty(stockQty);
  const base = `${fmtQty(stockQty)} ${item.stockUnit}`;
  const f = factorOf(item, item.purchaseUnit);
  if (!f || f === 1 || item.purchaseUnit === item.stockUnit || stockQty === 0) return base;
  const eq = Math.round((stockQty / f) * 100) / 100;
  return `${base}, about ${eq.toLocaleString('en-NG', { maximumFractionDigits: 2 })} ${item.purchaseUnit}`;
}

/** A movement as typed: "2 bag (20 kg)", or "20 kg" when typed in stock units. */
export function movementQuantity(m: {
  quantity_change: number | string;
  entered_qty?: number | string | null;
  entered_unit?: string | null;
}, stockUnit: string): string {
  const q = Number(m.quantity_change);
  const sign = q >= 0 ? '+' : '−';
  const stock = `${fmtQty(Math.abs(q))} ${stockUnit}`.trim();
  if (m.entered_unit && m.entered_qty != null && normaliseUnit(m.entered_unit) !== normaliseUnit(stockUnit)) {
    return `${sign}${fmtQty(Math.abs(Number(m.entered_qty)))} ${m.entered_unit} (${stock})`;
  }
  return `${sign}${stock}`;
}

// ── Pack sizes on the item form ──────────────────────────────────────────────

export interface PackDraft { name: string; factor: string }

/** Which stock unit suits the kind of item (shown as a hint, never forced). */
export const STOCK_UNIT_RULE = 'Weighed items in kg, liquids and fuel in litres, counted items in pieces.';

/** Messages for pack sizes that cannot be saved; empty when all are fine. */
export function packProblems(stockUnit: string, packs: PackDraft[]): string[] {
  const out: string[] = [];
  const seen = new Set([normaliseUnit(stockUnit)]);
  for (const p of packs) {
    const name = normaliseUnit(p.name);
    if (!name && !p.factor) continue;
    if (!name) { out.push('Choose the unit for each pack size.'); continue; }
    if (seen.has(name)) { out.push(`"${name}" is listed twice, or is the stock unit itself.`); continue; }
    seen.add(name);
    if (!(parseFloat(p.factor) > 0)) out.push(`Say how many ${stockUnit || 'stock units'} are in one ${name}.`);
  }
  return [...new Set(out)];
}

// ── Similar names ────────────────────────────────────────────────────────────

const STOP = new Set(['fresh', 'regular', 'the', 'of', 'and', 'big', 'small', 'large', 'medium']);
const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !STOP.has(w)).map(stem);

/**
 * Items whose name shares a word with the one being typed, so "Prawns" shows
 * PRAWNS, PUD PRAWNS and JUMBO PRAWNS before a fourth is created.
 */
export function similarItems<T extends { name: string }>(name: string, items: T[], limit = 4): T[] {
  const mine = words(name);
  if (mine.length === 0 || name.trim().length < 3) return [];
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const theirs = words(item.name);
    if (theirs.length === 0) continue;
    const shared = mine.filter((w) => theirs.includes(w) || theirs.some((t) => (t.length > 3 && w.length > 3) && (t.startsWith(w) || w.startsWith(t)))).length;
    if (shared === 0) continue;
    const exact = mine.join(' ') === theirs.join(' ');
    scored.push({ item, score: (exact ? 10 : 0) + shared / Math.max(mine.length, theirs.length) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.item);
}

// ── Checks on what is typed ──────────────────────────────────────────────────

/**
 * Usage far above normal: more than the largest delivery on record (or, with
 * no delivery on record, more than is on hand). Usually the wrong unit.
 */
export function unusualUsage(stockQty: number, largestReceipt: number | null | undefined): boolean {
  return largestReceipt != null && largestReceipt > 0 && stockQty > largestReceipt;
}

/**
 * Which movements belong to the period before an item's unit was fixed.
 * `resetAt` is the latest unit change or opening count for the item.
 */
export const beforeUnitChange = (createdAt: string, resetAt: string | null | undefined) =>
  !!resetAt && createdAt < resetAt;
