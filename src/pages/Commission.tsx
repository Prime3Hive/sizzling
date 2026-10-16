import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleDollarSign, Clock, Loader2, Settings2, Target, TrendingUp, Undo2, Users,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ui/responsive-table';
import { EmptyState, Meter, PageHeader, SidePanel, StatTile, StatusPill } from '@/components/shell/ui';
import CommissionGrowth from '@/components/commission/CommissionGrowth';
import { formatNairaCompact, formatNairaShort } from '@/lib/currency';
import { cn } from '@/lib/utils';
import {
  COMMISSION_GROUPS, allocate, commissionWeeks, computePeriod, groupLabel, guessGroup, monthValue,
  settingsFromRow, sharesTotal, weekResult,
  type CommissionGroup, type CommissionSettings, type EligibleStaff, type WeekResult,
} from '@/lib/commission';
import {
  useCommissionSettings, type CommissionPayoutRow, type CommissionPeriodRow,
} from '@/hooks/useCommission';

const db = supabase as any;
const N = formatNairaCompact;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const rate = (n: number) => `${Number(n).toFixed(n % 1 === 0 ? 0 : 1)}%`;
const todayIso = () => format(new Date(), 'yyyy-MM-dd');

interface SalesReport {
  id: string;
  user_id: string;
  report_date: string;
  amount: number | null;
  status: string;
  title: string | null;
  converted_ref: string | null;
}

interface WeekRow extends WeekResult { expenses: number; reports: SalesReport[] }

/** The last 12 months, newest first, as "YYYY-MM". */
const monthOptions = (() => {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) out.push(monthValue(new Date(d.getFullYear(), d.getMonth() - i, 1)));
  return out;
})();

export default function Commission() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [month, setMonth] = useState(monthOptions[0]);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [openWeek, setOpenWeek] = useState<WeekRow | null>(null);

  const weeks = useMemo(() => commissionWeeks(month), [month]);
  const periodStart = weeks[0]?.start ?? `${month}-01`;
  const periodEnd = weeks[weeks.length - 1]?.end ?? `${month}-28`;
  const weeksClosed = periodEnd < todayIso();

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data: saved, isLoading: settingsLoading } = useCommissionSettings();
  const [draft, setDraft] = useState<CommissionSettings | null>(null);
  useEffect(() => { if (saved && !draft) setDraft(saved.settings); }, [saved, draft]);

  const { data: departments = [] } = useQuery({
    queryKey: ['commission-departments'],
    queryFn: async () => {
      const { data, error } = await db.from('departments').select('id, name').order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const { data: staff = [] } = useQuery({
    queryKey: ['commission-staff'],
    queryFn: async () => {
      const { data, error } = await db.from('staff_profiles')
        .select('id, full_name, department_id, departments(name)')
        .eq('employment_status', 'active')
        .order('full_name');
      if (error) throw error;
      return (data ?? []).map((s: any) => ({
        id: s.id, full_name: s.full_name, department_id: s.department_id, department: s.departments?.name ?? null,
      })) as EligibleStaff[];
    },
  });

  const { data: reports = [], isLoading: reportsLoading } = useQuery({
    queryKey: ['commission-sales-reports', periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await db.from('staff_reports')
        .select('id, user_id, report_date, amount, status, title, converted_ref')
        .eq('report_type', 'sales')
        .gte('report_date', periodStart).lte('report_date', periodEnd)
        .order('report_date');
      if (error) throw error;
      const rows = (data ?? []) as SalesReport[];
      // A report whose sale was later cancelled no longer counts.
      const refs = rows.map((r) => r.converted_ref).filter(Boolean);
      if (refs.length === 0) return rows;
      const { data: sales } = await db.from('sales').select('id, status, cancelled_at').in('id', refs);
      const cancelled = new Set(
        (sales ?? []).filter((s: any) => s.status === 'cancelled' || s.cancelled_at).map((s: any) => s.id),
      );
      return rows.map((r) => (r.converted_ref && cancelled.has(r.converted_ref) ? { ...r, status: 'cancelled' } : r));
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ['profiles-min'],
    queryFn: async () => {
      const { data, error } = await db.from('profiles').select('user_id, full_name');
      if (error) throw error;
      return (data ?? []) as { user_id: string; full_name: string }[];
    },
  });
  const nameOf = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.user_id, p.full_name]));
    return (id: string) => m.get(id) ?? 'Staff member';
  }, [profiles]);

  const { data: expenses = [] } = useQuery({
    queryKey: ['commission-expenses', periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await db.from('expenses')
        .select('amount, date')
        .eq('status', 'approved')
        .gte('date', periodStart).lte('date', periodEnd);
      if (error) throw error;
      return (data ?? []) as { amount: number; date: string }[];
    },
  });

  const { data: period, isLoading: periodLoading } = useQuery({
    queryKey: ['commission-period', month],
    queryFn: async () => {
      const { data, error } = await db.from('commission_periods')
        .select('*').eq('period_month', `${month}-01`).eq('status', 'approved').maybeSingle();
      if (error) throw error;
      return (data ?? null) as CommissionPeriodRow | null;
    },
  });

  const { data: payouts = [] } = useQuery({
    queryKey: ['commission-payouts', period?.id],
    enabled: !!period,
    queryFn: async () => {
      const { data, error } = await db.from('commission_payouts')
        .select('*, payroll_records(status, cancelled_at)')
        .eq('period_id', period!.id)
        .order('staff_name');
      if (error) throw error;
      return (data ?? []) as (CommissionPayoutRow & { payroll_records: { status: string; cancelled_at: string | null } | null })[];
    },
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const approved = !!period;
  const liveSettings = draft ?? saved?.settings ?? null;
  // An approved month is shown exactly as it was booked: its own criteria.
  const settings: CommissionSettings | null = approved ? settingsFromRow(period!.settings) : liveSettings;
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved.settings);

  const counted = reports.filter((r) => r.status === 'converted');
  const pending = reports.filter((r) => r.status === 'submitted');
  const pendingTotal = pending.reduce((t, r) => t + Number(r.amount || 0), 0);

  const live = useMemo(
    () => (settings ? computePeriod(month, counted.map((r) => ({ report_date: r.report_date, amount: Number(r.amount || 0) })), settings) : null),
    [month, counted, settings],
  );

  const result = useMemo(() => {
    if (!live || !settings) return null;
    if (!approved) return live;
    // Rebuild the booked weeks from the snapshot.
    const booked = period!.weeks.map((w) => weekResult({ week: w.week, start: w.start, end: w.end }, Number(w.sales), settings));
    return {
      ...live,
      weeks: booked,
      totalSales: Number(period!.total_sales),
      monthlyTarget: settings.weekly_target * booked.length,
      attainment: Number(period!.total_sales) / (settings.weekly_target * booked.length || 1),
      flatTotal: booked.reduce((t, w) => t + w.flat, 0),
      excessTotal: booked.reduce((t, w) => t + w.excess, 0),
      basePool: Number(period!.base_pool),
      escalatorHit: Number(period!.escalator_bonus) > 0,
      escalatorBonus: Number(period!.escalator_bonus),
      totalPool: Number(period!.total_pool),
    };
  }, [live, settings, approved, period]);

  const weekRows: WeekRow[] = useMemo(() => (result?.weeks ?? []).map((w) => ({
    ...w,
    expenses: expenses.filter((e) => e.date >= w.start && e.date <= w.end).reduce((t, e) => t + Number(e.amount), 0),
    reports: reports.filter((r) => r.report_date >= w.start && r.report_date <= w.end),
  })), [result, expenses, reports]);

  const groups = useMemo(
    () => (result && settings ? allocate(result.totalPool, staff, settings) : []),
    [result, settings, staff],
  );
  const previewAllocated = groups.reduce((t, g) => t + g.allocated, 0);
  const allocated = approved ? Number(period!.total_allocated) : previewAllocated;
  const lateSales = approved && live ? live.totalSales - Number(period!.total_sales) : 0;
  const shareSum = liveSettings ? sharesTotal(liveSettings) : 100;

  const blocker = approved ? null
    : !weeksClosed ? `The last week of this period ends ${format(parseISO(periodEnd), 'EEE d MMM')}. Approve once it has closed.`
    : pending.length > 0 ? `${pending.length} sales report${pending.length === 1 ? '' : 's'} (${N(pendingTotal)}) still awaiting review.`
    : dirty ? 'You have unsaved changes to the criteria. Save or discard them first — approval uses the saved criteria.'
    : Math.abs(shareSum - 100) > 0.01 ? `Department shares add up to ${shareSum}%, not 100%.`
    : null;

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['commission-period'] });
    qc.invalidateQueries({ queryKey: ['commission-payouts'] });
    qc.invalidateQueries({ queryKey: ['commission-cost'] });
    qc.invalidateQueries({ queryKey: ['journal-all-lines'] });
  };

  const saveCriteria = useMutation({
    mutationFn: async () => {
      if (!draft || !saved?.id) throw new Error('Commission settings are not set up yet — apply the commission migration.');
      if (Math.abs(sharesTotal(draft) - 100) > 0.01) throw new Error(`Department shares must add up to 100% (now ${sharesTotal(draft)}%).`);
      if (!(draft.weekly_target > 0)) throw new Error('The weekly target must be more than zero.');
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await db.from('commission_settings').update({
        weekly_target: draft.weekly_target, flat_rate: draft.flat_rate, excess_rate: draft.excess_rate,
        escalator_rate: draft.escalator_rate, group_shares: draft.group_shares,
        department_groups: draft.department_groups, updated_by: auth.user?.id ?? null, updated_at: new Date().toISOString(),
      }).eq('id', saved.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Criteria saved', description: 'Months not yet approved now use these criteria.' });
      qc.invalidateQueries({ queryKey: ['commission-settings'] });
      setDraft(null);
      setCriteriaOpen(false);
    },
    onError: (e: Error) => toast({ title: 'Could not save', description: e.message, variant: 'destructive' }),
  });

  const approve = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc('fn_approve_commission_period', { p_month: `${month}-01` });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Commission approved', description: 'Accrued to the books. It will be added to each person’s next payroll.' });
      setConfirmOpen(false);
      invalidate();
    },
    onError: (e: Error) => { setConfirmOpen(false); toast({ title: 'Not approved', description: e.message, variant: 'destructive' }); },
  });

  const voidPeriod = useMutation({
    mutationFn: async () => {
      const { error } = await db.rpc('fn_void_commission_period', { p_id: period!.id, p_reason: voidReason });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Commission voided', description: 'The accrual has been reversed in the ledger.' });
      setVoidOpen(false); setVoidReason('');
      invalidate();
    },
    onError: (e: Error) => toast({ title: 'Could not void', description: e.message, variant: 'destructive' }),
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  if (settingsLoading || !settings || !result) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-72" />
        <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  const tgt = N(settings.weekly_target);
  const loading = reportsLoading || periodLoading;

  const weekColumns: ResponsiveColumn<WeekRow>[] = [
    { key: 'week', header: 'Week', primary: true, cell: (w) => (
      <div>
        <div className="font-semibold">Week {w.week}</div>
        <div className="text-xs text-muted-foreground">{format(parseISO(w.start), 'd MMM')} – {format(parseISO(w.end), 'd MMM')}</div>
      </div>
    ) },
    { key: 'sales', header: 'Sales', align: 'right', cell: (w) => (
      <div>
        <div className="font-semibold tabular-nums">{N(w.sales)}</div>
        <div className="text-xs text-muted-foreground">{w.reports.filter((r) => r.status === 'converted').length} report(s)</div>
      </div>
    ) },
    { key: 'vs', header: 'vs target', align: 'right', cell: (w) => {
      const d = w.sales - settings.weekly_target;
      return <span className={cn('tabular-nums font-medium', d >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>{d >= 0 ? '+' : '−'}{N(Math.abs(d))}</span>;
    } },
    { key: 'flat', header: `Target bonus (${rate(settings.flat_rate)})`, align: 'right', hideOnMobile: true,
      cell: (w) => <span className={cn('tabular-nums', !w.hit && 'text-muted-foreground')}>{N(w.flat)}</span> },
    { key: 'exs', header: 'Above target', align: 'right', hideOnMobile: true,
      cell: (w) => <span className={cn('tabular-nums', w.excessSales === 0 && 'text-muted-foreground')}>{N(w.excessSales)}</span> },
    { key: 'exc', header: `Excess (${rate(settings.excess_rate)})`, align: 'right', hideOnMobile: true,
      cell: (w) => <span className={cn('tabular-nums', w.excess === 0 && 'text-muted-foreground')}>{N(w.excess)}</span> },
    { key: 'pool', header: 'Week pool', align: 'right', cell: (w) => <span className="font-bold tabular-nums">{N(w.total)}</span> },
    { key: 'net', header: 'Less expenses', align: 'right', hideOnMobile: true, cell: (w) => (
      <span className={cn('tabular-nums', w.sales - w.expenses < 0 && 'text-red-700 dark:text-red-400')} title={`Approved expenses: ${N(w.expenses)}`}>
        {N(w.sales - w.expenses)}
      </span>
    ) },
    { key: 'status', header: 'Status', mobileFooter: true, cell: (w) => (
      w.end >= todayIso() && !approved
        ? <StatusPill tone="info" label="In progress" />
        : w.hit ? <StatusPill tone="good" label="Target hit" /> : <StatusPill tone="pending" label="Below target" />
    ) },
  ];

  const potential = result.basePotential;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Sales commission"
        description="Worked out from approved staff sales reports. Approving a month books it as a cost; payroll pays it."
        actions={<>
          <Select value={month} onValueChange={(v) => { setMonth(v); setOpenWeek(null); }}>
            <SelectTrigger className="h-10 w-[170px]" aria-label="Commission month"><SelectValue /></SelectTrigger>
            <SelectContent>
              {monthOptions.map((m) => (
                <SelectItem key={m} value={m}>{format(parseISO(`${m}-01`), 'MMMM yyyy')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" className="h-10" onClick={() => setCriteriaOpen(true)}>
            <Settings2 className="mr-2 h-4 w-4" aria-hidden />Criteria{dirty && <span className="ml-1.5 h-2 w-2 rounded-full bg-brand" aria-label="unsaved" />}
          </Button>
          {approved ? (
            <Button variant="outline" className="h-10" onClick={() => setVoidOpen(true)}>
              <Undo2 className="mr-2 h-4 w-4" aria-hidden />Void
            </Button>
          ) : (
            <Button className="h-10" disabled={!!blocker || loading} onClick={() => setConfirmOpen(true)}>
              <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />Approve &amp; accrue
            </Button>
          )}
        </>}
      />

      {/* Period status */}
      <div className={cn(
        'flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center',
        approved ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
          : blocker ? 'bg-card' : 'border-brand/30 bg-brand-soft',
      )}>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-background/70">
          {approved ? <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-400" aria-hidden />
            : blocker ? <Clock className="h-5 w-5 text-muted-foreground" aria-hidden />
            : <CircleDollarSign className="h-5 w-5 text-brand" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">
            {approved
              ? `Approved ${format(parseISO(period!.approved_at), 'd MMM yyyy')} — ${N(allocated)} accrued to ${payouts.length} staff`
              : blocker ? `${format(parseISO(`${month}-01`), 'MMMM yyyy')} is not ready to approve`
              : `${format(parseISO(`${month}-01`), 'MMMM yyyy')} is ready to approve`}
          </div>
          <div className="mt-0.5 text-muted-foreground">
            {approved
              ? <>Journal: Dr 5120 Staff Sales Commission / Cr 2350 Commission Payable, dated {format(parseISO(period!.period_end), 'd MMM yyyy')}. Each person’s share is added to their next payroll, taxed through PAYE.</>
              : blocker ?? <>Approving books {N(previewAllocated)} to 5120 Staff Sales Commission against 2350 Commission Payable.</>}
          </div>
          {approved && lateSales !== 0 && (
            <div className="mt-1.5 flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>Sales for this period changed by {N(lateSales)} after approval (a late report or a cancelled sale). Void and re-approve to include it, if no payroll has picked the commission up yet.</span>
            </div>
          )}
        </div>
        {!approved && pending.length > 0 && (
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to="/staff-reports">Review reports<ArrowRight className="ml-1.5 h-4 w-4" aria-hidden /></Link>
          </Button>
        )}
      </div>

      {/* The model */}
      <div className="grid overflow-hidden rounded-2xl border bg-card md:grid-cols-3">
        {[
          { rule: 'Below target', title: `Weekly sales under ${tgt}`, value: '₦0', desc: 'No commission for that week', tone: 'text-muted-foreground' },
          { rule: 'Target hit', title: `Weekly sales reach ${tgt}`, value: N(settings.weekly_target * settings.flat_rate / 100),
            desc: `${rate(settings.flat_rate)} of the ${tgt} target, into the staff pool`, tone: 'text-emerald-700 dark:text-emerald-400' },
          { rule: 'Above target', title: `Every ₦ over ${tgt}`, value: `+${rate(settings.excess_rate)}`,
            desc: `e.g. ${N(settings.weekly_target + 1_000_000)} → extra ${N(1_000_000 * settings.excess_rate / 100)}`, tone: 'text-brand' },
        ].map((b, i) => (
          <div key={b.rule} className={cn('p-5', i > 0 && 'border-t md:border-l md:border-t-0')}>
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{b.rule}</div>
            <div className="mt-1 font-semibold">{b.title}</div>
            <div className={cn('mt-2 font-display text-2xl font-bold tabular-nums', b.tone)}>{b.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{b.desc}</div>
          </div>
        ))}
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Sales counted" value={formatNairaShort(result.totalSales)} sub={`of ${formatNairaShort(result.monthlyTarget)} target · ${weeks.length} weeks`} />
        <StatTile label="Attainment" value={pct(result.attainment)} sub="of monthly target">
          <Meter value={result.attainment * 100} className="mt-1" />
        </StatTile>
        <StatTile label="Target bonuses" value={formatNairaShort(result.flatTotal)} sub={`${result.weeks.filter((w) => w.hit).length} of ${weeks.length} weeks hit`} />
        <StatTile label="Excess commission" value={formatNairaShort(result.excessTotal)} sub={`${rate(settings.excess_rate)} of sales above target`} />
        <StatTile label="Commission pool" value={formatNairaShort(result.totalPool)} className="col-span-2 lg:col-span-1"
          sub={result.escalatorHit ? `incl. ${formatNairaShort(result.escalatorBonus)} escalator` : 'before escalator'} />
      </div>

      {/* Weekly breakdown */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Weekly sales</CardTitle>
          <CardDescription>
            Approved staff sales reports, Monday to Sunday. A week belongs to the month its Sunday falls in. Select a week to see its reports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-56" /> : (
            <>
              <ResponsiveTable columns={weekColumns} data={weekRows} rowKey={(w) => w.start} onRowClick={(w) => setOpenWeek(w)}
                mobileSubtitle={(w) => `${format(parseISO(w.start), 'd MMM')} – ${format(parseISO(w.end), 'd MMM')}`} />
              <div className="mt-3 flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t-2 pt-3 text-sm font-bold">
                <span className="mr-auto">Month</span>
                <span>Sales {N(result.totalSales)}</span>
                <span>Bonuses {N(result.flatTotal)}</span>
                <span>Excess {N(result.excessTotal)}</span>
                <span>Pool {N(result.basePool)}</span>
              </div>
              {pending.length > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Not counted yet: {pending.length} report(s) worth {N(pendingTotal)} awaiting review in <Link to="/staff-reports" className="font-semibold text-brand underline-offset-2 hover:underline">Staff reports</Link>.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Month-by-month and week-by-week growth */}
      <CommissionGrowth month={month} settings={liveSettings ?? settings} />

      {/* Progress + escalator */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardContent className="space-y-5 p-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold">Monthly sales vs target</span>
                <span className="tabular-nums text-muted-foreground">{pct(result.attainment)}</span>
              </div>
              <Meter value={result.attainment * 100} />
              <div className="mt-1.5 flex justify-between text-xs text-muted-foreground"><span>{N(result.totalSales)}</span><span>{N(result.monthlyTarget)}</span></div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold">Pool vs every-week-on-target</span>
                <span className="tabular-nums text-muted-foreground">{potential > 0 ? pct(result.basePool / potential) : '—'}</span>
              </div>
              <Meter value={potential > 0 ? (result.basePool / potential) * 100 : 0} />
              <div className="mt-1.5 flex justify-between text-xs text-muted-foreground"><span>{N(result.basePool)}</span><span>{N(potential)}</span></div>
            </div>
          </CardContent>
        </Card>
        <div className={cn(
          'flex items-center gap-4 rounded-2xl border p-5',
          result.escalatorHit ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10' : 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10',
        )}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-background/70">
            {result.escalatorHit ? <TrendingUp className="h-6 w-6 text-emerald-700 dark:text-emerald-400" aria-hidden /> : <Target className="h-6 w-6 text-amber-700 dark:text-amber-400" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{result.escalatorHit ? 'Monthly target reached — escalator unlocked' : 'Monthly escalator not yet triggered'}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">
              {result.escalatorHit
                ? `The pool is lifted by ${rate(settings.escalator_rate)} for everyone.`
                : `${N(Math.max(0, result.monthlyTarget - result.totalSales))} more in sales unlocks a ${rate(settings.escalator_rate)} lift on the pool.`}
            </div>
          </div>
          <div className="font-display text-xl font-bold tabular-nums">+{formatNairaShort(result.escalatorBonus)}</div>
        </div>
      </div>

      {/* Department split */}
      <div>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-lg font-bold">Department split</h2>
          <span className="text-sm text-muted-foreground">Pool {N(result.totalPool)} · paid out {N(allocated)}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
          {(approved
            ? bookedGroups(payouts, settings, result.totalPool)
            : groups.map((g) => ({ ...g, headcount: g.staff.length }))
          ).map((g) => (
            <div key={g.group} className="rounded-2xl border bg-card p-5">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{g.label}</span>
                <span className="font-display text-xl font-bold text-brand">{rate(g.share)}</span>
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Group pool</dt><dd className="tabular-nums font-medium">{N(g.pool)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Staff</dt><dd className="tabular-nums font-medium">{g.headcount}</dd></div>
                <div className="flex justify-between border-t pt-1.5 font-bold"><dt>Per person</dt><dd className="tabular-nums">{N(g.perPerson)}</dd></div>
              </dl>
              {g.headcount === 0 && g.share > 0 && (
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">No active staff mapped to this group — its share is not paid out.</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Payouts */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{approved ? 'Commission payouts' : 'Who would be paid'}</CardTitle>
          <CardDescription>
            {approved
              ? 'Booked at approval. Each amount is added to that person’s next payroll run and taxed through PAYE.'
              : 'Active staff in mapped departments, as things stand. Final amounts are fixed when the month is approved.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PayoutTable
            rows={approved
              ? payouts.map((p) => ({
                  id: p.id, name: p.staff_name, department: p.department, group: p.commission_group, amount: Number(p.amount),
                  payroll: p.payroll_record_id && !p.payroll_records?.cancelled_at ? (p.payroll_records?.status === 'paid' ? 'paid' : 'on payroll') : 'awaiting payroll',
                }))
              : groups.flatMap((g) => g.staff.map((s) => ({
                  id: s.id, name: s.full_name, department: s.department ?? null, group: g.group, amount: g.perPerson, payroll: null,
                })))}
          />
        </CardContent>
      </Card>

      {/* Week drill-down */}
      <SidePanel
        open={!!openWeek}
        onOpenChange={(o) => { if (!o) setOpenWeek(null); }}
        title={openWeek ? `Week ${openWeek.week} · ${format(parseISO(openWeek.start), 'd MMM')} – ${format(parseISO(openWeek.end), 'd MMM')}` : 'Week'}
        description="Sales reports for the week"
      >
        {openWeek && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Counted sales" value={formatNairaShort(openWeek.sales)} />
              <StatTile label="Week pool" value={formatNairaShort(openWeek.total)} />
            </div>
            {openWeek.reports.length === 0 ? (
              <EmptyState icon={CircleDollarSign} tone="neutral" title="No sales reports" body="Nobody submitted a sales report for this week." />
            ) : (
              <ul className="divide-y rounded-xl border">
                {openWeek.reports.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{nameOf(r.user_id)}</div>
                      <div className="text-xs text-muted-foreground">{format(parseISO(r.report_date), 'EEE d MMM')}{r.title ? ` · ${r.title}` : ''}</div>
                    </div>
                    <div className="text-right">
                      <div className={cn('font-semibold tabular-nums', r.status !== 'converted' && 'text-muted-foreground line-through decoration-1')}>{N(Number(r.amount || 0))}</div>
                      <StatusPill className="mt-1" tone={r.status === 'converted' ? 'good' : r.status === 'submitted' ? 'pending' : 'bad'}
                        label={r.status === 'converted' ? 'Counted' : r.status === 'submitted' ? 'Awaiting review' : r.status === 'cancelled' ? 'Sale cancelled' : r.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Approved expenses this week: {N(openWeek.expenses)}.</p>
          </div>
        )}
      </SidePanel>

      {/* Criteria */}
      {draft && (
        <SidePanel
          open={criteriaOpen}
          onOpenChange={setCriteriaOpen}
          title="Commission criteria"
          description="Targets, rates and department groups"
          footer={<>
            <Button variant="outline" onClick={() => { setDraft(saved?.settings ?? null); }} disabled={!dirty}>Discard</Button>
            <Button onClick={() => saveCriteria.mutate()} disabled={!dirty || saveCriteria.isPending}>
              {saveCriteria.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Save criteria
            </Button>
          </>}
        >
          <CriteriaForm draft={draft} onChange={setDraft} departments={departments} staff={staff} />
        </SidePanel>
      )}

      {/* Approve */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve {format(parseISO(`${month}-01`), 'MMMM yyyy')} commission?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>The figures are recalculated from approved sales reports and the saved criteria, then fixed for this month.</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Pool {N(result.totalPool)}; paid out {N(previewAllocated)} to {groups.reduce((t, g) => t + (g.perPerson > 0 ? g.staff.length : 0), 0)} staff.</li>
                  <li>Posts Dr 5120 Staff Sales Commission / Cr 2350 Commission Payable, dated {format(parseISO(periodEnd), 'd MMM yyyy')}.</li>
                  <li>Each share joins that person’s next payroll, where PAYE is withheld.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); approve.mutate(); }} disabled={approve.isPending}>
              {approve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Approve &amp; accrue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Void */}
      <AlertDialog open={voidOpen} onOpenChange={(o) => { setVoidOpen(o); if (!o) setVoidReason(''); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this month’s commission?</AlertDialogTitle>
            <AlertDialogDescription>
              The accrual is reversed in the ledger and the month can be approved again. This is refused once any payroll run carries the commission.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea id="void-reason" rows={2} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. late sales report for week 4" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!voidReason.trim() || voidPeriod.isPending}
              onClick={(e) => { e.preventDefault(); voidPeriod.mutate(); }}
            >
              {voidPeriod.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Void commission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Group cards for an approved month, rebuilt from what was actually booked. */
function bookedGroups(payouts: CommissionPayoutRow[], s: CommissionSettings, totalPool: number) {
  return COMMISSION_GROUPS.map(({ key, label }) => {
    const rows = payouts.filter((p) => p.commission_group === key);
    const share = Number(s.group_shares[key] ?? 0);
    return {
      group: key, label, share, pool: totalPool * share / 100,
      headcount: rows.length, perPerson: rows[0] ? Number(rows[0].amount) : 0,
    };
  });
}

interface PayoutLine { id: string; name: string; department: string | null; group: string; amount: number; payroll: string | null }

function PayoutTable({ rows }: { rows: PayoutLine[] }) {
  if (rows.length === 0) {
    return <EmptyState icon={Users} tone="neutral" title="Nobody to pay yet"
      body="There is no pool this month, or no active staff are in a mapped department. Map departments under Criteria." />;
  }
  const cols: ResponsiveColumn<PayoutLine>[] = [
    { key: 'name', header: 'Staff', primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'dept', header: 'Department', cell: (r) => <span className="text-muted-foreground">{r.department ?? '—'}</span> },
    { key: 'group', header: 'Group', cell: (r) => groupLabel(r.group) },
    { key: 'amount', header: 'Commission', align: 'right', cell: (r) => <span className="font-bold tabular-nums">{formatNairaCompact(r.amount)}</span> },
    ...(rows.some((r) => r.payroll) ? [{
      key: 'payroll', header: 'Payroll', mobileFooter: true,
      cell: (r: PayoutLine) => <StatusPill tone={r.payroll === 'paid' ? 'good' : r.payroll === 'on payroll' ? 'info' : 'pending'} label={r.payroll ?? ''} />,
    } as ResponsiveColumn<PayoutLine>] : []),
  ];
  return (
    <>
      <ResponsiveTable columns={cols} data={rows} rowKey={(r) => r.id} mobileSubtitle={(r) => groupLabel(r.group)} />
      <div className="mt-3 flex justify-between border-t-2 pt-3 text-sm font-bold">
        <span>{rows.length} staff</span>
        <span className="tabular-nums">{formatNairaCompact(rows.reduce((t, r) => t + r.amount, 0))}</span>
      </div>
    </>
  );
}

function CriteriaForm({ draft, onChange, departments, staff }: {
  draft: CommissionSettings;
  onChange: (s: CommissionSettings) => void;
  departments: { id: string; name: string }[];
  staff: EligibleStaff[];
}) {
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const set = (patch: Partial<CommissionSettings>) => onChange({ ...draft, ...patch });
  const total = sharesTotal(draft);
  const headcount = (deptId: string) => staff.filter((s) => s.department_id === deptId).length;

  return (
    <div className="flex flex-col gap-6">
      <section className="space-y-3">
        <h3 className="text-sm font-bold">Targets and rates</h3>
        <div className="grid gap-3 min-[420px]:grid-cols-2">
          <Field label="Weekly sales target (₦)" hint="Commission starts when a week reaches this">
            <Input type="number" min={0} step={100000} value={draft.weekly_target} onChange={(e) => set({ weekly_target: num(e.target.value) })} />
          </Field>
          <Field label="Target bonus (%)" hint="Of the target, when hit">
            <Input type="number" min={0} max={100} step={0.5} value={draft.flat_rate} onChange={(e) => set({ flat_rate: num(e.target.value) })} />
          </Field>
          <Field label="Excess rate (%)" hint="Of every ₦ above target">
            <Input type="number" min={0} max={100} step={0.5} value={draft.excess_rate} onChange={(e) => set({ excess_rate: num(e.target.value) })} />
          </Field>
          <Field label="Monthly escalator (%)" hint="Lift on the pool when the month hits target">
            <Input type="number" min={0} max={100} step={1} value={draft.escalator_rate} onChange={(e) => set({ escalator_rate: num(e.target.value) })} />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-bold">Pool shares</h3>
          <span className={cn('text-xs font-semibold tabular-nums', Math.abs(total - 100) > 0.01 ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground')}>
            {total}% of 100%
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {COMMISSION_GROUPS.map((g) => (
            <Field key={g.key} label={`${g.label} (%)`}>
              <Input type="number" min={0} max={100} value={draft.group_shares[g.key]}
                onChange={(e) => set({ group_shares: { ...draft.group_shares, [g.key]: num(e.target.value) } })} />
            </Field>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-bold">Department groups</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Which pool each department draws from. Headcount is active staff only.</p>
        </div>
        <ul className="divide-y rounded-xl border">
          {departments.map((d) => {
            const value = draft.department_groups[d.id] ?? 'none';
            const suggestion = guessGroup(d.name);
            return (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">{headcount(d.id)} active</div>
                </div>
                <Select value={value} onValueChange={(v) => set({ department_groups: { ...draft.department_groups, [d.id]: v as CommissionGroup | 'none' } })}>
                  <SelectTrigger className="h-9 w-[150px]" aria-label={`Group for ${d.name}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMMISSION_GROUPS.map((g) => (
                      <SelectItem key={g.key} value={g.key}>{g.label}{value === 'none' && suggestion === g.key ? ' (suggested)' : ''}</SelectItem>
                    ))}
                    <SelectItem value="none">Not eligible</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground">
        Changes preview on the page straight away. Approved months keep the criteria they were approved with.
      </p>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
