// The item master: what an item has to say about itself so that no later form
// has to ask what a quantity means (inventory redesign, 23 Nov 2026, stage 1).
// Pure helpers, shared by the item form, the item list and the count sheet.

import { normaliseUnit } from '@/lib/units';

export const ITEM_KINDS = [
  { value: 'raw_ingredient', label: 'Raw ingredient', hint: 'Bought and cooked: wings, peppers, oil' },
  { value: 'packaging', label: 'Packaging', hint: 'Packs, foil, cling film, bags' },
  { value: 'cleaning', label: 'Cleaning', hint: 'Detergent, hypo, hair nets' },
  { value: 'fuel', label: 'Fuel', hint: 'Gas, charcoal, diesel, petrol' },
  { value: 'finished_good', label: 'Finished good', hint: 'Made in production and kept' },
] as const;

export type ItemKind = typeof ITEM_KINDS[number]['value'];

export const itemKindLabel = (kind: string | null | undefined) =>
  ITEM_KINDS.find((k) => k.value === kind)?.label ?? 'Not set';

/** Used until the storage places list is saved in Inventory setup. */
export const DEFAULT_STORAGE_PLACES = ['Freezer', 'Cold room', 'Dry store', 'Gas store'];

/** Names compared the way the database compares them: case and spacing ignored. */
export const nameKey = (name: string | null | undefined) =>
  (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The item that already has this name, if any (archived ones included). */
export function sameNameItem<T extends { id: string; name: string }>(name: string, items: T[], exceptId?: string): T | undefined {
  const key = nameKey(name);
  if (!key) return undefined;
  return items.find((it) => it.id !== exceptId && nameKey(it.name) === key);
}

export interface ItemDraft {
  name: string;
  /** '' when not chosen. */
  kind: string;
  stockUnit: string;
  /** As typed: '' means nothing was entered, which is not the same as 0. */
  minLevel: string;
}

export interface ItemProblems {
  name?: string;
  kind?: string;
  stockUnit?: string;
  minLevel?: string;
}

/**
 * What stops an item being saved. An item needs a name nobody else has, a
 * type, a stock unit and a minimum level. 0 is a valid minimum ("tell me only
 * when it runs out") but it has to be typed.
 */
export function itemProblems<T extends { id: string; name: string }>(
  draft: ItemDraft, items: T[], opts: { exceptId?: string; requireKind?: boolean } = {},
): ItemProblems {
  const out: ItemProblems = {};
  if (!draft.name.trim()) out.name = 'Give the item a name.';
  else {
    const clash = sameNameItem(draft.name, items, opts.exceptId);
    if (clash) out.name = `“${clash.name}” is already in the list. Use that item instead of adding it again.`;
  }
  if (opts.requireKind !== false && !draft.kind) out.kind = 'Choose what kind of item this is.';
  if (!normaliseUnit(draft.stockUnit)) out.stockUnit = 'Choose the unit this item is counted in.';
  const raw = draft.minLevel.trim();
  const level = Number(raw);
  if (raw === '') out.minLevel = 'Enter the minimum level. Use 0 to be told only when it runs out.';
  else if (!Number.isFinite(level) || level < 0) out.minLevel = 'The minimum level cannot be below zero.';
  return out;
}

export const hasProblems = (p: ItemProblems) => Object.keys(p).length > 0;

/**
 * Count sheet order: by storage place, in the order the places are listed, so
 * the sheet follows the walk round the store. Items with no place come last.
 */
export function orderForCount<T extends { name: string }>(
  items: T[], placeOf: (item: T) => string | null | undefined, places: string[],
): T[] {
  const rank = new Map(places.map((p, i) => [nameKey(p), i]));
  const at = (item: T) => {
    const p = nameKey(placeOf(item));
    if (!p) return places.length + 1;
    return rank.get(p) ?? places.length;
  };
  return [...items].sort((a, b) =>
    at(a) - at(b)
    || nameKey(placeOf(a)).localeCompare(nameKey(placeOf(b)))
    || a.name.localeCompare(b.name));
}
