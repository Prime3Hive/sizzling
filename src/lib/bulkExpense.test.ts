import { describe, it, expect } from 'vitest';
import {
  budgetForDate, budgetAlert, autoReference, duplicatesWithin,
  previousWeek, rowsFromPriorWeek, addDays,
} from './bulkExpense';
import { sumPL, toPLRow, totalCost, monthChange } from './profitAndLoss';
import { validateExpenseLine, validationErrors } from './expenseValidation';

describe('budgetForDate', () => {
  const budgets = [
    { id: 'year', start_date: '2026-01-01', end_date: '2026-12-31' },
    { id: 'nov', start_date: '2026-11-01', end_date: '2026-11-30' },
    { id: 'oct', start_date: '2026-10-01', end_date: '2026-10-31' },
  ];
  it('picks the month that contains the date over a longer budget', () => {
    expect(budgetForDate(budgets, '2026-11-07')?.id).toBe('nov');
    expect(budgetForDate(budgets, '2026-10-31')?.id).toBe('oct');
  });
  it('falls back to a wider budget, then to none', () => {
    expect(budgetForDate(budgets, '2026-03-15')?.id).toBe('year');
    expect(budgetForDate(budgets, '2027-01-01')).toBeNull();
  });
});

describe('budgetAlert', () => {
  const total = 100_000_00n;
  it('is quiet below 80%', () => {
    expect(budgetAlert(50_000_00n, 29_999_00n, total)).toBeNull();
  });
  it('warns from 80%', () => {
    expect(budgetAlert(50_000_00n, 30_000_00n, total)).toMatchObject({ level: 'near', pct: 80 });
    expect(budgetAlert(90_000_00n, 10_000_00n, total)).toMatchObject({ level: 'near', pct: 100 });
  });
  it('reports how far over', () => {
    expect(budgetAlert(90_000_00n, 10_000_01n, total)).toMatchObject({ level: 'over', overByMinor: 1n });
  });
  it('ignores budgets with no amount', () => {
    expect(budgetAlert(0n, 5n, 0n)).toBeNull();
  });
});

describe('references and duplicates', () => {
  it('numbers references within a batch', () => {
    expect(autoReference('2026-11-23', 'K3QZ', 0)).toBe('EXP-20261123-K3QZ-01');
    expect(autoReference('2026-11-23', 'K3QZ', 33)).toBe('EXP-20261123-K3QZ-34');
    expect(autoReference('2026-11-23', 'K3QZ')).toBe('EXP-20261123-K3QZ');
  });
  it('flags rows sharing a date and an amount, and only those', () => {
    const d = duplicatesWithin([
      { date: '2026-08-07', amountMinor: 131_039_900n },
      { date: '2026-08-07', amountMinor: 131_039_900n },
      { date: '2026-08-08', amountMinor: 131_039_900n },
      { date: '2026-07-17', amountMinor: 84_914_900n },
      { date: '2026-07-17', amountMinor: 84_614_900n },
      { date: '2026-07-17', amountMinor: 0n },
      { date: '2026-07-17', amountMinor: 0n },
    ]);
    expect([...d].sort()).toEqual([0, 1]);
  });
});

describe('copy last week', () => {
  it('finds Monday to Sunday of the week before', () => {
    // 23 Nov 2026 is a Monday.
    expect(previousWeek('2026-11-23')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(previousWeek('2026-11-29')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
  it('moves each line forward a week, never past the latest allowed date', () => {
    const rows = rowsFromPriorWeek([
      { date: '2026-11-18', amount_minor: 3_800_000, description: 'Bike fuel', category_id: 'c1', payee_id: 'p1', payee_name: null },
      { date: '2026-11-16', amount_minor: 5_000_000, description: 'Bus fuel', category_id: 'c1', payee_id: null, payee_name: 'Filling station' },
    ], '2026-11-23');
    expect(rows).toEqual([
      { date: '2026-11-23', amount: '50,000', description: 'Bus fuel', categoryId: 'c1', payeeId: null, payeeName: 'Filling station' },
      { date: '2026-11-23', amount: '38,000', description: 'Bike fuel', categoryId: 'c1', payeeId: 'p1', payeeName: '' },
    ]);
  });
});

describe('the P&L rows', () => {
  const rows = [
    { month: '2026-10-01', revenue: 16792115, cogs: 9000000.1, gross_profit: 7792114.9, opex: 1000000.2, payroll: 2000000, commission: 0,
      net_profit: 4792114.7, sales_daily: 16719515, sales_event: 0, invoice_daily: 0, invoice_event: 72600, other_revenue: 0 },
    { month: '2026-11-01', revenue: 9720575, cogs: 1800000, gross_profit: 7920575, opex: 421111, payroll: 0, commission: 0,
      net_profit: 7499464, sales_daily: 8405575, sales_event: 0, invoice_daily: 1315000, invoice_event: 0, other_revenue: 0 },
  ].map(toPLRow);

  it('revenue is the sum of its parts on every row and in the total', () => {
    const parts = (r: any) => r.salesDaily + r.salesEvent + r.invoiceDaily + r.invoiceEvent + r.otherRevenue;
    rows.forEach((r) => expect(parts(r)).toBe(r.revenue));
    const t = sumPL(rows);
    expect(parts(t)).toBe(t.revenue);
    expect(t.revenue).toBe(26512690);
  });
  it('monthly rows add up to the total without float drift', () => {
    const t = sumPL(rows);
    expect(t.cogs).toBe(10800000.1);
    expect(t.opex).toBe(1421111.2);
    expect(totalCost(rows[1])).toBe(2221111);
  });
  it('reports everything as "other" when the database has no split yet', () => {
    const old = toPLRow({ month: '2026-11-01', revenue: 500, cogs: 0, gross_profit: 500, opex: 0, payroll: 0, commission: 0, net_profit: 500 });
    expect(old.otherRevenue).toBe(500);
    expect(old.salesDaily).toBe(0);
  });
});

describe('monthChange', () => {
  it('gives a plain percentage for ordinary swings', () => {
    expect(monthChange(110, 100)).toEqual({ text: '+10.0% vs last month', up: true });
    expect(monthChange(75, 100)).toEqual({ text: '-25.0% vs last month', up: false });
  });
  it('does not print a percentage against nothing or a negative base', () => {
    expect(monthChange(100, 0)).toBeNull();
    expect(monthChange(100, -50)).toBeNull();
    expect(monthChange(-8_300_000, 5_000_000)).toBeNull();
  });
  it('caps extreme swings', () => {
    expect(monthChange(4812, 100)).toEqual({ text: '48.1× last month', up: true });
  });
});

describe('receipt rule: one rule, with a typed reason as the only way round it', () => {
  const base = {
    description: 'Prawns for the weekend', amount: '25,000', category_id: 'c1', payee_name: 'Market',
    expense_account_code: '5000', cost_centre: 'Daily Orders', reference: 'EXP-1', date: '2026-11-07',
    payment_method: 'Cash',
  };
  const today = new Date(2026, 10, 23);
  const fields = (extra: object) => validationErrors(validateExpenseLine({ ...base, ...extra }, { today })).map((e) => e.field);

  it('needs a receipt at the threshold', () => {
    expect(fields({})).toEqual(['receipt']);
    expect(fields({ receipt_path: 'x/y.jpg' })).toEqual([]);
  });
  it('accepts a real reason and refuses a token one', () => {
    expect(fields({ no_receipt_reason: 'Roadside seller, no receipt book' })).toEqual([]);
    expect(fields({ no_receipt_reason: 'n/a' })).toEqual(['no_receipt_reason']);
  });
  it('does not ask below the threshold', () => {
    expect(fields({ amount: '9,999.99' })).toEqual([]);
  });
});
