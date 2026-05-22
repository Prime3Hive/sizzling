// Central registry for module names, actions, and roles.
// hasPermission callers should use Module/Action types so typos become compile errors.

export const MODULES = [
  'inventory', 'sales', 'invoices', 'finance', 'budgets', 'reports',
] as const;

export type Module = typeof MODULES[number];

export const ACTIONS = ['view', 'create', 'update', 'delete'] as const;
export type Action = typeof ACTIONS[number];

export type AppRole = 'admin' | 'manager' | 'hr' | 'employee';
