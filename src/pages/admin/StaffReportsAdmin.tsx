import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, CheckCircle2, XCircle, Loader2, ClipboardList, Wallet, ClipboardCheck, TrendingUp } from 'lucide-react';
import {
  REPORT_TYPES, REPORT_STATUS_COLOR, CADENCES, gradeColor, gradeFromScore,
  combinePerformance, summarizePerformance, describeCreditItems, type ReportType,
} from '@/lib/reports';
import { formatNairaCompact } from '@/lib/currency';

interface Report {
  id: string; user_id: string; report_type: ReportType; report_date: string; submitted_at: string;
  status: string; title: string | null; summary: string | null; amount: number | null;
  payment_method: string | null; details: any; timeliness_score: number | null;
  quality_score: number | null; performance_score: number | null; grade: string | null;
  review_note: string | null; converted_ref: string | null;
}
interface Assignment { id: string; user_id: string; report_type: ReportType; cadence: string; due_time: string | null; active: boolean; }
interface Payable { id: string; supplier: string; description: string | null; category: string | null; amount: number; incurred_date: string; due_date: string | null; status: string; paid_at: string | null; }
interface Profile { user_id: string; full_name: string; }

export default function StaffReportsAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [review, setReview] = useState<Report | null>(null);
  const [quality, setQuality] = useState('');
  const [reviewNote, setReviewNote] = useState('');

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ user_id: '', report_type: 'sales' as ReportType, cadence: 'daily', due_time: '' });

  const [payOpen, setPayOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<Payable | null>(null);
  const [payMethod, setPayMethod] = useState('cash');

  const { data: reports = [] } = useQuery<Report[]>({
    queryKey: ['admin-staff-reports'],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_reports').select('*').order('submitted_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Report[];
    },
  });
  const { data: assignments = [] } = useQuery<Assignment[]>({
    queryKey: ['admin-report-assignments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('report_assignments').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Assignment[];
    },
  });
  const { data: payables = [] } = useQuery<Payable[]>({
    queryKey: ['admin-payables'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payables').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Payable[];
    },
  });
  const { data: profiles = [] } = useQuery<Profile[]>({
    queryKey: ['profiles-min'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('user_id, full_name');
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });

  const nameOf = useMemo(() => {
    const m = Object.fromEntries(profiles.map(p => [p.user_id, p.full_name]));
    return (id: string) => m[id] ?? `${id.slice(0, 8)}…`;
  }, [profiles]);

  const pending = reports.filter(r => r.status === 'submitted');

  // Per-staff performance roll-up for the Performance tab.
  const staffSummaries = useMemo(() => {
    const byUser = new Map<string, Report[]>();
    for (const r of reports) {
      const list = byUser.get(r.user_id) ?? [];
      list.push(r);
      byUser.set(r.user_id, list);
    }
    return Array.from(byUser.entries())
      .map(([user_id, rows]) => ({ user_id, name: nameOf(user_id), summary: summarizePerformance(rows) }))
      .sort((a, b) => (b.summary.avgScore ?? -1) - (a.summary.avgScore ?? -1));
  }, [reports, nameOf]);

  // ── Approve + grade + convert to financial records ──────────────────────────
  const approve = useMutation({
    mutationFn: async (r: Report) => {
      const q = quality === '' ? null : Math.max(0, Math.min(100, parseFloat(quality)));
      const performance = combinePerformance(r.timeliness_score ?? null, q);
      let convertedRef: string | null = null;
      let status: 'approved' | 'converted' = 'approved';

      if (r.report_type === 'expense') {
        const lines: { category: string; amount: number; description: string }[] = r.details?.lines ?? [];
        const rows = (lines.length ? lines : [{ category: 'General', amount: r.amount ?? 0, description: r.title ?? '' }])
          .filter(l => (l.amount ?? 0) > 0)
          .map(l => ({
            amount: l.amount, description: l.description || r.title || 'Staff expense report',
            category: l.category || 'General', date: r.report_date, budget_id: null,
            account_type: 'COGS', cost_center: 'Daily Orders', created_by: user!.id,
          }));
        const { data, error } = await supabase.from('expenses').insert(rows).select('id');
        if (error) throw error;
        convertedRef = data?.[0]?.id ?? null;
        status = 'converted';
      } else if (r.report_type === 'sales') {
        const { data, error } = await supabase.from('finance_ledger').insert({
          user_id: user!.id, entry_date: r.report_date, entry_type: 'revenue',
          source_type: 'sale', source_id: r.id,
          description: `${r.title ?? 'Sales report'}${r.payment_method ? ` (${r.payment_method})` : ''}`,
          amount: r.amount ?? 0, cost_center: 'Daily Orders',
          reference_number: r.title ?? null, recorded_by: user!.id,
        }).select('id');
        if (error) throw error;
        convertedRef = data?.[0]?.id ?? null;
        status = 'converted';
      } else if (r.report_type === 'credit') {
        // Legacy reports stored a flat `supplier`; new ones carry item lines + an optional source.
        const items = describeCreditItems(r.details?.lines ?? []);
        const supplier = r.details?.is_supplier && r.details?.source
          ? r.details.source
          : (r.details?.source ?? r.details?.supplier ?? 'Miscellaneous');
        const { data, error } = await supabase.from('payables').insert({
          supplier,
          description: items || r.title || null, category: 'Credit Purchase',
          amount: r.amount ?? 0, incurred_date: r.report_date,
          due_date: r.details?.due_date ?? null, status: 'unpaid',
          source_report_id: r.id, created_by: user!.id,
        }).select('id');
        if (error) throw error;
        convertedRef = data?.[0]?.id ?? null;
        status = 'converted';
      }

      const { error: upErr } = await supabase.from('staff_reports').update({
        status, quality_score: q, performance_score: performance, grade: gradeFromScore(performance),
        review_note: reviewNote || null, reviewed_by: user!.id, reviewed_at: new Date().toISOString(),
        converted_ref: convertedRef,
      }).eq('id', r.id);
      if (upErr) throw upErr;
    },
    onSuccess: () => {
      toast({ title: 'Report approved', description: 'Converted to financial records where applicable.' });
      setReview(null); setQuality(''); setReviewNote('');
      qc.invalidateQueries({ queryKey: ['admin-staff-reports'] });
      qc.invalidateQueries({ queryKey: ['admin-payables'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const reject = useMutation({
    mutationFn: async (r: Report) => {
      const { error } = await supabase.from('staff_reports').update({
        status: 'rejected', review_note: reviewNote || null,
        reviewed_by: user!.id, reviewed_at: new Date().toISOString(),
      }).eq('id', r.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Report rejected' });
      setReview(null); setQuality(''); setReviewNote('');
      qc.invalidateQueries({ queryKey: ['admin-staff-reports'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const saveAssignment = useMutation({
    mutationFn: async () => {
      if (!assignForm.user_id) throw new Error('Select a staff member');
      const { error } = await supabase.from('report_assignments').upsert({
        user_id: assignForm.user_id, report_type: assignForm.report_type,
        cadence: assignForm.cadence, due_time: assignForm.due_time || null,
        active: true, created_by: user!.id,
      }, { onConflict: 'user_id,report_type' });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Assignment saved' });
      setAssignOpen(false);
      setAssignForm({ user_id: '', report_type: 'sales', cadence: 'daily', due_time: '' });
      qc.invalidateQueries({ queryKey: ['admin-report-assignments'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const toggleAssignment = useMutation({
    mutationFn: async (a: Assignment) => {
      const { error } = await supabase.from('report_assignments').update({ active: !a.active }).eq('id', a.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-report-assignments'] }),
  });

  const markPaid = useMutation({
    mutationFn: async (p: Payable) => {
      const { data: exp, error: expErr } = await supabase.from('expenses').insert({
        amount: p.amount, description: `Credit settled — ${p.supplier}${p.description ? `: ${p.description}` : ''}`,
        category: p.category || 'Credit Purchase', date: new Date().toISOString().slice(0, 10),
        budget_id: null, account_type: 'COGS', cost_center: 'Daily Orders',
        payment_method: payMethod, created_by: user!.id,
      }).select('id').single();
      if (expErr) throw expErr;
      const { error } = await supabase.from('payables').update({
        status: 'paid', paid_at: new Date().toISOString(), payment_method: payMethod, expense_id: exp!.id,
      }).eq('id', p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Marked paid', description: 'An expense has been recorded.' });
      setPayOpen(false); setPayTarget(null);
      qc.invalidateQueries({ queryKey: ['admin-payables'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const outstanding = payables.filter(p => p.status === 'unpaid').reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Staff Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">Review and grade staff reports, assign required reports, and manage the credit (payables) register.</p>
      </div>

      <Tabs defaultValue="review">
        <TabsList>
          <TabsTrigger value="review">Review{pending.length > 0 && <Badge className="ml-2 text-xs">{pending.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="all">All Reports</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="assignments">Assignments</TabsTrigger>
          <TabsTrigger value="payables">Payables{outstanding > 0 && <Badge className="ml-2 text-xs">{formatNairaCompact(outstanding)}</Badge>}</TabsTrigger>
        </TabsList>

        {/* Review queue */}
        <TabsContent value="review" className="mt-4">
          <ReportTable rows={pending} nameOf={nameOf} emptyMsg="No reports awaiting review." onRow={(r) => { setReview(r); setQuality(''); setReviewNote(''); }} actionLabel="Review" />
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <ReportTable rows={reports} nameOf={nameOf} emptyMsg="No reports yet." onRow={(r) => { setReview(r); setQuality(r.quality_score?.toString() ?? ''); setReviewNote(r.review_note ?? ''); }} actionLabel="View" />
        </TabsContent>

        {/* Performance summary — per staff member */}
        <TabsContent value="performance" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {staffSummaries.length === 0 ? (
                <Empty icon={TrendingUp} msg="No reports to summarise yet." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead><TableHead>Reports</TableHead><TableHead>On-time</TableHead>
                      <TableHead>Avg score</TableHead><TableHead>Grade</TableHead><TableHead>Pending</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {staffSummaries.map(s => (
                      <TableRow key={s.user_id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell>{s.summary.total}</TableCell>
                        <TableCell>{s.summary.onTimeRate != null ? `${s.summary.onTimeRate}%` : '—'}<span className="text-xs text-muted-foreground"> ({s.summary.onTime}/{s.summary.total})</span></TableCell>
                        <TableCell>{s.summary.avgScore ?? '—'}</TableCell>
                        <TableCell><Badge className={`text-xs border ${gradeColor(s.summary.grade)}`}>{s.summary.grade}</Badge></TableCell>
                        <TableCell>{s.summary.pending > 0 ? <Badge variant="outline">{s.summary.pending}</Badge> : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Assignments */}
        <TabsContent value="assignments" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button onClick={() => setAssignOpen(true)}><Plus className="h-4 w-4 mr-2" />Assign report</Button>
          </div>
          <Card>
            <CardContent className="p-0">
              {assignments.length === 0 ? (
                <Empty icon={ClipboardCheck} msg="No report assignments yet." />
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Staff</TableHead><TableHead>Report</TableHead><TableHead>Cadence</TableHead><TableHead>Due</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {assignments.map(a => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{nameOf(a.user_id)}</TableCell>
                        <TableCell>{REPORT_TYPES[a.report_type]?.label}</TableCell>
                        <TableCell className="capitalize">{a.cadence}</TableCell>
                        <TableCell>{a.due_time ?? '—'}</TableCell>
                        <TableCell><Switch checked={a.active} onCheckedChange={() => toggleAssignment.mutate(a)} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payables */}
        <TabsContent value="payables" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {payables.length === 0 ? (
                <Empty icon={Wallet} msg="No credit purchases recorded." />
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Description</TableHead><TableHead>Amount</TableHead><TableHead>Incurred</TableHead><TableHead>Due</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {payables.map(p => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.supplier}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.description ?? '—'}</TableCell>
                        <TableCell>{formatNairaCompact(p.amount)}</TableCell>
                        <TableCell className="text-sm">{format(parseISO(p.incurred_date), 'dd MMM yyyy')}</TableCell>
                        <TableCell className="text-sm">{p.due_date ? format(parseISO(p.due_date), 'dd MMM yyyy') : '—'}</TableCell>
                        <TableCell><Badge className={`text-xs border ${p.status === 'paid' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>{p.status}</Badge></TableCell>
                        <TableCell className="text-right">
                          {p.status === 'unpaid' && (
                            <Button size="sm" variant="outline" onClick={() => { setPayTarget(p); setPayMethod('cash'); setPayOpen(true); }}>Mark paid</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Review dialog */}
      <Dialog open={!!review} onOpenChange={o => { if (!o) setReview(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {review && (
            <>
              <DialogHeader>
                <DialogTitle>{REPORT_TYPES[review.report_type]?.label}</DialogTitle>
                <DialogDescription>By {nameOf(review.user_id)} · for {format(parseISO(review.report_date), 'dd MMM yyyy')} · submitted {format(parseISO(review.submitted_at), 'dd MMM, HH:mm')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-1 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge className={`border capitalize ${REPORT_STATUS_COLOR[review.status as keyof typeof REPORT_STATUS_COLOR] ?? ''}`}>{review.status}</Badge>
                  <Badge variant="outline">Timeliness: {review.timeliness_score ?? '—'}</Badge>
                  {review.grade && <Badge className={`border ${gradeColor(review.grade)}`}>Grade {review.grade}</Badge>}
                </div>
                {review.amount != null && <p>Amount: <span className="font-semibold">{formatNairaCompact(review.amount)}</span>{review.payment_method ? ` · ${review.payment_method}` : ''}</p>}
                {Array.isArray(review.details?.lines) && review.details.lines.length > 0 && (
                  <div className="rounded-lg border p-2 space-y-1">
                    {review.details.lines.map((l: any, i: number) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span>{l.category ?? l.item}{l.qty ? ` ×${l.qty}` : ''}</span>
                        <span className="text-muted-foreground">{l.amount != null ? formatNairaCompact(l.amount) : `counted ${l.counted ?? 0} · used ${l.used ?? 0}`}</span>
                      </div>
                    ))}
                  </div>
                )}
                {review.report_type === 'credit' && (review.details?.source || review.details?.supplier) && (
                  <p>Bought from: <span className="font-medium">{review.details?.source ?? review.details?.supplier}</span>{review.details?.is_supplier ? ' · registered supplier' : ' · not a supplier'}</p>
                )}
                {review.summary && <p className="text-muted-foreground">{review.summary}</p>}
                {review.converted_ref && <p className="text-violet-600 text-xs">Already converted to a financial record.</p>}

                {review.status === 'submitted' && (
                  <div className="space-y-3 pt-2 border-t">
                    <div className="space-y-2">
                      <Label>Quality score (0–100, optional)</Label>
                      <Input type="number" min="0" max="100" value={quality} onChange={e => setQuality(e.target.value)} placeholder="e.g. 85" />
                    </div>
                    <div className="space-y-2">
                      <Label>Review note (optional)</Label>
                      <Textarea rows={2} value={reviewNote} onChange={e => setReviewNote(e.target.value)} />
                    </div>
                    {REPORT_TYPES[review.report_type].convertsTo && (
                      <p className="text-xs text-muted-foreground">Approving will create: {REPORT_TYPES[review.report_type].convertsTo}.</p>
                    )}
                  </div>
                )}
              </div>
              {review.status === 'submitted' && (
                <DialogFooter>
                  <Button variant="outline" className="text-red-700 border-red-300 hover:bg-red-50" onClick={() => reject.mutate(review)} disabled={reject.isPending}>
                    <XCircle className="h-4 w-4 mr-1" />Reject
                  </Button>
                  <Button onClick={() => approve.mutate(review)} disabled={approve.isPending}>
                    {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}Approve
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Assignment dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign a required report</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Staff member</Label>
              <Select value={assignForm.user_id} onValueChange={v => setAssignForm(f => ({ ...f, user_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>{profiles.map(p => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Report type</Label>
                <Select value={assignForm.report_type} onValueChange={v => setAssignForm(f => ({ ...f, report_type: v as ReportType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(REPORT_TYPES) as ReportType[]).map(t => <SelectItem key={t} value={t}>{REPORT_TYPES[t].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cadence</Label>
                <Select value={assignForm.cadence} onValueChange={v => setAssignForm(f => ({ ...f, cadence: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CADENCES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Due time (optional)</Label>
              <Input type="time" value={assignForm.due_time} onChange={e => setAssignForm(f => ({ ...f, due_time: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={() => saveAssignment.mutate()} disabled={saveAssignment.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark-paid dialog */}
      <Dialog open={payOpen} onOpenChange={o => { setPayOpen(o); if (!o) setPayTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Settle credit purchase</DialogTitle>
            <DialogDescription>This records an expense for {payTarget ? formatNairaCompact(payTarget.amount) : ''} and marks the payable as paid.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Payment method</Label>
            <Select value={payMethod} onValueChange={setPayMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="cash">Cash</SelectItem><SelectItem value="transfer">Transfer</SelectItem></SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={() => payTarget && markPaid.mutate(payTarget)} disabled={markPaid.isPending}>
              {markPaid.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Empty({ icon: Icon, msg }: { icon: React.ElementType; msg: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2">
      <Icon className="h-8 w-8 opacity-30" /><p className="text-sm">{msg}</p>
    </div>
  );
}

function ReportTable({ rows, nameOf, emptyMsg, onRow, actionLabel }: {
  rows: Report[]; nameOf: (id: string) => string; emptyMsg: string; onRow: (r: Report) => void; actionLabel: string;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <Empty icon={ClipboardList} msg={emptyMsg} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Staff</TableHead><TableHead>Type</TableHead><TableHead>For date</TableHead><TableHead>Submitted</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Grade</TableHead><TableHead className="text-right">Action</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{nameOf(r.user_id)}</TableCell>
                  <TableCell>{REPORT_TYPES[r.report_type]?.label ?? r.report_type}</TableCell>
                  <TableCell className="text-sm">{format(parseISO(r.report_date), 'dd MMM yyyy')}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(parseISO(r.submitted_at), 'dd MMM, HH:mm')}</TableCell>
                  <TableCell>{r.amount != null ? formatNairaCompact(r.amount) : '—'}</TableCell>
                  <TableCell><Badge className={`text-xs border capitalize ${REPORT_STATUS_COLOR[r.status as keyof typeof REPORT_STATUS_COLOR] ?? ''}`}>{r.status}</Badge></TableCell>
                  <TableCell><Badge className={`text-xs border ${gradeColor(r.grade ?? '—')}`}>{r.grade ?? '—'}{r.performance_score != null ? ` · ${r.performance_score}` : ''}</Badge></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => onRow(r)}>{actionLabel}</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
