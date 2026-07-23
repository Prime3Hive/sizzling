// Nigerian statutory payroll computation.
//
// Implements the personal income tax regime of the Nigeria Tax Act 2025
// (effective 1 January 2026), the Pension Reform Act 2014 contribution rates,
// and the National Housing Fund Act levy. Amounts are computed per pay period
// from an annualised base, then rounded to 2 dp (kobo).
//
// Simplifications (documented for the finance team):
// • Pensionable emoluments are approximated as basic + allowances. The PRA
//   defines them as basic + housing + transport; until the salary structure
//   is itemised, gross is the closest available proxy.
// • The NTA 2025 rent relief (lower of 20% of annual rent or ₦500,000) is an
//   employee-specific claim; it defaults to 0 here and can be passed in once
//   rent declarations are collected.
// • NHF is levied at 2.5% of basic salary (mandatory for employees earning
//   the minimum threshold; toggle off for exempt staff).

/** NTA 2025 annual PAYE bands (₦, taxable income). */
export const PAYE_BANDS_2026: { upTo: number; rate: number }[] = [
  { upTo: 800_000, rate: 0 },
  { upTo: 3_000_000, rate: 0.15 },
  { upTo: 12_000_000, rate: 0.18 },
  { upTo: 25_000_000, rate: 0.21 },
  { upTo: 50_000_000, rate: 0.23 },
  { upTo: Infinity, rate: 0.25 },
];

export const PENSION_EMPLOYEE_RATE = 0.08; // PRA 2014 s.4(1)
export const PENSION_EMPLOYER_RATE = 0.1;  // PRA 2014 s.4(1)
export const NHF_RATE = 0.025;             // NHF Act, 2.5% of basic

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Progressive annual PAYE on an annual taxable income (₦). */
export function annualPaye(annualTaxable: number): number {
  let remaining = Math.max(0, annualTaxable);
  let lower = 0;
  let tax = 0;
  for (const band of PAYE_BANDS_2026) {
    const width = band.upTo - lower;
    const slice = Math.min(remaining, width);
    if (slice <= 0) break;
    tax += slice * band.rate;
    remaining -= slice;
    lower = band.upTo;
  }
  return tax;
}

export interface StatutoryInput {
  /** Basic salary for ONE pay period. */
  basic: number;
  /** Allowances for the same pay period. */
  allowances: number;
  /** Pay periods per year (12 = monthly, 52 = weekly…). Default 12. */
  periodsPerYear?: number;
  /** Annual rent relief already validated by HR (NTA 2025). Default 0. */
  annualRentRelief?: number;
  applyPension?: boolean;
  applyNhf?: boolean;
  /** Additional non-statutory deductions for the period (loans, cooperative…). */
  otherDeductions?: number;
}

export interface StatutoryResult {
  gross: number;
  paye: number;
  pensionEmployee: number;
  pensionEmployer: number;
  nhf: number;
  otherDeductions: number;
  /** paye + pensionEmployee + nhf + otherDeductions (what comes off the payslip). */
  totalDeductions: number;
  netPay: number;
  /** gross + pensionEmployer — the true cost to the employer. */
  employerCost: number;
}

/**
 * Full statutory computation for one pay period.
 * Deduction order follows the NTA/PITA mechanics: pension and NHF are
 * tax-deductible, so PAYE is charged on gross − pension − NHF − rent relief.
 */
export function computeStatutory(input: StatutoryInput): StatutoryResult {
  const periods = input.periodsPerYear && input.periodsPerYear > 0 ? input.periodsPerYear : 12;
  const basic = Math.max(0, Number(input.basic) || 0);
  const allowances = Math.max(0, Number(input.allowances) || 0);
  const other = Math.max(0, Number(input.otherDeductions) || 0);
  const gross = basic + allowances;

  const pensionEmployee = input.applyPension === false ? 0 : round2(gross * PENSION_EMPLOYEE_RATE);
  const pensionEmployer = input.applyPension === false ? 0 : round2(gross * PENSION_EMPLOYER_RATE);
  const nhf = input.applyNhf === false ? 0 : round2(basic * NHF_RATE);

  const annualTaxable =
    (gross - pensionEmployee - nhf) * periods - Math.max(0, input.annualRentRelief ?? 0);
  const paye = round2(annualPaye(annualTaxable) / periods);

  const totalDeductions = round2(paye + pensionEmployee + nhf + other);
  const netPay = round2(gross - totalDeductions);

  return {
    gross: round2(gross),
    paye,
    pensionEmployee,
    pensionEmployer,
    nhf,
    otherDeductions: round2(other),
    totalDeductions,
    netPay,
    employerCost: round2(gross + pensionEmployer),
  };
}

/** A zeroed statutory result for manual (non-statutory) payroll entries. */
export function manualDeductions(basic: number, allowances: number, deductions: number): StatutoryResult {
  const gross = round2(Math.max(0, basic) + Math.max(0, allowances));
  const other = round2(Math.max(0, deductions));
  return {
    gross,
    paye: 0,
    pensionEmployee: 0,
    pensionEmployer: 0,
    nhf: 0,
    otherDeductions: other,
    totalDeductions: other,
    netPay: round2(gross - other),
    employerCost: gross,
  };
}
