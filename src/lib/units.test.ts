import { describe, expect, it } from 'vitest';
import {
  allUnits, beforeUnitChange, buildItemUnits, costPerStockUnit, factorOf, movementQuantity,
  normaliseUnit, packProblems, similarItems, toStock, unusualUsage, withPurchaseEquivalent,
} from './units';

// The acceptance checks from the inventory and units fix list (23 Nov 2026).
const wings = buildItemUnits('kg', [{ unit_name: 'bag', factor: 10 }], 'bag');

describe('unit model', () => {
  it('spells units the way the database does', () => {
    expect(normaliseUnit(' KGs ')).toBe('kg');
    expect(normaliseUnit('ml')).toBe('millilitre');
    expect(normaliseUnit('g')).toBe('gram');
    expect(normaliseUnit('Ctn')).toBe('carton');
    expect(normaliseUnit('Bucket')).toBe('bucket');
    expect(normaliseUnit(null)).toBe('');
  });

  it('offers the standard units, the new ones and custom ones once each', () => {
    const units = allUnits(['Bucket', 'bag'], ['kg', 'tray']);
    for (const u of ['kg', 'litre', 'piece', 'pack', 'bag', 'carton', 'gram', 'millilitre', 'basket', 'crate', 'bottle', 'tin', 'sachet', 'bucket', 'tray']) {
      expect(units).toContain(u);
    }
    expect(units.filter((u) => u === 'bag')).toHaveLength(1);
  });

  it('keeps the stock unit first and the purchase unit only when it converts', () => {
    expect(wings.stockUnit).toBe('kg');
    expect(wings.purchaseUnit).toBe('bag');
    expect(wings.units).toEqual([{ name: 'kg', factor: 1 }, { name: 'bag', factor: 10 }]);
    // A purchase unit with no pack size falls back to the stock unit.
    expect(buildItemUnits('kg', [], 'bag').purchaseUnit).toBe('kg');
    // A pack size with no factor is not a unit.
    expect(buildItemUnits('kg', [{ unit_name: 'bag', factor: 0 }]).units).toHaveLength(1);
  });

  it('check 1: receiving 2 bags at 1 bag = 10 kg raises stock by 20 kg and reads "2 bag (20 kg)"', () => {
    const f = factorOf(wings, 'bag')!;
    expect(toStock(2, f)).toBe(20);
    expect(movementQuantity({ quantity_change: 20, entered_qty: 2, entered_unit: 'bag' }, 'kg')).toBe('+2 bag (20 kg)');
  });

  it('check 2: using 3.5 kg lowers stock by 3.5 kg', () => {
    expect(toStock(3.5, factorOf(wings, 'kg')!)).toBe(3.5);
    expect(movementQuantity({ quantity_change: -3.5 }, 'kg')).toBe('−3.5 kg');
  });

  it('check 3: ₦50,000 for 2 bags is ₦2,500 per kg, from either figure', () => {
    expect(costPerStockUnit({ qty: 2, factor: 10, total: 50_000 })).toBe(2500);
    expect(costPerStockUnit({ qty: 2, factor: 10, pricePerUnit: 25_000 })).toBe(2500);
  });

  it('check 4: a purchase unit cannot be saved without a conversion factor', () => {
    expect(packProblems('kg', [{ name: 'bag', factor: '' }])).toHaveLength(1);
    expect(packProblems('kg', [{ name: 'bag', factor: '0' }])).toHaveLength(1);
    expect(packProblems('kg', [{ name: 'bag', factor: '10' }])).toHaveLength(0);
    expect(packProblems('kg', [{ name: 'kg', factor: '1' }])).toHaveLength(1);
    expect(packProblems('kg', [{ name: 'bag', factor: '10' }, { name: 'bags', factor: '12' }])).toHaveLength(1);
    expect(packProblems('kg', [{ name: '', factor: '' }])).toHaveLength(0);
  });

  it('an unknown unit for an item has no factor', () => {
    expect(factorOf(wings, 'carton')).toBeNull();
    expect(factorOf(wings, '')).toBe(1);
  });

  it('a delivery can override the pack size', () => {
    // A bag that weighed 9.5 kg.
    expect(toStock(2, 9.5)).toBe(19);
    expect(costPerStockUnit({ qty: 2, factor: 9.5, total: 47_500 })).toBe(2500);
  });

  it('shows the purchase-unit equivalent beside a balance', () => {
    expect(withPurchaseEquivalent(28, wings)).toBe('28 kg, about 2.8 bag');
    expect(withPurchaseEquivalent(28, buildItemUnits('kg'))).toBe('28 kg');
    expect(withPurchaseEquivalent(0, wings)).toBe('0 kg');
  });

  it('quantities accept decimals', () => {
    expect(toStock(0.5, 1)).toBe(0.5);
    expect(toStock(0.25, 10)).toBe(2.5);
  });
});

describe('form checks', () => {
  const items = [
    { name: 'PRAWNS' }, { name: 'PUD PRAWNS' }, { name: 'JUMBO PRAWNS' },
    { name: 'CHICKEN' }, { name: 'Chicken Breast' }, { name: 'CHICKEN WINGS' }, { name: 'GAS' },
  ];

  it('adding "Prawns" shows the prawn items that exist', () => {
    const found = similarItems('Prawns', items).map((i) => i.name);
    expect(found[0]).toBe('PRAWNS');
    expect(found).toEqual(expect.arrayContaining(['PUD PRAWNS', 'JUMBO PRAWNS']));
    expect(found).not.toContain('GAS');
  });

  it('"Regular Prawns" still finds PRAWNS', () => {
    expect(similarItems('Regular Prawns', items).map((i) => i.name)).toContain('PRAWNS');
  });

  it('a new name finds nothing', () => {
    expect(similarItems('Charcoal', items)).toHaveLength(0);
    expect(similarItems('Ga', items)).toHaveLength(0);
  });

  it('160 for Chicken Breast prompts a confirmation when deliveries are 20 to 40', () => {
    expect(unusualUsage(160, 40)).toBe(true);
    expect(unusualUsage(30, 40)).toBe(false);
    // Nothing to compare against: no prompt.
    expect(unusualUsage(160, null)).toBe(false);
  });

  it('marks movements made before the unit change', () => {
    expect(beforeUnitChange('2026-10-16T10:00:00Z', '2026-11-24T09:00:00Z')).toBe(true);
    expect(beforeUnitChange('2026-11-25T10:00:00Z', '2026-11-24T09:00:00Z')).toBe(false);
    expect(beforeUnitChange('2026-10-16T10:00:00Z', null)).toBe(false);
  });
});
