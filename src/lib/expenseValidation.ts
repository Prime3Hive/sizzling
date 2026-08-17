// ─────────────────────────────────────────────────────────────────────────────
// The expense validator.
//
// ONE function, imported by every capture route: the single form, the bulk
// grid, the staff expense report, and any API client. If you find yourself
// writing a second set of rules for one of those routes, stop — add it here.
//
// This runs on the client for convenience. The same rules are enforced in the
// database (see the expense_line CHECK constraints and fn_validate_expense_line
// in supabase/migrations), because client-side validation is never the control.
// ─────────────────────────────────────────────────────────────────────────────

import {
  parseMoney,
  isMoneyError,
  formatMinor,
  type ParseMoneyResult,
} from '@/lib/money';
import {
  AMOUNT_CEILING_MINOR,
  FUTURE_DATE_TOLERANCE_DAYS,
  IMPLAUSIBILITY_FACTOR,
  PASTED_LIST_TOKEN_COUNT,
  PASTED_LIST_TOKEN_FLOOR,
  RECEIPT_THRESHOLD_MINOR,
} from '@/lib/expenseConfig';

// ── Text hygiene (migration M-06) ───────────────────────────────────────────

/**
 * Directional marks, zero-width characters, non-breaking spaces and stray C0
 * control codes. Written as escapes rather than pasted literals so the set is
 * readable and cannot drift when the file is edited.
 */
// Stripping C0 control codes is the point of this regex (migration M-06), so
// the rule that warns about them is disabled deliberately.
// eslint-disable-next-line no-control-regex
const CONTROL_MARKS = /[\u200E\u200F\uFEFF\u00A0\u2066-\u2069\u200B-\u200D\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** Strip control/directional marks and collapse whitespace. */
export const normaliseText = (s: string | null | undefined): string =>
  String(s ?? '').replace(CONTROL_MARKS, '').replace(/\s+/g, ' ').trim();

/** True when a field is nothing but control characters or whitespace. */
export const isEffectivelyEmpty = (s: string | null | undefined): boolean =>
  normaliseText(s) === '';

// ── Numeric tokens in prose ─────────────────────────────────────────────────

/**
 * Every number mentioned in a piece of text, as major units.
 * "Bus fuel 50,000 and charcoal 20,300" → [50000, 20300]
 */
export function extractNumericTokens(text: string): number[] {
  const cleaned = normaliseText(text);
  const out: number[] = [];
  const re = /\d[\d,]*(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export interface ImplausibilityCheck {
  implausible: boolean;
  message?: string;
  largestToken?: number;
}

/**
 * Compare the largest number mentioned in the description against the amount
 * actually entered. This is the guard that would have caught "Total amount
 * 922,340" being stored as ₦922.34.
 */
export function checkImplausible(
  description: string,
  amountMinor: bigint,
  factor: number = IMPLAUSIBILITY_FACTOR,
): ImplausibilityCheck {
  const amountMajor = Number(amountMinor) / 100;
  if (amountMajor <= 0) return { implausible: false };
  const tokens = extractNumericTokens(description);
  if (tokens.length === 0) return { implausible: false };
  const largest = Math.max(...tokens);
  if (largest < amountMajor * factor) return { implausible: false, largestToken: largest };
  return {
    implausible: true,
    largestToken: largest,
    message: `The description mentions ${largest.toLocaleString('en-NG')} but the amount is ${formatMinor(amountMinor).replace('₦', '')}. Please check.`,
  };
}

/**
 * A description carrying several large numbers is a pasted shopping list, and
 * belongs in separate lines. Callers should offer the splitter rather than a
 * bare rejection.
 */
export function looksLikePastedList(description: string): boolean {
  const big = extractNumericTokens(description).filter((n) => n > PASTED_LIST_TOKEN_FLOOR);
  return big.length >= PASTED_LIST_TOKEN_COUNT;
}

// ── The validator ───────────────────────────────────────────────────────────

export interface FieldError {
  field: string;
  message: string;
  /** Set when the fix is "split this into lines" rather than "retype it". */
  offerSplit?: boolean;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

/**
 * Errors from a validation result, or an empty array when it passed.
 *
 * This project compiles with `strict: false`, which weakens narrowing of a
 * discriminated union behind `if (!result.ok)`. Callers use this instead of
 * reaching for `result.errors` directly.
 */
export const validationErrors = <T,>(r: Validated<T>): FieldError[] =>
  r.ok ? [] : (r as { ok: false; errors: FieldError[] }).errors;

/** Field → message, for driving per-field error display. */
export const errorMap = <T,>(r: Validated<T>): Record<string, string> =>
  Object.fromEntries(validationErrors(r).map((e) => [e.field, e.message]));

export interface ExpenseLineInput {
  description: string;
  /** Raw user text. Never pre-parse this with parseFloat. */
  amount: string;
  category_id: string;
  payee_id?: string | null;
  /** Free-typed name for a one-off payee not on the vendor list. */
  payee_name?: string | null;
  expense_account_code?: string | null;
  cost_centre?: string | null;
  budget_id?: string | null;
  vat?: string | null;
  wht?: string | null;
  reference?: string | null;
  receipt_id?: string | null;
  receipt_path?: string | null;
  date?: string | null;
  payment_method?: string | null;
  bank_account_id?: string | null;
}

export interface ValidatedExpenseLine {
  description: string;
  amount_minor: bigint;
  category_id: string;
  payee_id: string | null;
  payee_name: string | null;
  expense_account_code: string;
  cost_centre: string;
  budget_id: string | null;
  vat_minor: bigint;
  wht_minor: bigint;
  reference: string | null;
  receipt_path: string | null;
  date: string | null;
  payment_method: string | null;
  bank_account_id: string | null;
}

export interface ValidateOptions {
  /** Books are closed on or before this date (from fn_books_locked). */
  lockedThrough?: string | null;
  /** Skip the fields a claim carries once for all its lines. */
  scope?: 'line' | 'full';
  /** Today, injectable for tests. */
  today?: Date;
  /** Reference must be unique per payee; caller supplies the known set. */
  existingReferences?: Set<string>;
}

const METHODS_NEEDING_BANK = new Set(['transfer', 'card', 'pos']);

/**
 * Validate one expense line. `scope: 'line'` checks only what a line owns
 * (used by the staff mobile capture flow, where date and payment method are
 * set once on the claim); `scope: 'full'` additionally requires the
 * claim-level fields, and is what the single-entry form and bulk grid use.
 */
export function validateExpenseLine(
  input: ExpenseLineInput,
  opts: ValidateOptions = {},
): Validated<ValidatedExpenseLine> {
  const { scope = 'full', today = new Date(), lockedThrough = null, existingReferences } = opts;
  const errors: FieldError[] = [];

  // ── Amount ──
  let amountMinor = 0n;
  const parsed: ParseMoneyResult = parseMoney(input.amount, {
    ceilingMinor: AMOUNT_CEILING_MINOR,
    label: 'amount',
  });
  if (isMoneyError(parsed)) {
    errors.push({ field: 'amount', message: parsed.error });
  } else {
    amountMinor = parsed.minor;
  }

  // ── Description ──
  const description = normaliseText(input.description);
  if (description === '') {
    errors.push({ field: 'description', message: 'Describe what was bought.' });
  } else if (description.length > 500) {
    errors.push({ field: 'description', message: 'Description is longer than 500 characters.' });
  } else if (looksLikePastedList(description)) {
    errors.push({
      field: 'description',
      message: 'This looks like several purchases in one line. Split it so each purchase is its own line.',
      offerSplit: true,
    });
  }

  // ── Implausibility: the defect that produced ₦922.34 ──
  if (amountMinor > 0n && description !== '') {
    const check = checkImplausible(description, amountMinor);
    if (check.implausible) errors.push({ field: 'amount', message: check.message! });
  }

  // ── Category (controlled list, FK) ──
  const categoryId = normaliseText(input.category_id);
  if (categoryId === '') {
    errors.push({ field: 'category_id', message: 'Choose a category.' });
  }

  // ── Payee ──
  const payeeId = input.payee_id ? String(input.payee_id) : null;
  const payeeName = normaliseText(input.payee_name);
  if (!payeeId && payeeName === '') {
    errors.push({ field: 'payee', message: 'Name who was paid. Choose a supplier, or type a one-off payee.' });
  }

  // ── VAT / WHT (optional) ──
  const optionalMinor = (raw: string | null | undefined, field: string, label: string): bigint => {
    const s = String(raw ?? '').trim();
    if (s === '') return 0n;
    const r = parseMoney(s, { allowZero: true, ceilingMinor: AMOUNT_CEILING_MINOR, label });
    if (isMoneyError(r)) {
      errors.push({ field, message: r.error });
      return 0n;
    }
    return r.minor;
  };
  const vatMinor = optionalMinor(input.vat, 'vat', 'VAT');
  const whtMinor = optionalMinor(input.wht, 'wht', 'WHT');
  if (amountMinor > 0n && vatMinor > amountMinor) {
    errors.push({ field: 'vat', message: 'VAT cannot be more than the amount.' });
  }
  if (amountMinor > 0n && whtMinor > amountMinor) {
    errors.push({ field: 'wht', message: 'WHT cannot be more than the amount.' });
  }

  // ── Receipt above the threshold ──
  const receiptPath = input.receipt_path ?? null;
  if (amountMinor >= RECEIPT_THRESHOLD_MINOR && !receiptPath && !input.receipt_id) {
    errors.push({
      field: 'receipt',
      message: `A receipt is required at ${formatMinor(RECEIPT_THRESHOLD_MINOR)} and above.`,
    });
  }

  // ── Claim-level fields ──
  const expenseAccount = normaliseText(input.expense_account_code);
  const costCentre = normaliseText(input.cost_centre);
  const paymentMethod = normaliseText(input.payment_method);
  const date = input.date ? String(input.date) : null;

  if (scope === 'full') {
    if (expenseAccount === '') {
      errors.push({ field: 'expense_account_code', message: 'Choose an expense account.' });
    }
    if (costCentre === '') {
      errors.push({ field: 'cost_centre', message: 'Choose a cost centre.' });
    }
    if (paymentMethod === '') {
      errors.push({ field: 'payment_method', message: 'Choose how this was paid.' });
    } else if (METHODS_NEEDING_BANK.has(paymentMethod.toLowerCase()) && !input.bank_account_id) {
      errors.push({ field: 'bank_account_id', message: `Choose the bank account used for this ${paymentMethod.toLowerCase()} payment.` });
    }
    const reference = normaliseText(input.reference);
    if (reference === '') {
      errors.push({ field: 'reference', message: 'Enter the invoice or reference number.' });
    } else if (existingReferences) {
      const key = `${payeeId ?? payeeName.toLowerCase()}|${reference.toLowerCase()}`;
      if (existingReferences.has(key)) {
        errors.push({ field: 'reference', message: `Reference "${reference}" has already been used for this payee.` });
      }
    }

    const dateErr = validateExpenseDate(date, { today, lockedThrough });
    if (dateErr) errors.push(dateErr);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      description,
      amount_minor: amountMinor,
      category_id: categoryId,
      payee_id: payeeId,
      payee_name: payeeId ? null : payeeName,
      expense_account_code: expenseAccount,
      cost_centre: costCentre,
      budget_id: input.budget_id || null,
      vat_minor: vatMinor,
      wht_minor: whtMinor,
      reference: normaliseText(input.reference) || null,
      receipt_path: receiptPath,
      date,
      payment_method: paymentMethod || null,
      bank_account_id: input.bank_account_id || null,
    },
  };
}

/**
 * The calendar date in the user's own timezone, as YYYY-MM-DD.
 *
 * Deliberately not `toISOString().slice(0,10)`: that converts to UTC first, so
 * in Lagos (UTC+1) it returns yesterday for the first hour of every day. Using
 * it to bound "no future dates" would reject a staff member's own today.
 */
export const todayIso = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Date must be real, not in the future beyond tolerance, and in an open period. */
export function validateExpenseDate(
  date: string | null,
  opts: { today?: Date; lockedThrough?: string | null } = {},
): FieldError | null {
  const { today = new Date(), lockedThrough = null } = opts;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { field: 'date', message: 'Enter a valid date.' };
  }
  const limit = new Date(today);
  limit.setDate(limit.getDate() + FUTURE_DATE_TOLERANCE_DAYS);
  if (date > todayIso(limit)) {
    return {
      field: 'date',
      message: FUTURE_DATE_TOLERANCE_DAYS === 0
        ? 'An expense cannot be dated in the future.'
        : `An expense cannot be dated more than ${FUTURE_DATE_TOLERANCE_DAYS} day(s) ahead.`,
    };
  }
  if (lockedThrough && date <= lockedThrough) {
    return { field: 'date', message: `The books are closed through ${lockedThrough}. Use a later date or ask an admin to reopen the period.` };
  }
  return null;
}

// ── Claim-level checks ──────────────────────────────────────────────────────

export interface ClaimCheckInput {
  lines: Array<{ amount_minor: bigint }>;
  /** Total the staff member typed, if any, to reconcile against. */
  statedTotalMinor?: bigint | null;
  submittedBy?: string | null;
  approvedBy?: string | null;
}

export interface ClaimCheck {
  totalMinor: bigint;
  reconciles: boolean;
  differenceMinor: bigint;
  errors: FieldError[];
  /** Human summary for the UI: "8 lines totalling ₦922,340.00 — matches the stated total." */
  message: string;
}

export function checkExpenseClaim(input: ClaimCheckInput): ClaimCheck {
  const errors: FieldError[] = [];
  const totalMinor = input.lines.reduce<bigint>((s, l) => s + l.amount_minor, 0n);

  if (input.lines.length === 0) {
    errors.push({ field: 'lines', message: 'Add at least one expense line.' });
  }
  if (input.submittedBy && input.approvedBy && input.submittedBy === input.approvedBy) {
    errors.push({ field: 'approved_by', message: 'You cannot approve a claim you submitted yourself.' });
  }

  const stated = input.statedTotalMinor ?? null;
  const difference = stated === null ? 0n : totalMinor - stated;
  const reconciles = stated === null || difference === 0n;
  if (!reconciles) {
    errors.push({
      field: 'stated_total',
      message: `The lines total ${formatMinor(totalMinor)} but the stated total is ${formatMinor(stated!)} — a difference of ${formatMinor(difference < 0n ? -difference : difference)}.`,
    });
  }

  const n = input.lines.length;
  const message = stated === null
    ? `${n} line${n === 1 ? '' : 's'} totalling ${formatMinor(totalMinor)}.`
    : reconciles
      ? `${n} line${n === 1 ? '' : 's'} totalling ${formatMinor(totalMinor)} — matches the stated total.`
      : `${n} line${n === 1 ? '' : 's'} totalling ${formatMinor(totalMinor)} — the stated total is ${formatMinor(stated)}.`;

  return { totalMinor, reconciles, differenceMinor: difference, errors, message };
}
