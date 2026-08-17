// ─────────────────────────────────────────────────────────────────────────────
// Expense policy thresholds.
//
// These are the four values section 12 of EXPENSE-FIX-INSTRUCTIONS.md lists as
// "decisions needed from management" that carry a suggested default. They are
// set to those defaults here so the controls are live rather than absent.
// Change them here and every route follows — do not inline these numbers.
//
// STILL OUTSTANDING from management, deliberately not guessed:
//   • Category → expense account mapping (see CATEGORY_ACCOUNT_MAP below —
//     seeded empty; the finance lead supplies it).
//   • Who may approve an expense, and their limits (see APPROVAL_LIMITS).
//   • How far back corrupted records are re-captured (migration M-03).
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_CEILING_MINOR } from '@/lib/money';

/** A receipt is mandatory at or above this amount. Default ₦10,000. */
export const RECEIPT_THRESHOLD_MINOR = 1_000_000n;

/**
 * If the largest number mentioned in the description exceeds the entered
 * amount by at least this factor, the entry is blocked as implausible.
 * Default 100×.
 */
export const IMPLAUSIBILITY_FACTOR = 100;

/** Amounts above this are held for review rather than silently accepted. */
export const AMOUNT_CEILING_MINOR = DEFAULT_CEILING_MINOR;

/**
 * How far in the future an expense may be dated, in days. Default 0 — an
 * expense cannot be dated after today.
 */
export const FUTURE_DATE_TOLERANCE_DAYS = 0;

/** A description carrying this many large numbers is a pasted list, not one expense. */
export const PASTED_LIST_TOKEN_COUNT = 3;

/** A "large number" for the pasted-list test. */
export const PASTED_LIST_TOKEN_FLOOR = 1000;

/** Receipt uploads: accepted types and size cap. */
export const RECEIPT_ACCEPT = 'image/*,application/pdf';
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Expense accounts reachable from the form. Replaces the old two-option
 * COGS / OpEX control, which left Rent and Utilities unreachable.
 */
export const EXPENSE_ACCOUNTS = [
  { code: '5000', name: 'Cost of Goods Sold' },
  { code: '5100', name: 'Salaries & Wages' },
  { code: '5110', name: 'Employer Pension Contribution' },
  { code: '5200', name: 'Rent' },
  { code: '5300', name: 'Utilities' },
  { code: '5400', name: 'Operating Expenses' },
  { code: '5900', name: 'Other Expenses' },
] as const;

export type ExpenseAccountCode = (typeof EXPENSE_ACCOUNTS)[number]['code'];

/**
 * Category → default expense account. Pre-fills the account field; the user
 * may always override it.
 *
 * TODO(management): the finance lead must supply this mapping. Until they do
 * this stays empty and the account field has NO default, which is the
 * behaviour section 5.4 requires ("NO default"). Adding a guessed mapping here
 * would silently reinstate the COGS default the audit asked us to remove.
 */
export const CATEGORY_ACCOUNT_MAP: Record<string, ExpenseAccountCode> = {};

/**
 * Approval limits by role.
 *
 * TODO(management): section 12 records this as "cannot be guessed". Until it
 * is supplied the system falls back to the existing rule — any admin may
 * approve any amount, and the approver may not be the submitter (enforced in
 * validateExpenseClaim and by the DB trigger).
 */
export const APPROVAL_LIMITS: Record<string, bigint | null> = {};
