// Yearly leave allowance. One definition, so the leave form, Home and Me all
// count the same way.

export const SICK_LIMIT = 4;       // occurrences per year
export const CASUAL_LIMIT = 14;    // days per year

export interface LeaveRow {
  leave_type: string;
  start_date: string;
  end_date: string;
  status: string;
}

export const leaveDays = (start: string, end: string) =>
  Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;

/** Usage for the year from pending + approved requests, as the form counts it. */
export function leaveUsage(rows: LeaveRow[]) {
  const counted = rows.filter((r) => r.status === 'pending' || r.status === 'approved');
  const sickUsed = counted.filter((r) => r.leave_type === 'sick').length;
  const casualDaysUsed = counted
    .filter((r) => r.leave_type === 'casual')
    .reduce((sum, r) => sum + leaveDays(r.start_date, r.end_date), 0);
  return {
    sickUsed,
    sickRemaining: SICK_LIMIT - sickUsed,
    casualDaysUsed,
    casualDaysRemaining: CASUAL_LIMIT - casualDaysUsed,
  };
}
