import { describe, it, expect } from 'vitest';
import {
  parseMoney,
  isMoneyError,
  formatMinor,
  formatAmountForTyping,
  caretAfterFormat,
  nairaToMinor,
  minorToNaira,
  sumMinor,
} from './money';

const minorOf = (input: string, opts = {}) => {
  const r = parseMoney(input, opts);
  if (isMoneyError(r)) throw new Error(`expected "${input}" to parse, got: ${r.error}`);
  return r.minor;
};

const errorOf = (input: string, opts = {}) => {
  const r = parseMoney(input, opts);
  if (!isMoneyError(r)) throw new Error(`expected "${input}" to be rejected, got ${r.minor}`);
  return r.error;
};

describe('X-01 — parseMoney: the vectors that must pass', () => {
  // These are the exact vectors mandated by section 2 of the fix instructions.
  it('"922,340" -> 92234000 minor (the record that was stored as 922.34)', () => {
    expect(minorOf('922,340')).toBe(92234000n);
  });

  it('"922340" -> 92234000 minor', () => {
    expect(minorOf('922340')).toBe(92234000n);
  });

  it('"922,340.50" -> 92234050 minor', () => {
    expect(minorOf('922,340.50')).toBe(92234050n);
  });

  it('"1,373,250.00" -> 137325000 minor', () => {
    expect(minorOf('1,373,250.00')).toBe(137325000n);
  });

  it('"1.31" -> 131 minor', () => {
    expect(minorOf('1.31')).toBe(131n);
  });

  it('"922,34" -> ERROR (ambiguous, do not guess)', () => {
    expect(errorOf('922,34')).toMatch(/not a clear amount/i);
  });

  it('"1.234.567" -> ERROR', () => {
    expect(errorOf('1.234.567')).toMatch(/more than one decimal point/i);
  });

  it('"" -> ERROR', () => {
    expect(errorOf('')).toMatch(/enter an amount/i);
  });

  it('"0" -> ERROR on an expense', () => {
    expect(errorOf('0')).toMatch(/cannot be zero/i);
  });
});

describe('parseMoney — the defect itself', () => {
  // The old path was parseFloat() on an <input type="number"> value that the
  // browser had already localised. These assert we never reproduce it.
  it('never divides a comma-grouped amount by a thousand', () => {
    expect(minorOf('922,340')).not.toBe(92234n);
    expect(minorToNaira(minorOf('922,340'))).toBe(922340);
  });

  it('treats comma as thousands, never as a decimal separator', () => {
    expect(minorOf('1,500')).toBe(150000n);
    expect(minorOf('1,500')).not.toBe(150n);
  });

  it('rejects the pre-localised form rather than silently accepting it', () => {
    // "922.340" is what Chromium leaves in a number input on a comma-decimal
    // device. Three decimal places is not a valid kobo amount.
    expect(errorOf('922.340')).toMatch(/more than 2 decimal places/i);
  });
});

describe('parseMoney — cleaning and rejection', () => {
  it('strips currency symbols', () => {
    expect(minorOf('₦922,340')).toBe(92234000n);
    expect(minorOf('NGN 1,000')).toBe(100000n);
  });

  it('strips the directional marks that arrive from chat apps', () => {
    expect(minorOf('‎922,340‏')).toBe(92234000n);
    expect(minorOf('﻿562,850')).toBe(56285000n);
  });

  it('strips whitespace', () => {
    expect(minorOf('  1,000.50  ')).toBe(100050n);
  });

  it('rejects letters and stray characters', () => {
    expect(errorOf('922,340 naira')).toMatch(/not part of a number/i);
    expect(errorOf('abc')).toMatch(/not part of a number/i);
    expect(errorOf('1,000+2,000')).toMatch(/not part of a number/i);
  });

  it('rejects negatives on an expense but allows them when asked', () => {
    expect(errorOf('-500')).toMatch(/cannot be negative/i);
    expect(minorOf('-500', { allowNegative: true })).toBe(-50000n);
  });

  it('allows zero only when asked', () => {
    expect(minorOf('0', { allowZero: true })).toBe(0n);
  });

  it('rejects malformed comma groups', () => {
    expect(errorOf('1,23,456')).toMatch(/not a clear amount/i);
    expect(errorOf('1234,56')).toMatch(/not a clear amount/i);
    expect(errorOf(',500')).toMatch(/not a clear amount/i);
  });

  it('accepts well-formed comma groups of every length', () => {
    expect(minorOf('1,000')).toBe(100000n);
    expect(minorOf('12,000')).toBe(1200000n);
    expect(minorOf('123,000')).toBe(12300000n);
    expect(minorOf('1,234,567')).toBe(123456700n);
  });

  it('holds amounts above the ceiling for review', () => {
    expect(errorOf('50,000,001')).toMatch(/needs review/i);
    expect(minorOf('50,000,000')).toBe(5000000000n);
  });

  it('honours a custom ceiling', () => {
    expect(errorOf('2,000', { ceilingMinor: 100000n })).toMatch(/needs review/i);
  });

  it('handles one and two decimal places', () => {
    expect(minorOf('10.5')).toBe(1050n);
    expect(minorOf('10.05')).toBe(1005n);
    expect(minorOf('.5')).toBe(50n);
  });
});

describe('formatMinor', () => {
  it('formats kobo as en-NG naira', () => {
    expect(formatMinor(92234000n)).toBe('₦922,340.00');
    expect(formatMinor(131n)).toBe('₦1.31');
    expect(formatMinor(0n)).toBe('₦0.00');
  });

  it('round-trips through the parser without loss', () => {
    // Formatting then re-parsing is forbidden in production code, but the
    // values must still agree — otherwise the display is lying.
    const minor = minorOf('1,373,250.00');
    expect(formatMinor(minor)).toBe('₦1,373,250.00');
  });
});

describe('formatAmountForTyping', () => {
  it('groups thousands as the user types', () => {
    expect(formatAmountForTyping('922340')).toBe('922,340');
    expect(formatAmountForTyping('1373250')).toBe('1,373,250');
    expect(formatAmountForTyping('1')).toBe('1');
  });

  it('leaves a partial decimal alone', () => {
    expect(formatAmountForTyping('922340.')).toBe('922,340.');
    expect(formatAmountForTyping('922340.5')).toBe('922,340.5');
  });

  it('caps the decimal at two places', () => {
    expect(formatAmountForTyping('1.2345')).toBe('1.23');
  });

  it('drops characters that cannot be part of an amount', () => {
    expect(formatAmountForTyping('₦922,340')).toBe('922,340');
  });

  it('keeps the caret next to the digit the user just typed', () => {
    // The field held "92,234" and the user typed "0" at the end, so the raw
    // post-keystroke value is "92,2340" with the caret at 7. Re-grouping must
    // leave the caret after that same "0", not throw it to the end.
    const rawAfterKeystroke = '92,2340';
    const newValue = formatAmountForTyping(rawAfterKeystroke);
    expect(newValue).toBe('922,340');
    expect(caretAfterFormat(rawAfterKeystroke, 7, newValue)).toBe(7);
  });

  it('keeps the caret mid-field when editing in the middle', () => {
    // "1,234,567" with the caret after "1,2" (index 3); the user deletes the
    // "2", giving raw "1,34,567" caret 3 -> "134,567", caret after "13".
    const newValue = formatAmountForTyping('1,34,567');
    expect(newValue).toBe('134,567');
    expect(caretAfterFormat('1,34,567', 3, newValue)).toBe(2);
  });
});

describe('minor-unit helpers', () => {
  it('converts between the legacy naira column and kobo', () => {
    expect(nairaToMinor(922340)).toBe(92234000n);
    expect(nairaToMinor('1373250.00')).toBe(137325000n);
    expect(minorToNaira(92234000n)).toBe(922340);
  });

  it('sums without floating-point drift', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in kobo it is exactly 30.
    expect(sumMinor([10n, 20n])).toBe(30n);
    expect(sumMinor([14205000n, 20200000n, 5000000n, 6500000n, 2030000n, 2240000n, 31959000n, 10100000n]))
      .toBe(92234000n);
  });
});
