import { describe, expect, it } from 'vitest';
import {
  allocate, commissionWeeks, computePeriod, DEFAULT_SETTINGS, growth, monthsEndingAt, weekResult, type CommissionSettings,
} from './commission';

const S: CommissionSettings = {
  ...DEFAULT_SETTINGS,
  department_groups: { dSales: 'sales', dMgmt: 'management', dKit: 'kitchen', dOps: 'operations', dFin: 'none' },
};

describe('commissionWeeks', () => {
  it('takes the weeks whose Sunday falls in the month', () => {
    // September 2026: 1st is a Tuesday; Sundays 6, 13, 20, 27.
    const w = commissionWeeks('2026-09');
    expect(w.map((x) => x.end)).toEqual(['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
    expect(w[0].start).toBe('2026-08-31');
  });

  it('gives five weeks when a month has five Sundays', () => {
    // August 2026: Sundays 2, 9, 16, 23, 30.
    expect(commissionWeeks('2026-08')).toHaveLength(5);
  });

  it('never counts a day in two months', () => {
    const aug = commissionWeeks('2026-08');
    const sep = commissionWeeks('2026-09');
    expect(aug[aug.length - 1].end < sep[0].start).toBe(true);
  });
});

describe('weekResult', () => {
  const w = { week: 1, start: '2026-09-07', end: '2026-09-13' };

  it('pays nothing below target', () => {
    expect(weekResult(w, 4_999_999, S).total).toBe(0);
  });

  it('pays the flat rate on the target at exactly target', () => {
    expect(weekResult(w, 5_000_000, S)).toMatchObject({ flat: 50_000, excess: 0, total: 50_000 });
  });

  it('adds the excess rate above target', () => {
    // ₦6M → 1% × 5M + 3% × 1M
    expect(weekResult(w, 6_000_000, S)).toMatchObject({ flat: 50_000, excess: 30_000, total: 80_000 });
  });
});

describe('computePeriod', () => {
  const sep = commissionWeeks('2026-09');
  const entry = (i: number, amount: number) => ({ report_date: sep[i].end, amount });

  it('applies the escalator once the monthly target is met', () => {
    const p = computePeriod('2026-09', [entry(0, 5e6), entry(1, 5e6), entry(2, 5e6), entry(3, 6e6)], S);
    expect(p.monthlyTarget).toBe(20e6);
    expect(p.basePool).toBe(230_000);
    expect(p.escalatorHit).toBe(true);
    expect(p.escalatorBonus).toBe(46_000);
    expect(p.totalPool).toBe(276_000);
  });

  it('withholds the escalator when the month falls short', () => {
    const p = computePeriod('2026-09', [entry(0, 8e6), entry(1, 4e6), entry(2, 4e6), entry(3, 3e6)], S);
    expect(p.escalatorHit).toBe(false);
    expect(p.totalPool).toBe(50_000 + 90_000);
  });

  it('ignores sales outside the period', () => {
    const p = computePeriod('2026-09', [{ report_date: '2026-09-29', amount: 9e6 }], S);
    expect(p.totalSales).toBe(0);
  });
});

describe('allocate', () => {
  const staff = [
    { id: 'a', full_name: 'A', department_id: 'dSales' },
    { id: 'b', full_name: 'B', department_id: 'dSales' },
    { id: 'c', full_name: 'C', department_id: 'dKit' },
    { id: 'd', full_name: 'D', department_id: 'dKit' },
    { id: 'e', full_name: 'E', department_id: 'dKit' },
    { id: 'f', full_name: 'F', department_id: 'dFin' },
  ];

  it('splits shares equally within a group, never over-paying', () => {
    const groups = allocate(100_000, staff, S);
    const kitchen = groups.find((g) => g.group === 'kitchen')!;
    expect(kitchen.pool).toBe(40_000);
    expect(kitchen.perPerson).toBe(13_333.33);
    expect(kitchen.allocated).toBeLessThanOrEqual(40_000);
    expect(groups.find((g) => g.group === 'sales')!.perPerson).toBe(10_000);
  });

  it('leaves an empty group unallocated and excludes unmapped departments', () => {
    const groups = allocate(100_000, staff, S);
    expect(groups.find((g) => g.group === 'management')!.allocated).toBe(0);
    expect(groups.flatMap((g) => g.staff).some((p) => p.id === 'f')).toBe(false);
  });
});

describe('growth', () => {
  it('is the fractional change from the previous figure', () => {
    expect(growth(6e6, 5e6)).toBeCloseTo(0.2);
    expect(growth(4e6, 5e6)).toBeCloseTo(-0.2);
  });

  it('has no value without a previous figure', () => {
    expect(growth(5e6, 0)).toBeNull();
    expect(growth(5e6, null)).toBeNull();
  });

  it('lists months oldest first, across a year boundary', () => {
    expect(monthsEndingAt('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});
