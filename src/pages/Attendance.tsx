import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  CalendarCheck, ChevronLeft, ChevronRight, Send, CheckCircle2, XCircle,
  Lock, Loader2, MessageSquare, Inbox, ClipboardList, Undo2,
} from 'lucide-react';
import {
  ATTENDANCE_STATUSES, ATTENDANCE_STATUS_LIST, WEEK_STATUS_COLOR, WEEK_STATUS_LABEL,
  REVIEW_STATUS_COLOR, statusLabel, statusColor, summarizeAttendance, rateColor,
  weekStartOf, weekDays, addWeeks, todayIso,
  type AttendanceStatus, type WeekStatus,
} from '@/lib/attendance';

// The attendance tables post-date the generated Supabase types, so they are
// reached through the untyped client the same way the other newer modules are.
const db = supabase as any;

interface StaffRow {
  id: string;
  full_name: string;
  position: string | null;
  departments?: { name: string } | null;
}

interface WeekRow {
  id: string;
  week_start: string;
  week_end: string;
  status: WeekStatus;
  hr_comment: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

interface RecordRow {
  id: string;
  week_id: string;
  staff_profile_id: string;
  work_date: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  hr_note: string | null;
  corrected_from: string | null;
}

interface ReviewRow {
  id: string;
  record_id: string;
  user_id: string;
  claimed_status: AttendanceStatus | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  attendance_records?: {
    work_date: string;
    status: AttendanceStatus;
    hr_note: string | null;
    staff_profiles?: { full_name: string } | null;
  } | null;
}

const ATTENDANCE_TABS = ['mark', 'weeks', 'reviews'];

/** A cell being edited in the marking grid. */
interface CellDraft {
  status: AttendanceStatus;
  check_in: string;
  check_out: string;
  hr_note: string;
}

export default function Attendance() {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const { toast } = useToast();
  const qc = useQueryClient();

  // The week being looked at and the open tab live in the URL rather than in
  // component state, so the "attendance submitted" notification can put an
  // admin on the exact week awaiting them instead of on whatever week today
  // falls in, and so "Open" on a report row is a real link to that week.
  const [searchParams, setSearchParams] = useSearchParams();

  const weekParam = searchParams.get('week');
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(weekParam ?? '')
    ? weekStartOf(weekParam!)
    : weekStartOf(todayIso());

  const tabParam = searchParams.get('tab');
  const tab = ATTENDANCE_TABS.includes(tabParam ?? '') ? tabParam! : 'mark';

  const setParams = (next: { week?: string; tab?: string }) => {
    const p = new URLSearchParams(searchParams);
    if (next.week !== undefined) p.set('week', next.week);
    if (next.tab !== undefined) {
      if (next.tab === 'mark') p.delete('tab');
      else p.set('tab', next.tab);
    }
    setSearchParams(p, { replace: true });
  };

  const setWeekStart = (next: string | ((prev: string) => string)) =>
    setParams({ week: typeof next === 'function' ? next(weekStart) : next });

  const [comment, setComment] = useState('');
  const [commentTouched, setCommentTouched] = useState(false);
  // The open cell and its draft live here rather than inside the cell, so a
  // re-render of the grid (a save settling, a query refetching) cannot discard
  // half-typed input.
  const [openCell, setOpenCell] = useState<string | null>(null);
  const [cellDraft, setCellDraft] = useState<CellDraft>({ status: 'present', check_in: '', check_out: '', hr_note: '' });
  const [decision, setDecision] = useState<{ week: WeekRow; approve: boolean } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [reviewDecision, setReviewDecision] = useState<{ req: ReviewRow; approve: boolean } | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data: staff = [], isLoading: staffLoading } = useQuery<StaffRow[]>({
    queryKey: ['attendance-staff'],
    queryFn: async () => {
      const { data, error } = await db
        .from('staff_profiles')
        .select('id, full_name, position, departments(name)')
        .order('full_name');
      if (error) throw error;
      return (data ?? []) as StaffRow[];
    },
  });

  const { data: week, isLoading: weekLoading } = useQuery<WeekRow | null>({
    queryKey: ['attendance-week', weekStart],
    queryFn: async () => {
      const { data, error } = await db
        .from('attendance_weeks')
        .select('id, week_start, week_end, status, hr_comment, submitted_at, reviewed_at, review_note')
        .eq('week_start', weekStart)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as WeekRow | null;
    },
  });

  // Load the stored comment into the box, unless the user is mid-edit.
  useEffect(() => {
    if (!commentTouched) setComment(week?.hr_comment ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week?.id, week?.hr_comment]);

  // Moving to another week drops any unsaved comment with the week it belonged to.
  useEffect(() => { setCommentTouched(false); setOpenCell(null); }, [weekStart]);

  const { data: records = [] } = useQuery<RecordRow[]>({
    queryKey: ['attendance-records', week?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from('attendance_records')
        .select('id, week_id, staff_profile_id, work_date, status, check_in, check_out, hr_note, corrected_from')
        .eq('week_id', week!.id);
      if (error) throw error;
      return (data ?? []) as RecordRow[];
    },
    enabled: !!week?.id,
  });

  const { data: weeks = [] } = useQuery<WeekRow[]>({
    queryKey: ['attendance-weeks'],
    queryFn: async () => {
      const { data, error } = await db
        .from('attendance_weeks')
        .select('id, week_start, week_end, status, hr_comment, submitted_at, reviewed_at, review_note')
        .order('week_start', { ascending: false })
        .limit(26);
      if (error) throw error;
      return (data ?? []) as WeekRow[];
    },
  });

  const { data: reviews = [] } = useQuery<ReviewRow[]>({
    queryKey: ['attendance-reviews-admin'],
    queryFn: async () => {
      const { data, error } = await db
        .from('attendance_review_requests')
        .select('id, record_id, user_id, claimed_status, reason, status, decision_note, decided_at, created_at, attendance_records(work_date, status, hr_note, staff_profiles(full_name))')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
  });

  // What is actually being approved. Keyed on the week in the dialog, which is
  // not always the week open in the grid — a report can be decided straight
  // from the list. Same key shape as the grid's query, so it reuses that cache
  // when they are the same week.
  const { data: decisionRecords = [], isLoading: decisionLoading } = useQuery<RecordRow[]>({
    queryKey: ['attendance-records', decision?.week.id],
    queryFn: async () => {
      const { data, error } = await db
        .from('attendance_records')
        .select('id, week_id, staff_profile_id, work_date, status, check_in, check_out, hr_note, corrected_from')
        .eq('week_id', decision!.week.id);
      if (error) throw error;
      return (data ?? []) as RecordRow[];
    },
    enabled: !!decision?.week.id,
  });

  const decisionSummary = useMemo(() => ({
    ...summarizeAttendance(decisionRecords),
    staffCount: new Set(decisionRecords.map(r => r.staff_profile_id)).size,
  }), [decisionRecords]);

  const byCell = useMemo(() => {
    const m = new Map<string, RecordRow>();
    for (const r of records) m.set(`${r.staff_profile_id}|${r.work_date}`, r);
    return m;
  }, [records]);

  const weekStatus: WeekStatus = week?.status ?? 'draft';
  const editable = weekStatus === 'draft' || weekStatus === 'rejected';
  const pendingReviews = reviews.filter(r => r.status === 'pending');

  const invalidateWeek = () => {
    qc.invalidateQueries({ queryKey: ['attendance-week', weekStart] });
    qc.invalidateQueries({ queryKey: ['attendance-records', week?.id] });
    qc.invalidateQueries({ queryKey: ['attendance-weeks'] });
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  /** Open the week (idempotent) and return its id, so marking never races. */
  const ensureWeek = async (): Promise<string> => {
    if (week?.id) return week.id;
    const { data, error } = await db.rpc('fn_open_attendance_week', { p_any_date: weekStart });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['attendance-week', weekStart] });
    return data as string;
  };

  const markCell = useMutation({
    mutationFn: async (args: { staffId: string; workDate: string; draft: CellDraft }) => {
      const weekId = await ensureWeek();
      const { error } = await db.from('attendance_records').upsert(
        {
          week_id: weekId,
          staff_profile_id: args.staffId,
          work_date: args.workDate,
          status: args.draft.status,
          check_in: args.draft.check_in || null,
          check_out: args.draft.check_out || null,
          hr_note: args.draft.hr_note.trim() || null,
        },
        { onConflict: 'staff_profile_id,work_date' },
      );
      if (error) throw error;
    },
    onSuccess: () => { setOpenCell(null); invalidateWeek(); },
    onError: (e: any) => toast({ title: 'Could not mark that day', description: e.message, variant: 'destructive' }),
  });

  /** Fill every unmarked working day for one staff member, or for the whole week. */
  const fillMutation = useMutation({
    mutationFn: async (args: { staffId?: string; status: AttendanceStatus }) => {
      const weekId = await ensureWeek();
      const targets = args.staffId ? staff.filter(s => s.id === args.staffId) : staff;
      const rows = targets.flatMap(s =>
        days
          .filter(d => !byCell.has(`${s.id}|${d}`))
          .map(d => ({ week_id: weekId, staff_profile_id: s.id, work_date: d, status: args.status })),
      );
      if (rows.length === 0) return 0;
      const { error } = await db.from('attendance_records')
        .upsert(rows, { onConflict: 'staff_profile_id,work_date' });
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      invalidateWeek();
      toast({ title: n ? `Marked ${n} day${n === 1 ? '' : 's'}` : 'Nothing left to fill' });
    },
    onError: (e: any) => toast({ title: 'Could not fill the week', description: e.message, variant: 'destructive' }),
  });

  const saveComment = useMutation({
    mutationFn: async () => {
      const weekId = await ensureWeek();
      const { error } = await db.from('attendance_weeks')
        .update({ hr_comment: comment.trim() || null }).eq('id', weekId);
      if (error) throw error;
    },
    onSuccess: () => { setCommentTouched(false); invalidateWeek(); toast({ title: 'Comment saved' }); },
    onError: (e: any) => toast({ title: 'Could not save the comment', description: e.message, variant: 'destructive' }),
  });

  const setWeekStatus = useMutation({
    mutationFn: async (args: { weekId: string; status: WeekStatus; note?: string }) => {
      const patch: Record<string, unknown> = { status: args.status };
      if (args.status === 'submitted') patch.hr_comment = comment.trim() || null;
      if (args.note !== undefined) patch.review_note = args.note.trim() || null;
      const { error } = await db.from('attendance_weeks').update(patch).eq('id', args.weekId);
      if (error) throw error;
      return args;
    },
    onSuccess: async (args) => {
      setCommentTouched(false);
      invalidateWeek();

      // Submitting asks the admins to look; approving tells the staff to look.
      if (args.status === 'submitted') {
        const { data: admins } = await db.from('user_roles')
          .select('user_id').eq('role', 'admin').eq('role_status', 'approved');
        const who = user?.user_metadata?.full_name || user?.email;
        for (const a of (admins ?? []).filter((a: any) => a.user_id !== user?.id)) {
          await db.from('notifications').insert({
            user_id: a.user_id,
            title: 'Weekly attendance submitted',
            message: `${who} submitted the attendance report for the week of ${format(parseISO(weekStart), 'd MMM yyyy')}.`,
            type: 'attendance_report',
            related_id: args.weekId,
          });
        }
        toast({ title: 'Submitted for approval' });
      } else if (args.status === 'approved') {
        const wk = weeks.find(w => w.id === args.weekId);
        const range = wk ? weekDays(wk.week_start) : days;
        const { data: marked } = await db.from('attendance_records')
          .select('user_id').eq('week_id', args.weekId).not('user_id', 'is', null);
        const notified = new Set<string>((marked ?? []).map((m: any) => m.user_id));
        for (const uid of notified) {
          await db.from('notifications').insert({
            user_id: uid,
            title: 'Attendance published',
            message: `Your attendance for the week of ${format(parseISO(range[0]), 'd MMM yyyy')} is now on your portal.`,
            type: 'attendance',
          });
        }
        toast({ title: 'Week approved', description: 'Staff can now see their attendance for this week.' });
      } else if (args.status === 'rejected') {
        toast({ title: 'Sent back to HR' });
      } else {
        toast({ title: 'Recalled to draft' });
      }
      setDecision(null);
      setDecisionNote('');
    },
    onError: (e: any) => toast({ title: 'Could not update the week', description: e.message, variant: 'destructive' }),
  });

  const decideReview = useMutation({
    mutationFn: async (args: { req: ReviewRow; approve: boolean; note: string }) => {
      const { error } = await db.rpc('fn_decide_attendance_review', {
        p_request_id: args.req.id,
        p_approve: args.approve,
        p_note: args.note.trim() || null,
      });
      if (error) throw error;

      const day = args.req.attendance_records?.work_date;
      await db.from('notifications').insert({
        user_id: args.req.user_id,
        title: `Attendance review ${args.approve ? 'approved' : 'declined'}`,
        message: `Your review request for ${day ? format(parseISO(day), 'd MMM yyyy') : 'a day'} was ${args.approve ? 'approved' : 'declined'}.${args.note.trim() ? ' ' + args.note.trim() : ''}`,
        type: 'attendance',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-reviews-admin'] });
      qc.invalidateQueries({ queryKey: ['attendance-records', week?.id] });
      setReviewDecision(null);
      setReviewNote('');
      toast({ title: 'Review answered' });
    },
    onError: (e: any) => toast({ title: 'Could not answer the review', description: e.message, variant: 'destructive' }),
  });

  // ── Marking grid ───────────────────────────────────────────────────────────

  const openCellFor = (key: string, rec: RecordRow | undefined) => {
    setCellDraft({
      status: rec?.status ?? 'present',
      check_in: rec?.check_in?.slice(0, 5) ?? '',
      check_out: rec?.check_out?.slice(0, 5) ?? '',
      hr_note: rec?.hr_note ?? '',
    });
    setOpenCell(key);
  };

  const Cell = ({ s, day }: { s: StaffRow; day: string }) => {
    const key = `${s.id}|${day}`;
    const rec = byCell.get(key);

    // A locked week is still worth opening — the admin approving it has to be
    // able to read the note and the times behind a letter, not just hover it.
    const openable = editable || !!rec;

    const face = (
      <button
        type="button"
        disabled={!openable}
        className={`h-9 w-9 rounded-md border text-xs font-semibold transition ${
          rec ? statusColor(rec.status) : 'bg-background text-muted-foreground border-dashed border-border'
        } ${openable ? 'hover:ring-2 hover:ring-primary/30' : 'cursor-default'} ${
          rec?.hr_note ? 'ring-1 ring-primary/40' : ''
        }`}
        title={rec ? `${statusLabel(rec.status)}${rec.hr_note ? ` — ${rec.hr_note}` : ''}` : 'Not marked'}
      >
        {rec ? ATTENDANCE_STATUSES[rec.status]?.code ?? '?' : '·'}
      </button>
    );

    if (!openable) return face;

    // Locked week: the same cell, read only.
    if (!editable) {
      return (
        <Popover open={openCell === key} onOpenChange={o => setOpenCell(o ? key : null)}>
          <PopoverTrigger asChild>{face}</PopoverTrigger>
          <PopoverContent className="w-72 space-y-3" align="start">
            <div>
              <p className="text-sm font-semibold">{s.full_name}</p>
              <p className="text-xs text-muted-foreground">{format(parseISO(day), 'EEEE d MMM yyyy')}</p>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className={`text-[10px] ${statusColor(rec!.status)}`}>
                {statusLabel(rec!.status)}
              </Badge>
              {rec!.corrected_from && (
                <span className="text-[11px] text-muted-foreground">
                  was {statusLabel(rec!.corrected_from)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">In</p>
                <p className="font-medium">{rec!.check_in?.slice(0, 5) ?? '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Out</p>
                <p className="font-medium">{rec!.check_out?.slice(0, 5) ?? '—'}</p>
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">HR comment</p>
              <p className="text-sm">{rec!.hr_note || <span className="text-muted-foreground">None.</span>}</p>
            </div>

            <p className="text-[11px] text-muted-foreground border-t pt-2">
              {weekStatus === 'approved'
                ? 'This week is approved. A day changes only through an approved review request.'
                : 'This week is with the admin. Send it back to HR to have a day changed.'}
            </p>
          </PopoverContent>
        </Popover>
      );
    }

    return (
      <Popover open={openCell === key} onOpenChange={o => (o ? openCellFor(key, rec) : setOpenCell(null))}>
        <PopoverTrigger asChild>{face}</PopoverTrigger>
        <PopoverContent className="w-72 space-y-3" align="start">
          <div>
            <p className="text-sm font-semibold">{s.full_name}</p>
            <p className="text-xs text-muted-foreground">{format(parseISO(day), 'EEEE d MMM yyyy')}</p>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {ATTENDANCE_STATUS_LIST.map(st => (
              <button
                key={st}
                type="button"
                onClick={() => setCellDraft(d => ({ ...d, status: st }))}
                className={`rounded-md border px-2 py-1.5 text-xs font-medium text-left transition ${
                  cellDraft.status === st ? ATTENDANCE_STATUSES[st].color : 'bg-background border-border hover:bg-muted'
                }`}
              >
                {ATTENDANCE_STATUSES[st].label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">In</Label>
              <Input type="time" value={cellDraft.check_in} className="h-8"
                onChange={e => setCellDraft(d => ({ ...d, check_in: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Out</Label>
              <Input type="time" value={cellDraft.check_out} className="h-8"
                onChange={e => setCellDraft(d => ({ ...d, check_out: e.target.value }))} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Comment (optional)</Label>
            <Textarea
              rows={2}
              value={cellDraft.hr_note}
              placeholder="Why this day is marked the way it is."
              onChange={e => setCellDraft(d => ({ ...d, hr_note: e.target.value }))}
            />
          </div>

          <Button
            size="sm"
            className="w-full"
            disabled={markCell.isPending}
            onClick={() => markCell.mutate({ staffId: s.id, workDate: day, draft: cellDraft })}
          >
            {markCell.isPending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            Save day
          </Button>
        </PopoverContent>
      </Popover>
    );
  };

  const weekLabel = `${format(parseISO(weekStart), 'd MMM')} – ${format(parseISO(days[6]), 'd MMM yyyy')}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">Attendance</h1>
        <p className="text-muted-foreground mt-1">
          Mark the week, submit it as a report, and let the admin approve it onto the staff portal.
        </p>
      </div>

      <Tabs value={tab} onValueChange={t => setParams({ tab: t })} className="space-y-6">
        <TabsList className="bg-muted/50 p-1 flex-wrap h-auto gap-1">
          <TabsTrigger value="mark"><CalendarCheck className="h-4 w-4 mr-2" />Mark Week</TabsTrigger>
          <TabsTrigger value="weeks"><ClipboardList className="h-4 w-4 mr-2" />Weekly Reports</TabsTrigger>
          <TabsTrigger value="reviews">
            <Inbox className="h-4 w-4 mr-2" />Review Requests
            {pendingReviews.length > 0 && (
              <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">{pendingReviews.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Mark the week ── */}
        <TabsContent value="mark" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => setWeekStart(w => addWeeks(w, -1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-[190px] text-center">
                    <p className="font-semibold">{weekLabel}</p>
                    <Badge variant="outline" className={`text-[10px] ${WEEK_STATUS_COLOR[weekStatus]}`}>
                      {WEEK_STATUS_LABEL[weekStatus]}
                    </Badge>
                  </div>
                  <Button variant="outline" size="icon" onClick={() => setWeekStart(w => addWeeks(w, 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setWeekStart(weekStartOf(todayIso()))}>
                    This week
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {editable && (
                    <Button variant="outline" size="sm" disabled={fillMutation.isPending}
                      onClick={() => fillMutation.mutate({ status: 'present' })}>
                      Fill blanks as present
                    </Button>
                  )}
                  {editable && week && records.length > 0 && (
                    <Button size="sm" disabled={setWeekStatus.isPending}
                      onClick={() => setWeekStatus.mutate({ weekId: week.id, status: 'submitted' })}>
                      <Send className="h-4 w-4 mr-2" />Submit report
                    </Button>
                  )}
                  {weekStatus === 'submitted' && (
                    <>
                      {/* HR pulls its own report back; an admin sends it back
                          instead, so the reason is recorded with it. */}
                      {!isAdmin && (
                        <Button variant="outline" size="sm" disabled={setWeekStatus.isPending}
                          onClick={() => setWeekStatus.mutate({ weekId: week!.id, status: 'draft' })}>
                          <Undo2 className="h-4 w-4 mr-2" />Recall
                        </Button>
                      )}
                      {isAdmin && (
                        <>
                          <Button variant="outline" size="sm"
                            onClick={() => { setDecision({ week: week!, approve: false }); setDecisionNote(''); }}>
                            <XCircle className="h-4 w-4 mr-2" />Send back
                          </Button>
                          <Button size="sm"
                            onClick={() => { setDecision({ week: week!, approve: true }); setDecisionNote(''); }}>
                            <CheckCircle2 className="h-4 w-4 mr-2" />Approve
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {weekStatus === 'approved' && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-success/20 bg-success/5 px-3 py-2 text-xs text-success">
                  <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Approved and published to staff. A day in this week now changes only through an approved
                    review request.
                  </span>
                </div>
              )}
              {weekStatus === 'submitted' && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">
                  <Lock className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {isAdmin
                      ? 'Submitted for your approval. Open any day to read its times and HR’s comment, then approve the week or send it back with a note.'
                      : 'With the admin for approval. Recall it to draft if a day still needs changing.'}
                  </span>
                </div>
              )}
              {weekStatus === 'rejected' && (
                <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  Sent back by the admin{week?.review_note ? `: ${week.review_note}` : '.'} Correct the week and submit it again.
                </div>
              )}
            </CardHeader>

            <CardContent className="space-y-4">
              {staffLoading || weekLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : staff.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No staff profiles yet. Add staff before marking attendance.
                </p>
              ) : (
                <div className="overflow-x-auto -mx-2 px-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left font-medium py-2 pr-3 min-w-[170px] sticky left-0 bg-background">Staff</th>
                        {days.map(d => (
                          <th key={d} className="px-1 py-2 font-medium text-center w-12">
                            <div className="text-[11px] text-muted-foreground">{format(parseISO(d), 'EEE')}</div>
                            <div>{format(parseISO(d), 'd')}</div>
                          </th>
                        ))}
                        <th className="px-2 py-2 font-medium text-right w-16">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staff.map(s => {
                        const mine = days
                          .map(d => byCell.get(`${s.id}|${d}`))
                          .filter(Boolean) as RecordRow[];
                        const sum = summarizeAttendance(mine);
                        return (
                          <tr key={s.id} className="border-b last:border-0">
                            <td className="py-1.5 pr-3 sticky left-0 bg-background">
                              <div className="font-medium leading-tight">{s.full_name}</div>
                              <div className="text-[11px] text-muted-foreground">
                                {s.departments?.name ?? s.position ?? '—'}
                              </div>
                            </td>
                            {days.map(d => (
                              <td key={d} className="px-1 py-1.5 text-center">
                                <Cell s={s} day={d} />
                              </td>
                            ))}
                            <td className={`px-2 py-1.5 text-right font-semibold ${rateColor(sum.rate)}`}>
                              {sum.rate == null ? '—' : `${sum.rate}%`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-1 text-[11px] text-muted-foreground">
                {ATTENDANCE_STATUS_LIST.map(st => (
                  <span key={st} className="flex items-center gap-1.5">
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-semibold ${ATTENDANCE_STATUSES[st].color}`}>
                      {ATTENDANCE_STATUSES[st].code}
                    </span>
                    {ATTENDANCE_STATUSES[st].label}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />Comment on the week
              </CardTitle>
              <CardDescription>
                Goes to the admin with the report. Anything that needs explaining — a shortage, a shift
                change, a run of absences.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={3}
                value={comment}
                disabled={!editable}
                placeholder="Where necessary."
                onChange={e => { setComment(e.target.value); setCommentTouched(true); }}
              />
              {editable && (
                <Button variant="outline" size="sm" disabled={saveComment.isPending || !commentTouched}
                  onClick={() => saveComment.mutate()}>
                  {saveComment.isPending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
                  Save comment
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Weekly reports ── */}
        <TabsContent value="weeks">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Weekly attendance reports</CardTitle>
              <CardDescription>
                {isAdmin
                  ? 'Approve a week to publish it to the staff portal, or send it back with a note.'
                  : 'Submitted weeks and where they stand.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {weeks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No weeks marked yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Comment</TableHead>
                      <TableHead className="hidden sm:table-cell">Submitted</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeks.map(w => (
                      <TableRow key={w.id}>
                        <TableCell className="font-medium whitespace-nowrap">
                          {format(parseISO(w.week_start), 'd MMM')} – {format(parseISO(w.week_end), 'd MMM yyyy')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${WEEK_STATUS_COLOR[w.status]}`}>
                            {WEEK_STATUS_LABEL[w.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell max-w-xs">
                          <span className="text-xs text-muted-foreground line-clamp-2">
                            {w.hr_comment || '—'}
                          </span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs text-muted-foreground whitespace-nowrap">
                          {w.submitted_at ? format(parseISO(w.submitted_at), 'd MMM, HH:mm') : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm"
                              onClick={() => setParams({ week: w.week_start, tab: 'mark' })}>
                              Open
                            </Button>
                            {isAdmin && w.status === 'submitted' && (
                              <>
                                <Button variant="outline" size="sm"
                                  onClick={() => { setDecision({ week: w, approve: false }); setDecisionNote(''); }}>
                                  Send back
                                </Button>
                                <Button size="sm"
                                  onClick={() => { setDecision({ week: w, approve: true }); setDecisionNote(''); }}>
                                  Approve
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Review requests ── */}
        <TabsContent value="reviews">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Attendance review requests</CardTitle>
              <CardDescription>
                Raised by staff against an approved day. Approving one with a claimed status rewrites that day
                and keeps what it used to say. {isAdmin ? '' : 'Only an admin can answer these.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {reviews.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No review requests.</p>
              ) : reviews.map(r => (
                <div key={r.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">
                        {r.attendance_records?.staff_profiles?.full_name ?? 'Staff member'}
                        <span className="text-muted-foreground font-normal">
                          {' · '}
                          {r.attendance_records?.work_date
                            ? format(parseISO(r.attendance_records.work_date), 'EEE d MMM yyyy')
                            : '—'}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Marked <Badge variant="outline" className={`text-[10px] ${statusColor(r.attendance_records?.status)}`}>
                          {statusLabel(r.attendance_records?.status)}
                        </Badge>
                        {r.claimed_status && (
                          <> → claims <Badge variant="outline" className={`text-[10px] ${statusColor(r.claimed_status)}`}>
                            {statusLabel(r.claimed_status)}
                          </Badge></>
                        )}
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] ${REVIEW_STATUS_COLOR[r.status]}`}>
                      {r.status}
                    </Badge>
                  </div>

                  <p className="text-sm">{r.reason}</p>
                  {r.attendance_records?.hr_note && (
                    <p className="text-xs text-muted-foreground">HR noted: {r.attendance_records.hr_note}</p>
                  )}
                  {r.decision_note && (
                    <p className="text-xs text-muted-foreground">Answer: {r.decision_note}</p>
                  )}

                  {isAdmin && r.status === 'pending' && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline"
                        onClick={() => { setReviewDecision({ req: r, approve: false }); setReviewNote(''); }}>
                        <XCircle className="h-3.5 w-3.5 mr-1.5" />Decline
                      </Button>
                      <Button size="sm"
                        onClick={() => { setReviewDecision({ req: r, approve: true }); setReviewNote(''); }}>
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Approve
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Week approval / rejection */}
      <Dialog open={!!decision} onOpenChange={o => { if (!o) { setDecision(null); setDecisionNote(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.approve ? 'Approve this week' : 'Send this week back'}</DialogTitle>
            <DialogDescription>
              {decision?.approve
                ? 'Approving publishes every day in the week to the staff it belongs to. After that the week is final — a day changes only through an approved review request.'
                : 'HR gets the week back as a draft, with your note attached.'}
            </DialogDescription>
          </DialogHeader>

          {/* What is in the week, so the decision is not taken blind. */}
          {decision && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-medium">
                Week of {format(parseISO(decision.week.week_start), 'd MMM')} – {format(parseISO(decision.week.week_end), 'd MMM yyyy')}
              </p>
              {decisionLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                    {[
                      { label: 'Staff', value: decisionSummary.staffCount },
                      { label: 'Days', value: decisionSummary.total },
                      { label: 'Present', value: decisionSummary.present },
                      { label: 'Late', value: decisionSummary.late },
                      { label: 'Absent', value: decisionSummary.absent },
                      { label: 'Leave', value: decisionSummary.onLeave },
                    ].map(m => (
                      <div key={m.label}>
                        <p className="text-sm font-semibold">{m.value}</p>
                        <p className="text-[10px] text-muted-foreground">{m.label}</p>
                      </div>
                    ))}
                  </div>
                  <p className={`text-xs font-medium ${rateColor(decisionSummary.rate)}`}>
                    Attendance rate {decisionSummary.rate == null ? '—' : `${decisionSummary.rate}%`}
                  </p>
                </>
              )}
              <div className="border-t pt-2">
                <p className="text-[10px] text-muted-foreground">HR’s comment on the week</p>
                <p className="text-xs">
                  {decision.week.hr_comment || <span className="text-muted-foreground">None given.</span>}
                </p>
              </div>
              {decision.approve && (
                <Button variant="outline" size="sm" className="w-full"
                  onClick={() => {
                    setParams({ week: decision.week.week_start, tab: 'mark' });
                    setDecision(null);
                    setDecisionNote('');
                  }}>
                  Review the days first
                </Button>
              )}
            </div>
          )}

          <div>
            <Label className="text-xs">Note {decision?.approve ? '(optional)' : ''}</Label>
            <Textarea rows={3} value={decisionNote} onChange={e => setDecisionNote(e.target.value)}
              placeholder={decision?.approve ? 'Anything to record with the approval.' : 'What needs correcting.'} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button
              disabled={setWeekStatus.isPending || (!decision?.approve && !decisionNote.trim())}
              onClick={() => decision && setWeekStatus.mutate({
                weekId: decision.week.id,
                status: decision.approve ? 'approved' : 'rejected',
                note: decisionNote,
              })}
            >
              {setWeekStatus.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {decision?.approve ? 'Approve week' : 'Send back'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review decision */}
      <Dialog open={!!reviewDecision} onOpenChange={o => { if (!o) { setReviewDecision(null); setReviewNote(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reviewDecision?.approve ? 'Approve this review' : 'Decline this review'}</DialogTitle>
            <DialogDescription>
              {reviewDecision?.approve && reviewDecision.req.claimed_status
                ? `The day becomes "${statusLabel(reviewDecision.req.claimed_status)}". What it said before is kept on the record.`
                : reviewDecision?.approve
                  ? 'The request is accepted. No status was claimed, so the day itself is unchanged.'
                  : 'The day stands as marked. Your note goes to the staff member.'}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Note {reviewDecision?.approve ? '(optional)' : ''}</Label>
            <Textarea rows={3} value={reviewNote} onChange={e => setReviewNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDecision(null)}>Cancel</Button>
            <Button
              disabled={decideReview.isPending || (!reviewDecision?.approve && !reviewNote.trim())}
              onClick={() => reviewDecision && decideReview.mutate({
                req: reviewDecision.req, approve: reviewDecision.approve, note: reviewNote,
              })}
            >
              {decideReview.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {reviewDecision?.approve ? 'Approve' : 'Decline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
