import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import {
  CalendarCheck, CalendarDays, ChevronRight, Inbox as InboxIcon, Package, Plus, Search, Users,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { useInbox } from '@/hooks/useInbox';
import { useMySummary } from '@/hooks/useMySummary';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNairaShort, formatNairaCompact } from '@/lib/currency';
import { CASUAL_LIMIT } from '@/lib/leave';
import { weekStartOf } from '@/lib/attendance';
import { cn } from '@/lib/utils';
import { openCommandPalette } from '@/components/shell/CommandPalette';
import { useMe } from '@/components/shell/useNavAccess';
import { InitialsAvatar, Meter, StatTile, StatusPill } from '@/components/shell/ui';
import { WeekDots } from '@/components/shell/WeekDots';

const db = supabase as any;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Greeting({ name, actions }: { name: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="text-sm font-medium text-muted-foreground">{format(new Date(), 'EEEE, d MMMM')}</div>
        <h1 className="mt-1 font-display text-[1.75rem] font-bold leading-tight sm:text-[2.125rem]">
          {greeting()}, {name}
        </h1>
      </div>
      {/* On a phone the tab bar's ＋ New does this job, one thumb away. */}
      {actions && <div className="flex flex-wrap gap-2.5 max-lg:hidden">{actions}</div>}
    </div>
  );
}

function AttentionCard({ to, icon: Icon, title, sub, hot, tone }: {
  to: string; icon: React.ElementType; title: string; sub: string; hot?: boolean;
  tone: 'brand' | 'green' | 'red' | 'blue';
}) {
  const iconTone = {
    brand: 'bg-primary text-primary-foreground',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  }[tone];
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-4 rounded-2xl border p-4 transition-colors sm:p-5',
        hot ? 'border-orange-200 bg-brand-soft dark:border-orange-500/30' : 'bg-card hover:border-orange-300',
      )}
    >
      <span className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', iconTone)}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[17px] font-bold">{title}</span>
        <span className="text-[13px] text-muted-foreground">{sub}</span>
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

// ── Revenue chart: one series, so no legend; the title names it ──────────────

function RevenueChart({ data }: { data: { label: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  // A round top for the axis so the gridlines land on readable numbers.
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const PLOT = 180;

  return (
    <div className="relative mt-5 h-[224px]">
      {[0, 0.5, 1].map((f) => (
        <div key={f} className="absolute left-12 right-0" style={{ bottom: 24 + f * PLOT }}>
          <div className={cn('border-t', f === 0 ? 'border-foreground/25' : 'border-dashed border-border')} />
          <span className="absolute -left-12 w-10 -translate-y-1/2 text-right text-[11.5px] tabular-nums text-muted-foreground">
            {formatNairaShort(top * f)}
          </span>
        </div>
      ))}
      <div className="absolute bottom-[25px] left-16 right-2 flex items-end gap-3 sm:gap-6" style={{ height: PLOT }}>
        {data.map((d, i) => {
          const h = Math.max(2, Math.round((d.value / top) * PLOT));
          const on = hover === i;
          return (
            <div
              key={d.label}
              className="relative flex h-full flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${d.label}: ${formatNairaCompact(d.value)}`}
            >
              {on && (
                <span className="absolute z-10 mb-2 whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-semibold tabular-nums text-background"
                  style={{ bottom: h }}>
                  {d.label} · {formatNairaCompact(d.value)}
                </span>
              )}
              <div
                className={cn('w-full max-w-[52px] rounded-t transition-colors', on ? 'bg-primary' : 'bg-orange-500')}
                style={{ height: h }}
              />
            </div>
          );
        })}
      </div>
      <div className="absolute bottom-0 left-16 right-2 flex gap-3 sm:gap-6">
        {data.map((d) => (
          <span key={d.label} className="flex-1 text-center text-xs font-semibold text-muted-foreground">{d.label}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Revenue by month</caption>
        <tbody>
          {data.map((d) => <tr key={d.label}><th>{d.label}</th><td>{formatNairaCompact(d.value)}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ── Recent activity: the person's own notifications ──────────────────────────

function RecentActivity() {
  const { user } = useAuth();
  const { data = [], isLoading } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications').select('*').eq('user_id', user!.id)
        .order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  return (
    <section className="flex flex-col rounded-2xl border bg-card p-5 sm:p-6">
      <h2 className="mb-2 text-base font-bold">Recent activity</h2>
      {isLoading ? (
        <div className="space-y-3 pt-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : data.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">Nothing new. Approvals, requests and updates will show up here.</p>
      ) : (
        <ul>
          {data.slice(0, 6).map((n: any) => (
            <li key={n.id} className="flex gap-3 border-t py-2.5 first:border-t-0">
              <InitialsAvatar name={n.title} size={32} square />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13.5px] font-semibold leading-snug">{n.title}</span>
                <span className="line-clamp-2 text-[12.5px] text-muted-foreground">{n.message}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(parseISO(n.created_at), { addSuffix: true })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Lead home: admin, manager, HR ────────────────────────────────────────────

function useFinanceSnapshot(enabled: boolean, withPayroll: boolean) {
  const now = new Date();
  const sixAgo = format(new Date(now.getFullYear(), now.getMonth() - 5, 1), 'yyyy-MM-dd');
  const monthStart = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');

  const q = useQuery({
    queryKey: ['home-finance', sixAgo, withPayroll],
    queryFn: async () => {
      const [sales, invoices, expenses, outstanding, payroll, salePay, invPay] = await Promise.all([
        supabase.from('sales').select('total_amount, vat_amount, sale_date').gte('sale_date', sixAgo).neq('status', 'cancelled'),
        db.from('invoices').select('total_amount, tax_amount, issue_date').eq('status', 'invoice').gte('issue_date', sixAgo),
        db.from('expenses').select('amount, date').eq('status', 'approved').is('cancelled_at', null).gte('date', sixAgo),
        db.from('invoices').select('total_amount, amount_paid, issue_date').eq('status', 'invoice').in('payment_status', ['unpaid', 'partial']),
        withPayroll
          ? supabase.from('payroll_records').select('net_pay, status').eq('status', 'pending')
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('payments').select('amount').eq('status', 'completed').gte('payment_date', monthStart),
        db.from('invoice_payments').select('amount').gte('payment_date', monthStart),
      ]);
      for (const r of [sales, invoices, expenses, outstanding]) if ((r as any).error) throw (r as any).error;
      return {
        sales: (sales.data ?? []) as any[],
        invoices: (invoices.data ?? []) as any[],
        expenses: (expenses.data ?? []) as any[],
        outstanding: (outstanding.data ?? []) as any[],
        payroll: ((payroll as any).data ?? []) as any[],
        cash: [...((salePay.data ?? []) as any[]), ...(((invPay as any).data ?? []) as any[])]
          .reduce((s, p) => s + Number(p.amount), 0),
      };
    },
    enabled,
  });

  return useMemo(() => {
    const d = q.data;
    if (!d) return null;
    // Revenue is net of VAT, the same rule the Finance pages use.
    const months = Array.from({ length: 6 }, (_, i) => {
      const m = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { y: m.getFullYear(), m: m.getMonth(), label: format(m, 'MMM') };
    });
    const inMonth = (s: string, y: number, m: number) => { const x = parseISO(s); return x.getFullYear() === y && x.getMonth() === m; };
    const revenue = months.map(({ y, m, label }) => ({
      label,
      value:
        d.sales.filter((s) => inMonth(s.sale_date, y, m)).reduce((a, s) => a + Number(s.total_amount) - Number(s.vat_amount ?? 0), 0) +
        d.invoices.filter((i) => inMonth(i.issue_date, y, m)).reduce((a, i) => a + Number(i.total_amount) - Number(i.tax_amount ?? 0), 0),
    }));
    const spend = months.map(({ y, m }) =>
      d.expenses.filter((e) => inMonth(e.date, y, m)).reduce((a, e) => a + Number(e.amount), 0));
    const receivables = d.outstanding.reduce((s, i) => s + Number(i.total_amount) - Number(i.amount_paid ?? 0), 0);
    const overdue = d.outstanding.filter((i) => (Date.now() - parseISO(i.issue_date).getTime()) / 86_400_000 > 30).length;
    return {
      revenue,
      thisRevenue: revenue[5].value, lastRevenue: revenue[4].value,
      thisSpend: spend[5], lastSpend: spend[4],
      receivables, overdue,
      payrollPending: d.payroll.reduce((s, r) => s + Number(r.net_pay), 0),
      payrollCount: d.payroll.length,
      cash: d.cash,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
}

function delta(now: number, before: number): { text: string; up: boolean } | null {
  if (!before) return null;
  const pct = ((now - before) / before) * 100;
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, up: pct >= 0 };
}

function LeadHome() {
  const me = useMe();
  const { isAdmin, isManager, isHR, canFeature, hasPermission } = useRoles();
  const { canApproveAnything, waiting, myPending } = useInbox();
  const financials = isAdmin || isManager;
  const fin = useFinanceSnapshot(financials, isAdmin);
  const monthName = format(new Date(), 'MMMM');

  const canSeeStock = isAdmin || hasPermission('inventory', 'view');
  const { data: lowStock = [] } = useQuery({
    queryKey: ['home-low-stock'],
    queryFn: async () => {
      const { data } = await supabase.from('skus').select('name, stock_quantity, reorder_level').gt('reorder_level', 0);
      return (data ?? []).filter((s: any) => Number(s.stock_quantity) <= Number(s.reorder_level));
    },
    enabled: canSeeStock,
  });

  // HR marks the week; show where this week stands for them.
  const weekStart = weekStartOf(new Date());
  const { data: thisWeek } = useQuery({
    queryKey: ['attendance-week', weekStart],
    queryFn: async () => {
      const { data } = await db.from('attendance_weeks')
        .select('id, week_start, week_end, status, hr_comment, submitted_at, reviewed_at, review_note')
        .eq('week_start', weekStart).maybeSingle();
      return data ?? null;
    },
    enabled: canFeature('mark_attendance') && !canFeature('approve_attendance'),
  });

  const attendanceWaiting = waiting.filter((w) => w.kind === 'attendance').length;
  const stockWaiting = waiting.filter((w) => w.kind === 'inventory').length;

  const cards: React.ReactNode[] = [];
  if (canApproveAnything) {
    const n = waiting.length;
    const kinds = Array.from(new Set(waiting.map((w) => w.kind)));
    cards.push(
      <AttentionCard key="inbox" to="/inbox" icon={InboxIcon} tone="brand" hot={n > 0}
        title={n === 0 ? 'No approvals waiting' : `${n} approval${n === 1 ? '' : 's'} waiting`}
        sub={n === 0 ? 'You’re all caught up' : kinds.map((k) => ({ expense: 'expenses', leave: 'leave', attendance: 'attendance', inventory: 'stock', signup: 'sign-ups' }[k])).join(', ')} />,
    );
  } else {
    cards.push(
      <AttentionCard key="mine" to="/inbox" icon={InboxIcon} tone="brand"
        title={myPending.length ? `${myPending.length} of your requests pending` : 'No requests pending'}
        sub="Leave, expenses and stock you’ve asked for" />,
    );
  }
  if (canFeature('approve_attendance')) {
    cards.push(
      <AttentionCard key="att" to={attendanceWaiting ? '/inbox?kind=attendance' : '/attendance?tab=weeks'} icon={CalendarCheck} tone="green"
        title={attendanceWaiting ? `${attendanceWaiting} attendance week${attendanceWaiting === 1 ? '' : 's'} to publish` : 'Attendance is up to date'}
        sub={attendanceWaiting ? 'Submitted by HR · ready to approve' : 'No submitted weeks waiting'} />,
    );
  } else if (canFeature('mark_attendance')) {
    const st = thisWeek?.status ?? 'draft';
    cards.push(
      <AttentionCard key="att" to="/attendance" icon={CalendarCheck} tone="green"
        title={st === 'submitted' ? 'This week is with the admin' : st === 'approved' ? 'This week is published' : st === 'rejected' ? 'This week was sent back' : 'Mark this week’s attendance'}
        sub={`Week of ${format(parseISO(weekStart), 'd MMM')}`} />,
    );
  }
  if (canSeeStock) {
    cards.push(
      <AttentionCard key="stock" to="/business/inventory" icon={Package} tone="red"
        title={lowStock.length ? `${lowStock.length} item${lowStock.length === 1 ? '' : 's'} below reorder level` : 'Stock levels are healthy'}
        sub={lowStock.length ? lowStock.slice(0, 3).map((s: any) => s.name).join(', ') : 'Nothing below its reorder level'} />,
    );
  } else if (isManager && stockWaiting) {
    cards.push(
      <AttentionCard key="stockreq" to="/inbox?kind=inventory" icon={Package} tone="red"
        title={`${stockWaiting} stock request${stockWaiting === 1 ? '' : 's'}`} sub="Waiting for your approval" />,
    );
  } else if (isHR) {
    cards.push(
      <AttentionCard key="people" to="/people" icon={Users} tone="blue" title="Staff directory" sub="Profiles, contacts and who is off today" />,
    );
  }

  const sales = fin ? delta(fin.thisRevenue, fin.lastRevenue) : null;
  const spend = fin ? delta(fin.thisSpend, fin.lastSpend) : null;

  return (
    <div className="flex flex-col gap-7">
      <Greeting
        name={me.firstName}
        actions={<>
          <Button variant="outline" className="h-10" onClick={openCommandPalette}>
            <Search className="mr-2 h-4 w-4" aria-hidden /> Jump to…
          </Button>
          {hasPermission('budgets', 'create') ? (
            <Button asChild className="h-10"><Link to="/expenses?new=1"><Plus className="mr-2 h-4 w-4" aria-hidden />New expense</Link></Button>
          ) : (
            <Button asChild className="h-10"><Link to="/staff-portal?tab=leave"><Plus className="mr-2 h-4 w-4" aria-hidden />Request leave</Link></Button>
          )}
        </>}
      />

      <section aria-label="Needs your attention" className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards}
      </section>

      {financials && (
        <section className="flex flex-col gap-3.5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-bold">{monthName} at a glance</h2>
            {isAdmin && <Link to="/finance/overview" className="text-sm font-semibold text-primary hover:underline">Full overview</Link>}
          </div>
          {!fin ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[120px] rounded-2xl" />)}</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatTile label="Revenue" value={formatNairaShort(fin.thisRevenue)}
                sub={sales ? <><b className={sales.up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>{sales.text}</b> vs last month</> : 'Net of VAT'} />
              <StatTile label="Expenses" value={formatNairaShort(fin.thisSpend)}
                sub={spend ? <><b className={spend.up ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}>{spend.text}</b> vs last month</> : 'Approved only'} />
              {isAdmin ? (
                <StatTile label="Payroll awaiting payment" value={formatNairaShort(fin.payrollPending)}
                  sub={`${fin.payrollCount} payslip${fin.payrollCount === 1 ? '' : 's'} pending`} />
              ) : (
                <StatTile label="Cash collected" value={formatNairaShort(fin.cash)} sub="Payments received this month" />
              )}
              <StatTile label="Unpaid invoices" value={formatNairaShort(fin.receivables)}
                sub={fin.overdue ? <><b className="text-red-700 dark:text-red-400">{fin.overdue}</b> over 30 days</> : 'None over 30 days'} />
            </div>
          )}
        </section>
      )}

      <div className={cn('grid gap-4', financials && 'xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]')}>
        {financials && (
          <section className="rounded-2xl border bg-card p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Revenue, last 6 months</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">Sales and invoices, net of VAT</p>
              </div>
              {isAdmin && (
                <Button asChild variant="outline" size="sm"><Link to="/profit-loss">Open P&amp;L</Link></Button>
              )}
            </div>
            {fin ? <RevenueChart data={fin.revenue} /> : <Skeleton className="mt-5 h-[224px] w-full" />}
          </section>
        )}
        <RecentActivity />
      </div>
    </div>
  );
}

// ── Staff home ───────────────────────────────────────────────────────────────

function StaffHome() {
  const me = useMe();
  const { mine } = useInbox();
  const s = useMySummary();
  const casualLeft = Math.max(0, s.leave.casualDaysRemaining);

  const todos = [
    ...s.missing.slice(0, 3).map((m) => ({ title: m.label, sub: 'Your profile', to: '/my-profile', pill: 'Profile', tone: 'neutral' as const })),
    { title: 'Send your daily report', sub: 'Reports and expense claims', to: '/staff-portal?tab=reports', pill: 'Today', tone: 'pending' as const },
    { title: 'Check your checklists', sub: 'Tasks assigned to you', to: '/staff-portal?tab=checklists', pill: 'Open', tone: 'info' as const },
  ];

  return (
    <div className="flex flex-col gap-7">
      <Greeting
        name={me.firstName}
        actions={<>
          <Button asChild variant="outline" className="h-10"><Link to="/staff-portal?tab=leave"><CalendarDays className="mr-2 h-4 w-4" aria-hidden />Request leave</Link></Button>
          <Button asChild className="h-10"><Link to="/staff-portal?tab=reports"><Plus className="mr-2 h-4 w-4" aria-hidden />Submit expense</Link></Button>
        </>}
      />

      <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
        <StatTile label="Casual leave left" value={<>{casualLeft} <span className="text-base font-semibold text-muted-foreground">of {CASUAL_LIMIT} days</span></>}
          sub={`${s.leave.sickRemaining} sick leave occurrence${s.leave.sickRemaining === 1 ? '' : 's'} left this year`}>
          <Meter value={(s.leave.casualDaysUsed / CASUAL_LIMIT) * 100} className="mt-1" />
        </StatTile>
        <StatTile label="Latest payslip"
          value={s.payslip ? formatNairaShort(Number(s.payslip.net_pay)) : '—'}
          sub={s.payslip ? `${s.payslip.salary_period ?? format(parseISO(s.payslip.period_start), 'MMMM yyyy')} · ${s.payslip.status}` : 'No payslip yet'}>
          <Button asChild variant="outline" size="sm" className="mt-1 self-start"><Link to="/my-payslip">View payslips</Link></Button>
        </StatTile>
        <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5">
          <span className="text-[13px] font-semibold text-muted-foreground">This week’s attendance</span>
          <WeekDots days={s.week} />
          <span className="text-xs text-muted-foreground">Marked by HR · shows once the week is published</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border bg-card p-5 sm:p-6">
          <h2 className="mb-2 text-base font-bold">Your to-dos</h2>
          <ul>
            {todos.map((t) => (
              <li key={t.title}>
                <Link to={t.to} className="flex min-h-[60px] items-center gap-3 border-t py-2 first:border-t-0 hover:bg-accent/40">
                  <span aria-hidden className="h-[22px] w-[22px] shrink-0 rounded-[7px] border-2 border-border" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{t.title}</span>
                    <span className="text-[12.5px] text-muted-foreground">{t.sub}</span>
                  </span>
                  <StatusPill label={t.pill} tone={t.tone} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl border bg-card p-5 sm:p-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-bold">My requests</h2>
            <Button asChild variant="outline" size="sm"><Link to="/inbox">See all</Link></Button>
          </div>
          {mine.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">You haven’t made any requests yet.</p>
          ) : (
            <ul>
              {mine.slice(0, 4).map((m) => (
                <li key={m.key}>
                  <Link to={`/inbox?item=${encodeURIComponent(m.key)}`} className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold">{m.title}</span>
                      <span className="text-[12.5px] text-muted-foreground">
                        {formatDistanceToNow(parseISO(m.at), { addSuffix: true })}
                      </span>
                    </span>
                    {m.status && <StatusPill status={m.status} />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Pending ──────────────────────────────────────────────────────────────────

function PendingHome() {
  const me = useMe();
  const { userRole } = useRoles();
  return (
    <div className="flex flex-col gap-7">
      <Greeting name={me.firstName} />
      <div className="rounded-2xl border bg-brand-soft p-6">
        <h2 className="font-display text-xl font-bold">Your access is waiting for approval</h2>
        <p className="mt-2 max-w-xl text-sm text-foreground/80">
          Your <b className="capitalize">{userRole?.role === 'hr' ? 'HR' : userRole?.role}</b> role has been requested and an
          administrator needs to approve it. You’ll get the rest of the portal as soon as they do. Meanwhile you can
          finish your profile.
        </p>
        <Button asChild className="mt-4 h-10"><Link to="/my-profile">Complete my profile</Link></Button>
      </div>
    </div>
  );
}

export default function Home() {
  const { isAdmin, isManager, isHR, isPending, loading } = useRoles();
  if (loading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (isPending) return <PendingHome />;
  if (isAdmin || isManager || isHR) return <LeadHome />;
  return <StaffHome />;
}
