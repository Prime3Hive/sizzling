import { describe, expect, it } from 'vitest';
import { buildItemUnits } from './units';
import {
  buildLinesPayload, calcStockLine, checkReceipt, isBlankLine, totalsByCategory,
  type LineDraft, type OtherLineDraft, type ReceiptHeaderDraft, type StockLineDraft,
} from './receiving';

// The "Receive" checks from the inventory redesign (23 Nov 2026):
// a market run of 2 bags of wings at ₦188,000 each and ₦50,000 bus fuel.
const wingsUnits = buildItemUnits('kg', [{ unit_name: 'bag', factor: 20 }], 'bag');
const items: Record<string, { name: string; category: string; units: ReturnType<typeof buildItemUnits> }> = {
  wings: { name: 'Chicken Wings', category: 'Proteins', units: wingsUnits },
  rice: { name: 'Rice', category: 'Dry Goods & Seasonings', units: buildItemUnits('kg', [], null) },
};
const itemOf = (id: string) => items[id];

const wings: StockLineDraft = { key: 1, kind: 'stock', sku_id: 'wings', quantity: '2', unit: 'bag', factor: '', priceMode: 'unit', price: '188000' };
const fuel: OtherLineDraft = { key: 2, kind: 'other', category: 'Transport', description: 'Bus fuel', amount: '50,000' };
const header: ReceiptHeaderDraft = {
  payeeId: '', supplierName: 'Market', date: '2026-11-23', method: 'cash',
  bankAccountId: '', budgetId: '', hasPhoto: false, noReceiptReason: '',
};
const opts = { itemOf, today: '2026-11-24', photoAboveMinor: null, bankRequired: true };

describe('receive: one step for every purchase', () => {
  it('check 1: 2 bags at ₦188,000 is 40 kg and ₦376,000, at ₦9,400 per kg', () => {
    const c = calcStockLine(wings, wingsUnits);
    expect(c.converted).toBe(true);
    expect(c.stockQty).toBe(40);
    expect(c.stockUnit).toBe('kg');
    expect(c.amountMinor).toBe(37_600_000);
    expect(c.unitCost).toBe(9400);
  });

  it('takes the total paid as readily as the price per unit', () => {
    const c = calcStockLine({ ...wings, priceMode: 'total', price: '376000' }, wingsUnits);
    expect(c.amountMinor).toBe(37_600_000);
    expect(c.unitCost).toBe(9400);
  });

  it('uses this delivery’s weight when the bag was not the usual size', () => {
    const c = calcStockLine({ ...wings, factor: '19' }, wingsUnits);
    expect(c.stockQty).toBe(38);
    expect(c.factor).toBe(19);
    expect(c.itemFactor).toBe(20);
  });

  it('checks 1 and 2: one receipt, ₦376,000 Proteins and ₦50,000 Transport, ₦426,000 once', () => {
    const lines: LineDraft[] = [wings, fuel];
    const check = checkReceipt(header, lines, opts);
    expect(check.ok).toBe(true);
    expect(check.totalMinor).toBe(42_600_000);
    expect(totalsByCategory(lines, itemOf)).toEqual([
      { category: 'Proteins', minor: 37_600_000 },
      { category: 'Transport', minor: 5_000_000 },
    ]);
    expect(buildLinesPayload(lines, itemOf)).toEqual([
      { kind: 'stock', sku_id: 'wings', quantity: 2, unit: 'bag', total: 376000 },
      { kind: 'other', category: 'Transport', description: 'Bus fuel', amount: 50000 },
    ]);
  });

  it('sends no unit for a line typed in the stock unit, and the factor only when it differs', () => {
    const rice: StockLineDraft = { key: 3, kind: 'stock', sku_id: 'rice', quantity: '50', unit: '', factor: '', priceMode: 'total', price: '90000' };
    expect(buildLinesPayload([rice, { ...wings, factor: '19' }], itemOf)).toEqual([
      { kind: 'stock', sku_id: 'rice', quantity: 50, total: 90000 },
      { kind: 'stock', sku_id: 'wings', quantity: 2, unit: 'bag', factor: 19, total: 376000 },
    ]);
  });

  it('ignores lines nothing was typed into, and needs at least one real line', () => {
    const blank: StockLineDraft = { key: 9, kind: 'stock', sku_id: '', quantity: '', unit: '', factor: '', priceMode: 'unit', price: '' };
    expect(isBlankLine(blank)).toBe(true);
    expect(checkReceipt(header, [wings, blank], opts).ok).toBe(true);
    expect(checkReceipt(header, [blank], opts).header.lines).toBeTruthy();
  });

  it('says what is missing on the header', () => {
    const c = checkReceipt({ ...header, supplierName: ' ', method: '', date: '2026-12-01' }, [wings], opts);
    expect(c.header.supplier).toBeTruthy();
    expect(c.header.method).toBeTruthy();
    expect(c.header.date).toContain('future');
    expect(checkReceipt({ ...header, method: 'transfer' }, [wings], opts).header.bank).toBeTruthy();
    expect(checkReceipt({ ...header, method: 'transfer' }, [wings], { ...opts, bankRequired: false }).ok).toBe(true);
  });

  it('says what is missing on a line', () => {
    const c = checkReceipt(header, [
      { ...wings, key: 1, quantity: '' },
      { ...wings, key: 2, sku_id: 'rice', unit: 'carton' },
      { ...wings, key: 3, sku_id: 'rice', unit: '', price: '' },
      { ...fuel, key: 4, category: '' },
      { ...fuel, key: 5, amount: '0' },
    ], opts);
    expect(c.lines[1]).toContain('quantity');
    expect(c.lines[2]).toContain('how many kg');
    expect(c.lines[3]).toContain('another line');
    expect(c.lines[4]).toContain('category');
    expect(c.lines[5]).toContain('amount');
    expect(c.ok).toBe(false);
  });

  it('asks for a photo above the amount the owner set, or a proper reason', () => {
    const limit = { ...opts, photoAboveMinor: 20_000_000 };
    expect(checkReceipt(header, [wings], limit).header.photo).toBeTruthy();
    expect(checkReceipt({ ...header, hasPhoto: true }, [wings], limit).ok).toBe(true);
    expect(checkReceipt({ ...header, noReceiptReason: 'no' }, [wings], limit).header.photo).toContain('10');
    expect(checkReceipt({ ...header, noReceiptReason: 'Open market, trader gives no receipt' }, [wings], limit).ok).toBe(true);
    expect(checkReceipt(header, [fuel], limit).ok).toBe(true);
  });
});
