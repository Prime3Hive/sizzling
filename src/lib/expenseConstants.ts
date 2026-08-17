// Centralized expense categories and constants used across Expenses, P/L, and Ledger
//
// ⚠ DEPRECATED for expense capture. Categories, cost centres and expense
// accounts are now controlled tables read through src/hooks/useExpenseReference:
//   EXPENSE_CATEGORIES → public.expense_categories
//   COST_CENTERS       → public.cost_centres
//   ACCOUNT_TYPES      → public.chart_of_accounts, via EXPENSE_ACCOUNTS in
//                        src/lib/expenseConfig.ts. The two-value COGS/OpEX
//                        control is gone: it left Rent (5200) and Utilities
//                        (5300) unreachable from the form.
//
// These arrays remain only for src/components/procurement/LPOSheet.tsx, which
// belongs to the procure-to-pay work governed by FIX-INSTRUCTIONS.md. Do not
// add new expense-capture uses.

export const EXPENSE_CATEGORIES = [
  'Raw Materials',
  'Packaging',
  'Production Labour',
  'Shipping & Transportation',
  'Repairs & Maintenance',
  'Salaries & Wages',
  'Catering Services',
  'Event Staff',
  'Proteins',
  'Snacks',
  'Chefs Payment',
  'Waiters Payment',
  'Miscellaneous',
] as const;

export const ACCOUNT_TYPES = ['COGS', 'OpEX'] as const;
export const COST_CENTERS = ['Daily Orders', 'Event Account', 'Operations Account'] as const;
export const PAYMENT_METHODS = ['Card', 'Transfer', 'Cash', 'POS'] as const;

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const SALARY_PERIODS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'bi-weekly', label: 'Bi-Weekly' },
  { value: 'weekly', label: 'Weekly' },
] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
export type AccountType = typeof ACCOUNT_TYPES[number];
export type CostCenter = typeof COST_CENTERS[number];
export type PaymentMethod = typeof PAYMENT_METHODS[number];
