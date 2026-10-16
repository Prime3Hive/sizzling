// The app's structure in one place. The sidebar, the phone's More screen, the
// section tabs above each page, the breadcrumb and the search palette all read
// from here, so a page cannot be reachable from one of them and missing from
// another.
//
// Every `show` check mirrors the guard on the route in App.tsx. Showing a link
// the route would bounce is the bug this file exists to prevent, so when a
// route's guard changes, change its check here too.

import {
  Home, Inbox, Users, Wallet, Package, UserRound, ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { Module } from '@/config/modules';
import type { Feature } from '@/config/capabilities';

export interface NavAccess {
  isAdmin: boolean;
  isManager: boolean;
  isHR: boolean;
  isEmployee: boolean;
  isPending: boolean;
  hasPermission: (module: Module, action: 'view' | 'create' | 'update' | 'delete') => boolean;
  canFeature: (feature: Feature) => boolean;
}

export interface NavTab {
  label: string;
  /** Path, optionally with a query string (`/staff-portal?tab=leave`). */
  to: string;
  /** Extra paths that count as this tab (old aliases, sub-pages). */
  also?: string[];
  /** Words the search palette should also match on. */
  keywords?: string;
  show: (a: NavAccess) => boolean;
}

export type WorkspaceId = 'people' | 'finance' | 'operations' | 'me' | 'admin';

export interface Workspace {
  id: WorkspaceId;
  label: string;
  description: string;
  icon: LucideIcon;
  tabs: NavTab[];
}

const approved = (a: NavAccess) => !a.isPending && (a.isAdmin || a.isManager || a.isHR || a.isEmployee);

export const WORKSPACES: Workspace[] = [
  {
    id: 'people',
    label: 'People',
    description: 'Directory, attendance, payroll, leave and performance',
    icon: Users,
    tabs: [
      { label: 'Directory', to: '/people', also: ['/staff-profiles'], keywords: 'staff profiles employees',
        show: (a) => a.isAdmin || a.isHR },
      { label: 'Attendance', to: '/attendance', keywords: 'mark week clock',
        show: (a) => a.canFeature('mark_attendance') },
      { label: 'Payroll', to: '/payroll', keywords: 'salary pay run',
        show: (a) => a.isAdmin },
      { label: 'Leave', to: '/staff-portal?tab=leave', keywords: 'holiday time off',
        show: (a) => a.isAdmin },
      { label: 'Complaints', to: '/staff-portal?tab=complaints',
        show: (a) => a.isAdmin || a.isHR },
      { label: 'Performance', to: '/business/kpi', keywords: 'kpi scores targets',
        show: (a) => a.isAdmin || a.isManager || a.isHR },
      { label: 'Birthdays', to: '/birthdays', keywords: 'calendar celebrations',
        show: (a) => (a.isAdmin || a.isManager || a.isHR) },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    description: 'Money in, money out, and what still needs sign-off',
    icon: Wallet,
    tabs: [
      { label: 'Overview', to: '/finance/overview', keywords: 'dashboard profit cash receivables',
        show: (a) => a.isAdmin },
      { label: 'Expenses', to: '/expenses', keywords: 'spend receipts claims',
        show: (a) => a.hasPermission('budgets', 'view') },
      { label: 'Invoices', to: '/business/invoices', keywords: 'bill customer',
        show: (a) => a.hasPermission('invoices', 'view') },
      { label: 'Payments', to: '/business/payments', keywords: 'sales receipts collections',
        show: (a) => a.hasPermission('sales', 'view') },
      { label: 'Budgets', to: '/budgets',
        show: (a) => a.hasPermission('budgets', 'view') },
      { label: 'Ledger', to: '/business/finance', keywords: 'finance ledger entries',
        show: (a) => a.hasPermission('finance', 'view') },
      { label: 'Accounting', to: '/accounting', keywords: 'journal chart of accounts trial balance',
        show: (a) => a.isAdmin },
      { label: 'Reports', to: '/reports', keywords: 'finance report',
        show: (a) => a.hasPermission('reports', 'view') },
      { label: 'Profit & loss', to: '/profit-loss', keywords: 'p&l pnl income statement',
        show: (a) => a.isAdmin },
      { label: 'Commission', to: '/commission', keywords: 'sales commission target bonus incentive',
        show: (a) => a.isAdmin },
      { label: 'Staff reports', to: '/staff-reports', keywords: 'daily reports expense claims',
        show: (a) => a.isAdmin },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Stock, purchasing and supply, from request to delivery',
    icon: Package,
    tabs: [
      { label: 'Overview', to: '/operations', also: ['/business'],
        show: (a) => approved(a) },
      { label: 'Inventory', to: '/business/inventory', also: ['/business/sku-management'], keywords: 'stock sku products',
        show: (a) => a.hasPermission('inventory', 'view') },
      { label: 'Stock requests', to: '/business/inventory-requests', keywords: 'request items',
        show: (a) => approved(a) },
      { label: 'Procurement', to: '/procurement', keywords: 'purchase orders lpo suppliers',
        show: (a) => a.isAdmin || a.isManager },
      { label: 'Analytics', to: '/business/analytics', keywords: 'stock analytics',
        show: (a) => a.hasPermission('inventory', 'view') },
      { label: 'NJC Supplies', to: '/njc-supplies', keywords: 'njc',
        show: (a) => a.canFeature('njc_supplies') },
    ],
  },
  {
    id: 'me',
    label: 'Me',
    description: 'Your profile, pay, time off and requests',
    icon: UserRound,
    tabs: [
      { label: 'Overview', to: '/me',
        show: () => true },
      { label: 'Profile', to: '/my-profile', keywords: 'my details emergency contact',
        show: () => true },
      { label: 'Payslips', to: '/my-payslip', keywords: 'my pay salary',
        show: (a) => approved(a) },
      { label: 'Leave', to: '/staff-portal?tab=leave', keywords: 'request leave time off',
        show: (a) => approved(a) },
      { label: 'Attendance', to: '/staff-portal?tab=attendance', keywords: 'my attendance',
        show: (a) => approved(a) },
      { label: 'Reports', to: '/staff-portal?tab=reports', keywords: 'daily report expense claim',
        show: (a) => approved(a) },
      { label: 'Checklists', to: '/staff-portal?tab=checklists',
        show: (a) => approved(a) },
      { label: 'Performance', to: '/staff-portal?tab=performance', keywords: 'my kpi',
        show: (a) => approved(a) },
      { label: 'Complaints', to: '/staff-portal?tab=complaints',
        show: (a) => approved(a) },
      { label: 'Messages', to: '/staff-portal?tab=messages',
        show: (a) => approved(a) },
      { label: 'Documents', to: '/staff-portal?tab=documents', keywords: 'my documents contract',
        show: (a) => approved(a) },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'Who can get in, what they can see, and the company’s records',
    icon: ShieldCheck,
    tabs: [
      { label: 'Overview', to: '/admin', show: (a) => a.isAdmin },
      { label: 'Users', to: '/users', keywords: 'sign ups roles approve access',
        show: (a) => a.isAdmin },
      { label: 'Access control', to: '/department-permissions', keywords: 'permissions departments',
        show: (a) => a.isAdmin },
      { label: 'Bank accounts', to: '/bank-accounts', show: (a) => a.isAdmin },
      { label: 'Company files', to: '/company-files', keywords: 'documents policies',
        show: (a) => a.isAdmin },
      { label: 'Messages', to: '/messages', keywords: 'contact form enquiries',
        show: (a) => a.isAdmin },
    ],
  },
];

export const HOME = { label: 'Home', to: '/dashboard', icon: Home };
export const INBOX = { label: 'Inbox', to: '/inbox', icon: Inbox };

export function visibleTabs(ws: Workspace, a: NavAccess): NavTab[] {
  return ws.tabs.filter((t) => t.show(a));
}

export function visibleWorkspaces(a: NavAccess): Workspace[] {
  return WORKSPACES.filter((ws) => visibleTabs(ws, a).length > 0);
}

/** Where a workspace's sidebar link goes: its first tab this user can open. */
export function landingOf(ws: Workspace, a: NavAccess): string | null {
  return visibleTabs(ws, a)[0]?.to ?? null;
}

function splitTo(to: string): { path: string; tab: string | null } {
  const [path, query] = to.split('?');
  return { path, tab: query ? new URLSearchParams(query).get('tab') : null };
}

/** Does this tab own the current location? Query tabs must match exactly. */
export function tabMatches(tab: NavTab, pathname: string, search: string): boolean {
  const here = new URLSearchParams(search).get('tab');
  const candidates = [tab.to, ...(tab.also ?? [])];
  return candidates.some((c) => {
    const { path, tab: wantTab } = splitTo(c);
    if (pathname !== path) return false;
    if (wantTab) return here === wantTab;
    return true;
  });
}

/**
 * Which workspace and tab the current location belongs to, among the ones this
 * user can see. `/staff-portal?tab=leave` is People for an admin (the team's
 * leave) and Me for everyone else (their own), so order matters: People and
 * Finance are checked before Me.
 */
export function locate(pathname: string, search: string, a: NavAccess): { workspace: Workspace; tab: NavTab } | null {
  // The staff portal opens on "leave" when no tab is given.
  const effectiveSearch = pathname === '/staff-portal' && !new URLSearchParams(search).get('tab')
    ? '?tab=leave'
    : search;
  for (const ws of WORKSPACES) {
    for (const tab of visibleTabs(ws, a)) {
      if (tabMatches(tab, pathname, effectiveSearch)) return { workspace: ws, tab };
    }
  }
  return null;
}
