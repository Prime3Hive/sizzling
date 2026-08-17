// ─────────────────────────────────────────────────────────────────────────────
// Money — parsing, storage and display for Nigerian Naira.
//
// Money is stored as an integer number of KOBO (minor units). Never as a float.
//
// Why this file exists: amounts used to be read with `parseFloat` off an
// `<input type="number">`. Chromium sanitises a number input's value using the
// DEVICE's locale, so on a phone set to a comma-decimal locale (de-DE, fr-FR,
// pt-BR …) typing "922,340" leaves `input.value === "922.340"`, and
// `parseFloat("922.340")` is 922.34 — one thousandth of what the user typed.
// Amounts typed without separators survived, which is why some records in the
// same table are correct and others are off by a factor of 1000.
//
// The fix is to stop letting the browser interpret the number at all: read the
// raw text and parse it here, with comma ALWAYS a thousands separator (en-NG).
// ─────────────────────────────────────────────────────────────────────────────

/** Characters pasted in from chat apps that must never reach the parser. */
const INVISIBLE = /[\u200E\u200F\uFEFF\u00A0\u2066-\u2069\u200B-\u200D]/g;

/** Currency markers a user may reasonably type or paste. */
const CURRENCY = /(?:₦|NGN)/gi;

/** Default ceiling above which an amount is held for review, in kobo (₦50,000,000). */
export const DEFAULT_CEILING_MINOR = 5_000_000_000n;

export interface ParseMoneyOptions {
  /** Reject anything above this, in minor units. Default ₦50,000,000. */
  ceilingMinor?: bigint;
  /** Permit exactly zero. Default false — an expense of nothing is not an expense. */
  allowZero?: boolean;
  /** Permit negatives. Default false. Reversals carry their own sign elsewhere. */
  allowNegative?: boolean;
  /** Field name used in error messages. Default "amount". */
  label?: string;
}

export type ParseMoneyResult = { minor: bigint } | { error: string };

export const isMoneyError = (r: ParseMoneyResult): r is { error: string } =>
  Object.prototype.hasOwnProperty.call(r, 'error');

/**
 * Parse a user-entered amount into kobo.
 *
 * Comma is ALWAYS a thousands separator and period is ALWAYS the decimal
 * point. This is en-NG and it does not vary by locale — a locale-variable
 * parser is the defect this function exists to replace.
 */
export function parseMoney(input: string, opts: ParseMoneyOptions = {}): ParseMoneyResult {
  const {
    ceilingMinor = DEFAULT_CEILING_MINOR,
    allowZero = false,
    allowNegative = false,
    label = 'amount',
  } = opts;

  if (input == null) return { error: `Enter an ${label}.` };

  // Strip whitespace, currency symbols and directional/zero-width marks.
  const cleaned = String(input).replace(INVISIBLE, '').replace(CURRENCY, '').replace(/\s+/g, '');

  if (cleaned === '') return { error: `Enter an ${label}.` };

  // Only digits, comma, period and a single leading minus are admissible.
  if (!/^-?[0-9,.]+$/.test(cleaned)) {
    return { error: `The ${label} contains characters that are not part of a number. Enter digits only, for example 922,340.` };
  }

  const negative = cleaned.startsWith('-');
  if (negative && !allowNegative) {
    return { error: `The ${label} cannot be negative.` };
  }
  const body = negative ? cleaned.slice(1) : cleaned;
  if (body === '') return { error: `Enter an ${label}.` };

  // At most one period, and at most 2 digits after it.
  const periods = (body.match(/\./g) ?? []).length;
  if (periods > 1) {
    return { error: `The ${label} has more than one decimal point. Use a comma for thousands, for example 1,234,567.` };
  }

  const [wholeRaw, fracRaw = ''] = body.split('.');
  if (fracRaw.length > 2) {
    return { error: `The ${label} has more than 2 decimal places. Kobo goes to 2 places, for example 922,340.50.` };
  }
  if (fracRaw !== '' && !/^[0-9]+$/.test(fracRaw)) {
    return { error: `The ${label} has an invalid decimal part.` };
  }
  if (wholeRaw === '' && fracRaw === '') return { error: `Enter an ${label}.` };

  // A comma may only sit where a thousands separator sits. "922,34" is
  // ambiguous — 922.34 in one locale, a typo for 922,340 in ours. Do not guess.
  if (wholeRaw.includes(',')) {
    const groups = wholeRaw.split(',');
    const head = groups[0];
    const rest = groups.slice(1);
    const headOk = /^[0-9]{1,3}$/.test(head);
    const restOk = rest.length > 0 && rest.every((g) => /^[0-9]{3}$/.test(g));
    if (!headOk || !restOk) {
      const stripped = wholeRaw.replace(/,/g, '');
      return {
        error: `"${input}" is not a clear ${label}. A comma separates thousands, so the groups after it must be 3 digits — did you mean ${stripped}0, or ${wholeRaw.replace(',', '.')}?`,
      };
    }
  }

  const whole = wholeRaw.replace(/,/g, '');
  if (whole !== '' && !/^[0-9]+$/.test(whole)) {
    return { error: `The ${label} is not a valid number.` };
  }

  const minorAbs = BigInt(whole === '' ? '0' : whole) * 100n + BigInt(fracRaw === '' ? '0' : fracRaw.padEnd(2, '0'));
  const minor = negative ? -minorAbs : minorAbs;

  if (minor === 0n && !allowZero) {
    return { error: `The ${label} cannot be zero.` };
  }
  if (minorAbs > ceilingMinor) {
    return {
      error: `${formatMinor(minorAbs)} is above the ${formatMinor(ceilingMinor)} limit and needs review before it can be entered.`,
    };
  }

  return { minor };
}

// ── Display ─────────────────────────────────────────────────────────────────
// Format on output only. Never round-trip a formatted string back through the
// parser — that is how a display formatter becomes a data-corruption bug.

const NGN = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "₦922,340.00" from kobo. */
export function formatMinor(minor: bigint | number | null | undefined): string {
  const v = typeof minor === 'bigint' ? Number(minor) : Number(minor ?? 0);
  return NGN.format(v / 100).replace('NGN', '₦');
}

/** Kobo → naira as a plain number, for the legacy `amount` readers. */
export const minorToNaira = (minor: bigint | number): number =>
  Number(typeof minor === 'bigint' ? minor : Math.round(Number(minor) || 0)) / 100;

/** Naira (legacy numeric column) → kobo. Rounds to the nearest kobo. */
export const nairaToMinor = (naira: number | string | null | undefined): bigint =>
  BigInt(Math.round((Number(naira) || 0) * 100));

/** Sum kobo safely. */
export const sumMinor = (values: Array<bigint | number>): bigint =>
  values.reduce<bigint>((s, v) => s + (typeof v === 'bigint' ? v : BigInt(Math.round(Number(v) || 0))), 0n);

// ── Live input formatting ───────────────────────────────────────────────────

/**
 * Group the whole part with commas as the user types, leaving a trailing "."
 * or a partial decimal alone so typing "922340." does not fight the user.
 * Returns the display string only — the stored value still goes through
 * parseMoney().
 */
export function formatAmountForTyping(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(INVISIBLE, '')
    .replace(CURRENCY, '')
    .replace(/[^0-9.]/g, '');
  if (cleaned === '') return '';
  const firstDot = cleaned.indexOf('.');
  const whole = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  const frac = firstDot === -1 ? null : cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
  const grouped = whole.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === null ? grouped : `${grouped || '0'}.${frac}`;
}

/**
 * Re-place the caret after re-grouping. Counts the significant characters to
 * the left of the caret in the old string and puts the caret after the same
 * number in the new one, so inserting a separator does not throw the user to
 * the end of the field.
 */
export function caretAfterFormat(oldValue: string, caret: number, newValue: string): number {
  const before = (oldValue.slice(0, caret).match(/[0-9.]/g) ?? []).length;
  if (before === 0) return 0;
  let seen = 0;
  for (let i = 0; i < newValue.length; i++) {
    if (/[0-9.]/.test(newValue[i])) seen++;
    if (seen >= before) return i + 1;
  }
  return newValue.length;
}
