import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ChevronRight, Mail, Phone, Plus, Search, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useRoles } from '@/hooks/useRoles';
import {
  useStaffDirectory, positionLabel, employmentLabel, type DirectoryPerson,
} from '@/hooks/useStaffDirectory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { weekDays, weekStartOf } from '@/lib/attendance';
import {
  EmptyState, FieldGrid, FilterChips, InitialsAvatar, PageHeader, SidePanel, StatusPill,
} from '@/components/shell/ui';
import { WeekDots } from '@/components/shell/WeekDots';

const db = supabase as any;

const joinedOf = (p: DirectoryPerson) =>
  p.employment_date ? format(parseISO(p.employment_date), 'MMM yyyy') : p.year_of_joining ? String(p.year_of_joining) : '—';

function PersonPanel({ person, onClose }: { person: DirectoryPerson | null; onClose: () => void }) {
  const weekStart = weekStartOf(new Date());
  const days = weekDays(weekStart);
  const { data: records = [] } = useQuery({
    queryKey: ['person-week', person?.id, weekStart],
    queryFn: async () => {
      const { data } = await db.from('attendance_records')
        .select('work_date, status')
        .eq('staff_profile_id', person!.id)
        .gte('work_date', days[0]).lte('work_date', days[6]);
      return (data ?? []) as { work_date: string; status: string }[];
    },
    enabled: !!person,
  });
  const byDate = new Map(records.map((r) => [r.work_date, r.status]));
  const week = days.map((date) => ({ date, status: byDate.get(date) ?? null })).filter((d, i) => i < 5 || d.status);

  return (
    <SidePanel
      open={!!person}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Staff profile"
      description={person ? `Summary for ${person.full_name}` : undefined}
      footer={person && (<>
        {person.phone_number && (
          <Button asChild variant="outline" className="h-11 flex-1 sm:h-10 sm:flex-none">
            <a href={`tel:${person.phone_number}`}><Phone className="mr-2 h-4 w-4" aria-hidden />Call</a>
          </Button>
        )}
        {person.email_address && (
          <Button asChild variant="outline" className="h-11 flex-1 sm:h-10 sm:flex-none">
            <a href={`mailto:${person.email_address}`}><Mail className="mr-2 h-4 w-4" aria-hidden />Email</a>
          </Button>
        )}
        <Button asChild className="h-11 w-full sm:h-10 sm:w-auto">
          <Link to={`/staff-profiles?view=${person.id}`}>Open full profile</Link>
        </Button>
      </>)}
    >
      {person && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <InitialsAvatar name={person.full_name} size={64} />
            <div className="min-w-0">
              <div className="font-display text-[22px] font-bold leading-tight">{person.full_name}</div>
              <div className="text-sm text-muted-foreground">
                {positionLabel(person.position)}{person.departments?.name ? ` · ${person.departments.name}` : ''}
              </div>
              <StatusPill className="mt-2" status={person.onLeave ? 'On leave' : 'Active'} />
            </div>
          </div>
          <FieldGrid fields={[
            { label: 'Department', value: person.departments?.name ?? '—' },
            { label: 'Employment', value: employmentLabel(person.employment_type) },
            { label: 'Joined', value: joinedOf(person) },
            { label: 'Portal account', value: person.linked_user_id ? 'Linked' : 'Not linked' },
            { label: 'Phone', value: person.phone_number ?? '—' },
            { label: 'Email', value: person.email_address ?? '—' },
          ]} />
          <div className="flex flex-col gap-2.5">
            <div className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">This week</div>
            <WeekDots days={week} />
          </div>
        </div>
      )}
    </SidePanel>
  );
}

export default function People() {
  const { isAdmin, isHR } = useRoles();
  const { data: people = [], isLoading } = useStaffDirectory();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('all');

  const departments = useMemo(
    () => Array.from(new Set(people.map((p) => p.departments?.name).filter(Boolean) as string[])).sort(),
    [people],
  );
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) =>
      (dept === 'all' || p.departments?.name === dept) &&
      (!needle || `${p.full_name} ${p.position ?? ''} ${p.phone_number ?? ''} ${p.email_address ?? ''}`.toLowerCase().includes(needle)));
  }, [people, q, dept]);

  const personId = params.get('person');
  const person = people.find((p) => p.id === personId) ?? null;
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('person', id); else next.delete('person');
    setParams(next, { replace: !id });
  };

  const onLeave = people.filter((p) => p.onLeave).length;
  const cols = 'grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_20px]';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Staff directory"
        description={isLoading ? 'Loading…' : `${people.length} people · ${departments.length} departments${onLeave ? ` · ${onLeave} on leave today` : ''}`}
        actions={(isAdmin || isHR) && (
          <Button asChild className="h-10"><Link to="/staff-profiles?new=1"><Plus className="mr-2 h-4 w-4" aria-hidden />Add staff</Link></Button>
        )}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, role or phone"
            aria-label="Search people" className="h-11 pl-10 text-base sm:text-sm" />
        </div>
        {departments.length > 1 && (
          <FilterChips label="Department" value={dept} onChange={setDept}
            options={[{ value: 'all', label: 'All' }, ...departments.map((d) => ({ value: d, label: d }))]} />
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card">
        {isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : shown.length === 0 ? (
          <EmptyState icon={Users} tone="neutral"
            title={people.length ? 'No one matches that' : 'No staff profiles yet'}
            body={people.length ? 'Try a different name or department.' : 'Add your first staff member to build the directory.'} />
        ) : (
          <>
            <div className={`hidden h-11 items-center gap-4 px-5 text-xs font-bold uppercase tracking-[0.04em] text-muted-foreground md:grid ${cols}`}>
              <span>Name</span><span>Department</span><span>Type</span><span>Status</span><span>Joined</span><span />
            </div>
            <ul>
              {shown.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => open(p.id)}
                    className={`flex w-full items-center gap-3.5 border-t px-4 py-3 text-left text-sm transition-colors first:border-t-0 hover:bg-accent/50 md:grid md:h-16 md:gap-4 md:px-5 md:py-0 md:first:border-t ${cols}`}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <InitialsAvatar name={p.full_name} size={40} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-bold">{p.full_name}</span>
                        <span className="truncate text-[12.5px] text-muted-foreground">
                          {positionLabel(p.position)}
                          <span className="md:hidden">{p.departments?.name ? ` · ${p.departments.name}` : ''}</span>
                        </span>
                      </span>
                    </span>
                    <span className="hidden truncate md:block">{p.departments?.name ?? '—'}</span>
                    <span className="hidden text-muted-foreground md:block">{employmentLabel(p.employment_type)}</span>
                    <span className="shrink-0"><StatusPill status={p.onLeave ? 'On leave' : 'Active'} /></span>
                    <span className="hidden tabular-nums text-muted-foreground md:block">{joinedOf(p)}</span>
                    <ChevronRight className="hidden h-4 w-4 text-muted-foreground md:block" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <PersonPanel person={person} onClose={() => open(null)} />
    </div>
  );
}
