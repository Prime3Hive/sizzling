// Central registry for module names, actions, and roles.
// hasPermission callers should use Module/Action types so typos become compile errors.

export const MODULES = [
  'inventory', 'production', 'sales', 'invoices', 'finance', 'budgets', 'reports',
] as const;

/** Where a module's columns mean something more specific than the verb. */
export const MODULE_ACTION_HINTS: Partial<Record<(typeof MODULES)[number], string>> = {
  production: 'Create = record production · Edit = approve it and manage recipes',
};

export type Module = typeof MODULES[number];

export const ACTIONS = ['view', 'create', 'update', 'delete'] as const;
export type Action = typeof ACTIONS[number];

export type AppRole = 'admin' | 'manager' | 'hr' | 'employee';
