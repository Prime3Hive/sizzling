import { describe, expect, it } from 'vitest';
import { costStatement, foodCostPct, monthRange, pivotUsage, recentMonths, toCostReport, toCsv } from './stockReports';

// Costing checks from the inventory redesign (23 Nov 2026).
const raw = {
  from: '2026-10-01', to: '2026-10-31',
  opening_value: '120000.00', closing_value: 408000, purchases: 576000,
  cogs: { kitchen: 96000, event: 96000, waste: 19200, count_difference: 76800, usage: 0, sale: 0 },
  other: { correction: 0, production: 0, opening: 0, return: 0, transfer: 0, reversal: 0 },
  revenue: { daily: 900000, event: 400000 },
  ledger_cogs: 576000,
  reliable_from: '2026-09-28',
  movements_without_cost: 0,
};

describe('costing', () => {
  it('cost of goods = kitchen + event + waste + count differences, at average cost', () => {
    const s = costStatement(toCostReport(raw));
    expect(s.cogsTotal).toBe(288000);
  });

  it('check: opening + purchases − cost of goods = closing stock value', () => {
    const s = costStatement(toCostReport(raw));
    expect(s.expectedClosing).toBe(408000);
    expect(s.unexplained).toBe(0);
  });

  it('check: food cost % = cost of goods ÷ food revenue', () => {
    const s = costStatement(toCostReport(raw));
    expect(s.foodRevenue).toBe(1300000);
    expect(s.foodCostPct).toBe(22.2);
    expect(foodCostPct(96000, 400000)).toBe(24);
    expect(foodCostPct(96000, 0)).toBeNull();
    expect(foodCostPct(96000, null)).toBeNull();
  });

  it('purchases raise stock value, not cost of goods: the ledger differs by the change in stock', () => {
    const s = costStatement(toCostReport(raw));
    // The ledger expensed all ₦576,000 bought; ₦288,000 of it is still on the shelf.
    expect(s.ledgerGap).toBe(288000);
    expect(raw.closing_value - Number(raw.opening_value)).toBe(288000);
  });

  it('shows corrections and production as their own lines, not inside cost of goods', () => {
    const r = toCostReport({ ...raw, closing_value: 398000, other: { ...raw.other, correction: -15000, production: 5000 } });
    const s = costStatement(r);
    expect(s.cogsTotal).toBe(288000);
    expect(s.otherTotal).toBe(-10000);
    expect(s.unexplained).toBe(0);
  });

  it('leaves revenue out for someone who cannot see the books', () => {
    const s = costStatement(toCostReport({ ...raw, revenue: null, ledger_cogs: null }));
    expect(s.foodRevenue).toBeNull();
    expect(s.foodCostPct).toBeNull();
    expect(s.ledgerGap).toBeNull();
    expect(s.cogsTotal).toBe(288000);
  });
});

describe('usage by item', () => {
  it('gives one line per item with its routes and its weeks', () => {
    const row = (week_start: string, route: string, quantity: number, value: number, id = 'w') => ({
      week_start, product_id: id, sku_id: id, item_name: id === 'w' ? 'Wings' : 'Rice', stock_unit: 'kg', route, quantity, value,
    });
    const p = pivotUsage([
      row('2026-10-05', 'kitchen', 10, 96000),
      row('2026-10-12', 'event', 15, 144000),
      row('2026-10-12', 'event_return', -5, -48000),
      row('2026-10-12', 'waste', 2, 19200),
      row('2026-10-05', 'kitchen', 4, 6000, 'r'),
    ]);
    expect(p.weeks).toEqual(['2026-10-05', '2026-10-12']);
    expect(p.items.map((i) => i.item_name)).toEqual(['Wings', 'Rice']);
    const wings = p.items[0];
    expect(wings.byRoute).toEqual({ kitchen: 10, event: 15, event_return: -5, waste: 2 });
    expect(wings.byWeek).toEqual({ '2026-10-05': 10, '2026-10-12': 12 });
    expect(wings.quantity).toBe(22);
    expect(wings.value).toBe(211200);
  });
});

describe('periods and export', () => {
  it('knows the first and last day of a month', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('lists recent months newest first, across a year end', () => {
    expect(recentMonths(new Date(2027, 0, 15), 3)).toEqual(['2027-01', '2026-12', '2026-11']);
  });

  it('writes a CSV that survives commas and quotes', () => {
    expect(toCsv(['Item', 'Why'], [['Wings, large', 'Freezer "B" failed'], ['Rice', null]]))
      .toBe('"Item","Why"\n"Wings, large","Freezer ""B"" failed"\n"Rice",""');
  });
});
