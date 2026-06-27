// Shared definitions and grading logic for the Staff Reports module.

export type ReportType = 'sales' | 'inventory' | 'expense' | 'credit';
export type Cadence = 'daily' | 'weekly' | 'monthly';
export type ReportStatus = 'submitted' | 'approved' | 'rejected' | 'converted';

export const REPORT_TYPES: Record<ReportType, { label: string; blurb: string; convertsTo: string | null }> = {
  sales:     { label: 'Sales Report',     blurb: 'Cash or transfer takings for the period.', convertsTo: 'Finance ledger (revenue)' },
  inventory: { label: 'Inventory Report', blurb: 'Stock counts, usage and availability.',     convertsTo: null },
  expense:   { label: 'Expense Report',   blurb: 'Money spent — recorded only once approved.', convertsTo: 'Expense record' },
  credit:    { label: 'Credit Report',    blurb: 'Purchases made on credit (unpaid).',         convertsTo: 'Payables register' },
};

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

export const REPORT_STATUS_COLOR: Record<ReportStatus, string> = {
  submitted: 'bg-blue-100 text-blue-700 border-blue-200',
  approved:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  rejected:  'bg-red-100 text-red-700 border-red-200',
  converted: 'bg-violet-100 text-violet-700 border-violet-200',
};
