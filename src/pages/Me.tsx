import { Link, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { CalendarDays, ChevronRight, FileText, LogOut, Moon, Pencil } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useRoles } from '@/hooks/useRoles';
import { useInbox } from '@/hooks/useInbox';
import { useMySummary } from '@/hooks/useMySummary';
import { Button } from '@/components/ui/button';
import { formatNairaCompact } from '@/lib/currency';
import { CASUAL_LIMIT } from '@/lib/leave';
import { useMe } from '@/components/shell/useNavAccess';
import { InitialsAvatar, Meter, StatTile, StatusPill } from '@/components/shell/ui';
import { WeekDots } from '@/components/shell/WeekDots';

const LINKS = [
  { to: '/my-payslip', title: 'Payslips', sub: 'Every payslip, ready to download' },
  { to: '/staff-portal?tab=leave', title: 'Leave', sub: 'Request time off and see your balance' },
  { to: '/staff-portal?tab=attendance', title: 'Attendance', sub: 'Your days, and asking HR to review one' },
  { to: '/staff-portal?tab=reports', title: 'Reports & expense claims', sub: 'Daily reports and money you spent for work' },
  { to: '/staff-portal?tab=checklists', title: 'Checklists', sub: 'Tasks assigned to you' },
  { to: '/staff-portal?tab=performance', title: 'Performance', sub: 'Your KPI tasks and scores' },
  { to: '/staff-portal?tab=complaints', title: 'Complaints', sub: 'Raise something with HR' },
  { to: '/staff-portal?tab=messages', title: 'Messages', sub: 'Messages with management' },
  { to: '/staff-portal?tab=documents', title: 'Documents', sub: 'Your contract and personal files' },
];

export default function Me() {
  const me = useMe();
  const { isPending } = useRoles();
  const s = useMySummary();
  const { mine } = useInbox();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme === 'dark';

  const { data: docs = [] } = useQuery({
    queryKey: ['me-documents', me.staffProfileId],
    queryFn: async () => {
      const { data } = await supabase
        .from('staff_documents')
        .select('id, file_name, file_type, created_at')
        .eq('staff_profile_id', me.staffProfileId!)
        .order('created_at', { ascending: false })
        .limit(4);
      return data ?? [];
    },
    enabled: !!me.staffProfileId && !isPending,
  });

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-7">
        <div className="flex min-w-0 flex-1 items-center gap-4">
        <InitialsAvatar name={me.name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[1.5rem] font-bold leading-tight sm:text-[1.75rem]">{me.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[me.title, me.department, me.email].filter(Boolean).join(' · ')}
          </p>
        </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button asChild variant="outline" className="h-11 flex-1 sm:h-10 sm:flex-none">
            <Link to="/my-profile"><Pencil className="mr-2 h-4 w-4" aria-hidden />Edit profile</Link>
          </Button>
          {!isPending && (
            <Button asChild className="h-11 flex-1 sm:h-10 sm:flex-none">
              <Link to="/staff-portal?tab=leave"><CalendarDays className="mr-2 h-4 w-4" aria-hidden />Request leave</Link>
            </Button>
          )}
        </div>
      </section>

      {!isPending && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
            <StatTile label="Latest payslip"
              value={s.payslip ? formatNairaCompact(Number(s.payslip.net_pay)) : '—'}
              sub={s.payslip
                ? `${s.payslip.salary_period ?? format(parseISO(s.payslip.period_start), 'MMMM yyyy')} · ${s.payslip.status}`
                : s.hasProfile ? 'No payslip yet' : 'Your staff profile isn’t linked yet'}>
              <Button asChild variant="outline" size="sm" className="mt-1 self-start"><Link to="/my-payslip">View & download</Link></Button>
            </StatTile>
            <StatTile label="Casual leave left"
              value={`${Math.max(0, s.leave.casualDaysRemaining)} days`}
              sub={`${s.leave.casualDaysUsed} of ${CASUAL_LIMIT} used · ${s.leave.sickRemaining} sick leave left`}>
              <Meter value={(s.leave.casualDaysUsed / CASUAL_LIMIT) * 100} className="mt-1" />
            </StatTile>
            <div className="col-span-2 flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5 md:col-span-1">
              <span className="text-[13px] font-semibold text-muted-foreground">This week</span>
              <WeekDots days={s.week} />
              <Link to="/staff-portal?tab=attendance" className="text-[13px] font-semibold text-primary hover:underline">
                Full attendance
              </Link>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border bg-card p-5 sm:p-6">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-bold">My requests</h2>
                <Button asChild variant="outline" size="sm"><Link to="/inbox?view=mine">Open</Link></Button>
              </div>
              {mine.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">Nothing yet. Leave, expense claims and stock requests show up here.</p>
              ) : (
                <ul>
                  {mine.slice(0, 4).map((m) => (
                    <li key={m.key} className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-semibold">{m.title}</span>
                        <span className="text-[12.5px] text-muted-foreground">{formatDistanceToNow(parseISO(m.at), { addSuffix: true })}</span>
                      </span>
                      {m.status && <StatusPill status={m.status} />}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rounded-2xl border bg-card p-5 sm:p-6">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-bold">My documents</h2>
                <Button asChild variant="outline" size="sm"><Link to="/staff-portal?tab=documents">All</Link></Button>
              </div>
              {docs.length === 0 ? (
                <p className="py-6 text-sm text-muted-foreground">No documents on your file yet.</p>
              ) : (
                <ul>
                  {docs.map((d: any) => (
                    <li key={d.id}>
                      <Link to="/staff-portal?tab=documents" className="flex h-14 items-center gap-3 border-t first:border-t-0">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-soft text-primary">
                          <FileText className="h-[17px] w-[17px]" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 truncate font-semibold">{d.file_name}</span>
                        <span className="text-[12.5px] text-muted-foreground">{format(parseISO(d.created_at), 'd MMM yyyy')}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="overflow-hidden rounded-2xl border bg-card">
            <h2 className="px-5 pb-1 pt-5 text-base font-bold sm:px-6">Everything about you</h2>
            <ul>
              {LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="flex min-h-16 items-center gap-3 border-t px-5 py-3 first:border-t-0 hover:bg-accent/40 sm:px-6">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-bold">{l.title}</span>
                      <span className="text-[12.5px] text-muted-foreground">{l.sub}</span>
                    </span>
                    <ChevronRight className="h-[18px] w-[18px] text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section aria-labelledby="settings-h" className="overflow-hidden rounded-2xl border bg-card">
        <h2 id="settings-h" className="px-5 pb-1 pt-5 text-base font-bold sm:px-6">Settings</h2>
        <label className="flex min-h-14 cursor-pointer items-center gap-3 px-5 sm:px-6">
          <Moon className="h-[18px] w-[18px] text-muted-foreground" aria-hidden />
          <span className="flex-1 font-semibold">Dark mode</span>
          <Switch checked={dark} onCheckedChange={(on) => setTheme(on ? 'dark' : 'light')} aria-label="Dark mode" />
        </label>
        <button type="button" onClick={async () => { await signOut(); navigate('/auth'); }}
          className="flex min-h-14 w-full items-center gap-3 border-t px-5 text-left font-bold text-destructive hover:bg-accent/40 sm:px-6">
          <LogOut className="h-[18px] w-[18px]" aria-hidden /> Sign out
        </button>
      </section>
    </div>
  );
}
