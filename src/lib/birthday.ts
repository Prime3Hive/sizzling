// Birthday maths, shared by the calendar, dashboard, notifications and profiles.
//
// Two things the old inline versions got wrong:
//  - `new Date("1990-10-04")` is parsed as UTC midnight, so west of Greenwich
//    it lands on the previous day. A DOB is a calendar date, not an instant —
//    it is split into parts and built in local time here.
//  - Countdowns compared a midnight birthday against `new Date()` (now, with a
//    time of day). Today's birthday was already "past" and rolled to next year,
//    and late in the evening tomorrow's rounded down to 0 ("Today!"). Every
//    comparison here is between two local midnights.

const MS_PER_DAY = 86_400_000;

/** Parse a `YYYY-MM-DD` (or ISO timestamp) date of birth into its parts. */
export function parseDob(dob: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return null;
  return { year: +m[1], month: +m[2] - 1, day: +m[3] };
}

/** The DOB as a local-midnight Date (for display), or null if unparseable. */
export function dobAsDate(dob: string): Date | null {
  const p = parseDob(dob);
  return p ? new Date(p.year, p.month, p.day) : null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The birthday as it falls in `year` — 29 Feb is kept on 28 Feb in common years. */
function birthdayIn(year: number, month: number, day: number): Date {
  if (month === 1 && day === 29 && !isLeap(year)) return new Date(year, 1, 28);
  return new Date(year, month, day);
}

/** Whole calendar days between two dates, ignoring time of day and DST shifts. */
function dayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

export interface NextBirthday {
  /** Local midnight of the next birthday (today's, if it is today). */
  date: Date;
  /** 0 = today, 1 = tomorrow, … */
  daysUntil: number;
  /** Age the person turns on that date. */
  turning: number;
}

export function nextBirthday(dob: string, now: Date = new Date()): NextBirthday | null {
  const p = parseDob(dob);
  if (!p) return null;
  const today = startOfDay(now);
  let date = birthdayIn(today.getFullYear(), p.month, p.day);
  if (date < today) date = birthdayIn(today.getFullYear() + 1, p.month, p.day);
  return { date, daysUntil: dayDiff(today, date), turning: date.getFullYear() - p.year };
}

export function isBirthdayToday(dob: string, now: Date = new Date()): boolean {
  return nextBirthday(dob, now)?.daysUntil === 0;
}

/** Whether the birthday falls on `day` of `month` (0-based) in `year`. */
export function isBirthdayOn(dob: string, year: number, month: number, day: number): boolean {
  const p = parseDob(dob);
  if (!p) return false;
  const d = birthdayIn(year, p.month, p.day);
  return d.getMonth() === month && d.getDate() === day;
}

/** "Today", "Tomorrow", "In 5 days", "In 3 weeks", "In 2 months". */
export function countdownLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  if (daysUntil < 14) return `In ${daysUntil} days`;
  if (daysUntil < 60) return `In ${Math.round(daysUntil / 7)} weeks`;
  const months = Math.round(daysUntil / 30.44);
  return months <= 1 ? "In a month" : `In ${months} months`;
}

/** "Sat, 4 Oct" */
export function formatBirthdayShort(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** "4 October 1995" */
export function formatDob(dob: string): string | null {
  const d = dobAsDate(dob);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
}
