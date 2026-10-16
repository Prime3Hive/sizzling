// Staff sales commission — the arithmetic.
//
// This mirrors fn_approve_commission_period (migration 20260930100000) line
// for line, so what the dashboard previews is what approval books. The
// database recomputes everything on approval; nothing here is trusted by it.
//
// • Weeks run Monday–Sunday (as attendance and Weekly Sales do). A week
//   belongs to the month its Sunday falls in, so a month has 4 or 5 whole
//   weeks and no week is counted in two months.
// • Week below target → nothing. At or above → flat % of the TARGET plus
//   excess % of every naira above it.
// • Month at or above weekly target × weeks → pool lifted by the escalator %.
// • Pool splits by group share, then equally among the group's active staff,
//   rounded DOWN to the kobo so the total paid never exceeds the pool.

export type CommissionGroup = 'sales' | 'management' | 'kitchen' | 'operations';

export const COMMISSION_GROUPS: { key: CommissionGroup; label: string }[] = [
  { key: 'sales', label: 'Sales / CSR' },
  { key: 'management', label: 'Management' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'operations', label: 'Operations' },
];

export const groupLabel = (g: string): string =>
  COMMISSION_GROUPS.find((x) => x.key === g)?.label ?? g;

export interface CommissionSettings {
  weekly_target: number;
  /** Percentages: 1 = 1%. */
  flat_rate: number;
  excess_rate: number;
  escalator_rate: number;
  group_shares: Record<CommissionGroup, number>;
  /** departments.id → group; anything missing is not eligible. */
  department_groups: Record<string, CommissionGroup | 'none'>;
}

export const DEFAULT_SETTINGS: CommissionSettings = {
  weekly_target: 5_000_000,
  flat_rate: 1,
  excess_rate: 3,
  escalator_rate: 20,
  group_shares: { sales: 20, management: 20, kitchen: 40, operations: 20 },
  department_groups: {},
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const floor2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100;

// ── Calendar ─────────────────────────────────────────────────────────────────

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface CommissionWeek { week: number; start: string; end: string }

/** The Monday–Sunday weeks whose Sunday falls in `month` ("YYYY-MM"). */
export function commissionWeeks(month: string): CommissionWeek[] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const sunday = new Date(first);
  sunday.setDate(first.getDate() + ((7 - first.getDay()) % 7));
  const weeks: CommissionWeek[] = [];
  for (let d = sunday, i = 1; d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7), i++) {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6);
    weeks.push({ week: i, start: iso(start), end: iso(d) });
  }
  return weeks;
}

export const monthValue = (d: Date = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// ── Pool ─────────────────────────────────────────────────────────────────────

export interface WeekResult extends CommissionWeek {
  sales: number;
  hit: boolean;
  flat: number;
  /** Naira above target (the base the excess rate applies to). */
  excessSales: number;
  excess: number;
  total: number;
}

export function weekResult(week: CommissionWeek, sales: number, s: CommissionSettings): WeekResult {
  const hit = sales >= s.weekly_target;
  const flat = hit ? round2(s.weekly_target * s.flat_rate / 100) : 0;
  const excessSales = hit ? sales - s.weekly_target : 0;
  const excess = hit ? round2(excessSales * s.excess_rate / 100) : 0;
  return { ...week, sales, hit, flat, excessSales, excess, total: flat + excess };
}

export interface PeriodResult {
  weeks: WeekResult[];
  totalSales: number;
  monthlyTarget: number;
  attainment: number;
  flatTotal: number;
  excessTotal: number;
  basePool: number;
  escalatorHit: boolean;
  escalatorBonus: number;
  totalPool: number;
  /** Pool if every week just hit target — the "full-month potential" base. */
  basePotential: number;
}

export interface SalesEntry { report_date: string; amount: number }

export function computePeriod(month: string, sales: SalesEntry[], s: CommissionSettings): PeriodResult {
  const weeks = commissionWeeks(month).map((w) => {
    const total = sales
      .filter((r) => r.report_date >= w.start && r.report_date <= w.end)
      .reduce((t, r) => t + Number(r.amount || 0), 0);
    return weekResult(w, total, s);
  });
  const totalSales = weeks.reduce((t, w) => t + w.sales, 0);
  const monthlyTarget = s.weekly_target * weeks.length;
  const flatTotal = weeks.reduce((t, w) => t + w.flat, 0);
  const excessTotal = weeks.reduce((t, w) => t + w.excess, 0);
  const basePool = flatTotal + excessTotal;
  const escalatorHit = weeks.length > 0 && totalSales >= monthlyTarget;
  const escalatorBonus = escalatorHit ? round2(basePool * s.escalator_rate / 100) : 0;
  return {
    weeks,
    totalSales,
    monthlyTarget,
    attainment: monthlyTarget > 0 ? totalSales / monthlyTarget : 0,
    flatTotal,
    excessTotal,
    basePool,
    escalatorHit,
    escalatorBonus,
    totalPool: basePool + escalatorBonus,
    basePotential: round2(s.weekly_target * s.flat_rate / 100) * weeks.length,
  };
}

// ── Allocation ───────────────────────────────────────────────────────────────

export interface EligibleStaff {
  id: string;
  full_name: string;
  department_id: string | null;
  department?: string | null;
}

export interface GroupAllocation {
  group: CommissionGroup;
  label: string;
  share: number;
  pool: number;
  staff: EligibleStaff[];
  perPerson: number;
  /** perPerson × headcount — what is actually paid for this group. */
  allocated: number;
}

export function groupOf(s: CommissionSettings, departmentId: string | null): CommissionGroup | null {
  if (!departmentId) return null;
  const g = s.department_groups[departmentId];
  return g && g !== 'none' ? g : null;
}

export function allocate(totalPool: number, staff: EligibleStaff[], s: CommissionSettings): GroupAllocation[] {
  return COMMISSION_GROUPS.map(({ key, label }) => {
    const share = Number(s.group_shares[key] ?? 0);
    const members = staff.filter((p) => groupOf(s, p.department_id) === key);
    const pool = totalPool * share / 100;
    const perPerson = members.length > 0 && share > 0 ? floor2(pool / members.length) : 0;
    return { group: key, label, share, pool, staff: members, perPerson, allocated: round2(perPerson * members.length) };
  });
}

export const sharesTotal = (s: CommissionSettings): number =>
  COMMISSION_GROUPS.reduce((t, g) => t + Number(s.group_shares[g.key] ?? 0), 0);

/** Best guess at a department's group from its name; admins can override. */
export function guessGroup(departmentName: string): CommissionGroup | 'none' {
  const n = departmentName.toLowerCase();
  if (/(sales|csr|customer)/.test(n)) return 'sales';
  if (/(manage|admin)/.test(n)) return 'management';
  if (/(kitchen|chef|cook|culinary)/.test(n)) return 'kitchen';
  if (/(operation|logistic|inventory|store|driver)/.test(n)) return 'operations';
  return 'none';
}

/** Normalise a settings row from the database (numerics arrive as strings). */
export function settingsFromRow(row: any | null | undefined): CommissionSettings {
  if (!row) return DEFAULT_SETTINGS;
  const shares = row.group_shares ?? {};
  return {
    weekly_target: Number(row.weekly_target ?? DEFAULT_SETTINGS.weekly_target),
    flat_rate: Number(row.flat_rate ?? DEFAULT_SETTINGS.flat_rate),
    excess_rate: Number(row.excess_rate ?? DEFAULT_SETTINGS.excess_rate),
    escalator_rate: Number(row.escalator_rate ?? DEFAULT_SETTINGS.escalator_rate),
    group_shares: {
      sales: Number(shares.sales ?? 0),
      management: Number(shares.management ?? 0),
      kitchen: Number(shares.kitchen ?? 0),
      operations: Number(shares.operations ?? 0),
    },
    department_groups: { ...(row.department_groups ?? {}) },
  };
}

// ── Growth ───────────────────────────────────────────────────────────────────

/** Change from `prev` to `curr` as a fraction (0.12 = +12%); null when there is no base. */
export function growth(curr: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || prev <= 0) return null;
  return (curr - prev) / prev;
}

/** The `count` months ending at `month` ("YYYY-MM"), oldest first. */
export function monthsEndingAt(month: string, count: number): string[] {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => monthValue(new Date(y, m - 1 - (count - 1 - i), 1)));
}
