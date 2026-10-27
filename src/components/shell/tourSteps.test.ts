import { describe, expect, it } from 'vitest';
import { tourSteps } from './tourSteps';
import type { NavAccess } from './navigation';

const as = (role: 'admin' | 'manager' | 'hr' | 'employee', pending = false): NavAccess => ({
  isAdmin: role === 'admin',
  isManager: role === 'manager',
  isHR: role === 'hr',
  isEmployee: role === 'employee',
  isPending: pending,
  hasPermission: () => role === 'admin',
  canFeature: () => role === 'admin',
});

const ids = (a: NavAccess, desktop: boolean) => tourSteps(a, { desktop }).map((s) => s.id);

describe('tourSteps', () => {
  it('keeps a pending user to what they can open', () => {
    expect(ids(as('employee', true), true)).toEqual(['welcome', 'home', 'me', 'notifications', 'account', 'help', 'done']);
  });

  it('shows ＋ New on phones only, and the account menu on desktop only', () => {
    expect(ids(as('employee'), false)).toContain('new');
    expect(ids(as('employee'), false)).not.toContain('account');
    expect(ids(as('employee'), true)).not.toContain('new');
    expect(ids(as('employee'), true)).toContain('account');
  });

  it('names the workspaces a person can use', () => {
    const ws = tourSteps(as('admin'), { desktop: true }).find((s) => s.id === 'workspaces')!;
    expect(ws.body).toContain('People, Finance, Operations and Admin');
  });

  it('describes the inbox as approvals only for people who approve', () => {
    const inbox = (a: NavAccess) => tourSteps(a, { desktop: true }).find((s) => s.id === 'inbox')!.body;
    expect(inbox(as('manager'))).toContain('waiting for your decision');
    expect(inbox(as('employee'))).not.toContain('waiting for your decision');
  });

  it('points phone users to Help through Me', () => {
    const help = tourSteps(as('employee'), { desktop: false }).find((s) => s.id === 'help')!;
    expect(help.anchors).toEqual(['me']);
  });
});
