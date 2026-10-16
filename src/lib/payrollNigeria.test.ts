import { describe, expect, it } from 'vitest';
import { annualPaye, computeStatutory } from './payrollNigeria';

describe('computeStatutory with commission', () => {
  const base = { basic: 300_000, allowances: 0 };

  it('leaves a salary-only payslip unchanged', () => {
    const a = computeStatutory(base);
    const b = computeStatutory({ ...base, commission: 0 });
    expect(b).toEqual(a);
  });

  it('does not charge pension or NHF on commission', () => {
    const a = computeStatutory(base);
    const b = computeStatutory({ ...base, commission: 50_000 });
    expect(b.pensionEmployee).toBe(a.pensionEmployee);
    expect(b.pensionEmployer).toBe(a.pensionEmployer);
    expect(b.nhf).toBe(a.nhf);
    expect(b.gross).toBe(a.gross + 50_000);
  });

  it('taxes commission at the marginal rate, not annualised', () => {
    const a = computeStatutory(base);
    const b = computeStatutory({ ...base, commission: 50_000 });
    const annualTaxable = (300_000 - a.pensionEmployee - a.nhf) * 12;
    const expected = annualPaye(annualTaxable + 50_000) - annualPaye(annualTaxable);
    expect(b.paye - a.paye).toBeCloseTo(expected, 1);
    expect(b.netPay).toBeCloseTo(a.netPay + 50_000 - expected, 1);
  });
});
