import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { ArrowLeft, Check, CheckCheck, ExternalLink, Inbox as InboxIcon, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useInbox, KIND_LABEL, type InboxItem, type InboxKind } from '@/hooks/useInbox';
import { useToast } from '@/hooks/use-toast';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ToastAction } from '@/components/ui/toast';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { summarizeAttendance } from '@/lib/attendance';
import { cn } from '@/lib/utils';
import {
  EmptyState, FieldGrid, FilterChips, InitialsAvatar, PageHeader, StatusPill, TypeTag,
} from '@/components/shell/ui';

const db = supabase as any;
type View = 'waiting' | 'mine';
type KindFilter = 'all' | InboxKind;

/** How long a decision can be taken back before it is written. */
const UNDO_MS = 5000;

/**
 * Kinds that can be decided straight from the list. Attendance weeks publish
 * to every staff member's portal and sign-ups grant access, so both still go
 * through the detail view where the summary is in front of the approver.
 */
const QUICK: InboxKind[] = ['expense', 'leave', 'inventory'];

const when = (iso: string) => {
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); } catch { return ''; }
};

const rejectWord = (item: InboxItem) => (item.kind === 'attendance' ? 'Send back' : 'Reject');

function AttendanceSummary({ weekId }: { weekId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['attendance-records', weekId],
    queryFn: async () => {
      const { data, error } = await db
        .from('attendance_records')
        .select('id, week_id, staff_profile_id, work_date, status, check_in, check_out, hr_note, corrected_from')
        .eq('week_id', weekId);
      if (error) throw error;
      return data ?? [];
    },
  });
  if (isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  const rows = data ?? [];
  const s = summarizeAttendance(rows);
  const staff = new Set(rows.map((r: any) => r.staff_profile_id)).size;
  return (
    <FieldGrid fields={[
      { label: 'Staff marked', value: String(staff) },
      { label: 'Days worked', value: `${s.worked} of ${s.expected}` },
      { label: 'Late', value: String(s.late) },
      { label: 'Absent', value: String(s.absent) },
      { label: 'On leave / excused', value: String(s.onLeave + s.excused) },
      { label: 'Attendance rate', value: s.rate === null ? '—' : `${s.rate}%` },
    ]} />
  );
}

function Row({ item, active, onOpen, onQuick }: {
  item: InboxItem;
  active: boolean;
  onOpen: () => void;
  /** Present when the item can be decided from the list. */
  onQuick?: (approve: boolean) => void;
}) {
  const who = item.who.replace(/^HR · /, '');
  return (
    <div className={cn(
      'flex flex-col gap-3 rounded-2xl border p-3.5 transition-colors lg:rounded-xl lg:p-0',
      active
        ? 'border-orange-300 bg-brand-soft dark:border-orange-500/40'
        : 'bg-card lg:border-transparent lg:hover:bg-accent/60',
    )}>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        className="flex w-full items-start gap-3 text-left lg:px-4 lg:py-3.5"
      >
        <InitialsAvatar name={who} size={40} className="max-lg:mt-0.5 lg:hidden" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center justify-between gap-2 text-[12.5px] text-muted-foreground">
            <span className="truncate"><b className="font-bold text-foreground">{who}</b>{item.dept ? ` · ${item.dept}` : ''}</span>
            <span className="shrink-0">{when(item.at)}</span>
          </span>
          <span className="text-[15px] font-bold leading-snug">{item.title}</span>
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <TypeTag kind={item.kind}>{KIND_LABEL[item.kind]}</TypeTag>
              {item.status && <StatusPill status={item.status} />}
            </span>
            {item.amount && <span className="shrink-0 font-display text-base font-bold tabular-nums">{item.amount}</span>}
          </span>
        </span>
      </button>
      {onQuick && (
        <div className="flex gap-2 lg:hidden">
          {item.canReject && (
            <Button variant="outline" onClick={() => onQuick(false)} className="h-11 flex-1">
              {rejectWord(item)}
            </Button>
          )}
          <Button onClick={() => onQuick(true)} className="h-11 flex-1">
            <Check className="h-4 w-4" aria-hidden />Approve
          </Button>
        </div>
      )}
    </div>
  );
}

function Detail({ item, view, onDecide, onBack, inSheet }: {
  item: InboxItem;
  view: View;
  onDecide: (approve: boolean, note: string) => void;
  onBack?: () => void;
  inSheet?: boolean;
}) {
  const [note, setNote] = useState('');
  useEffect(() => setNote(''), [item.key]);
  const deciding = view === 'waiting';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn('flex-1 space-y-5 overflow-y-auto pb-4', inSheet ? 'px-5 pt-2' : 'px-1 lg:px-8 lg:py-7')}>
        {onBack && (
          <button type="button" onClick={onBack} className="-ml-1 inline-flex h-11 items-center gap-2 text-sm font-semibold text-muted-foreground">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to list
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <TypeTag kind={item.kind}>{KIND_LABEL[item.kind]}</TypeTag>
          {item.status && <StatusPill status={item.status} />}
          <span className="text-[13px] text-muted-foreground">{when(item.at)}</span>
        </div>
        <div>
          <h2 className="font-display text-2xl font-bold leading-tight sm:text-[1.625rem]">{item.title}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{item.who}{item.dept ? ` · ${item.dept}` : ''}</p>
        </div>
        {item.amount && (
          <div className="font-display text-[2rem] font-bold tabular-nums text-brand-soft-foreground sm:text-4xl">{item.amount}</div>
        )}
        {item.detail && <p className="max-w-2xl text-[15px] leading-relaxed text-foreground/85">{item.detail}</p>}
        {item.kind === 'attendance' && deciding && <AttendanceSummary weekId={item.rowId} />}
        {item.fields.length > 0 && <FieldGrid fields={item.fields} />}
        {deciding && item.kind !== 'signup' && (
          <div className="max-w-2xl space-y-1.5">
            <Label htmlFor="decision-note">Note to {item.who.replace(/^HR · /, '')} <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="decision-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder={item.kind === 'attendance' ? 'What needs changing, if you send it back' : 'Sent with your decision'} />
          </div>
        )}
        <Link to={item.href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          Open the full record <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      {deciding && (
        <div className={cn(
          'flex shrink-0 gap-2.5 border-t bg-card py-3',
          inSheet ? 'px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'lg:justify-end lg:px-8 lg:py-4',
        )}>
          {item.canReject && (
            <Button variant="outline" onClick={() => onDecide(false, note)}
              className="h-12 flex-1 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-500/30 dark:text-red-400 lg:h-10 lg:flex-none">
              <X className="mr-1.5 h-4 w-4" aria-hidden />{rejectWord(item)}
            </Button>
          )}
          <Button onClick={() => onDecide(true, note)} className="h-12 flex-[2] lg:h-10 lg:flex-none">
            <Check className="mr-1.5 h-4 w-4" aria-hidden />{item.approveLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

interface Queued { item: InboxItem; approve: boolean; note: string; timer: number }

/**
 * Decisions wait UNDO_MS before they are written, so a mis-tap can be taken
 * back without anything reaching the ledger or the requester. Anything still
 * waiting is written at once if the person leaves the page or the app.
 */
function useDecisionQueue() {
  const { decide } = useInbox();
  const { toast } = useToast();
  const queue = useRef(new Map<string, Queued>());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const mutate = useRef(decide.mutate);
  mutate.current = decide.mutate;

  const unhide = (key: string) => setHidden((h) => { const n = new Set(h); n.delete(key); return n; });

  const commit = useCallback((key: string) => {
    const q = queue.current.get(key);
    if (!q) return;
    queue.current.delete(key);
    window.clearTimeout(q.timer);
    mutate.current({ item: q.item, approve: q.approve, note: q.note }, {
      onError: (e: any) => {
        unhide(key);
        toast({ title: 'That didn’t go through', description: `${q.item.title}: ${e.message}`, variant: 'destructive' });
      },
    });
  }, [toast]);

  const undo = useCallback((key: string) => {
    const q = queue.current.get(key);
    if (!q) return;
    window.clearTimeout(q.timer);
    queue.current.delete(key);
    unhide(key);
  }, []);

  const enqueue = useCallback((item: InboxItem, approve: boolean, note = '') => {
    const timer = window.setTimeout(() => commit(item.key), UNDO_MS);
    queue.current.set(item.key, { item, approve, note, timer });
    setHidden((h) => new Set(h).add(item.key));
    const verb = approve ? 'Approved' : item.kind === 'attendance' ? 'Sent back' : 'Rejected';
    toast({
      title: `${verb} · ${item.title}`,
      description: item.whoUserId ? `${item.who.replace(/^HR · /, '')} will be told.` : undefined,
      duration: UNDO_MS,
      action: <ToastAction altText="Undo" onClick={() => undo(item.key)} className="h-10 font-bold">Undo</ToastAction>,
    });
  }, [commit, toast, undo]);

  // Leaving the page or backgrounding the app writes what's waiting now.
  useEffect(() => {
    const flush = () => Array.from(queue.current.keys()).forEach(commit);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [commit]);

  return { hidden, enqueue };
}

export default function Inbox() {
  const { canApproveAnything, waiting: allWaiting, mine, loading } = useInbox();
  const { hidden, enqueue } = useDecisionQueue();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [params, setParams] = useSearchParams();

  const waiting = useMemo(() => allWaiting.filter((i) => !hidden.has(i.key)), [allWaiting, hidden]);
  const view: View = canApproveAnything && params.get('view') !== 'mine' ? 'waiting' : 'mine';
  const kind = (params.get('kind') ?? 'all') as KindFilter;
  const selectedKey = params.get('item');

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const source = view === 'waiting' ? waiting : mine;
  const kinds: InboxKind[] = ['expense', 'leave', 'attendance', 'inventory', 'signup'];
  const chips = [
    { value: 'all' as KindFilter, label: 'All', count: source.length },
    ...kinds
      .filter((k) => source.some((i) => i.kind === k))
      .map((k) => ({ value: k as KindFilter, label: KIND_LABEL[k], count: source.filter((i) => i.kind === k).length })),
  ];
  const visible = useMemo(
    () => (kind === 'all' ? source : source.filter((i) => i.kind === kind)),
    [source, kind],
  );

  // Desktop always shows something on the right; a phone opens a sheet only
  // when an item is tapped. A decided item drops out of `visible`, so the
  // desktop selection moves on to the next one by itself.
  const selected = visible.find((i) => i.key === selectedKey) ?? (wide ? visible[0] : undefined);

  const decideSelected = (item: InboxItem, approve: boolean, note: string) => {
    enqueue(item, approve, note);
    if (!wide) set({ item: null });
  };

  const list = (
    <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto lg:gap-1 lg:rounded-2xl lg:border lg:bg-card lg:p-2">
      {loading && source.length === 0 ? (
        [0, 1, 2].map((i) => <Skeleton key={i} className="h-[132px] w-full rounded-2xl lg:h-[104px]" />)
      ) : visible.length === 0 ? (
        <EmptyState
          icon={view === 'waiting' ? CheckCheck : InboxIcon}
          tone={view === 'waiting' ? 'good' : 'neutral'}
          title={view === 'waiting' ? 'You’re all caught up' : 'No requests yet'}
          body={view === 'waiting'
            ? 'New approvals will show up here and on the Inbox badge.'
            : 'Leave, expense claims and stock requests you make will be tracked here.'}
        />
      ) : (
        visible.map((i) => (
          <Row
            key={i.key}
            item={i}
            active={wide && i.key === selected?.key}
            onOpen={() => set({ item: i.key })}
            onQuick={view === 'waiting' && QUICK.includes(i.kind) ? (approve) => enqueue(i, approve) : undefined}
          />
        ))
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100svh-64px-64px)] lg:gap-5">
      <PageHeader
        className="max-lg:hidden"
        title={view === 'waiting' ? 'Inbox' : 'My requests'}
        description={view === 'waiting'
          ? 'Everything waiting on you, in one place. Decide without leaving the page.'
          : 'Everything you’ve asked for, and where it stands.'}
      />
      <div className="flex flex-col gap-3">
        {canApproveAnything && (
          // A two-way switch reads better as a segmented control on a phone.
          <div role="group" aria-label="Show" className="flex rounded-2xl bg-muted p-1 lg:hidden">
            {([['waiting', 'Waiting on me', waiting.length], ['mine', 'My requests', mine.length]] as const).map(([v, label, n]) => (
              <button key={v} type="button" aria-pressed={view === v}
                onClick={() => set({ view: v === 'mine' ? 'mine' : null, kind: null, item: null })}
                className={cn(
                  'h-10 flex-1 rounded-xl text-sm font-bold transition-colors',
                  view === v ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
                )}>
                {label} <span className="tabular-nums opacity-70">{n}</span>
              </button>
            ))}
          </div>
        )}
        {canApproveAnything && (
          <FilterChips
            className="max-lg:hidden"
            label="Show"
            value={view}
            onChange={(v) => set({ view: v === 'mine' ? 'mine' : null, kind: null, item: null })}
            options={[
              { value: 'waiting', label: 'Waiting on me', count: waiting.length },
              { value: 'mine', label: 'My requests', count: mine.length },
            ]}
          />
        )}
        {chips.length > 2 && (
          <FilterChips label="Type" value={kind} onChange={(v) => set({ kind: v === 'all' ? null : v, item: null })} options={chips} />
        )}
      </div>

      {wide ? (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
          {list}
          <div className="min-h-0 overflow-hidden rounded-2xl border bg-card">
            {selected ? (
              <Detail item={selected} view={view} onDecide={(a, n) => decideSelected(selected, a, n)} />
            ) : (
              <EmptyState className="h-full" icon={CheckCheck} title="You’re all caught up"
                body="Pick an item on the left to see it here." />
            )}
          </div>
        </div>
      ) : (
        <>
          {list}
          <Sheet open={!!selected} onOpenChange={(o) => { if (!o) set({ item: null }); }}>
            <SheetContent side="bottom" className="flex max-h-[92svh] flex-col gap-0 p-0 pb-0">
              <div aria-hidden className="mx-auto mb-1 mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border" />
              <SheetTitle className="sr-only">{selected?.title ?? 'Request'}</SheetTitle>
              <SheetDescription className="sr-only">Details and decision</SheetDescription>
              {selected && (
                <Detail item={selected} view={view} inSheet onDecide={(a, n) => decideSelected(selected, a, n)} />
              )}
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  );
}
