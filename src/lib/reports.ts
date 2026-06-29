// Shared definitions and grading logic for the Staff Reports module.

export type ReportType = 'sales' | 'inventory' | 'expense' | 'credit' | 'kitchen' | 'operations';
export type Cadence = 'daily' | 'weekly' | 'monthly';
export type ReportStatus = 'submitted' | 'approved' | 'rejected' | 'converted';

export const REPORT_TYPES: Record<ReportType, { label: string; blurb: string; convertsTo: string | null }> = {
  sales:      { label: 'Sales Report',     blurb: 'Cash or transfer takings for the period.', convertsTo: 'Finance ledger (revenue)' },
  inventory:  { label: 'Inventory Report', blurb: 'Stock counts, usage and availability.',     convertsTo: null },
  expense:    { label: 'Expense Report',   blurb: 'Money spent — recorded only once approved.', convertsTo: 'Expense record' },
  credit:     { label: 'Credit Report',    blurb: 'Items bought on credit (unpaid) — from a supplier or otherwise.', convertsTo: 'Payables register' },
  kitchen:    { label: 'Kitchen Report',   blurb: 'Food prepared, quantities served and wastage for the day.', convertsTo: null },
  operations: { label: 'Operations Report', blurb: 'The general report: key activities, challenges, observations and suggestions.', convertsTo: null },
};

// ── Operations (general) report ──────────────────────────────────────────────
// A narrative report covering the day's running. Stored on details as plain text
// fields so it can be read back and rendered consistently.
export interface OperationsDetails {
  key_activities?: string;
  challenges?: string;
  observations?: string;
  suggestions?: string;
}

export const OPERATIONS_FIELDS: { key: keyof OperationsDetails; label: string; placeholder: string }[] = [
  { key: 'key_activities', label: 'Key activities', placeholder: 'What was done today — services, deliveries, events, staffing…' },
  { key: 'challenges',     label: 'Challenges',     placeholder: 'Problems faced — shortages, downtime, complaints…' },
  { key: 'observations',   label: 'Observations',   placeholder: 'Notable things you noticed — trends, customer feedback…' },
  { key: 'suggestions',    label: 'Suggestions',    placeholder: 'What you would improve or recommend.' },
];

// ── Credit report line items ─────────────────────────────────────────────────
// A credit report is a list of items bought on credit. Each item is either
// picked from the product list, typed in manually, or logged as miscellaneous.
// Credit may or may not come from a registered supplier.

export type CreditLineKind = 'product' | 'manual' | 'misc';

export interface CreditLine {
  kind?: CreditLineKind;
  product_id?: string | null;
  item: string;            // item description (product name, manual text, or "Miscellaneous")
  qty?: number | null;
  amount: number;
}

/** Human-readable summary of the items on a credit report — used in lists and on conversion. */
export function describeCreditItems(lines: CreditLine[] = []): string {
  return lines
    .map(l => `${(l.item || 'Miscellaneous').trim()}${l.qty ? ` ×${l.qty}` : ''}`)
    .filter(Boolean)
    .join(', ');
}

export const CADENCES: { value: Cadence; label: string }[] = [
  { value: 'daily',   label: 'Daily' },
  { value: 'weekly',  label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

/**
 * Timeliness score (0–100) from when a report was due vs when it was submitted.
 * On time → 100; each (started) day late costs 20 points, floored at 0.
 */
export function computeTimeliness(opts: {
  reportDate: string;          // YYYY-MM-DD the report is FOR
  submittedAt: string | Date;  // ISO timestamp
  dueTime?: string | null;     // 'HH:MM' expected submission time
}): number {
  const due = new Date(`${opts.reportDate}T${opts.dueTime ? opts.dueTime : '23:59:59'}`);
  const submitted = new Date(opts.submittedAt);
  const lateMs = submitted.getTime() - due.getTime();
  if (lateMs <= 0) return 100;
  const lateDays = Math.ceil(lateMs / 86_400_000);
  return Math.max(0, 100 - lateDays * 20);
}

/** Letter grade from a 0–100 score. */
export function gradeFromScore(score: number | null | undefined): string {
  if (score == null) return '—';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Overall performance: average of timeliness and the admin quality score.
 * Before review (no quality score yet) it reflects timeliness alone.
 */
export function combinePerformance(timeliness: number | null, quality: number | null): number | null {
  if (timeliness == null && quality == null) return null;
  if (quality == null) return timeliness;
  if (timeliness == null) return quality;
  return Math.round((timeliness + quality) / 2);
}

export function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return 'bg-green-100 text-green-700 border-green-200';
    case 'B': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'C': return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'D': return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'F': return 'bg-red-100 text-red-700 border-red-200';
    default:  return 'bg-muted text-muted-foreground border-border';
  }
}

// ── Performance summary ──────────────────────────────────────────────────────
// A compact roll-up of a staff member's (or the whole team's) report history.

export interface PerfReport {
  status: string;
  timeliness_score: number | null;
  performance_score: number | null;
}

export interface PerfSummary {
  total: number;
  pending: number;      // awaiting review
  approved: number;     // approved or converted
  rejected: number;
  onTime: number;       // submissions that met their due time
  onTimeRate: number | null;  // 0–100 over reports that carry a timeliness score
  avgScore: number | null;    // mean performance score
  grade: string;        // letter grade derived from avgScore
}

/** Roll a list of reports into the headline performance numbers. */
export function summarizePerformance(reports: PerfReport[]): PerfSummary {
  const total = reports.length;
  const pending = reports.filter(r => r.status === 'submitted').length;
  const approved = reports.filter(r => r.status === 'approved' || r.status === 'converted').length;
  const rejected = reports.filter(r => r.status === 'rejected').length;

  const timed = reports.filter(r => r.timeliness_score != null);
  const onTime = timed.filter(r => (r.timeliness_score as number) >= 100).length;
  const onTimeRate = timed.length ? Math.round((onTime / timed.length) * 100) : null;

  const scored = reports.filter(r => r.performance_score != null);
  const avgScore = scored.length
    ? Math.round(scored.reduce((s, r) => s + (r.performance_score as number), 0) / scored.length)
    : null;

  return { total, pending, approved, rejected, onTime, onTimeRate, avgScore, grade: gradeFromScore(avgScore) };
}

export const REPORT_STATUS_COLOR: Record<ReportStatus, string> = {
  submitted: 'bg-blue-100 text-blue-700 border-blue-200',
  approved:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  rejected:  'bg-red-100 text-red-700 border-red-200',
  converted: 'bg-violet-100 text-violet-700 border-violet-200',
};
