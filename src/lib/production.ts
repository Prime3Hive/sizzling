import { supabase } from '@/integrations/supabase/client';

// Production: recipes → runs (recorded, then approved) → lots of finished stock.
// Quantities are stored in each item's BASE unit (products.uom). Pack sizes in
// product_units say how many base units one bag / carton / gram holds, so a
// recipe can say "1 bag of flour" and a run "10 cartons" while stock and cost
// stay in kg and packs.

const db = supabase as any;

export type ItemClass = 'raw_material' | 'finished_good' | 'semi_finished';
export type RunStatus = 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'reversed';

export const ITEM_CLASS_LABEL: Record<ItemClass, string> = {
  raw_material: 'Raw material / bought-in',
  finished_good: 'Finished good',
  semi_finished: 'Semi-finished (made, then used in other recipes)',
};

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  submitted: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Withdrawn',
  reversed: 'Reversed',
};

export const isProduced = (c: ItemClass | null | undefined) => c === 'finished_good' || c === 'semi_finished';

// ── Units ────────────────────────────────────────────────────────────────────

export interface PackUnit {
  /** Name shown to people: "bag", "carton", "g". */
  name: string;
  /** Base units in one of these. The base unit itself is 1. */
  factor: number;
}

/** The base unit first, then the item's pack sizes, largest first. */
export function unitsFor(baseUom: string | null | undefined, packs: PackUnit[]): PackUnit[] {
  const base = (baseUom || 'unit').trim();
  const seen = new Set([base.toLowerCase()]);
  const extra = packs
    .filter((p) => p.factor > 0 && p.name.trim() && !seen.has(p.name.trim().toLowerCase()))
    .sort((a, b) => b.factor - a.factor);
  return [{ name: base, factor: 1 }, ...extra];
}

/** Round to the 4 places stock is stored at. */
export const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
export const round2 = (n: number) => Math.round(n * 100) / 100;

export const toBase = (qty: number, factor: number) => round4(qty * factor);
export const fromBase = (baseQty: number, factor: number) => (factor > 0 ? round4(baseQty / factor) : 0);

/** "2.5", "240", "0.125" — no trailing zeros. */
export function fmtQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(round4(Number(n))).toLocaleString('en-NG', { maximumFractionDigits: 4 });
}

/**
 * A base quantity read in the item's packs, e.g. 250 packs with
 * carton = 24 → "10 carton + 10 pack". Only the largest pack is used.
 */
export function describeInPacks(baseQty: number, units: PackUnit[]): string {
  const base = units[0];
  const big = units.slice(1).find((u) => u.factor > 1);
  if (!base) return fmtQty(baseQty);
  if (!big || Math.abs(baseQty) < big.factor) return `${fmtQty(baseQty)} ${base.name}`;
  const whole = Math.trunc(baseQty / big.factor);
  const rest = round4(baseQty - whole * big.factor);
  return rest === 0
    ? `${fmtQty(whole)} ${big.name}`
    : `${fmtQty(whole)} ${big.name} + ${fmtQty(rest)} ${base.name}`;
}

// ── Recipes and costs ────────────────────────────────────────────────────────

export interface RecipeLine {
  product_id: string;
  quantity: number;   // per batch, in unit_name
  unit_name: string | null;
  factor: number;     // base units per unit_name
}

/** Standard (expected) base quantity of each input for `batches` batches. */
export function scaleRecipe(lines: RecipeLine[], batches: number): { product_id: string; standard: number; unit_name: string | null; factor: number }[] {
  return lines.map((l) => ({
    product_id: l.product_id,
    standard: toBase(l.quantity * batches, l.factor),
    unit_name: l.unit_name,
    factor: l.factor,
  }));
}

export interface CostInput {
  /** Base quantity actually used. */
  actual: number;
  /** Cost per base unit (moving average). */
  unitCost: number;
}

export interface BatchCost {
  material: number;
  other: number;
  total: number;
  /** Cost per base unit of the output; 0 when nothing was produced. */
  perUnit: number;
}

/** What approval will post, priced at today's costs (line by line, to kobo). */
export function batchCost(inputs: CostInput[], otherCosts: number[], outputBase: number): BatchCost {
  const material = round2(inputs.reduce((s, i) => s + round2(Math.max(0, i.actual) * Math.max(0, i.unitCost)), 0));
  const other = round2(otherCosts.reduce((s, c) => s + (c > 0 ? round2(c) : 0), 0));
  const total = round2(material + other);
  return { material, other, total, perUnit: outputBase > 0 ? round4(total / outputBase) : 0 };
}

/** Cost of one of each pack size, from the cost per base unit. */
export function packCosts(perBase: number, units: PackUnit[]): { name: string; factor: number; cost: number }[] {
  return units.map((u) => ({ name: u.name, factor: u.factor, cost: round2(perBase * u.factor) }));
}

/**
 * Actual against standard. `pct` is the share over (+) or under (−) the
 * recipe; null when there was no standard to compare with.
 */
export function variance(standard: number | null | undefined, actual: number): { diff: number; pct: number | null } {
  const std = Number(standard ?? 0);
  const diff = round4(actual - std);
  return { diff, pct: std > 0 ? Math.round((diff / std) * 1000) / 10 : null };
}

/** Over the recipe by more than this share is flagged for the approver. */
export const VARIANCE_FLAG_PCT = 5;

/** Days until a lot expires (negative once it has), or null with no expiry. */
export function daysToExpiry(expiresOn: string | null | undefined, today = new Date()): number | null {
  if (!expiresOn) return null;
  const end = new Date(`${expiresOn}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

// ── Database calls ───────────────────────────────────────────────────────────

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

export interface RunPayload {
  recipe_id?: string | null;
  output_product_id: string;
  production_date: string;
  batches?: number | null;
  output_qty: number;
  output_unit?: string | null;
  output_factor?: number;
  warehouse_id?: string | null;
  notes?: string | null;
  inputs: { product_id: string; standard_qty?: number | null; actual_qty: number; unit_name?: string | null; factor?: number }[];
  costs: { description: string; amount: number }[];
}

export const submitProductionRun = (run: RunPayload) => rpc<string>('submit_production_run', { p_run: run });
export const approveProductionRun = (id: string, note?: string) =>
  rpc<number>('approve_production_run', { p_run_id: id, p_note: note ?? null });
export const rejectProductionRun = (id: string, note?: string) =>
  rpc<void>('reject_production_run', { p_run_id: id, p_note: note ?? null });
export const cancelProductionRun = (id: string) => rpc<void>('cancel_production_run', { p_run_id: id });
export const reverseProductionRun = (id: string, reason: string) =>
  rpc<void>('reverse_production_run', { p_run_id: id, p_reason: reason });
export const setProductionItem = (productId: string, itemClass: ItemClass, lotCode: string | null, shelfLifeDays: number | null) =>
  rpc<void>('set_production_item', {
    p_product_id: productId, p_item_class: itemClass, p_lot_code: lotCode, p_shelf_life_days: shelfLifeDays,
  });
