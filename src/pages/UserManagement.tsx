// People & access: one place to decide who someone is (role, department,
// staff profile) and what they can reach. Access is chosen as a named level
// per area of the app; a person follows their department unless an admin
// sets something different for them.

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Check, Loader2, Plus, Search, ShieldCheck, UserRound, Users,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ui/responsive-table';
import {
  EmptyState, FilterChips, InitialsAvatar, PageHeader, SidePanel, StatusPill,
} from '@/components/shell/ui';
import { cn } from '@/lib/utils';
import { FEATURES } from '@/config/capabilities';
import { hasFeature } from '@/config/capabilities';
import type { AppRole, Module } from '@/config/modules';
import {
  FEATURE_LABEL, MODULE_ACCESS, NO_FLAGS, ROLE_EXTRAS, ROLE_INFO, ROLE_ORDER,
  accessSummary, levelOf, type Flags,
} from '@/config/accessLevels';

const db = supabase as any;
const INHERIT = '__inherit';
const NO_DEPT = '__none';

type PermRow = Flags & { module_name: string };
type Perms = Partial<Record<Module, Flags>>;

interface Person {
  user_id: string;
  name: string;
  role: AppRole;
  status: 'approved' | 'pending';
  hasRoleRecord: boolean;
  departmentId: string | null;
  staffProfile: string | null;
  overrides: Perms;
}
interface Department { id: string; name: string; description: string | null }
interface StaffProfile { id: string; full_name: string; linked_user_id: string | null; position: string | null }

const toPerms = (rows: PermRow[]): Perms =>
  Object.fromEntries(rows.map((r) => [r.module_name, {
    can_view: !!r.can_view, can_create: !!r.can_create, can_update: !!r.can_update, can_delete: !!r.can_delete,
  }]));

/** What someone can actually do in an area: their own setting, else their department's. */
const effective = (p: Person, deptPerms: Record<string, Perms>, m: Module): Flags | null =>
  p.role === 'admin'
    ? { can_view: true, can_create: true, can_update: true, can_delete: true }
    : p.overrides[m] ?? (p.departmentId ? deptPerms[p.departmentId]?.[m] ?? null : null);

export default function UserManagement() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'people';
  const setTab = (t: string) => setParams(t === 'people' ? {} : { tab: t }, { replace: true });

  // Cached, and refreshed when a sign-up is approved from the Inbox.
  const { data, isPending, error } = useQuery({
    queryKey: ['user-management'],
    queryFn: async () => {
      const [profiles, roles, depts, staff, deptPerms, userPerms] = await Promise.all([
        supabase.from('profiles').select('user_id, full_name'),
        supabase.from('user_roles').select('user_id, role, role_status, department_id'),
        supabase.from('departments').select('id, name, description').order('name'),
        supabase.from('staff_profiles').select('id, full_name, linked_user_id, position'),
        supabase.from('department_permissions').select('department_id, module_name, can_view, can_create, can_update, can_delete'),
        db.from('user_permissions').select('user_id, module_name, can_view, can_create, can_update, can_delete'),
      ]);
      for (const r of [profiles, roles, depts, staff, deptPerms, userPerms]) if (r.error) throw r.error;

      const roleBy = new Map((roles.data ?? []).map((r: any) => [r.user_id, r]));
      const staffBy = new Map((staff.data ?? []).filter((s: any) => s.linked_user_id).map((s: any) => [s.linked_user_id, s.full_name]));
      const group = <T extends { module_name: string }>(rows: T[], key: (r: T) => string) => {
        const out: Record<string, T[]> = {};
        for (const r of rows) (out[key(r)] ??= []).push(r);
        return out;
      };
      const userPermsBy = group((userPerms.data ?? []) as (PermRow & { user_id: string })[], (r) => r.user_id);
      const deptPermsBy = group((deptPerms.data ?? []) as (PermRow & { department_id: string })[], (r) => r.department_id);

      const people: Person[] = (profiles.data ?? []).map((p: any) => {
        const r: any = roleBy.get(p.user_id);
        return {
          user_id: p.user_id,
          name: p.full_name || 'No name',
          role: (r?.role ?? 'employee') as AppRole,
          status: (r?.role_status === 'pending' ? 'pending' : 'approved') as Person['status'],
          hasRoleRecord: !!r,
          departmentId: r?.department_id ?? null,
          staffProfile: staffBy.get(p.user_id) ?? null,
          overrides: toPerms(userPermsBy[p.user_id] ?? []),
        };
      }).sort((a: Person, b: Person) =>
        (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || a.name.localeCompare(b.name));

      return {
        people,
        departments: (depts.data ?? []) as Department[],
        staffProfiles: (staff.data ?? []) as StaffProfile[],
        deptPerms: Object.fromEntries(Object.entries(deptPermsBy).map(([k, v]) => [k, toPerms(v)])) as Record<string, Perms>,
      };
    },
  });

  useEffect(() => {
    if (error) toast({ title: 'Could not load people', description: (error as Error).message, variant: 'destructive' });
  }, [error]);

  const people = data?.people ?? [];
  const departments = data?.departments ?? [];
  const deptPerms = data?.deptPerms ?? {};
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? null;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['user-management'] });
    qc.invalidateQueries({ queryKey: ['user-role-data'] });
    qc.invalidateQueries({ queryKey: ['inbox'] });
  };

  const [personId, setPersonId] = useState<string | null>(null);
  const [deptId, setDeptId] = useState<string | null>(null);
  const person = people.find((p) => p.user_id === personId) ?? null;
  const dept = departments.find((d) => d.id === deptId) ?? null;

  const pendingCount = people.filter((p) => p.status === 'pending').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="People & access"
        description="Who someone is in the company, and what they can see and do."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="people" className="gap-1.5">
            <Users className="h-4 w-4" />People
            {pendingCount > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{pendingCount}</span>}
          </TabsTrigger>
          <TabsTrigger value="departments" className="gap-1.5"><Building2 className="h-4 w-4" />Departments</TabsTrigger>
          <TabsTrigger value="roles" className="gap-1.5"><ShieldCheck className="h-4 w-4" />What roles include</TabsTrigger>
        </TabsList>

        <HowItWorks />

        <TabsContent value="people">
          {isPending ? <Skeleton className="h-72 w-full" /> : (
            <PeopleTab people={people} deptName={deptName} deptPerms={deptPerms} onOpen={setPersonId} />
          )}
        </TabsContent>

        <TabsContent value="departments">
          {isPending ? <Skeleton className="h-72 w-full" /> : (
            <DepartmentsTab departments={departments} people={people} deptPerms={deptPerms}
              onOpen={setDeptId} onCreated={(id) => { refresh(); setDeptId(id); }} />
          )}
        </TabsContent>

        <TabsContent value="roles">
          <RolesTab people={people} />
        </TabsContent>
      </Tabs>

      <PersonPanel
        person={person} self={person?.user_id === user?.id}
        departments={departments} deptPerms={deptPerms} staffProfiles={data?.staffProfiles ?? []}
        onClose={() => setPersonId(null)} onSaved={refresh}
      />
      <DepartmentPanel
        dept={dept} perms={dept ? deptPerms[dept.id] ?? {} : {}}
        members={people.filter((p) => p.departmentId === deptId)}
        onClose={() => setDeptId(null)} onSaved={refresh}
        onOpenPerson={(id) => { setDeptId(null); setTab('people'); setPersonId(id); }}
      />
    </div>
  );
}

// ── How access works ─────────────────────────────────────────────────────────

function HowItWorks() {
  return (
    <ol className="my-4 grid gap-2 text-sm sm:grid-cols-3">
      {[
        ['Role', 'Staff, HR, Manager or Admin. Sets the people-side things they get, like leave approval or payroll. Admins can do everything.'],
        ['Department', 'Sets what everyone in it can reach in Inventory, Production, Sales, Invoices, Expenses, Finance and Reports.'],
        ['Personal access', 'Only when one person needs more or less than their department. Most people won’t need any.'],
      ].map(([t, b], i) => (
        <li key={t} className="flex gap-3 rounded-xl border bg-card p-3">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">{i + 1}</span>
          <span><b>{t}.</b> <span className="text-muted-foreground">{b}</span></span>
        </li>
      ))}
    </ol>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

function PeopleTab({ people, deptName, deptPerms, onOpen }: {
  people: Person[];
  deptName: (id: string | null) => string | null;
  deptPerms: Record<string, Perms>;
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'pending' | AppRole>('all');
  const [q, setQ] = useState('');
  const search = useDeferredValue(q.trim().toLowerCase());

  const shown = useMemo(() => people.filter((p) =>
    (filter === 'all' || (filter === 'pending' ? p.status === 'pending' : p.role === filter))
    && (!search || p.name.toLowerCase().includes(search) || (deptName(p.departmentId) ?? '').toLowerCase().includes(search))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [people, filter, search]);

  const columns: ResponsiveColumn<Person>[] = [
    {
      key: 'who', header: 'Person', primary: true,
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          <InitialsAvatar name={p.name} size={32} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{p.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {ROLE_INFO[p.role].label}{deptName(p.departmentId) ? ` · ${deptName(p.departmentId)}` : ' · No department'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'access', header: 'Can reach',
      cell: (p) => {
        if (p.role === 'admin') return <span className="text-sm">Everything</span>;
        const s = accessSummary((m) => effective(p, deptPerms, m));
        return (
          <span className="text-sm">
            {s || <span className="text-muted-foreground">Only their own pay, leave and requests</span>}
            {Object.keys(p.overrides).length > 0 && <StatusPill tone="violet" label="Personal" className="ml-2 normal-case" />}
          </span>
        );
      },
    },
    {
      key: 'status', header: 'Status', mobileFooter: true,
      cell: (p) => p.status === 'pending'
        ? <StatusPill tone="pending" label="Waiting for approval" className="normal-case" />
        : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips<typeof filter> label="Filter people" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'Everyone', count: people.length },
          { value: 'pending', label: 'Waiting', count: people.filter((p) => p.status === 'pending').length },
          ...ROLE_ORDER.map((r) => ({ value: r, label: ROLE_INFO[r].label, count: people.filter((p) => p.role === r).length })),
        ]} />
        <div className="relative sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Search people" placeholder="Search name or department" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <ResponsiveTable
        columns={columns} data={shown} rowKey={(p) => p.user_id} onRowClick={(p) => onOpen(p.user_id)}
        emptyState={<EmptyState icon={Users} tone="neutral" title="No one matches" />}
      />
    </div>
  );
}

function PersonPanel({ person, self, departments, deptPerms, staffProfiles, onClose, onSaved }: {
  person: Person | null;
  self: boolean;
  departments: Department[];
  deptPerms: Record<string, Perms>;
  staffProfiles: StaffProfile[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [role, setRole] = useState<AppRole>('employee');
  const [deptId, setDeptId] = useState(NO_DEPT);
  const [profileId, setProfileId] = useState('');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!person) return;
    setRole(person.role);
    setDeptId(person.departmentId ?? NO_DEPT);
    setProfileId('');
    setChoices(Object.fromEntries(MODULE_ACCESS.map((m) => [
      m.key, person.overrides[m.key] ? levelOf(m, person.overrides[m.key]).key : INHERIT,
    ])));
  }, [person]);

  if (!person) return <SidePanel open={false} onOpenChange={onClose} title="" children={null} />;

  const dept = deptId === NO_DEPT ? null : deptId;
  const deptName = departments.find((d) => d.id === dept)?.name;
  const unlinked = staffProfiles.filter((s) => !s.linked_user_id);

  const dirty = role !== person.role || dept !== person.departmentId
    || MODULE_ACCESS.some((m) => choices[m.key] !== (person.overrides[m.key] ? levelOf(m, person.overrides[m.key]).key : INHERIT));

  const run = async (key: string, fn: () => Promise<void>, msg: string, close = true) => {
    setBusy(key);
    try { await fn(); toast({ title: msg }); onSaved(); if (close) onClose(); }
    catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(null); }
  };

  const save = () => run('save', async () => {
    const roleRow = { role, department_id: dept, assigned_by: user!.id, assigned_at: new Date().toISOString() };
    if (person.hasRoleRecord) {
      // An admin's own decision needs no second approval; a waiting sign-up
      // stays waiting until someone presses Approve.
      const { error } = await supabase.from('user_roles').update(roleRow).eq('user_id', person.user_id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('user_roles').insert({ ...roleRow, user_id: person.user_id, role_status: 'approved' });
      if (error) throw error;
    }

    const upserts: any[] = [];
    const clear: string[] = [];
    for (const m of MODULE_ACCESS) {
      const c = choices[m.key];
      if (c === INHERIT) { clear.push(m.key); continue; }
      if (c === 'custom') continue;   // left as it was
      const level = m.levels.find((l) => l.key === c);
      if (level) upserts.push({ user_id: person.user_id, module_name: m.key, ...level.flags, created_by: user!.id, updated_at: new Date().toISOString() });
    }
    if (upserts.length) {
      const { error } = await db.from('user_permissions').upsert(upserts, { onConflict: 'user_id,module_name' });
      if (error) throw error;
    }
    if (clear.length) {
      const { error } = await db.from('user_permissions').delete().eq('user_id', person.user_id).in('module_name', clear);
      if (error) throw error;
    }
  }, `Saved for ${person.name}`);

  const approve = () => run('approve', async () => {
    const { error } = await supabase.from('user_roles').update({ role_status: 'approved' }).eq('user_id', person.user_id);
    if (error) throw error;
  }, `${person.name} can now sign in`, false);

  const link = () => run('link', async () => {
    const { error } = await supabase.from('staff_profiles').update({ linked_user_id: person.user_id }).eq('id', profileId);
    if (error) throw error;
  }, 'Staff profile linked', false);

  return (
    <SidePanel
      open={!!person} onOpenChange={(o) => { if (!o) onClose(); }}
      title={person.name} description="Role, department and access"
      footer={<>
        <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>Close</Button>
        <Button className="flex-[2] sm:flex-none" disabled={!dirty || !!busy} onClick={save}>
          {busy === 'save' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save changes
        </Button>
      </>}
    >
      <div className="space-y-7">
        {person.status === 'pending' && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <span>Waiting for approval. They can’t use the app until approved.</span>
            <Button size="sm" disabled={!!busy} onClick={approve}>
              {busy === 'approve' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Approve
            </Button>
          </div>
        )}

        <section className="space-y-2.5">
          <h3 className="text-sm font-semibold">Role</h3>
          {self && <p className="text-xs text-muted-foreground">You can’t change your own role.</p>}
          <div role="radiogroup" aria-label="Role" className="grid gap-2">
            {ROLE_ORDER.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} disabled={self}
                onClick={() => setRole(r)}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60',
                  role === r ? 'border-primary bg-primary/5' : 'hover:border-foreground/30',
                )}>
                <span className={cn('mt-0.5 h-4 w-4 shrink-0 rounded-full border-2', role === r ? 'border-primary bg-primary' : 'border-muted-foreground/40')} />
                <span>
                  <span className="block text-sm font-semibold">{ROLE_INFO[r].label}</span>
                  <span className="block text-xs text-muted-foreground">{ROLE_INFO[r].summary}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <Label htmlFor="person-dept" className="text-sm font-semibold">Department</Label>
          <Select value={deptId} onValueChange={setDeptId}>
            <SelectTrigger id="person-dept"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DEPT}>No department</SelectItem>
              {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </section>

        <section className="space-y-2.5">
          <div>
            <h3 className="text-sm font-semibold">Access</h3>
            <p className="text-xs text-muted-foreground">
              {role === 'admin'
                ? 'Admins can reach everything, so there’s nothing to set here.'
                : `Each area follows ${deptName ? `the ${deptName} department` : 'their department (none set, so no access)'} unless you choose something else for ${person.name.split(' ')[0]}.`}
            </p>
          </div>
          {role !== 'admin' && (
            <div className="divide-y rounded-xl border">
              {MODULE_ACCESS.map((m) => {
                const fromDept = levelOf(m, dept ? deptPerms[dept]?.[m.key] : null);
                const choice = choices[m.key] ?? INHERIT;
                const current = person.overrides[m.key] ? levelOf(m, person.overrides[m.key]) : null;
                const result = choice === INHERIT ? fromDept
                  : choice === 'custom' ? current! : m.levels.find((l) => l.key === choice)!;
                return (
                  <div key={m.key} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground">{result.hint}</div>
                    </div>
                    <Select value={choice} onValueChange={(v) => setChoices((c) => ({ ...c, [m.key]: v }))}>
                      <SelectTrigger aria-label={`${m.label} access`}
                        className={cn(choice !== INHERIT && 'border-violet-400 dark:border-violet-500')}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={INHERIT}>Department: {fromDept.label}</SelectItem>
                        {m.levels.map((l) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}
                        {current?.key === 'custom' && <SelectItem value="custom">Custom (keep)</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">They’ll see changes the next time they open the app.</p>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Staff profile</h3>
          {person.staffProfile ? (
            <p className="flex items-center gap-2 text-sm"><UserRound className="h-4 w-4 text-primary" />Linked to {person.staffProfile}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Link their login to their staff record so payslips, leave and attendance show under Me.</p>
              <div className="flex gap-2">
                <Select value={profileId} onValueChange={setProfileId}>
                  <SelectTrigger aria-label="Staff profile" className="min-w-0 flex-1"><SelectValue placeholder={unlinked.length ? 'Choose a staff profile' : 'No unlinked profiles'} /></SelectTrigger>
                  <SelectContent>
                    {unlinked.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.full_name}{s.position ? ` (${s.position.replace(/_/g, ' ')})` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" disabled={!profileId || !!busy} onClick={link}>
                  {busy === 'link' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Link
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </SidePanel>
  );
}

// ── Departments ──────────────────────────────────────────────────────────────

function DepartmentsTab({ departments, people, deptPerms, onOpen, onCreated }: {
  departments: Department[];
  people: Person[];
  deptPerms: Record<string, Perms>;
  onOpen: (id: string) => void;
  onCreated: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from('departments').insert({ name: name.trim() }).select('id').single();
    setSaving(false);
    if (error) { toast({ title: 'Could not create the department', description: error.message, variant: 'destructive' }); return; }
    setName(''); setAdding(false);
    onCreated(data.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Open a department to set what its people can reach.</p>
        {adding ? (
          <div className="flex gap-2">
            <Input autoFocus aria-label="Department name" placeholder="Department name" value={name}
              className="min-w-0 flex-1 sm:w-56" onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setAdding(false); }} />
            <Button onClick={create} disabled={saving || !name.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setAdding(true)}><Plus className="mr-2 h-4 w-4" />New department</Button>
        )}
      </div>

      {departments.length === 0 ? (
        <EmptyState icon={Building2} tone="neutral" title="No departments yet" body="Create one, then put people in it." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((d) => {
            const members = people.filter((p) => p.departmentId === d.id).length;
            const summary = accessSummary((m) => deptPerms[d.id]?.[m]);
            return (
              <button key={d.id} type="button" onClick={() => onOpen(d.id)}
                className="flex flex-col gap-2 rounded-2xl border bg-card p-4 text-left transition-colors hover:border-foreground/30">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{d.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{members} {members === 1 ? 'person' : 'people'}</span>
                </div>
                {d.description && <span className="text-xs text-muted-foreground">{d.description}</span>}
                <span className="text-sm">{summary || <span className="text-muted-foreground">No business areas yet</span>}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DepartmentPanel({ dept, perms, members, onClose, onSaved, onOpenPerson }: {
  dept: Department | null;
  perms: Perms;
  members: Person[];
  onClose: () => void;
  onSaved: () => void;
  onOpenPerson: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [local, setLocal] = useState<Perms>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!dept) return;
    setName(dept.name); setDesc(dept.description ?? ''); setLocal(perms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept?.id]);

  if (!dept) return <SidePanel open={false} onOpenChange={onClose} title="" children={null} />;

  // Access saves as soon as it's chosen, like a switch.
  const setLevel = async (m: (typeof MODULE_ACCESS)[number], key: string) => {
    const level = m.levels.find((l) => l.key === key);
    if (!level) return;
    const prev = local[m.key];
    setLocal((p) => ({ ...p, [m.key]: level.flags }));
    setSaving(m.key);
    const { error } = await supabase.from('department_permissions').upsert(
      { department_id: dept.id, module_name: m.key, ...level.flags },
      { onConflict: 'department_id,module_name' },
    );
    setSaving(null);
    if (error) {
      setLocal((p) => ({ ...p, [m.key]: prev ?? NO_FLAGS }));
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
      return;
    }
    onSaved();
  };

  const detailsDirty = name.trim() !== dept.name || (desc.trim() || null) !== (dept.description || null);
  const saveDetails = async () => {
    if (!name.trim()) return;
    setSaving('details');
    const { error } = await supabase.from('departments').update({ name: name.trim(), description: desc.trim() || null }).eq('id', dept.id);
    setSaving(null);
    if (error) { toast({ title: 'Could not save', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Department updated' });
    onSaved();
  };

  return (
    <SidePanel open={!!dept} onOpenChange={(o) => { if (!o) onClose(); }} title={dept.name} description="Department access">
      <div className="space-y-7">
        <section className="space-y-2.5">
          <div>
            <h3 className="text-sm font-semibold">What {dept.name} can reach</h3>
            <p className="text-xs text-muted-foreground">Saved as you choose. Applies to everyone in the department except admins and anyone with personal access set.</p>
          </div>
          <div className="divide-y rounded-xl border">
            {MODULE_ACCESS.map((m) => {
              const level = levelOf(m, local[m.key]);
              return (
                <div key={m.key} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {m.label}{saving === m.key && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    </div>
                    <div className="text-xs text-muted-foreground">{level.key === 'none' ? m.description : level.hint}</div>
                  </div>
                  <Select value={level.key} onValueChange={(v) => setLevel(m, v)}>
                    <SelectTrigger aria-label={`${m.label} access for ${dept.name}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {m.levels.map((l) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}
                      {level.key === 'custom' && <SelectItem value="custom" disabled>Custom (set earlier)</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">People ({members.length})</h3>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one yet. Set someone’s department from the People tab.</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {members.map((p) => (
                <li key={p.user_id}>
                  <button type="button" onClick={() => onOpenPerson(p.user_id)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/40">
                    <InitialsAvatar name={p.name} size={28} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{ROLE_INFO[p.role].label}</span>
                    {Object.keys(p.overrides).length > 0 && p.role !== 'admin' && <StatusPill tone="violet" label="Personal" className="normal-case" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Details</h3>
          <div className="space-y-1.5">
            <Label htmlFor="dept-name">Name</Label>
            <Input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dept-desc">Description</Label>
            <Textarea id="dept-desc" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <Button variant="outline" disabled={!detailsDirty || !name.trim() || saving === 'details'} onClick={saveDetails}>
            {saving === 'details' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save details
          </Button>
        </section>
      </div>
    </SidePanel>
  );
}

// ── Roles ────────────────────────────────────────────────────────────────────

function RolesTab({ people }: { people: Person[] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        A role decides the people-side things someone gets. It doesn’t open business areas like Inventory or Sales; departments do that.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {ROLE_ORDER.map((r) => {
          const features = FEATURES.filter((f) => hasFeature(r, f));
          const count = people.filter((p) => p.role === r).length;
          return (
            <div key={r} className="space-y-3 rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-lg font-bold">{ROLE_INFO[r].label}</span>
                <span className="text-xs text-muted-foreground">{count} {count === 1 ? 'person' : 'people'}</span>
              </div>
              <p className="text-sm text-muted-foreground">{ROLE_INFO[r].summary}</p>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {[...features.map((f) => FEATURE_LABEL[f]), ...ROLE_EXTRAS[r]].map((t) => (
                  <li key={t} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />{t}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
