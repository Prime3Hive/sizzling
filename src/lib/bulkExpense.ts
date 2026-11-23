// Pure helpers shared by the expense forms: which budget a date falls in, when
// to warn about a budget, references, duplicates inside a batch, and turning
// last week's expenses into this week's rows. No React, no database.

export interface BudgetWindow {
  id: string;
  start_date: string;
  end_date: string;
}

/**
 * The budget an expense dated `date` belongs to: the one whose range contains
 * the date, the shortest range first (a month beats a quarter or a year).
 * The database applies the same rule in fn_budget_for_date.
 */
export function budgetForDate<T extends BudgetWindow>(budgets: T[], date: string): T | null {
  const covering = budgets.filter((b) => b.start_date && b.end_date && b.start_date <= date && b.end_date >= date);
  if (covering.length === 0) return null;
  const span = (b: BudgetWindow) => new Date(b.end_date).getTime() - new Date(b.start_date).getTime();
  return [...covering].sort((a, b) => span(a) - span(b))[0];
}

export interface BudgetAlert {
  level: 'near' | 'over';
  /** Share of the budget used once this spend is added, in percent. */
  pct: number;
  /** How far over, in kobo (0 unless level is 'over'). */
  overByMinor: bigint;
}

/** Warn at 80% of a budget and again once it is exceeded. */
export function budgetAlert(spentMinor: bigint, addMinor: bigint, totalMinor: bigint): BudgetAlert | null {
  if (totalMinor <= 0n || addMinor <= 0n) return null;
  const after = spentMinor + addMinor;
  const pct = Number((after * 1000n) / totalMinor) / 10;
  if (after > totalMinor) return { level: 'over', pct, overByMinor: after - totalMinor };
  if (after * 100n >= totalMinor * 80n) return { level: 'near', pct, overByMinor: 0n };
  return null;
}

/** EXP-20261123-K3QZ-07: one batch code, numbered per row. */
export const batchCode = (): string => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X');

export function autoReference(date: string, code: string, index?: number): string {
  const base = `EXP-${date.replace(/-/g, '')}-${code}`;
  return index === undefined ? base : `${base}-${String(index + 1).padStart(2, '0')}`;
}

/** Rows in a batch that share a date and an amount with an earlier row. */
export function duplicatesWithin(rows: { date: string; amountMinor: bigint }[]): Set<number> {
  const seen = new Map<string, number>();
  const dupes = new Set<number>();
  rows.forEach((r, i) => {
    if (r.amountMinor <= 0n) return;
    const key = `${r.date}|${r.amountMinor}`;
    if (seen.has(key)) {
      dupes.add(i);
      dupes.add(seen.get(key)!);
    } else {
      seen.set(key, i);
    }
  });
  return dupes;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + days);
  return iso(d);
}

/** Monday to Sunday of the week before the one containing `date`. */
export function previousWeek(date: string): { from: string; to: string } {
  const d = parse(date);
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday - 7);
  const from = iso(d);
  return { from, to: addDays(from, 6) };
}

export interface PriorExpense {
  date: string;
  amount_minor: number | null;
  amount?: number | null;
  description: string | null;
  category_id: string | null;
  payee_id: string | null;
  payee_name: string | null;
}

export interface CopiedRow {
  date: string;
  amount: string;
  description: string;
  categoryId: string;
  payeeId: string | null;
  payeeName: string;
}

/**
 * Last week's expenses as rows for this week: same lines, each moved forward
 * seven days (never past `latest`, since an expense cannot be dated ahead).
 * Amounts come across as a starting point and stay editable.
 */
export function rowsFromPriorWeek(prior: PriorExpense[], latest: string): CopiedRow[] {
  return [...prior]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => {
      const minor = e.amount_minor ?? Math.round(Number(e.amount ?? 0) * 100);
      const moved = addDays(e.date, 7);
      return {
        date: moved > latest ? latest : moved,
        amount: (minor / 100).toFixed(2).replace(/\.00$/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ','),
        description: e.description ?? '',
        categoryId: e.category_id ?? '',
        payeeId: e.payee_id,
        payeeName: e.payee_id ? '' : (e.payee_name ?? ''),
      };
    });
}
