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
// The remaining arrays are used by src/components/procurement/LPOSheet.tsx and
// the P&L. Do not add new expense-capture uses.

// EXPENSE_CATEGORIES was removed (2026-11-17). The approved categories live in
// public.expense_categories, each with its ledger account; see
// src/lib/expenseCategories.ts for the list and the item → category guesser.

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

export type AccountType = typeof ACCOUNT_TYPES[number];
export type CostCenter = typeof COST_CENTERS[number];
export type PaymentMethod = typeof PAYMENT_METHODS[number];
