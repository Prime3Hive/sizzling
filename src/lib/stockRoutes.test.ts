import { describe, expect, it } from 'vitest';
import {
  countSummary, countedAs, countedQty, isUncounted, needsReason, orderDailySheet, routeOf,
} from './stockRoutes';

// Stock out and count checks from the inventory redesign (23 Nov 2026).

describe('routes', () => {
  it('uses the route a movement carries', () => {
    expect(routeOf({ route: 'event', movement_type: 'usage' })).toBe('event');
    expect(routeOf({ route: 'waste', movement_type: 'waste' })).toBe('waste');
  });

  it('works out the route of an older movement from its type', () => {
    expect(routeOf({ movement_type: 'purchase' })).toBe('receive');
    expect(routeOf({ movement_type: 'stock_take' })).toBe('count_difference');
    expect(routeOf({ movement_type: 'production_issue' })).toBe('production');
    expect(routeOf({ movement_type: 'adjustment', reference_type: 'manual' })).toBe('correction');
    expect(routeOf({ movement_type: 'adjustment', reference_type: 'opening' })).toBe('opening');
    // A plain "Used" entry from before the routes is not passed off as kitchen use.
    expect(routeOf({ movement_type: 'usage' })).toBe('usage');
    expect(routeOf({ route: 'nonsense', movement_type: 'usage' })).toBe('usage');
  });
});

describe('daily sheet', () => {
  it('lists items by storage place, the most used first within each place', () => {
    const items = [
      { id: 'rice', name: 'Rice', place: 'Dry store' },
      { id: 'wings', name: 'Wings', place: 'Freezer' },
      { id: 'breast', name: 'Breast', place: 'Freezer' },
      { id: 'gizzard', name: 'Gizzard', place: 'freezer ' },
      { id: 'salt', name: 'Salt', place: null },
    ];
    const used = new Map([['wings', 12], ['gizzard', 30], ['rice', 4]]);
    const sheet = orderDailySheet(items, (i) => i.place, ['Freezer', 'Cold room', 'Dry store'], used);
    expect(sheet.map((g) => g.place)).toEqual(['Freezer', 'Dry store', 'No storage place set']);
    expect(sheet[0].items.map((i) => i.id)).toEqual(['gizzard', 'wings', 'breast']);
  });
});

describe('count', () => {
  it('takes a count in packs and loose stock units: 2 bags and 6 kg', () => {
    expect(countedQty({ packs: '2', loose: '6' }, 20)).toBe(46);
    expect(countedAs({ packs: '2', loose: '6' }, 'bag', 'kg')).toBe('2 bag + 6 kg');
    expect(countedQty({ packs: '', loose: '52' }, 20)).toBe(52);
    expect(countedAs({ packs: '', loose: '52' }, 'bag', 'kg')).toBe('52 kg');
    expect(countedQty({ packs: '3', loose: '' }, null)).toBe(0);
  });

  it('tells "not counted" from "counted zero"', () => {
    expect(isUncounted({ packs: '', loose: '' })).toBe(true);
    expect(isUncounted(undefined)).toBe(true);
    expect(isUncounted({ packs: '', loose: '0' })).toBe(false);
    expect(countedAs({ packs: '', loose: '0' }, 'bag', 'kg')).toBe('0 kg');
  });

  it('asks for a reason above 10% of expected, or above ₦20,000', () => {
    // Expected 60 kg, counted 52 kg at ₦9,400: 13% and ₦75,200.
    expect(needsReason(60, 52, 9400)).toBe(true);
    // 3 of 100 kg at ₦1,500: 3% and ₦4,500.
    expect(needsReason(100, 97, 1500)).toBe(false);
    // 3% but worth ₦28,200.
    expect(needsReason(100, 97, 9400)).toBe(true);
    // 20% but worth ₦200.
    expect(needsReason(10, 8, 100)).toBe(true);
    expect(needsReason(60, 60, 9400)).toBe(false);
    // Something found where the records showed none.
    expect(needsReason(0, 2, 100)).toBe(true);
  });

  it('follows the limits the owner sets', () => {
    expect(needsReason(60, 52, 9400, { pct: 20, valueMinor: 10_000_000 })).toBe(false);
  });

  it('sums the review: expected 60, counted 52 is 8 kg short, ₦75,200', () => {
    const lines = [
      { id: 'a', expected_qty: 60, counted_qty: 52, unit_cost: 9400 },
      { id: 'b', expected_qty: 100, counted_qty: 97, unit_cost: 1500 },
      { id: 'c', expected_qty: 10, counted_qty: 10, unit_cost: 2000 },
      { id: 'd', expected_qty: 5, counted_qty: 6, unit_cost: 1000, reason: 'Found behind the freezer' },
    ];
    const s = countSummary(lines);
    expect(s.counted).toBe(4);
    expect(s.differ).toBe(3);
    expect(s.shortValue).toBe(79700);
    expect(s.overValue).toBe(1000);
    expect(s.netValue).toBe(-78700);
    // Only the wings line still needs a reason: rice is small, the found item has one.
    expect(s.unexplained).toBe(1);
    expect(countSummary(lines, undefined, { a: 'Freezer left open' }, (l) => (l as unknown as { id: string }).id).unexplained).toBe(0);
  });
});
