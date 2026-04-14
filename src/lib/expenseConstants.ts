// Centralized expense categories and constants used across Expenses, P/L, and Ledger

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
