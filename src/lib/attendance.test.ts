import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  weekStartOf, weekDays, addWeeks, monthBounds, monthValueOf,
  reviewWindowOpen, summarizeAttendance, statusLabel,
  type AttendanceStatus,
} from './attendance';

const day = (status: AttendanceStatus) => ({ status });

afterEach(() => vi.useRealTimers());

// The client's idea of a week has to match date_trunc('week', …) in
// fn_attendance_week_start, or HR marks days into a week the database will not
// accept them in.
describe('weekStartOf — weeks begin on Monday', () => {
  it('returns the day itself for a Monday', () => {
    expect(weekStartOf('2026-08-17')).toBe('2026-08-17'); // a Monday
  });

  it('walks back from mid-week', () => {
    expect(weekStartOf('2026-08-19')).toBe('2026-08-17'); // Wednesday
    expect(weekStartOf('2026-08-22')).toBe('2026-08-17'); // Saturday
  });

  it('puts Sunday at the END of its week, not the start', () => {
    // The trap: getDay() === 0 for Sunday, so a naive subtraction lands a week early.
    expect(weekStartOf('2026-08-23')).toBe('2026-08-17');
  });

  it('crosses a month boundary', () => {
    expect(weekStartOf('2026-09-01')).toBe('2026-08-31'); // Tue → Mon in August
  });

  it('crosses a year boundary', () => {
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28'); // Fri → Mon in December
  });

  it('is stable when applied twice', () => {
    for (const d of ['2026-08-17', '2026-08-19', '2026-08-23', '2026-02-29']) {
      expect(weekStartOf(weekStartOf(d))).toBe(weekStartOf(d));
    }
  });
});

describe('weekDays', () => {
  it('gives seven consecutive dates from the Monday', () => {
    expect(weekDays('2026-08-17')).toEqual([
      '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
      '2026-08-21', '2026-08-22', '2026-08-23',
    ]);
  });

  it('spans a month end without repeating or skipping a day', () => {
    const week = weekDays('2026-08-31');
    expect(week).toHaveLength(7);
    expect(week[0]).toBe('2026-08-31');
    expect(week[6]).toBe('2026-09-06');
    expect(new Set(week).size).toBe(7);
  });
});

describe('addWeeks', () => {
  it('steps forwards and backwards by whole weeks', () => {
    expect(addWeeks('2026-08-17', 1)).toBe('2026-08-24');
    expect(addWeeks('2026-08-17', -1)).toBe('2026-08-10');
    expect(addWeeks('2026-08-17', 0)).toBe('2026-08-17');
  });

  it('stays on a Monday across a year boundary', () => {
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04');
    expect(weekStartOf(addWeeks('2026-12-28', 1))).toBe('2027-01-04');
  });
});

describe('monthBounds', () => {
  it('covers a 31-day month', () => {
    expect(monthBounds('2026-08')).toEqual({ start: '2026-08-01', end: '2026-08-31' });
  });

  it('covers a 30-day month', () => {
    expect(monthBounds('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('gets February right in a leap year and a common one', () => {
    expect(monthBounds('2028-02').end).toBe('2028-02-29');
    expect(monthBounds('2026-02').end).toBe('2026-02-28');
  });

  it('covers December without rolling into the next year', () => {
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });
});

describe('monthValueOf', () => {
  it('zero-pads single-digit months', () => {
    expect(monthValueOf('2026-03-09')).toBe('2026-03');
    expect(monthValueOf('2026-11-09')).toBe('2026-11');
  });
});

// "No review can be done after that month is past" — the UI half of the rule.
// fn_attendance_review_open enforces it for real, and also closes the window
// once payroll seals the period, which a date alone cannot tell you.
describe('reviewWindowOpen', () => {
  it('is open for a day in the running month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21)); // 21 Aug 2026
    expect(reviewWindowOpen('2026-08-01')).toBe(true);
    expect(reviewWindowOpen('2026-08-21')).toBe(true);
    expect(reviewWindowOpen('2026-08-31')).toBe(true);
  });

  it('is shut the moment the month turns', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 1)); // 1 Sep 2026
    expect(reviewWindowOpen('2026-08-31')).toBe(false);
    expect(reviewWindowOpen('2026-09-01')).toBe(true);
  });

  it('is shut for the same month a year earlier', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 21));
    expect(reviewWindowOpen('2025-08-21')).toBe(false);
  });
});

describe('summarizeAttendance', () => {
  it('counts late and half days as worked', () => {
    const s = summarizeAttendance([day('present'), day('late'), day('half_day')]);
    expect(s.worked).toBe(3);
    expect(s.expected).toBe(3);
    expect(s.rate).toBe(100);
  });

  it('leaves holidays and off days out of the denominator', () => {
    // 4 present + 1 absent out of 5 expected; the weekend does not count against anyone.
    const s = summarizeAttendance([
      day('present'), day('present'), day('present'), day('present'),
      day('absent'), day('off_day'), day('holiday'),
    ]);
    expect(s.total).toBe(7);
    expect(s.expected).toBe(5);
    expect(s.worked).toBe(4);
    expect(s.rate).toBe(80);
  });

  it('treats leave and excused absence as neutral, not as a missed day', () => {
    const s = summarizeAttendance([day('present'), day('on_leave'), day('excused')]);
    expect(s.expected).toBe(1);
    expect(s.rate).toBe(100);
    expect(s.onLeave).toBe(1);
    expect(s.excused).toBe(1);
  });

  it('reports no rate rather than zero when nothing was expected', () => {
    expect(summarizeAttendance([]).rate).toBeNull();
    expect(summarizeAttendance([day('holiday'), day('off_day')]).rate).toBeNull();
  });

  it('rounds the rate to a whole percent', () => {
    const s = summarizeAttendance([day('present'), day('present'), day('absent')]);
    expect(s.rate).toBe(67);
  });
});

describe('statusLabel', () => {
  it('names an unmarked day rather than showing a blank', () => {
    expect(statusLabel(null)).toBe('Not marked');
    expect(statusLabel(undefined)).toBe('Not marked');
  });

  it('falls back to the raw value for a status it does not know', () => {
    expect(statusLabel('suspended')).toBe('suspended');
  });
});
