import { describe, expect, it } from 'vitest';
import { landingOf, locate, visibleWorkspaces, WORKSPACES, type NavAccess } from './navigation';
import { leaveUsage } from '@/lib/leave';

const as = (role: 'admin' | 'manager' | 'hr' | 'employee', modules: string[] = [], features: string[] = []): NavAccess => ({
  isAdmin: role === 'admin',
  isManager: role === 'manager',
  isHR: role === 'hr',
  isEmployee: role === 'employee',
  isPending: false,
  hasPermission: (m) => role === 'admin' || modules.includes(m),
  canFeature: (f) => role === 'admin' || features.includes(f),
});

const ws = (id: string) => WORKSPACES.find((w) => w.id === id)!;

describe('navigation', () => {
  it('gives an employee only Operations (stock requests) and Me', () => {
    expect(visibleWorkspaces(as('employee')).map((w) => w.id)).toEqual(['operations', 'me']);
  });

  it('never shows Admin to anyone but admins', () => {
    for (const role of ['manager', 'hr', 'employee'] as const) {
      expect(visibleWorkspaces(as(role)).some((w) => w.id === 'admin')).toBe(false);
    }
    expect(visibleWorkspaces(as('admin')).some((w) => w.id === 'admin')).toBe(true);
  });

  it('shows Finance tabs only for the modules a user holds', () => {
    const a = as('employee', ['invoices']);
    expect(landingOf(ws('finance'), a)).toBe('/business/invoices');
    expect(landingOf(ws('finance'), as('employee'))).toBeNull();
  });

  it('files the staff portal leave tab under People for admins and Me for staff', () => {
    expect(locate('/staff-portal', '?tab=leave', as('admin'))?.workspace.id).toBe('people');
    expect(locate('/staff-portal', '?tab=leave', as('employee'))?.workspace.id).toBe('me');
  });

  it('treats the staff portal with no tab as its default leave tab', () => {
    expect(locate('/staff-portal', '', as('employee'))?.tab.label).toBe('Leave');
  });

  it('matches aliases and query tabs exactly', () => {
    const admin = as('admin');
    expect(locate('/business/sku-management', '', admin)?.tab.label).toBe('Inventory');
    expect(locate('/staff-portal', '?tab=documents', admin)?.tab.label).toBe('Documents');
    expect(locate('/nowhere', '', admin)).toBeNull();
  });

  it('does not place a page in a workspace the user cannot see', () => {
    expect(locate('/payroll', '', as('hr'))).toBeNull();
  });
});

describe('leaveUsage', () => {
  it('counts pending and approved casual days, ignoring rejected', () => {
    const u = leaveUsage([
      { leave_type: 'casual', start_date: '2026-03-02', end_date: '2026-03-04', status: 'approved' },
      { leave_type: 'casual', start_date: '2026-05-11', end_date: '2026-05-11', status: 'pending' },
      { leave_type: 'casual', start_date: '2026-06-01', end_date: '2026-06-05', status: 'rejected' },
      { leave_type: 'sick', start_date: '2026-04-01', end_date: '2026-04-02', status: 'approved' },
    ]);
    expect(u.casualDaysUsed).toBe(4);
    expect(u.casualDaysRemaining).toBe(10);
    expect(u.sickUsed).toBe(1);
    expect(u.sickRemaining).toBe(3);
  });
});
