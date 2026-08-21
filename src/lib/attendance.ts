// Shared definitions for the Attendance module — mirrors the CHECK constraints
// and the two closing windows in 20260821100000_attendance.sql. The database is
// the authority on all of it; this file exists so the UI can say the same thing
// before the round trip.

export type AttendanceStatus =
  | 'present' | 'late' | 'half_day' | 'absent'
  | 'excused' | 'on_leave' | 'holiday' | 'off_day';

export type WeekStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

interface StatusMeta {
  label: string;
  /** Single letter for the marking grid, where a whole week has to fit a screen. */
  code: string;
  /** Counts towards days worked in the summary. */
  worked: boolean;
  /** Neither worked nor held against anyone — off days, public holidays. */
  neutral: boolean;
  color: string;
}

export const ATTENDANCE_STATUSES: Record<AttendanceStatus, StatusMeta> = {
  present:  { label: 'Present',    code: 'P', worked: true,  neutral: false, color: 'bg-success/10 text-success border-success/20' },
  late:     { label: 'Late',       code: 'L', worked: true,  neutral: false, color: 'bg-warning/10 text-warning border-warning/20' },
  half_day: { label: 'Half day',   code: 'H', worked: true,  neutral: false, color: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800' },
  absent:   { label: 'Absent',     code: 'A', worked: false, neutral: false, color: 'bg-destructive/10 text-destructive border-destructive/20' },
  excused:  { label: 'Excused',    code: 'E', worked: false, neutral: true,  color: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800' },
  on_leave: { label: 'On leave',   code: 'V', worked: false, neutral: true,  color: 'bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800' },
  holiday:  { label: 'Holiday',    code: 'X', worked: false, neutral: true,  color: 'bg-muted text-muted-foreground border-border' },
  off_day:  { label: 'Off day',    code: 'O', worked: false, neutral: true,  color: 'bg-muted text-muted-foreground border-border' },
};

export const ATTENDANCE_STATUS_LIST = Object.keys(ATTENDANCE_STATUSES) as AttendanceStatus[];

export const statusLabel = (s: string | null | undefined): string =>
  s ? (ATTENDANCE_STATUSES[s as AttendanceStatus]?.label ?? s) : 'Not marked';

export const statusColor = (s: string | null | undefined): string =>
  (s && ATTENDANCE_STATUSES[s as AttendanceStatus]?.color) || 'bg-muted text-muted-foreground border-border';

export const WEEK_STATUS_COLOR: Record<WeekStatus, string> = {
  draft:     'bg-muted text-muted-foreground border-border',
  submitted: 'bg-warning/10 text-warning border-warning/20',
  approved:  'bg-success/10 text-success border-success/20',
  rejected:  'bg-destructive/10 text-destructive border-destructive/20',
};

export const WEEK_STATUS_LABEL: Record<WeekStatus, string> = {
  draft:     'Draft',
  submitted: 'Awaiting approval',
  approved:  'Approved',
  rejected:  'Sent back',
};

export const REVIEW_STATUS_COLOR: Record<ReviewStatus, string> = {
  pending:   'bg-warning/10 text-warning border-warning/20',
  approved:  'bg-success/10 text-success border-success/20',
  rejected:  'bg-destructive/10 text-destructive border-destructive/20',
  withdrawn: 'bg-muted text-muted-foreground border-border',
};

// ── Dates ────────────────────────────────────────────────────────────────────
// Weeks run Monday to Sunday, matching date_trunc('week', …) in Postgres and
// the "This Week" range the finance report already uses.

const iso = (d: Date): string => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

/** Monday of the week a date falls in, as YYYY-MM-DD. */
export function weekStartOf(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : new Date(date);
  const day = d.getDay();                 // 0 = Sunday
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return iso(d);
}

/** The seven dates of a week, given its Monday. */
export function weekDays(weekStart: string): string[] {
  const start = new Date(`${weekStart}T00:00:00`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return iso(d);
  });
}

export const addWeeks = (weekStart: string, n: number): string => {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setDate(d.getDate() + n * 7);
  return iso(d);
};

export const todayIso = (): string => iso(new Date());

/** First and last day of the month a date falls in. */
export function monthBounds(monthValue: string): { start: string; end: string } {
  const [y, m] = monthValue.split('-').map(Number);
  return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
}

export const monthValueOf = (date: Date | string = new Date()): string => {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Can a staff member still challenge this day?
 *
 * Mirrors fn_attendance_review_open: the day must fall in the running month.
 * The database also refuses once payroll has sealed the period, which the
 * client cannot see from a date alone — so treat a `true` here as "worth
 * offering the button", not as permission.
 */
export function reviewWindowOpen(workDate: string): boolean {
  return monthValueOf(workDate) === monthValueOf();
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface AttendanceDay { status: string }

export interface AttendanceSummary {
  total: number;
  /** Days that were expected to be worked — excludes holidays and off days. */
  expected: number;
  worked: number;
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  excused: number;
  onLeave: number;
  /** Worked as a share of expected, 0–100. Null when nothing was expected. */
  rate: number | null;
}

export function summarizeAttendance(days: AttendanceDay[]): AttendanceSummary {
  const count = (s: AttendanceStatus) => days.filter(d => d.status === s).length;
  const expected = days.filter(d => !ATTENDANCE_STATUSES[d.status as AttendanceStatus]?.neutral).length;
  const worked = days.filter(d => ATTENDANCE_STATUSES[d.status as AttendanceStatus]?.worked).length;

  return {
    total: days.length,
    expected,
    worked,
    present: count('present'),
    late: count('late'),
    halfDay: count('half_day'),
    absent: count('absent'),
    excused: count('excused'),
    onLeave: count('on_leave'),
    rate: expected > 0 ? Math.round((worked / expected) * 100) : null,
  };
}

export function rateColor(rate: number | null): string {
  if (rate == null) return 'text-muted-foreground';
  if (rate >= 95) return 'text-success';
  if (rate >= 80) return 'text-warning';
  return 'text-destructive';
}
