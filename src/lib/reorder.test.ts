import { describe, expect, it } from 'vitest';
import { buildItemUnits } from './units';
import { groupBySupplier, needsBuying, suggestOrder, toBuyList } from './reorder';

// Reordering checks from the inventory redesign (23 Nov 2026).
const bags = buildItemUnits('kg', [{ unit_name: 'bag', factor: 20 }], 'bag');

describe('to buy', () => {
  it('check: wings at 15 kg, minimum 20 kg, target 60 kg suggest 3 bags of 20 kg', () => {
    const s = suggestOrder({ onHand: 15, minimum: 20, target: 60, units: bags });
    expect(s.needed).toBe(45);
    expect(s.packs).toBe(3);
    expect(s.unit).toBe('bag');
    expect(s.stockQty).toBe(60);
    expect(s.targetAssumed).toBe(false);
  });

  it('uses twice the minimum until a target is set', () => {
    const s = suggestOrder({ onHand: 15, minimum: 20, target: null, units: bags });
    expect(s.target).toBe(40);
    expect(s.targetAssumed).toBe(true);
    expect(s.packs).toBe(2); // 25 kg short → 2 bags
  });

  it('rounds up to whole purchase units, and not past an exact fit', () => {
    expect(suggestOrder({ onHand: 0, minimum: 20, target: 60, units: bags }).packs).toBe(3);
    expect(suggestOrder({ onHand: 19.99, minimum: 20, target: 60, units: bags }).packs).toBe(3);
    expect(suggestOrder({ onHand: 20, minimum: 20, target: 60, units: bags }).packs).toBe(2);
  });

  it('suggests stock units for an item with no pack size', () => {
    const s = suggestOrder({ onHand: 3, minimum: 5, target: 12, stockUnit: 'piece' });
    expect(s.unit).toBe('piece');
    expect(s.packs).toBe(9);
  });

  it('never suggests a target below the minimum', () => {
    expect(suggestOrder({ onHand: 5, minimum: 20, target: 10, units: bags }).target).toBe(20);
  });

  it('lists an item at or below its minimum, and not one above it', () => {
    expect(needsBuying(20, 20)).toBe(true);
    expect(needsBuying(15, 20)).toBe(true);
    expect(needsBuying(20.01, 20)).toBe(false);
    // No minimum set: only when it has run out.
    expect(needsBuying(0, 0)).toBe(true);
    expect(needsBuying(1, 0)).toBe(false);
  });

  it('puts what has run out first, then the furthest below its minimum', () => {
    const items = [
      { id: 'a', name: 'Rice', stock_quantity: 9, reorder_level: 10 },
      { id: 'b', name: 'Wings', stock_quantity: 5, reorder_level: 20 },
      { id: 'c', name: 'Oil', stock_quantity: 0, reorder_level: 4 },
      { id: 'd', name: 'Salt', stock_quantity: 50, reorder_level: 5 },
      { id: 'e', name: 'Old item', stock_quantity: 0, reorder_level: 5, is_archived: true },
    ];
    const list = toBuyList(items, () => undefined);
    expect(list.map((r) => r.item.name)).toEqual(['Oil', 'Wings', 'Rice']);
  });

  it('groups the list by usual supplier, the market group last', () => {
    const rows = [{ n: 'Wings', s: 'k' }, { n: 'Pepper', s: null }, { n: 'Breast', s: 'k' }, { n: 'Gas', s: 'g' }];
    const names: Record<string, string> = { k: 'Kola Frozen Foods', g: 'Gas Depot' };
    const groups = groupBySupplier(rows, (r) => (r.s ? { id: r.s, name: names[r.s] } : null));
    expect(groups.map((g) => g.name)).toEqual(['Gas Depot', 'Kola Frozen Foods', 'No usual supplier (market)']);
    expect(groups[1].rows.map((r) => r.n)).toEqual(['Wings', 'Breast']);
  });
});
