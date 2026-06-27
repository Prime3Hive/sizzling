import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ClipboardList, FileText, Loader2 } from 'lucide-react';
import {
  REPORT_TYPES, REPORT_STATUS_COLOR, gradeColor, computeTimeliness,
  gradeFromScore, type ReportType,
} from '@/lib/reports';
import { formatNairaCompact } from '@/lib/currency';

interface Assignment { id: string; report_type: ReportType; cadence: string; due_time: string | null; active: boolean; }
interface Report {
  id: string; report_type: ReportType; report_date: string; submitted_at: string;
  status: string; title: string | null; amount: number | null; payment_method: string | null;
  timeliness_score: number | null; quality_score: number | null; performance_score: number | null;
  grade: string | null; review_note: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function MyReports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReportType>('sales');
  const [form, setForm] = useState({ report_date: today(), title: '', summary: '', amount: '', payment_method: 'cash', supplier: '', due_date: '' });
  const [expLines, setExpLines] = useState<{ category: string; amount: string; description: string }[]>([{ category: '', amount: '', description: '' }]);
  const [invLines, setInvLines] = useState<{ item: string; counted: string; used: string }[]>([{ item: '', counted: '', used: '' }]);

  const { data: assignments = [] } = useQuery<Assignment[]>({
    queryKey: ['my-report-assignments', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('report_assignments')
        .select('id, report_type, cadence, due_time, active')
        .eq('user_id', user!.id).eq('active', true);
      if (error) throw error;
      return (data ?? []) as Assignment[];
    },
    enabled: !!user,
  });

  const { data: reports = [] } = useQuery<Report[]>({
    queryKey: ['my-reports', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_reports')
        .select('id, report_type, report_date, submitted_at, status, title, amount, payment_method, timeliness_score, quality_score, performance_score, grade, review_note')
        .eq('user_id', user!.id).order('submitted_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Report[];
    },
    enabled: !!user,
  });

  const assignedTypes = useMemo(() => assignments.map(a => a.report_type), [assignments]);
  const typeOptions = (assignedTypes.length ? assignedTypes : (Object.keys(REPORT_TYPES) as ReportType[]));

  const resetForm = () => {
    setForm({ report_date: today(), title: '', summary: '', amount: '', payment_method: 'cash', supplier: '', due_date: '' });
    setExpLines([{ category: '', amount: '', description: '' }]);
    setInvLines([{ item: '', counted: '', used: '' }]);
  };

  const openNew = () => { setType(typeOptions[0] ?? 'sales'); resetForm(); setOpen(true); };

  const submit = useMutation({
    mutationFn: async () => {
      const assignment = assignments.find(a => a.report_type === type);
      let amount: number | null = null;
      const details: Record<string, unknown> = {};

      if (type === 'sales') {
        amount = parseFloat(form.amount) || 0;
        if (amount <= 0) throw new Error('Enter the sales amount');
        details.payment_method = form.payment_method;
      } else if (type === 'expense') {
        const lines = expLines
          .map(l => ({ category: l.category.trim(), amount: parseFloat(l.amount) || 0, description: l.description.trim() }))
          .filter(l => l.category && l.amount > 0);
        if (lines.length === 0) throw new Error('Add at least one expense line');
        amount = lines.reduce((s, l) => s + l.amount, 0);
        details.lines = lines;
      } else if (type === 'credit') {
        amount = parseFloat(form.amount) || 0;
        if (!form.supplier.trim()) throw new Error('Enter the supplier');
        if (amount <= 0) throw new Error('Enter the credit amount');
        details.supplier = form.supplier.trim();
        if (form.due_date) details.due_date = form.due_date;
      } else if (type === 'inventory') {
        const lines = invLines
          .map(l => ({ item: l.item.trim(), counted: parseFloat(l.counted) || 0, used: parseFloat(l.used) || 0 }))
          .filter(l => l.item);
        details.lines = lines;
      }

      const timeliness = computeTimeliness({ reportDate: form.report_date, submittedAt: new Date(), dueTime: assignment?.due_time });

      const { error } = await supabase.from('staff_reports').insert({
        user_id: user!.id,
        assignment_id: assignment?.id ?? null,
        report_type: type,
        report_date: form.report_date,
        title: form.title || `${REPORT_TYPES[type].label} — ${form.report_date}`,
        summary: form.summary || null,
        amount,
        payment_method: type === 'sales' ? form.payment_method : null,
        details,
        timeliness_score: timeliness,
        performance_score: timeliness,
        grade: gradeFromScore(timeliness),
        status: 'submitted',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Report submitted', description: 'Your report has been sent for review.' });
      setOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ['my-reports'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold">My Reports</h2>
          <p className="text-sm text-muted-foreground">Submit your assigned reports on time — timeliness affects your performance.</p>
        </div>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Submit Report</Button>
      </div>

      {/* Assigned reports */}
      {assignments.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assignments.map(a => (
            <Card key={a.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />{REPORT_TYPES[a.report_type].label}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p className="capitalize">Required: {a.cadence}{a.due_time ? ` · by ${a.due_time}` : ''}</p>
                <Button size="sm" variant="outline" className="mt-1"
                  onClick={() => { setType(a.report_type); resetForm(); setOpen(true); }}>
                  Submit now
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* History */}
      <Card>
        <CardContent className="p-0">
          {reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2">
              <ClipboardList className="h-8 w-8 opacity-30" />
              <p className="text-sm">You have not submitted any reports yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>For date</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{REPORT_TYPES[r.report_type]?.label ?? r.report_type}</TableCell>
                    <TableCell className="text-sm">{format(parseISO(r.report_date), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(parseISO(r.submitted_at), 'dd MMM, HH:mm')}</TableCell>
                    <TableCell>{r.amount != null ? formatNairaCompact(r.amount) : '—'}</TableCell>
                    <TableCell><Badge className={`text-xs border capitalize ${REPORT_STATUS_COLOR[r.status as keyof typeof REPORT_STATUS_COLOR] ?? ''}`}>{r.status}</Badge></TableCell>
                    <TableCell>
                      <Badge className={`text-xs border ${gradeColor(r.grade ?? '—')}`}>
                        {r.grade ?? '—'}{r.performance_score != null ? ` · ${r.performance_score}` : ''}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Submit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submit Report</DialogTitle>
            <DialogDescription>{REPORT_TYPES[type].blurb}{REPORT_TYPES[type].convertsTo ? ` Converts to ${REPORT_TYPES[type].convertsTo} once approved.` : ''}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Report type</Label>
                <Select value={type} onValueChange={v => setType(v as ReportType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{typeOptions.map(t => <SelectItem key={t} value={t}>{REPORT_TYPES[t].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>For date</Label>
                <Input type="date" value={form.report_date} onChange={e => setForm(f => ({ ...f, report_date: e.target.value }))} />
              </div>
            </div>

            {type === 'sales' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Amount (₦)</Label>
                  <Input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Payment method</Label>
                  <Select value={form.payment_method} onValueChange={v => setForm(f => ({ ...f, payment_method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {type === 'expense' && (
              <div className="space-y-2">
                <Label>Expense lines</Label>
                {expLines.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <Input className="flex-1" placeholder="Category" value={l.category} onChange={e => setExpLines(p => p.map((x, idx) => idx === i ? { ...x, category: e.target.value } : x))} />
                    <Input className="w-28" type="number" min="0" placeholder="Amount" value={l.amount} onChange={e => setExpLines(p => p.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))} />
                    <Button type="button" variant="ghost" size="icon" className="text-destructive shrink-0" onClick={() => setExpLines(p => p.length > 1 ? p.filter((_, idx) => idx !== i) : p)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setExpLines(p => [...p, { category: '', amount: '', description: '' }])}><Plus className="h-3.5 w-3.5 mr-1" />Add line</Button>
              </div>
            )}

            {type === 'credit' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Supplier</Label><Input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} /></div>
                  <div className="space-y-2"><Label>Amount (₦)</Label><Input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} /></div>
                </div>
                <div className="space-y-2"><Label>Due date (optional)</Label><Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
              </div>
            )}

            {type === 'inventory' && (
              <div className="space-y-2">
                <Label>Stock lines</Label>
                {invLines.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <Input className="flex-1" placeholder="Item" value={l.item} onChange={e => setInvLines(p => p.map((x, idx) => idx === i ? { ...x, item: e.target.value } : x))} />
                    <Input className="w-24" type="number" placeholder="Counted" value={l.counted} onChange={e => setInvLines(p => p.map((x, idx) => idx === i ? { ...x, counted: e.target.value } : x))} />
                    <Input className="w-24" type="number" placeholder="Used" value={l.used} onChange={e => setInvLines(p => p.map((x, idx) => idx === i ? { ...x, used: e.target.value } : x))} />
                    <Button type="button" variant="ghost" size="icon" className="text-destructive shrink-0" onClick={() => setInvLines(p => p.length > 1 ? p.filter((_, idx) => idx !== i) : p)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setInvLines(p => [...p, { item: '', counted: '', used: '' }])}><Plus className="h-3.5 w-3.5 mr-1" />Add line</Button>
              </div>
            )}

            <div className="space-y-2"><Label>Notes / summary (optional)</Label><Textarea rows={2} value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} /></div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
