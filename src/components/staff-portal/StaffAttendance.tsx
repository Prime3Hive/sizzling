import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ui/responsive-table';
import { ChevronLeft, ChevronRight, Flag, Loader2, Lock, MessageSquare } from 'lucide-react';
import {
  ATTENDANCE_STATUS_LIST, ATTENDANCE_STATUSES, REVIEW_STATUS_COLOR,
  statusLabel, statusColor, summarizeAttendance, rateColor,
  monthBounds, monthValueOf, reviewWindowOpen,
  type AttendanceStatus,
} from '@/lib/attendance';

const db = supabase as any;

interface MyDay {
  id: string;
  work_date: string;
  status: AttendanceStatus;
  check_in: string | null;
  check_out: string | null;
  hr_note: string | null;
  corrected_from: string | null;
  attendance_weeks?: { week_start: string; status: string; hr_comment: string | null } | null;
}

interface MyReview {
  id: string;
  record_id: string;
  claimed_status: AttendanceStatus | null;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  decision_note: string | null;
  created_at: string;
}

const shiftMonth = (month: string, n: number): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthValueOf(d);
};

export default function StaffAttendance() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [month, setMonth] = useState(() => monthValueOf());
  const [challenge, setChallenge] = useState<MyDay | null>(null);
  const [claimed, setClaimed] = useState<string>('none');
  const [reason, setReason] = useState('');

  const { start, end } = useMemo(() => monthBounds(month), [month]);

  // Only approved weeks are readable — RLS enforces it, so what comes back here
  // is exactly what has been published.
  const { data: days = [], isLoading } = useQuery<MyDay[]>({
    queryKey: ['my-attendance', user?.id, month],
    queryFn: async () => {
      const { data, error } = await db
        .from('attendance_records')
        .select('id, work_date, status, check_in, check_out, hr_note, corrected_from, attendance_weeks(week_start, status, hr_comment)')
        .eq('user_id', user!.id)
        .gte('work_date', start)
        .lte('work_date', end)
        .order('work_date');
      if (error) throw error;
      return (data ?? []) as MyDay[];
    },
    enabled: !!user,
  });

  const { data: myReviews = [] } = useQuery<MyReview[]>({
    queryKey: ['my-attendance-reviews', user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from('attendance_review_requests')
        .select('id, record_id, claimed_status, reason, status, decision_note, created_at')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as MyReview[];
    },
    enabled: !!user,
  });

  const reviewByRecord = useMemo(() => {
    const m = new Map<string, MyReview>();
    // Newest first from the query, so the first one seen is the current answer.
    for (const r of myReviews) if (!m.has(r.record_id)) m.set(r.record_id, r);
    return m;
  }, [myReviews]);

  const summary = useMemo(() => summarizeAttendance(days), [days]);
  const weekComments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of days) {
      const w = d.attendance_weeks;
      if (w?.hr_comment) seen.set(w.week_start, w.hr_comment);
    }
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [days]);

  const isCurrentMonth = month === monthValueOf();

  const raise = useMutation({
    mutationFn: async () => {
      if (!challenge) return;
      const { error } = await db.from('attendance_review_requests').insert({
        record_id: challenge.id,
        user_id: user!.id,
        claimed_status: claimed === 'none' ? null : claimed,
        reason: reason.trim(),
      });
      if (error) throw error;

      const { data: admins } = await db.from('user_roles')
        .select('user_id').eq('role', 'admin').eq('role_status', 'approved');
      const who = user!.user_metadata?.full_name || user!.email;
      for (const a of admins ?? []) {
        await db.from('notifications').insert({
          user_id: a.user_id,
          title: 'Attendance review requested',
          message: `${who} asked for a review of their attendance on ${format(parseISO(challenge.work_date), 'd MMM yyyy')}.`,
          type: 'attendance_report',
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-attendance-reviews', user?.id] });
      setChallenge(null); setClaimed('none'); setReason('');
      toast({ title: 'Review requested', description: 'An admin will look at this day.' });
    },
    onError: (e: any) => toast({ title: 'Could not request a review', description: e.message, variant: 'destructive' }),
  });

  const withdraw = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('attendance_review_requests')
        .update({ status: 'withdrawn' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-attendance-reviews', user?.id] });
      toast({ title: 'Request withdrawn' });
    },
    onError: (e: any) => toast({ title: 'Could not withdraw', description: e.message, variant: 'destructive' }),
  });

  const columns: ResponsiveColumn<MyDay>[] = [
    {
      key: 'date', header: 'Date', primary: true,
      cell: d => (
        <span className="font-medium whitespace-nowrap">{format(parseISO(d.work_date), 'EEE d MMM')}</span>
      ),
    },
    {
      key: 'status', header: 'Status',
      cell: d => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className={`text-[10px] ${statusColor(d.status)}`}>{statusLabel(d.status)}</Badge>
          {d.corrected_from && (
            <span className="text-[10px] text-muted-foreground">was {statusLabel(d.corrected_from)}</span>
          )}
        </div>
      ),
    },
    {
      key: 'hours', header: 'In / Out', hideOnMobile: false,
      cell: d => (
        <span className="text-xs text-muted-foreground">
          {d.check_in ? d.check_in.slice(0, 5) : '—'} / {d.check_out ? d.check_out.slice(0, 5) : '—'}
        </span>
      ),
    },
    {
      key: 'note', header: 'HR comment',
      cell: d => <span className="text-xs text-muted-foreground">{d.hr_note || '—'}</span>,
    },
    {
      key: 'review', header: '', align: 'right', mobileFooter: true,
      cell: d => {
        const r = reviewByRecord.get(d.id);
        if (r && r.status === 'pending') {
          return (
            <div className="flex items-center justify-end gap-2">
              <Badge variant="outline" className={`text-[10px] ${REVIEW_STATUS_COLOR.pending}`}>Under review</Badge>
              <Button variant="ghost" size="sm" onClick={() => withdraw.mutate(r.id)}>Withdraw</Button>
            </div>
          );
        }
        if (r && r.status !== 'withdrawn') {
          return (
            <Badge variant="outline" className={`text-[10px] ${REVIEW_STATUS_COLOR[r.status]}`}>
              Review {r.status}
            </Badge>
          );
        }
        if (!reviewWindowOpen(d.work_date)) {
          return <span className="text-[10px] text-muted-foreground">Window closed</span>;
        }
        return (
          <Button variant="ghost" size="sm"
            onClick={() => { setChallenge(d); setClaimed('none'); setReason(''); }}>
            <Flag className="h-3.5 w-3.5 mr-1.5" />Request review
          </Button>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Month + summary */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">My attendance</CardTitle>
              <CardDescription>
                Marked by HR and shown here once the admin approves that week's report.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setMonth(m => shiftMonth(m, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[120px] text-center font-medium">
                {format(parseISO(`${month}-01`), 'MMMM yyyy')}
              </span>
              <Button variant="outline" size="icon"
                disabled={month >= monthValueOf()}
                onClick={() => setMonth(m => shiftMonth(m, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Days worked</p>
              <p className="text-xl font-bold">{summary.worked}<span className="text-sm text-muted-foreground">/{summary.expected}</span></p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Attendance rate</p>
              <p className={`text-xl font-bold ${rateColor(summary.rate)}`}>
                {summary.rate == null ? '—' : `${summary.rate}%`}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Late</p>
              <p className="text-xl font-bold">{summary.late}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Absent</p>
              <p className="text-xl font-bold">{summary.absent}</p>
            </div>
          </div>

          {!isCurrentMonth && (
            <div className="mt-4 flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Lock className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {format(parseISO(`${month}-01`), 'MMMM yyyy')} is past. Attendance can only be reviewed
                within the month it falls in, so these days now stand as marked.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* HR's comments on the weeks in this month */}
      {weekComments.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />HR comments this month
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {weekComments.map(([wkStart, text]) => (
              <div key={wkStart} className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground mb-1">
                  Week of {format(parseISO(wkStart), 'd MMM yyyy')}
                </p>
                <p className="text-sm">{text}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* The days */}
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : (
            <ResponsiveTable
              columns={columns}
              data={days}
              rowKey={d => d.id}
              mobileSubtitle={d => statusLabel(d.status)}
              emptyState={
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Nothing published for {format(parseISO(`${month}-01`), 'MMMM yyyy')} yet. Attendance appears
                  here once HR has submitted the week and the admin has approved it.
                </div>
              }
            />
          )}
        </CardContent>
      </Card>

      {/* Raise a review */}
      <Dialog open={!!challenge} onOpenChange={o => { if (!o) setChallenge(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request a review</DialogTitle>
            <DialogDescription>
              {challenge && (
                <>
                  {format(parseISO(challenge.work_date), 'EEEE d MMMM yyyy')} is marked{' '}
                  <span className="font-medium">{statusLabel(challenge.status)}</span>. An admin decides,
                  and only within this month.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label className="text-xs">What should it say?</Label>
              <Select value={claimed} onValueChange={setClaimed}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">I'm not sure — please just look at it</SelectItem>
                  {ATTENDANCE_STATUS_LIST
                    .filter(s => s !== challenge?.status)
                    .map(s => (
                      <SelectItem key={s} value={s}>{ATTENDANCE_STATUSES[s].label}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Why</Label>
              <Textarea
                rows={4}
                value={reason}
                placeholder="What actually happened that day, and anything that backs it up."
                onChange={e => setReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setChallenge(null)}>Cancel</Button>
            <Button disabled={raise.isPending || reason.trim().length < 5} onClick={() => raise.mutate()}>
              {raise.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
