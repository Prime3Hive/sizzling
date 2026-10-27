import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  batchCost, daysToExpiry, describeInPacks, fromBase, packCosts, scaleRecipe, toBase, unitsFor, variance,
} from './production';

describe('unitsFor', () => {
  it('puts the base unit first and packs largest first, without duplicates', () => {
    const u = unitsFor('kg', [{ name: 'g', factor: 0.001 }, { name: 'bag', factor: 50 }, { name: 'KG', factor: 1 }]);
    expect(u.map((x) => x.name)).toEqual(['kg', 'bag', 'g']);
  });
  it('falls back to "unit" when an item has no unit of measure', () => {
    expect(unitsFor(null, [])[0]).toEqual({ name: 'unit', factor: 1 });
  });
});

describe('conversion', () => {
  it('converts packs to base and back', () => {
    expect(toBase(10, 24)).toBe(240);       // 10 cartons of 24 packs
    expect(toBase(250, 0.001)).toBe(0.25);  // 250 g in kg
    expect(fromBase(240, 24)).toBe(10);
  });
  it('reads a base quantity in the largest pack', () => {
    const u = unitsFor('pack', [{ name: 'carton', factor: 24 }]);
    expect(describeInPacks(250, u)).toBe('10 carton + 10 pack');
    expect(describeInPacks(240, u)).toBe('10 carton');
    expect(describeInPacks(12, u)).toBe('12 pack');
  });
});

describe('scaleRecipe', () => {
  it('multiplies each line by batches and converts to base', () => {
    const out = scaleRecipe([
      { product_id: 'flour', quantity: 1, unit_name: 'bag', factor: 50 },
      { product_id: 'salt', quantity: 200, unit_name: 'g', factor: 0.001 },
    ], 2.5);
    expect(out).toEqual([
      { product_id: 'flour', standard: 125, unit_name: 'bag', factor: 50 },
      { product_id: 'salt', standard: 0.5, unit_name: 'g', factor: 0.001 },
    ]);
  });
});

describe('batchCost', () => {
  it('adds materials and production expenses and divides by output', () => {
    const c = batchCost(
      [{ actual: 50, unitCost: 900 }, { actual: 0.25, unitCost: 1200 }],  // 45,000 + 300
      [3000, 0, -5],                                                     // only positive costs count
      240,
    );
    expect(c).toEqual({ material: 45300, other: 3000, total: 48300, perUnit: 201.25 });
  });
  it('is zero per unit when nothing was produced', () => {
    expect(batchCost([{ actual: 1, unitCost: 10 }], [], 0).perUnit).toBe(0);
  });
  it('gives the cost of each pack size', () => {
    const units = unitsFor('pack', [{ name: 'carton', factor: 24 }]);
    expect(packCosts(201.25, units)).toEqual([
      { name: 'pack', factor: 1, cost: 201.25 },
      { name: 'carton', factor: 24, cost: 4830 },
    ]);
  });
});

describe('variance', () => {
  it('reports over and under use against the recipe', () => {
    expect(variance(50, 53)).toEqual({ diff: 3, pct: 6 });
    expect(variance(50, 48)).toEqual({ diff: -2, pct: -4 });
  });
  it('has no percentage without a standard', () => {
    expect(variance(null, 2)).toEqual({ diff: 2, pct: null });
  });
});

describe('daysToExpiry', () => {
  it('counts whole days from today', () => {
    const today = new Date(2026, 9, 27);
    expect(daysToExpiry('2026-10-30', today)).toBe(3);
    expect(daysToExpiry('2026-10-26', today)).toBe(-1);
    expect(daysToExpiry(null, today)).toBeNull();
  });
});
