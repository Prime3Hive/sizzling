import { describe, it, expect } from 'vitest';
import {
  validateExpenseLine,
  validationErrors,
  validateExpenseDate,
  checkImplausible,
  checkExpenseClaim,
  looksLikePastedList,
  extractNumericTokens,
  normaliseText,
  isEffectivelyEmpty,
  type ExpenseLineInput,
} from './expenseValidation';

const TODAY = new Date('2026-08-17T09:00:00Z');

const line = (over: Partial<ExpenseLineInput> = {}): ExpenseLineInput => ({
  description: '10kg of teriyaki',
  amount: '142,050',
  category_id: 'cat-raw-materials',
  payee_name: 'Mama Ngozi Foods',
  expense_account_code: '5000',
  cost_centre: 'Daily Orders',
  payment_method: 'Cash',
  reference: 'INV-001',
  receipt_path: 'receipts/abc.jpg',
  date: '2026-08-14',
  ...over,
});

const errorsFor = (input: ExpenseLineInput, opts = {}) =>
  validationErrors(validateExpenseLine(input, { today: TODAY, ...opts }));
const fieldsWithErrors = (input: ExpenseLineInput, opts = {}) =>
  errorsFor(input, opts).map((e) => e.field);

describe('validateExpenseLine — the happy path', () => {
  it('accepts a complete line and returns kobo', () => {
    const r = validateExpenseLine(line(), { today: TODAY });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.amount_minor).toBe(14205000n);
      expect(r.value.description).toBe('10kg of teriyaki');
      expect(r.value.expense_account_code).toBe('5000');
    }
  });

  it('cleans directional marks out of the text it stores', () => {
    const r = validateExpenseLine(line({ description: '‎10kg of teriyaki‏' }), { today: TODAY });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBe('10kg of teriyaki');
  });
});

describe('X-02 — the implausibility check', () => {
  it('blocks ₦1.31 against a description mentioning 50,000', () => {
    const errs = errorsFor(line({ amount: '1.31', description: 'Bus fuel 50,000', receipt_path: null }));
    expect(errs.some((e) => e.field === 'amount' && /mentions 50,000 but the amount is 1\.31/.test(e.message))).toBe(true);
  });

  it('produces the message from the specification', () => {
    const check = checkImplausible('Total amount 922,340', 92234n);
    expect(check.implausible).toBe(true);
    expect(check.message).toBe('The description mentions 922,340 but the amount is 922.34. Please check.');
  });

  it('lets a matching amount through', () => {
    expect(checkImplausible('Total amount 922,340', 92234000n).implausible).toBe(false);
  });

  it('does not fire below the 100x factor', () => {
    // 5,000 mentioned against ₦100 is a factor of 50 — under the threshold.
    expect(checkImplausible('about 5,000', 10000n).implausible).toBe(false);
    expect(checkImplausible('about 5,000', 1000n).implausible).toBe(true);
  });

  it('ignores descriptions with no numbers', () => {
    expect(checkImplausible('Bus fuel', 100n).implausible).toBe(false);
  });
});

describe('X-03 — pasted lists belong in separate lines', () => {
  const narrative =
    'Expense 10kg of teriyaki 142,050 Credit payment items Mr Theophilus 202,000 Bus fuel 50,000';

  it('detects a pasted list', () => {
    expect(looksLikePastedList(narrative)).toBe(true);
    expect(looksLikePastedList('10kg of teriyaki')).toBe(false);
    expect(looksLikePastedList('Bus fuel 50,000')).toBe(false);
  });

  it('rejects the line and offers the splitter rather than a bare refusal', () => {
    const errs = errorsFor(line({ description: narrative, amount: '394,050' }));
    const descErr = errs.find((e) => e.field === 'description');
    expect(descErr?.offerSplit).toBe(true);
    expect(descErr?.message).toMatch(/split it/i);
  });

  it('extracts every number mentioned in prose', () => {
    expect(extractNumericTokens('Bus fuel 50,000 and charcoal 20,300')).toEqual([50000, 20300]);
  });
});

describe('validateExpenseLine — required fields', () => {
  it('requires description, amount, category and payee', () => {
    const fields = fieldsWithErrors(line({
      description: '', amount: '', category_id: '', payee_name: '', payee_id: null,
    }));
    expect(fields).toContain('description');
    expect(fields).toContain('amount');
    expect(fields).toContain('category_id');
    expect(fields).toContain('payee');
  });

  it('accepts a supplier id in place of a typed payee name', () => {
    expect(fieldsWithErrors(line({ payee_name: '', payee_id: 'vendor-1' }))).not.toContain('payee');
  });

  it('requires an expense account with no default', () => {
    expect(fieldsWithErrors(line({ expense_account_code: '' }))).toContain('expense_account_code');
  });

  it('requires a cost centre and a payment method', () => {
    const fields = fieldsWithErrors(line({ cost_centre: '', payment_method: '' }));
    expect(fields).toContain('cost_centre');
    expect(fields).toContain('payment_method');
  });

  it('requires a reference', () => {
    expect(fieldsWithErrors(line({ reference: '' }))).toContain('reference');
  });

  it('U-14 — blocks submission until a payment method is chosen', () => {
    expect(fieldsWithErrors(line({ payment_method: '' }))).toContain('payment_method');
  });

  it('skips claim-level fields when validating a single line', () => {
    const fields = fieldsWithErrors(
      line({ expense_account_code: '', cost_centre: '', payment_method: '', reference: '' }),
      { scope: 'line' },
    );
    expect(fields).toEqual([]);
  });
});

describe('validateExpenseLine — bank account, VAT and WHT', () => {
  it('requires a bank account for a transfer, card or POS payment', () => {
    for (const method of ['Transfer', 'Card', 'POS']) {
      expect(fieldsWithErrors(line({ payment_method: method })), method).toContain('bank_account_id');
    }
  });

  it('does not require one for cash', () => {
    expect(fieldsWithErrors(line({ payment_method: 'Cash' }))).not.toContain('bank_account_id');
  });

  it('accepts optional VAT and WHT in kobo', () => {
    const r = validateExpenseLine(line({ vat: '10,000', wht: '7,102.50' }), { today: TODAY });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.vat_minor).toBe(1000000n);
      expect(r.value.wht_minor).toBe(710250n);
    }
  });

  it('rejects VAT or WHT larger than the amount', () => {
    const fields = fieldsWithErrors(line({ amount: '1,000', vat: '2,000', wht: '3,000', receipt_path: null }));
    expect(fields).toContain('vat');
    expect(fields).toContain('wht');
  });
});

describe('validateExpenseLine — receipt threshold', () => {
  it('requires a receipt at ₦10,000 and above', () => {
    expect(fieldsWithErrors(line({ amount: '10,000', receipt_path: null }))).toContain('receipt');
  });

  it('does not require one below the threshold', () => {
    expect(fieldsWithErrors(line({ amount: '9,999.99', receipt_path: null }))).not.toContain('receipt');
  });

  it('is satisfied by an uploaded receipt', () => {
    expect(fieldsWithErrors(line({ amount: '922,340', receipt_path: 'receipts/x.pdf' }))).not.toContain('receipt');
  });
});

describe('validateExpenseDate', () => {
  it('rejects a future date with the default zero tolerance', () => {
    expect(validateExpenseDate('2026-08-18', { today: TODAY })?.field).toBe('date');
  });

  it('accepts today', () => {
    expect(validateExpenseDate('2026-08-17', { today: TODAY })).toBeNull();
  });

  it('rejects a date in a closed period', () => {
    const err = validateExpenseDate('2026-07-31', { today: TODAY, lockedThrough: '2026-07-31' });
    expect(err?.message).toMatch(/books are closed/i);
  });

  it('rejects a malformed date', () => {
    expect(validateExpenseDate('14/08/2026', { today: TODAY })?.field).toBe('date');
    expect(validateExpenseDate(null, { today: TODAY })?.field).toBe('date');
  });
});

describe('duplicate references', () => {
  it('rejects a reference already used for the same payee', () => {
    const existing = new Set(['mama ngozi foods|inv-001']);
    expect(fieldsWithErrors(line(), { existingReferences: existing })).toContain('reference');
  });

  it('allows the same reference for a different payee', () => {
    const existing = new Set(['someone else|inv-001']);
    expect(fieldsWithErrors(line(), { existingReferences: existing })).not.toContain('reference');
  });
});

describe('X-11 — claim-level checks', () => {
  it('sums its lines', () => {
    const r = checkExpenseClaim({
      lines: [{ amount_minor: 14205000n }, { amount_minor: 20200000n }],
    });
    expect(r.totalMinor).toBe(34405000n);
    expect(r.message).toBe('2 lines totalling ₦344,050.00.');
  });

  it('reconciles against a stated total', () => {
    const r = checkExpenseClaim({ lines: [{ amount_minor: 92234000n }], statedTotalMinor: 92234000n });
    expect(r.reconciles).toBe(true);
    expect(r.message).toMatch(/matches the stated total/);
  });

  it('reports a difference against a stated total that does not match', () => {
    const r = checkExpenseClaim({ lines: [{ amount_minor: 92234000n }], statedTotalMinor: 90000000n });
    expect(r.reconciles).toBe(false);
    expect(r.errors[0].message).toMatch(/a difference of ₦22,340\.00/);
  });

  it('refuses an approver who is the submitter', () => {
    const r = checkExpenseClaim({
      lines: [{ amount_minor: 100n }],
      submittedBy: 'user-1',
      approvedBy: 'user-1',
    });
    expect(r.errors.some((e) => e.field === 'approved_by')).toBe(true);
  });

  it('accepts a different approver', () => {
    const r = checkExpenseClaim({
      lines: [{ amount_minor: 100n }],
      submittedBy: 'user-1',
      approvedBy: 'user-2',
    });
    expect(r.errors).toHaveLength(0);
  });

  it('requires at least one line', () => {
    expect(checkExpenseClaim({ lines: [] }).errors.some((e) => e.field === 'lines')).toBe(true);
  });
});

describe('M-06 — text normalisation', () => {
  it('strips directional and zero-width marks', () => {
    expect(normaliseText('‎Mama Ngozi‏')).toBe('Mama Ngozi');
    expect(normaliseText('﻿Foods')).toBe('Foods');
  });

  it('collapses whitespace', () => {
    expect(normaliseText('  Bus   fuel  ')).toBe('Bus fuel');
  });

  it('detects a field that is nothing but control characters', () => {
    // One payables row has a supplier field of only control characters
    // against ₦562,850. That must be caught, not stored.
    expect(isEffectivelyEmpty('‎‏﻿')).toBe(true);
    expect(isEffectivelyEmpty('   ')).toBe(true);
    expect(isEffectivelyEmpty('Mama Ngozi')).toBe(false);
  });
});
