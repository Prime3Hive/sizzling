// What an admin chooses when giving access: a named level per area of the
// app, rather than four raw View / Create / Edit / Delete switches. Each level
// is a fixed set of those four flags, so the database and hasPermission()
// work exactly as before.

import type { AppRole, Module } from './modules';
import type { Feature } from './capabilities';

export interface Flags {
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export interface AccessLevel {
  key: string;
  label: string;
  hint: string;
  flags: Flags;
}

export interface ModuleAccess {
  key: Module;
  label: string;
  description: string;
  levels: AccessLevel[];
}

const f = (v = false, c = false, u = false, d = false): Flags =>
  ({ can_view: v, can_create: c, can_update: u, can_delete: d });

export const NO_FLAGS = f();
const none: AccessLevel = { key: 'none', label: 'No access', hint: 'Hidden from them', flags: f() };
const see = (hint: string): AccessLevel => ({ key: 'view', label: 'See only', hint, flags: f(true) });
const full = (hint: string): AccessLevel => ({ key: 'manage', label: 'Full control', hint, flags: f(true, true, true, true) });

export const MODULE_ACCESS: ModuleAccess[] = [
  {
    key: 'inventory', label: 'Inventory', description: 'Stock items, usage, purchases and stock takes',
    levels: [
      none,
      see('Look up stock and history'),
      { key: 'record', label: 'Record', hint: 'Record usage and stock coming in', flags: f(true, true) },
      full('Also edit items, costs and counts, and delete'),
    ],
  },
  {
    key: 'production', label: 'Production', description: 'Batches made in-house, recipes and lots',
    levels: [
      none,
      see('Look at runs, recipes and lots'),
      { key: 'record', label: 'Record', hint: 'Record batches for someone to approve', flags: f(true, true) },
      { key: 'approve', label: 'Approve', hint: 'Approve batches into stock and manage recipes', flags: f(true, false, true) },
      { key: 'both', label: 'Record and approve', hint: 'Both; they still can’t approve their own batches', flags: f(true, true, true) },
    ],
  },
  {
    key: 'sales', label: 'Sales & payments', description: 'Sales takings and payments received',
    levels: [
      none,
      see('Look at sales and payments'),
      { key: 'record', label: 'Record', hint: 'Record sales and payments received', flags: f(true, true) },
      full('Also correct and delete entries'),
    ],
  },
  {
    key: 'invoices', label: 'Invoices & quotations', description: 'Customer quotations and invoices',
    levels: [
      none,
      see('Look at invoices and quotations'),
      { key: 'create', label: 'Create', hint: 'Write quotations and invoices', flags: f(true, true) },
      full('Also edit, convert and delete'),
    ],
  },
  {
    key: 'budgets', label: 'Expenses & budgets', description: 'Company expenses and budget allocations',
    levels: [
      none,
      see('Look at expenses and budgets'),
      { key: 'record', label: 'Record', hint: 'Log expenses (they still need approval)', flags: f(true, true) },
      full('Also edit budgets and delete'),
    ],
  },
  {
    key: 'finance', label: 'Finance overview', description: 'Ledger, receivables, revenue and cash',
    levels: [none, see('Read the finance overview')],
  },
  {
    key: 'reports', label: 'Business reports', description: 'Operational and financial summaries',
    levels: [none, see('Read the reports')],
  },
];

const same = (a: Flags, b: Flags) =>
  a.can_view === b.can_view && a.can_create === b.can_create && a.can_update === b.can_update && a.can_delete === b.can_delete;

/** The named level a set of flags matches, or a "Custom" level describing it. */
export function levelOf(mod: ModuleAccess, flags: Flags | null | undefined): AccessLevel {
  const fl = flags ?? NO_FLAGS;
  if (!fl.can_view) return none;   // nothing works without View
  const hit = mod.levels.find((l) => same(l.flags, fl));
  if (hit) return hit;
  const parts = [fl.can_view && 'see', fl.can_create && 'add', fl.can_update && 'edit', fl.can_delete && 'delete'].filter(Boolean);
  return { key: 'custom', label: 'Custom', hint: `Set earlier: ${parts.join(', ')}`, flags: fl };
}

/** Short summary of what someone can do, e.g. "Inventory: Record · Production: Approve". */
export function accessSummary(get: (m: Module) => Flags | null | undefined): string {
  return MODULE_ACCESS
    .map((m) => ({ m, l: levelOf(m, get(m.key)) }))
    .filter(({ l }) => l.key !== 'none')
    .map(({ m, l }) => `${m.label}: ${l.label}`)
    .join(' · ');
}

// ── Roles ────────────────────────────────────────────────────────────────────

export const ROLE_INFO: Record<AppRole, { label: string; summary: string }> = {
  employee: {
    label: 'Staff',
    summary: 'Their own pay, leave, attendance and requests. Business areas only as their department or personal access allows.',
  },
  hr: {
    label: 'HR',
    summary: 'Everything Staff has, plus staff records, leave, complaints, payroll and marking attendance.',
  },
  manager: {
    label: 'Manager',
    summary: 'Everything Staff has, plus KPI targets, stock request approval, procurement and item costs.',
  },
  admin: {
    label: 'Admin',
    summary: 'Everything, everywhere. Department and personal access settings don’t apply.',
  },
};

export const ROLE_ORDER: AppRole[] = ['employee', 'hr', 'manager', 'admin'];

export const FEATURE_LABEL: Record<Feature, string> = {
  approve_roles: 'Approve new sign-ups',
  manage_departments: 'Manage departments and access',
  company_files: 'Company files',
  profit_loss: 'Profit & loss',
  njc_supplies: 'NJC supplies',
  approve_attendance: 'Approve and publish weekly attendance',
  view_all_staff: 'All staff profiles',
  manage_leave: 'Approve leave',
  manage_complaints: 'Handle complaints',
  view_payroll: 'Payroll',
  mark_attendance: 'Mark attendance',
  manage_kpi: 'Set KPI targets',
  view_kpi: 'Their own KPIs',
  submit_requests: 'Leave, complaints and messages',
  view_own_payslip: 'Their own payslips',
  view_own_attendance: 'Their own attendance',
};

/** Things a role adds that aren't set per area: managers' approvals, for instance. */
export const ROLE_EXTRAS: Record<AppRole, string[]> = {
  employee: [],
  hr: [],
  manager: ['Approve stock requests', 'Procurement and purchase orders', 'Change item costs'],
  admin: ['Approve expenses', 'Bank accounts', 'Accounting and the books'],
};
