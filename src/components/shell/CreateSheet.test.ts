import { describe, expect, it } from 'vitest';
import { createActions } from './CreateSheet';
import type { NavAccess } from './navigation';

const as = (
  role: 'admin' | 'manager' | 'hr' | 'employee',
  modules: string[] = [],
  features: string[] = [],
  isPending = false,
): NavAccess => ({
  isAdmin: role === 'admin',
  isManager: role === 'manager',
  isHR: role === 'hr',
  isEmployee: role === 'employee',
  isPending,
  hasPermission: (m) => role === 'admin' || modules.includes(m),
  canFeature: (f) => role === 'admin' || features.includes(f),
});

const tos = (list: { to: string }[]) => list.map((a) => a.to);

describe('＋ New sheet', () => {
  it('offers a pending account nothing to start', () => {
    const { mine, team } = createActions(as('employee', [], [], true));
    expect(mine).toEqual([]);
    expect(team).toEqual([]);
  });

  it('sends staff without budgets to an expense claim, not the Expenses page they cannot open', () => {
    const { mine, team } = createActions(as('employee'));
    expect(tos(mine)).toEqual([
      '/staff-portal?tab=reports&new=expense',
      '/staff-portal?tab=leave&new=1',
      '/business/inventory-requests?new=1',
      '/staff-portal?tab=reports&new=1',
    ]);
    expect(team).toEqual([]);
  });

  it('lets people who run budgets log an expense directly', () => {
    expect(tos(createActions(as('manager', ['budgets'])).mine)[0]).toBe('/expenses?new=1');
  });

  it('shows team actions only to those whose route guard allows them', () => {
    expect(tos(createActions(as('hr', [], ['mark_attendance'])).team)).toEqual(['/attendance']);
    expect(tos(createActions(as('employee', ['invoices', 'sales'])).team))
      .toEqual(['/business/invoices?new=1', '/business/payments?new=1']);
    expect(tos(createActions(as('admin')).team))
      .toEqual(['/attendance', '/business/invoices?new=1', '/business/payments?new=1']);
  });
});
