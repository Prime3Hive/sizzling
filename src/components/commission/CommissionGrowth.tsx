// Growth: sales month by month and week by week, against target.
//
// One measure (₦ sales) on one axis. Bars are sales, the dashed line is the
// target for that period (a month's target varies with its 4 or 5 weeks). The
// table below the chart is the same data in words — change vs the previous
// period carries a sign and an arrow, never colour alone.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterChips, StatTile, StatusPill } from '@/components/shell/ui';
import { formatNairaCompact, formatNairaShort } from '@/lib/currency';
import { cn } from '@/lib/utils';
import {
  commissionWeeks, computePeriod, growth, monthsEndingAt, weekResult, type CommissionSettings,
} from '@/lib/commission';

const db = supabase as any;
const MONTHS_SHOWN = 6;
const WEEKS_SHOWN = 12;

interface Point {
  key: string;
  label: string;
  detail: string;
  sales: number;
  target: number;
  pool: number;
  change: number | null;
  open: boolean;
}

/** Approved sales-report takings between two dates, less cancelled sales. */
function useCountedSales(from: string, to: string) {
  return useQuery({
    queryKey: ['commission-growth-sales', from, to],
    queryFn: async () => {
      const { data, error } = await db.from('staff_reports')
        .select('report_date, amount, converted_ref')
        .eq('report_type', 'sales').eq('status', 'converted')
        .gte('report_date', from).lte('report_date', to);
      if (error) throw error;
      const rows = (data ?? []) as { report_date: string; amount: number | null; converted_ref: string | null }[];
      const refs = rows.map((r) => r.converted_ref).filter(Boolean);
      let cancelled = new Set<string>();
      if (refs.length > 0) {
        const { data: sales } = await db.from('sales').select('id, status, cancelled_at').in('id', refs);
        cancelled = new Set((sales ?? []).filter((s: any) => s.status === 'cancelled' || s.cancelled_at).map((s: any) => s.id));
      }
      return rows
        .filter((r) => !(r.converted_ref && cancelled.has(r.converted_ref)))
        .map((r) => ({ report_date: r.report_date, amount: Number(r.amount || 0) }));
    },
  });
}

export default function CommissionGrowth({ month, settings }: { month: string; settings: CommissionSettings }) {
  const [view, setView] = useState<'months' | 'weeks'>('months');
  const today = format(new Date(), 'yyyy-MM-dd');

  const months = useMemo(() => monthsEndingAt(month, MONTHS_SHOWN), [month]);
  const from = commissionWeeks(months[0])[0]?.start ?? `${months[0]}-01`;
  const monthWeeks = commissionWeeks(month);
  const to = monthWeeks[monthWeeks.length - 1]?.end ?? `${month}-28`;
  const { data: sales = [], isLoading } = useCountedSales(from, to);

  const monthly: Point[] = useMemo(() => {
    const periods = months.map((m) => ({ m, p: computePeriod(m, sales, settings) }));
    return periods.map(({ m, p }, i) => {
      const weeks = commissionWeeks(m);
      return {
        key: m,
        label: format(parseISO(`${m}-01`), 'MMM'),
        detail: format(parseISO(`${m}-01`), 'MMMM yyyy'),
        sales: p.totalSales,
        target: p.monthlyTarget,
        pool: p.totalPool,
        change: i === 0 ? null : growth(p.totalSales, periods[i - 1].p.totalSales),
        open: (weeks[weeks.length - 1]?.end ?? '') >= today,
      };
    });
  }, [months, sales, settings, today]);

  const weekly: Point[] = useMemo(() => {
    const all = months.flatMap((m) => commissionWeeks(m)).map((w) => {
      const total = sales.filter((r) => r.report_date >= w.start && r.report_date <= w.end).reduce((t, r) => t + r.amount, 0);
      return weekResult(w, total, settings);
    });
    const shown = all.slice(-WEEKS_SHOWN);
    const offset = all.length - shown.length;
    return shown.map((w, i) => ({
      key: w.start,
      label: format(parseISO(w.end), 'd MMM'),
      detail: `${format(parseISO(w.start), 'd MMM')} – ${format(parseISO(w.end), 'd MMM yyyy')}`,
      sales: w.sales,
      target: settings.weekly_target,
      pool: w.total,
      change: offset + i === 0 ? null : growth(w.sales, all[offset + i - 1].sales),
      open: w.end >= today,
    }));
  }, [months, sales, settings, today]);

  const data = view === 'months' ? monthly : weekly;
  // Headline: the latest CLOSED period against the one before it.
  const lastClosed = (pts: Point[]) => [...pts].reverse().find((p) => !p.open) ?? null;
  const mClosed = lastClosed(monthly);
  const wClosed = lastClosed(weekly);
  const hitRate = (pts: Point[]) => {
    const closed = pts.filter((p) => !p.open);
    return closed.length ? `${closed.filter((p) => p.sales >= p.target).length} of ${closed.length}` : '—';
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div>
          <CardTitle className="text-base">Growth</CardTitle>
          <CardDescription>
            Counted sales for the {MONTHS_SHOWN} months to {format(parseISO(`${month}-01`), 'MMMM yyyy')}, against target.
          </CardDescription>
        </div>
        <FilterChips<"months" | "weeks"> label="Growth period" value={view} onChange={setView}
          options={[{ value: 'months', label: 'Months' }, { value: 'weeks', label: 'Weeks' }]} />
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Month on month" value={<Change value={mClosed?.change ?? null} />}
            sub={mClosed ? `${mClosed.detail} vs month before` : 'No closed month yet'} />
          <StatTile label="Week on week" value={<Change value={wClosed?.change ?? null} />}
            sub={wClosed ? `${wClosed.detail} vs week before` : 'No closed week yet'} />
          <StatTile label="Months on target" value={hitRate(monthly)} sub="closed months" />
          <StatTile label="Weeks on target" value={hitRate(weekly)} sub={`last ${WEEKS_SHOWN} weeks, closed`} />
        </div>

        {isLoading ? <Skeleton className="h-64" /> : (
          <>
            <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand" />Sales</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-foreground/60" />Target</span>
            </div>
            <div className="h-64" role="img"
              aria-label={`${view === 'months' ? 'Monthly' : 'Weekly'} sales against target; figures are in the table below.`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12}
                    tick={{ fill: 'hsl(var(--muted-foreground))' }} interval={0} minTickGap={4} />
                  <YAxis tickFormatter={formatNairaShort} tickLine={false} axisLine={false} fontSize={12} width={56}
                    tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip cursor={{ fill: 'hsl(var(--muted))', opacity: 0.6 }} content={<GrowthTooltip />} />
                  <Bar dataKey="sales" name="Sales" fill="hsl(var(--brand))" radius={[4, 4, 0, 0]} maxBarSize={44} />
                  <Line dataKey="target" name="Target" type="stepAfter" stroke="hsl(var(--foreground))" strokeOpacity={0.6}
                    strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">{view === 'months' ? 'Month' : 'Week'}</th>
                    <th className="py-2 pr-3 text-right font-semibold">Sales</th>
                    <th className="py-2 pr-3 text-right font-semibold">vs previous</th>
                    <th className="py-2 pr-3 text-right font-semibold">Of target</th>
                    <th className="py-2 pr-3 text-right font-semibold">Commission pool</th>
                    <th className="py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data].reverse().map((p) => (
                    <tr key={p.key} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{p.detail}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatNairaCompact(p.sales)}</td>
                      <td className="py-2 pr-3 text-right"><Change value={p.change} small /></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.target > 0 ? `${((p.sales / p.target) * 100).toFixed(0)}%` : '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatNairaCompact(p.pool)}</td>
                      <td className="py-2">
                        {p.open ? <StatusPill tone="info" label="In progress" />
                          : p.sales >= p.target ? <StatusPill tone="good" label="On target" />
                          : <StatusPill tone="pending" label="Below target" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Pools here use the current criteria for comparison; an approved month pays what was approved.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** A change figure with sign + arrow, so direction never relies on colour. */
function Change({ value, small }: { value: number | null; small?: boolean }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const up = value > 0.0005;
  const down = value < -0.0005;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 tabular-nums',
      small ? 'text-sm font-medium' : '',
      up ? 'text-emerald-700 dark:text-emerald-400' : down ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground',
    )}>
      <Icon className={small ? 'h-3.5 w-3.5' : 'h-5 w-5'} aria-hidden />
      {up ? '+' : down ? '−' : ''}{Math.abs(value * 100).toFixed(1)}%
    </span>
  );
}

function GrowthTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="mb-1 font-semibold">{p.detail}{p.open ? ' (in progress)' : ''}</div>
      <div className="flex justify-between gap-6"><span className="text-muted-foreground">Sales</span><span className="tabular-nums font-medium">{formatNairaCompact(p.sales)}</span></div>
      <div className="flex justify-between gap-6"><span className="text-muted-foreground">Target</span><span className="tabular-nums">{formatNairaCompact(p.target)}</span></div>
      <div className="flex justify-between gap-6"><span className="text-muted-foreground">vs previous</span><Change value={p.change} small /></div>
    </div>
  );
}
