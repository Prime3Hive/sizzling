// Receive: one step for every purchase (inventory redesign, stage 2).
//
// Pure working-out for the receive form: what a line comes to in stock units
// and in naira, what stops a receipt being saved, and the payload the database
// function fn_receive_stock takes. The database does the same sums again; this
// is so the person sees them before saving.

import { factorOf, normaliseUnit, round4, toStock, type ItemUnits } from '@/lib/units';

export type PayMethod = 'cash' | 'transfer' | 'credit';

export const PAY_METHODS: { value: PayMethod; label: string; hint: string }[] = [
  { value: 'cash', label: 'Cash', hint: 'Paid in cash' },
  { value: 'transfer', label: 'Transfer', hint: 'Paid from the bank' },
  { value: 'credit', label: 'Credit', hint: 'Not paid yet; owed to the supplier' },
];

export interface StockLineDraft {
  key: number;
  kind: 'stock';
  sku_id: string;
  quantity: string;
  /** '' = the item's stock unit. */
  unit: string;
  /** Stock units in one `unit` for this delivery only; '' = the item's pack size. */
  factor: string;
  priceMode: 'unit' | 'total';
  price: string;
  /** Set when the line comes from a purchase order. */
  lpo_item_id?: string;
}

export interface OtherLineDraft {
  key: number;
  kind: 'other';
  category: string;
  description: string;
  amount: string;
  lpo_item_id?: string;
  /** Quantity received against the order line, in the order's unit. */
  quantity?: string;
}

export type LineDraft = StockLineDraft | OtherLineDraft;

const num = (s: string | undefined) => {
  const n = parseFloat(String(s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const kobo = (naira: number) => Math.round(naira * 100);

export interface StockLineCalc {
  stockUnit: string;
  unit: string;
  /** Not in the stock unit, so a conversion is shown. */
  converted: boolean;
  itemFactor: number;
  factor: number;
  /** false when the unit is not one the item can be converted from. */
  convertible: boolean;
  qty: number;
  stockQty: number;
  amountMinor: number;
  /** Per stock unit. */
  unitCost: number;
}

/** What a stock line comes to: "2 bag = 40 kg, ₦376,000, ₦9,400 per kg". */
export function calcStockLine(line: StockLineDraft, item: ItemUnits | undefined, fallbackUnit = ''): StockLineCalc {
  const stockUnit = item?.stockUnit ?? normaliseUnit(fallbackUnit);
  const unit = normaliseUnit(line.unit) || stockUnit;
  const converted = unit !== stockUnit;
  const known = converted ? factorOf(item, unit) : 1;
  const itemFactor = known ?? 1;
  const typed = converted ? num(line.factor) : 0;
  const factor = typed > 0 ? typed : itemFactor;
  const qty = num(line.quantity);
  const stockQty = toStock(qty, factor);
  const amountMinor = line.priceMode === 'total' ? kobo(num(line.price)) : kobo(num(line.price) * qty);
  return {
    stockUnit, unit, converted, itemFactor, factor,
    convertible: !converted || known != null || typed > 0,
    qty, stockQty, amountMinor,
    unitCost: stockQty > 0 ? round4(amountMinor / 100 / stockQty) : 0,
  };
}

export const otherLineMinor = (line: OtherLineDraft) => kobo(num(line.amount));

/** A line nothing has been typed into: ignored on save rather than flagged. */
export function isBlankLine(line: LineDraft): boolean {
  return line.kind === 'stock'
    ? !line.sku_id && !line.quantity.trim() && !line.price.trim()
    : !line.description.trim() && !line.amount.trim() && !line.lpo_item_id;
}

export interface ReceiptHeaderDraft {
  /** A payee id, or '' when the name is typed. */
  payeeId: string;
  supplierName: string;
  date: string;
  method: PayMethod | '';
  bankAccountId: string;
  budgetId: string;
  hasPhoto: boolean;
  noReceiptReason: string;
}

export interface ReceiptCheck {
  /** Problems with the header, by field. */
  header: Partial<Record<'supplier' | 'date' | 'method' | 'bank' | 'photo' | 'lines', string>>;
  /** Problems with a line, by line key. */
  lines: Record<number, string>;
  ok: boolean;
  totalMinor: number;
}

export interface CheckOptions {
  itemOf: (skuId: string) => { name: string; units?: ItemUnits; unit?: string } | undefined;
  today: string;
  /** A total above this needs a photo or a reason; null = never. */
  photoAboveMinor: number | null;
  /** Transfers name the bank account when there are accounts to choose from. */
  bankRequired: boolean;
}

/** Everything that stops a receipt being saved. */
export function checkReceipt(header: ReceiptHeaderDraft, lines: LineDraft[], opts: CheckOptions): ReceiptCheck {
  const out: ReceiptCheck = { header: {}, lines: {}, ok: false, totalMinor: 0 };
  const live = lines.filter((l) => !isBlankLine(l));

  if (!header.payeeId && !header.supplierName.trim()) out.header.supplier = 'Say who it was bought from. Use “Market” for a market run.';
  if (!header.date) out.header.date = 'Enter the date.';
  else if (header.date > opts.today) out.header.date = 'A receipt cannot be dated in the future.';
  if (!header.method) out.header.method = 'Choose how it was paid.';
  if (header.method === 'transfer' && opts.bankRequired && !header.bankAccountId) out.header.bank = 'Choose the bank account it was paid from.';
  if (live.length === 0) out.header.lines = 'Add at least one item or cost.';

  const seen = new Set<string>();
  for (const l of live) {
    if (l.kind === 'stock') {
      const item = l.sku_id ? opts.itemOf(l.sku_id) : undefined;
      const c = calcStockLine(l, item?.units, item?.unit);
      if (!l.sku_id || !item) out.lines[l.key] = 'Choose the item.';
      else if (seen.has(l.sku_id)) out.lines[l.key] = `${item.name} is on another line. Put the whole quantity on one line.`;
      else if (c.qty <= 0) out.lines[l.key] = 'Enter the quantity received.';
      else if (!c.convertible) out.lines[l.key] = `Say how many ${c.stockUnit} are in one ${c.unit}.`;
      else if (c.amountMinor <= 0) out.lines[l.key] = 'Enter what was paid.';
      if (l.sku_id) seen.add(l.sku_id);
      out.totalMinor += Math.max(c.amountMinor, 0);
    } else {
      const amount = otherLineMinor(l);
      if (!l.category) out.lines[l.key] = 'Choose a category.';
      else if (!l.description.trim()) out.lines[l.key] = 'Say what it was for.';
      else if (amount <= 0) out.lines[l.key] = 'Enter the amount paid.';
      else if (l.lpo_item_id && num(l.quantity) <= 0) out.lines[l.key] = 'Enter the quantity received.';
      out.totalMinor += Math.max(amount, 0);
    }
  }

  const reason = header.noReceiptReason.trim();
  if (reason && reason.length < 10) out.header.photo = 'Say why there is no receipt (at least 10 characters).';
  else if (opts.photoAboveMinor != null && out.totalMinor > opts.photoAboveMinor && !header.hasPhoto && !reason) {
    out.header.photo = 'A receipt this size needs a photo of the supplier’s receipt, or the reason there is none.';
  }

  out.ok = Object.keys(out.header).length === 0 && Object.keys(out.lines).length === 0;
  return out;
}

/** The lines as fn_receive_stock takes them. */
export function buildLinesPayload(lines: LineDraft[], unitsOf: (skuId: string) => { units?: ItemUnits; unit?: string } | undefined) {
  return lines.filter((l) => !isBlankLine(l)).map((l) => {
    if (l.kind === 'other') {
      return {
        kind: 'other' as const,
        category: l.category,
        description: l.description.trim(),
        amount: otherLineMinor(l) / 100,
        ...(l.lpo_item_id ? { lpo_item_id: l.lpo_item_id, quantity: num(l.quantity) } : {}),
      };
    }
    const item = unitsOf(l.sku_id);
    const c = calcStockLine(l, item?.units, item?.unit);
    return {
      kind: 'stock' as const,
      sku_id: l.sku_id,
      quantity: c.qty,
      ...(c.converted ? { unit: c.unit, ...(c.factor !== c.itemFactor ? { factor: c.factor } : {}) } : {}),
      // Always the line total: it is what was paid, whichever way it was typed.
      total: c.amountMinor / 100,
      ...(l.lpo_item_id ? { lpo_item_id: l.lpo_item_id } : {}),
    };
  });
}

/** Naira totals per expense category, for the summary under the lines. */
export function totalsByCategory(
  lines: LineDraft[],
  itemOf: (skuId: string) => { category: string; units?: ItemUnits; unit?: string } | undefined,
): { category: string; minor: number }[] {
  const by = new Map<string, number>();
  for (const l of lines) {
    if (isBlankLine(l)) continue;
    if (l.kind === 'other') {
      if (l.category) by.set(l.category, (by.get(l.category) ?? 0) + otherLineMinor(l));
    } else {
      const item = itemOf(l.sku_id);
      if (!item) continue;
      const c = calcStockLine(l, item.units, item.unit);
      by.set(item.category, (by.get(item.category) ?? 0) + c.amountMinor);
    }
  }
  return [...by].map(([category, minor]) => ({ category, minor })).filter((x) => x.minor > 0);
}
