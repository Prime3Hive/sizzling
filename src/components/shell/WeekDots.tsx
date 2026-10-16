import { format, parseISO } from 'date-fns';
import { ATTENDANCE_STATUSES, statusLabel, type AttendanceStatus } from '@/lib/attendance';
import { cn } from '@/lib/utils';

const DOT: Partial<Record<AttendanceStatus, string>> = {
  present: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  late: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  half_day: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  absent: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  excused: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  on_leave: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
};

/** One square per day with the grid's letter code; the full word is in the label. */
export function WeekDots({ days, size = 'md' }: {
  days: { date: string; status: string | null }[];
  size?: 'md' | 'lg';
}) {
  return (
    <ul className="flex gap-2" aria-label="This week's attendance">
      {days.map((d) => {
        const meta = d.status ? ATTENDANCE_STATUSES[d.status as AttendanceStatus] : null;
        const day = format(parseISO(d.date), 'EEE');
        return (
          <li key={d.date} className="flex flex-col items-center gap-1.5" aria-label={`${day}: ${statusLabel(d.status)}`}>
            <span
              aria-hidden
              className={cn(
                'inline-flex items-center justify-center rounded-[10px] text-xs font-bold',
                size === 'lg' ? 'h-10 w-10' : 'h-8 w-8',
                (d.status && DOT[d.status as AttendanceStatus]) || 'bg-muted text-muted-foreground',
              )}
            >
              {meta?.code ?? '–'}
            </span>
            <span aria-hidden className="text-[11.5px] font-semibold text-muted-foreground">{day}</span>
          </li>
        );
      })}
    </ul>
  );
}
