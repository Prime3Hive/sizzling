// One queue for everything waiting on the signed-in person, plus the requests
// they have made themselves.
//
// Nothing here widens who may decide what. Each source is only fetched for the
// people its own page already lets decide it, and each decision writes the same
// columns that page writes. Where that page tells the requester, the same
// message goes; expenses and stock requests, whose pages send nothing, now tell
// the requester too, so a decision made from here never goes unheard. The database stays
// the authority: an expense status change by a non-admin is refused by a
// trigger whatever this file does.
//
//   expense     admin            Expenses.tsx          (trigger posts the journal)
//   leave       admin            StaffLeaveRequests    (canManage = isAdmin)
//   attendance  approve_attendance  Attendance.tsx     (weeks in "submitted")
//   inventory   admin / manager  InventoryRequests.tsx
//   production  production·update Production.tsx      (runs in "submitted"; the
//                                 database refuses self-approval by non-admins)
//   signup      approve_roles    UserManagement.tsx    (approve only; no reject there)

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { formatNairaCompact } from '@/lib/currency';
import { formatMinor } from '@/lib/money';
import { weekDays } from '@/lib/attendance';
import { approveProductionRun, describeInPacks, fmtQty, rejectProductionRun, unitsFor } from '@/lib/production';

const db = supabase as any;

export type InboxKind = 'expense' | 'leave' | 'attendance' | 'inventory' | 'production' | 'signup';

export const KIND_LABEL: Record<InboxKind, string> = {
  expense: 'Expense',
  leave: 'Leave',
  attendance: 'Attendance',
  inventory: 'Stock request',
  production: 'Production',
  signup: 'Sign-up',
};

export interface InboxItem {
  /** `${kind}:${rowId}` — unique across sources. */
  key: string;
  kind: InboxKind;
  rowId: string;
  title: string;
  who: string;
  whoUserId: string | null;
  dept: string | null;
  at: string;             // ISO timestamp used for sorting and "when"
  amount: string | null;  // headline figure: money, days, units
  detail: string | null;
  fields: { label: string; value: string }[];
  /** Where the full record lives, for anything the Inbox does not show. */
  href: string;
  canReject: boolean;
  approveLabel: string;
  /** Status, for the person's own requests. */
  status?: string;
}

const daysBetween = (a: string, b: string) =>
  Math.floor((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000) + 1;

const dateRange = (a: string, b: string) => {
  const s = parseISO(a), e = parseISO(b);
  return s.getMonth() === e.getMonth()
    ? `${format(s, 'd')}–${format(e, 'd MMM')}`
    : `${format(s, 'd MMM')} – ${format(e, 'd MMM')}`;
};

const humanise = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ');

const expenseAmount = (e: { amount_minor?: number | null; amount: number }) =>
  formatMinor(BigInt(e.amount_minor ?? Math.round((Number(e.amount) || 0) * 100)));

export function useInbox() {
  const { user } = useAuth();
  const { isAdmin, isManager, canFeature, hasPermission, userRole } = useRoles();
  const qc = useQueryClient();
  const approved = userRole?.role_status === 'approved';

  const can = {
    expense: isAdmin,
    leave: isAdmin,
    attendance: canFeature('approve_attendance'),
    inventory: isAdmin || isManager,
    production: hasPermission('production', 'update'),
    signup: canFeature('approve_roles'),
  };
  const canApproveAnything = Object.values(can).some(Boolean);

  // Names: expenses, stock requests and sign-ups only carry a user id.
  const { data: names = {} } = useQuery<Record<string, string>>({
    queryKey: ['inbox-names'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('user_id, full_name');
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p) => [p.user_id, p.full_name ?? '']));
    },
    enabled: !!user && approved,
    staleTime: 5 * 60_000,
  });
  const nameOf = (id: string | null | undefined) => (id && names[id]) || 'Someone';

  const poll = { refetchInterval: 60_000, staleTime: 30_000 } as const;

  // ── Waiting on me ──────────────────────────────────────────────────────────

  const expensesQ = useQuery({
    queryKey: ['inbox', 'expense'],
    queryFn: async () => {
      const { data, error } = await db
        .from('expenses')
        .select('id, description, amount, amount_minor, category, date, created_at, submitted_by, user_id, payee_name, receipt_path, cost_center, payees(name), budgets(title)')
        .eq('status', 'pending')
        .is('cancelled_at', null)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && can.expense,
    ...poll,
  });

  const leaveQ = useQuery({
    queryKey: ['inbox', 'leave'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_leave_requests')
        .select('id, user_id, leave_type, start_date, end_date, reason, created_at, staff_profiles(full_name, position, departments(name))')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!user && can.leave,
    ...poll,
  });

  const attendanceQ = useQuery({
    queryKey: ['inbox', 'attendance'],
    queryFn: async () => {
      const { data, error } = await db
        .from('attendance_weeks')
        .select('id, week_start, week_end, hr_comment, submitted_at, submitted_by')
        .eq('status', 'submitted')
        .order('week_start', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && can.attendance,
    ...poll,
  });

  const inventoryQ = useQuery({
    queryKey: ['inbox', 'inventory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_requests')
        .select(`
          id, user_id, requested_quantity, notes, created_at, request_date,
          skus(name, unit_of_measure, stock_quantity),
          inventory_request_items(id, requested_quantity, kind, item_name, amount, skus(name, unit_of_measure, stock_quantity))
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!user && can.inventory,
    ...poll,
  });

  const productionQ = useQuery({
    queryKey: ['inbox', 'production'],
    queryFn: async () => {
      let q = db
        .from('production_runs')
        .select(`
          id, run_number, production_date, output_qty, batches, notes, recorded_by, recorded_at,
          products(name, uom, product_units(unit_name, factor)),
          stock_lots!production_runs_lot_fk(lot_number, expires_on),
          production_run_inputs(id),
          production_run_costs(amount)
        `)
        .eq('status', 'submitted');
      // Self-approval is refused unless admin; don't offer what will fail.
      if (!isAdmin) q = q.neq('recorded_by', user!.id);
      const { data, error } = await q.order('recorded_at', { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!user && can.production,
    ...poll,
  });

  const signupQ = useQuery({
    queryKey: ['inbox', 'signup'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_roles')
        .select('id, user_id, role, assigned_at, departments(name)')
        .eq('role_status', 'pending')
        .order('assigned_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!user && can.signup,
    ...poll,
  });

  const waiting: InboxItem[] = useMemo(() => {
    const items: InboxItem[] = [];

    for (const e of expensesQ.data ?? []) {
      const by = e.submitted_by ?? e.user_id;
      items.push({
        key: `expense:${e.id}`, kind: 'expense', rowId: e.id,
        title: e.description || 'Expense',
        who: nameOf(by), whoUserId: by ?? null, dept: e.cost_center ?? null,
        at: e.created_at, amount: expenseAmount(e),
        detail: null,
        fields: [
          { label: 'Date', value: format(parseISO(e.date), 'd MMM yyyy') },
          { label: 'Category', value: e.category || '—' },
          { label: 'Payee', value: e.payees?.name ?? e.payee_name ?? '—' },
          { label: 'Budget', value: e.budgets?.title ?? '—' },
          { label: 'Receipt', value: e.receipt_path ? 'Attached' : 'None attached' },
          { label: 'On approval', value: 'Posts to the general ledger' },
        ],
        href: '/expenses',
        canReject: true, approveLabel: 'Approve',
      });
    }

    for (const r of leaveQ.data ?? []) {
      const days = daysBetween(r.start_date, r.end_date);
      items.push({
        key: `leave:${r.id}`, kind: 'leave', rowId: r.id,
        title: `${humanise(r.leave_type).replace(/^\w/, (c: string) => c.toUpperCase())} leave · ${dateRange(r.start_date, r.end_date)}`,
        who: r.staff_profiles?.full_name ?? nameOf(r.user_id), whoUserId: r.user_id,
        dept: r.staff_profiles?.departments?.name ?? null,
        at: r.created_at, amount: `${days} day${days === 1 ? '' : 's'}`,
        detail: r.reason || null,
        fields: [
          { label: 'Type', value: humanise(r.leave_type) },
          { label: 'From', value: format(parseISO(r.start_date), 'EEE d MMM yyyy') },
          { label: 'To', value: format(parseISO(r.end_date), 'EEE d MMM yyyy') },
          { label: 'Position', value: humanise(r.staff_profiles?.position) || '—' },
        ],
        href: '/staff-portal?tab=leave',
        canReject: true, approveLabel: 'Approve',
      });
    }

    for (const w of attendanceQ.data ?? []) {
      items.push({
        key: `attendance:${w.id}`, kind: 'attendance', rowId: w.id,
        title: `Attendance · week of ${format(parseISO(w.week_start), 'd MMM')}`,
        who: `HR · ${nameOf(w.submitted_by)}`, whoUserId: w.submitted_by ?? null, dept: 'HR',
        at: w.submitted_at ?? w.week_start,
        amount: dateRange(w.week_start, w.week_end ?? w.week_start),
        detail: w.hr_comment || 'HR has marked this week. Approving publishes it to every staff portal.',
        fields: [],
        href: `/attendance?tab=weeks`,
        canReject: true, approveLabel: 'Approve & publish',
      });
    }

    for (const r of inventoryQ.data ?? []) {
      const lines: any[] = r.inventory_request_items?.length
        ? r.inventory_request_items
        : [{ requested_quantity: r.requested_quantity, kind: 'sku', skus: r.skus }];
      const describe = (l: any) => l.kind === 'misc'
        ? `${l.item_name ?? 'Item'} × ${Number(l.requested_quantity)}`
        : `${l.skus?.name ?? 'Item'} × ${Number(l.requested_quantity)} ${l.skus?.unit_of_measure ?? ''}`.trim();
      const miscTotal = lines.filter((l) => l.kind === 'misc').reduce((s, l) => s + Number(l.amount ?? 0), 0);
      items.push({
        key: `inventory:${r.id}`, kind: 'inventory', rowId: r.id,
        title: lines.length === 1 ? describe(lines[0]) : `${describe(lines[0])} + ${lines.length - 1} more`,
        who: nameOf(r.user_id), whoUserId: r.user_id, dept: null,
        at: r.created_at, amount: `${lines.length} line${lines.length === 1 ? '' : 's'}`,
        detail: r.notes || null,
        fields: [
          ...lines.slice(0, 6).map((l, i) => ({
            label: `Line ${i + 1}`,
            value: l.kind === 'misc' || l.skus?.stock_quantity == null
              ? describe(l)
              : `${describe(l)} · ${Number(l.skus.stock_quantity)} in stock`,
          })),
          ...(miscTotal > 0 ? [{ label: 'Estimated cost', value: formatNairaCompact(miscTotal) }] : []),
        ],
        href: '/business/inventory-requests',
        canReject: true, approveLabel: 'Approve',
      });
    }

    for (const r of productionQ.data ?? []) {
      const units = unitsFor(r.products?.uom, (r.products?.product_units ?? []).map((u: any) => ({ name: u.unit_name, factor: Number(u.factor) })));
      const qty = describeInPacks(Number(r.output_qty), units);
      const expenses = (r.production_run_costs ?? []).reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
      items.push({
        key: `production:${r.id}`, kind: 'production', rowId: r.id,
        title: `${r.products?.name ?? 'Production'} · ${qty}`,
        who: nameOf(r.recorded_by), whoUserId: r.recorded_by ?? null, dept: null,
        at: r.recorded_at, amount: qty,
        detail: r.notes || null,
        fields: [
          { label: 'Run', value: r.run_number },
          { label: 'Lot', value: r.stock_lots?.lot_number ?? '—' },
          { label: 'Produced on', value: format(parseISO(r.production_date), 'd MMM yyyy') },
          { label: 'Batches', value: r.batches != null ? fmtQty(Number(r.batches)) : '—' },
          { label: 'Materials', value: `${r.production_run_inputs?.length ?? 0} line${r.production_run_inputs?.length === 1 ? '' : 's'}` },
          ...(expenses > 0 ? [{ label: 'Production expenses', value: formatNairaCompact(expenses) }] : []),
          { label: 'On approval', value: 'Materials leave stock, the batch enters stock, and the cost posts to the ledger' },
        ],
        href: '/business/production',
        canReject: true, approveLabel: 'Approve into stock',
      });
    }

    for (const r of signupQ.data ?? []) {
      const role = r.role === 'hr' ? 'HR' : humanise(r.role);
      items.push({
        key: `signup:${r.id}`, kind: 'signup', rowId: r.user_id,
        title: `${nameOf(r.user_id)} · ${role} access`,
        who: nameOf(r.user_id), whoUserId: r.user_id, dept: r.departments?.name ?? null,
        at: r.assigned_at, amount: role,
        detail: `Approving gives ${role} access${r.departments?.name ? ` in ${r.departments.name}` : ''}. You can change the role later in Users.`,
        fields: [
          { label: 'Role on approval', value: role },
          { label: 'Department', value: r.departments?.name ?? 'None yet' },
        ],
        href: '/users',
        // User management has no reject; a wrong role is corrected there.
        canReject: false, approveLabel: 'Approve access',
      });
    }

    return items.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expensesQ.data, leaveQ.data, attendanceQ.data, inventoryQ.data, productionQ.data, signupQ.data, names]);

  // ── My own requests ────────────────────────────────────────────────────────

  const mineQ = useQuery({
    queryKey: ['inbox', 'mine', user?.id],
    queryFn: async () => {
      const [leave, expenses, stock, production] = await Promise.all([
        supabase.from('staff_leave_requests')
          .select('id, leave_type, start_date, end_date, status, reason, admin_response, created_at, responded_at')
          .eq('user_id', user!.id).order('created_at', { ascending: false }).limit(20),
        db.from('expenses')
          .select('id, description, amount, amount_minor, category, date, status, created_at')
          .eq('submitted_by', user!.id).is('cancelled_at', null)
          .order('created_at', { ascending: false }).limit(20),
        supabase.from('inventory_requests')
          .select('id, status, created_at, notes, rejected_reason, skus(name), inventory_request_items(item_name, kind, skus(name))')
          .eq('user_id', user!.id).order('created_at', { ascending: false }).limit(20),
        db.from('production_runs')
          .select('id, run_number, status, output_qty, recorded_at, decision_note, products(name, uom)')
          .eq('recorded_by', user!.id).order('recorded_at', { ascending: false }).limit(20),
      ]);
      return {
        leave: (leave.data ?? []) as any[],
        expenses: (expenses.data ?? []) as any[],
        stock: (stock.data ?? []) as any[],
        // Before the production migration is applied the table is missing;
        // that must not hide everything else.
        production: (production.error ? [] : production.data ?? []) as any[],
      };
    },
    enabled: !!user && approved,
    ...poll,
  });

  const mine: InboxItem[] = useMemo(() => {
    const d = mineQ.data;
    if (!d) return [];
    const items: InboxItem[] = [];
    for (const r of d.leave) {
      const days = daysBetween(r.start_date, r.end_date);
      items.push({
        key: `leave:${r.id}`, kind: 'leave', rowId: r.id,
        title: `${humanise(r.leave_type).replace(/^\w/, (c: string) => c.toUpperCase())} leave · ${dateRange(r.start_date, r.end_date)}`,
        who: 'You', whoUserId: user?.id ?? null, dept: null,
        at: r.created_at, amount: `${days} day${days === 1 ? '' : 's'}`,
        detail: r.admin_response ? `Response: ${r.admin_response}` : r.reason,
        fields: [
          { label: 'From', value: format(parseISO(r.start_date), 'EEE d MMM yyyy') },
          { label: 'To', value: format(parseISO(r.end_date), 'EEE d MMM yyyy') },
          ...(r.responded_at ? [{ label: 'Decided', value: format(parseISO(r.responded_at), 'd MMM yyyy') }] : []),
        ],
        href: '/staff-portal?tab=leave', canReject: false, approveLabel: '', status: r.status,
      });
    }
    for (const e of d.expenses) {
      items.push({
        key: `expense:${e.id}`, kind: 'expense', rowId: e.id,
        title: e.description || 'Expense', who: 'You', whoUserId: user?.id ?? null, dept: null,
        at: e.created_at, amount: expenseAmount(e), detail: null,
        fields: [
          { label: 'Date', value: format(parseISO(e.date), 'd MMM yyyy') },
          { label: 'Category', value: e.category || '—' },
        ],
        href: '/staff-portal?tab=reports', canReject: false, approveLabel: '', status: e.status ?? 'approved',
      });
    }
    for (const r of d.stock) {
      const first = r.inventory_request_items?.[0];
      const name = first ? (first.kind === 'misc' ? first.item_name : first.skus?.name) : r.skus?.name;
      const more = (r.inventory_request_items?.length ?? 1) - 1;
      items.push({
        key: `inventory:${r.id}`, kind: 'inventory', rowId: r.id,
        title: `${name ?? 'Stock request'}${more > 0 ? ` + ${more} more` : ''}`,
        who: 'You', whoUserId: user?.id ?? null, dept: null,
        at: r.created_at, amount: null,
        detail: r.rejected_reason ? `Reason: ${r.rejected_reason}` : r.notes,
        fields: [],
        href: '/business/inventory-requests', canReject: false, approveLabel: '', status: r.status,
      });
    }
    for (const r of d.production) {
      const status = r.status === 'submitted' ? 'pending' : r.status === 'cancelled' ? 'withdrawn' : r.status;
      items.push({
        key: `production:${r.id}`, kind: 'production', rowId: r.id,
        title: `${r.products?.name ?? 'Production'} · ${fmtQty(Number(r.output_qty))} ${r.products?.uom ?? ''}`.trim(),
        who: 'You', whoUserId: user?.id ?? null, dept: null,
        at: r.recorded_at, amount: r.run_number,
        detail: r.decision_note ? `Note: ${r.decision_note}` : null,
        fields: [],
        href: '/business/production', canReject: false, approveLabel: '', status,
      });
    }
    return items.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  }, [mineQ.data, user?.id]);

  // ── Decisions ──────────────────────────────────────────────────────────────

  const notify = async (userId: string | null, title: string, message: string, type: string, relatedId?: string) => {
    if (!userId || userId === user?.id) return;
    await db.from('notifications').insert({ user_id: userId, title, message, type, related_id: relatedId ?? null });
  };

  const decide = useMutation({
    mutationFn: async ({ item, approve, note }: { item: InboxItem; approve: boolean; note?: string }) => {
      const now = new Date().toISOString();
      const trimmed = note?.trim() || null;

      switch (item.kind) {
        case 'expense': {
          const { error } = await supabase.from('expenses')
            .update({ status: approve ? 'approved' : 'rejected' }).eq('id', item.rowId);
          if (error) throw error;
          await notify(item.whoUserId, `Expense ${approve ? 'approved' : 'rejected'}`,
            `Your expense "${item.title}" (${item.amount}) was ${approve ? 'approved' : 'rejected'}.${trimmed ? ' ' + trimmed : ''}`,
            'expense');
          break;
        }
        case 'leave': {
          const status = approve ? 'approved' : 'rejected';
          const { error } = await supabase.from('staff_leave_requests')
            .update({ status, admin_response: trimmed ?? '', responded_by: user!.id, responded_at: now })
            .eq('id', item.rowId);
          if (error) throw error;
          await notify(item.whoUserId, `Leave Request ${approve ? 'Approved' : 'Rejected'}`,
            `Your ${item.title.split(' · ')[0].toLowerCase()} request has been ${status}.${trimmed ? ' Response: ' + trimmed : ''}`,
            'leave_request');
          break;
        }
        case 'attendance': {
          const patch: Record<string, unknown> = { status: approve ? 'approved' : 'rejected' };
          if (trimmed !== null || !approve) patch.review_note = trimmed;
          const { error } = await db.from('attendance_weeks').update(patch).eq('id', item.rowId);
          if (error) throw error;
          if (approve) {
            // Same message Attendance.tsx sends: every marked staff member hears once.
            const week = (attendanceQ.data ?? []).find((w: any) => w.id === item.rowId);
            const start = week ? weekDays(week.week_start)[0] : null;
            const { data: marked } = await db.from('attendance_records')
              .select('user_id').eq('week_id', item.rowId).not('user_id', 'is', null);
            const uids = new Set<string>((marked ?? []).map((m: any) => m.user_id));
            for (const uid of uids) {
              await db.from('notifications').insert({
                user_id: uid,
                title: 'Attendance published',
                message: `Your attendance for the week of ${start ? format(parseISO(start), 'd MMM yyyy') : 'last week'} is now on your portal.`,
                type: 'attendance',
              });
            }
          } else {
            await notify(item.whoUserId, 'Attendance sent back',
              `The attendance report for ${item.amount} was sent back.${trimmed ? ' ' + trimmed : ''}`,
              'attendance_report', item.rowId);
          }
          break;
        }
        case 'inventory': {
          const { error } = await supabase.from('inventory_requests').update(
            approve
              ? { status: 'approved', approved_by: user!.id, approved_at: now }
              : { status: 'rejected', approved_by: user!.id, approved_at: now, rejected_reason: trimmed },
          ).eq('id', item.rowId);
          if (error) throw error;
          await notify(item.whoUserId, `Stock request ${approve ? 'approved' : 'rejected'}`,
            `Your request "${item.title}" was ${approve ? 'approved' : 'rejected'}.${trimmed ? ' ' + trimmed : ''}`,
            'inventory');
          break;
        }
        case 'production': {
          // The database moves the stock, posts the ledger and tells the recorder.
          if (approve) await approveProductionRun(item.rowId, trimmed ?? undefined);
          else await rejectProductionRun(item.rowId, trimmed ?? undefined);
          break;
        }
        case 'signup': {
          if (!approve) throw new Error('Sign-ups are corrected in Users, not rejected here.');
          const { error } = await supabase.from('user_roles')
            .update({ role_status: 'approved' }).eq('user_id', item.rowId);
          if (error) throw error;
          break;
        }
      }
    },
    onSuccess: (_d, { item }) => {
      qc.invalidateQueries({ queryKey: ['inbox'] });
      // Keep the full pages in step with what was just decided here.
      const related: Record<InboxKind, string[][]> = {
        expense: [['expenses'], ['pl-expenses'], ['budgets-with-spend'], ['budgets-page']],
        leave: [['leave-requests']],
        attendance: [['attendance-weeks'], ['attendance-week']],
        inventory: [['inventory-requests']],
        production: [['production'], ['inventory-data'], ['inventory-item']],
        signup: [['user-role-data'], ['user-management']],
      };
      for (const key of related[item.kind]) qc.invalidateQueries({ queryKey: key });
    },
  });

  const loading = [expensesQ, leaveQ, attendanceQ, inventoryQ, productionQ, signupQ, mineQ]
    .some((q) => q.isLoading && q.fetchStatus !== 'idle');

  return {
    can,
    canApproveAnything,
    waiting,
    mine,
    myPending: mine.filter((m) => m.status === 'pending'),
    loading,
    decide,
  };
}
