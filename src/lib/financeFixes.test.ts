import { describe, it, expect } from 'vitest';
import { stockStatus, countStock, stockValue, needsReorder } from './stockStatus';
import { guessExpenseCategory, EXPENSE_CATEGORY_LIST } from './expenseCategories';
import { sumPL, toPLRow } from './profitAndLoss';

describe('one low-stock rule', () => {
  it('classifies negative, out, low and ok', () => {
    expect(stockStatus({ stock_quantity: -3, reorder_level: 5 })).toBe('negative');
    expect(stockStatus({ stock_quantity: 0, reorder_level: 0 })).toBe('out');
    expect(stockStatus({ stock_quantity: 4, reorder_level: 5 })).toBe('low');
    expect(stockStatus({ stock_quantity: 5, reorder_level: 5 })).toBe('low');
    expect(stockStatus({ stock_quantity: 6, reorder_level: 5 })).toBe('ok');
    // No reorder level set: only out/negative need attention.
    expect(stockStatus({ stock_quantity: 1, reorder_level: 0 })).toBe('ok');
  });

  it('dashboard count = running low + out of stock (+ negative)', () => {
    const items = [
      { stock_quantity: -45, reorder_level: 10 },
      { stock_quantity: 0, reorder_level: 2 },
      { stock_quantity: 3, reorder_level: 5 },
      { stock_quantity: 50, reorder_level: 5 },
    ];
    const c = countStock(items);
    expect(c).toEqual({ low: 1, out: 1, negative: 1, needsReorder: 3 });
    expect(items.filter(needsReorder).length).toBe(c.needsReorder);
  });

  it('stock value ignores negative balances', () => {
    expect(stockValue([
      { stock_quantity: 10, cost_per_unit: 2.5 },
      { stock_quantity: -4, cost_per_unit: 100 },
    ])).toBe(25);
  });
});

describe('expense categories', () => {
  it('has the approved list with ledger accounts', () => {
    expect(EXPENSE_CATEGORY_LIST).toHaveLength(18);
    expect(EXPENSE_CATEGORY_LIST.find(c => c.name === 'Kitchen Labour')?.account).toBe('5050');
    expect(EXPENSE_CATEGORY_LIST.map(c => c.name)).not.toContain('Salaries & Wages');
    expect(EXPENSE_CATEGORY_LIST.map(c => c.name)).not.toContain('Credit Purchase');
  });

  it('turns item names into categories instead of saving them as categories', () => {
    expect(guessExpenseCategory('Parsley')).toBe('Fresh Produce');
    expect(guessExpenseCategory('Egg')).toBe('Proteins');
    expect(guessExpenseCategory('Barrow')).toBe('Transport & Delivery');
    expect(guessExpenseCategory('Gas refill 12.5kg')).toBe('Cooking Fuel');
    expect(guessExpenseCategory('Groundnut oil 25L')).toBe('Dry Goods & Seasonings');
    expect(guessExpenseCategory('Foil and cling film')).toBe('Packaging & Disposables');
    expect(guessExpenseCategory('Waiters for wedding')).toBe('Event Labour');
    expect(guessExpenseCategory('POS charges')).toBe('Bank Charges');
    expect(guessExpenseCategory('1')).toBeNull();
  });
});

describe('the P&L identity', () => {
  it('gross profit − opex − payroll − commission = net profit, per row and in total', () => {
    const rows = [
      { month: '2026-01-01', revenue: 100, cogs: 40, gross_profit: 60, opex: 10, payroll: 20, commission: 5, net_profit: 25 },
      { month: '2026-02-01', revenue: 50, cogs: 30, gross_profit: 20, opex: 15, payroll: 20, commission: 0, net_profit: -15 },
    ].map(toPLRow);
    for (const r of [...rows, sumPL(rows)]) {
      expect(r.grossProfit - r.opex - r.payroll - r.commission).toBe(r.netProfit);
      expect(r.revenue - r.cogs).toBe(r.grossProfit);
    }
  });
});
