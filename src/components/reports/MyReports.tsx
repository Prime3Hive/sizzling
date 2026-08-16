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
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, ClipboardList, FileText, Loader2, Eye } from 'lucide-react';
import {
  REPORT_TYPES, REPORT_STATUS_COLOR, gradeColor, computeTimeliness,
  gradeFromScore, summarizePerformance, OPERATIONS_FIELDS,
  type ReportType, type CreditLineKind, type OperationsDetails,
} from '@/lib/reports';
import ReportDetailsDialog, { type StaffReportRecord } from '@/components/reports/ReportDetailsDialog';
import { formatNairaCompact } from '@/lib/currency';

interface Assignment { id: string; report_type: ReportType; cadence: string; due_time: string | null; active: boolean; }
interface Product { id: string; name: string; uom: string | null; price: number | null; }
interface CreditLineForm { kind: CreditLineKind; product_id: string; item: string; qty: string; amount: string; }
const emptyCreditLine = (): CreditLineForm => ({ kind: 'product', product_id: '', item: '', qty: '', amount: '' });
type Report = StaffReportRecord;

const today = () => new Date().toISOString().slice(0, 10);

export default function MyReports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Report | null>(null);
  const [type, setType] = useState<ReportType>('sales');
  const [form, setForm] = useState({ report_date: today(), title: '', summary: '', amount: '', payment_method: 'cash', sale_type: 'daily', source: '', is_supplier: false, due_date: '', misc_description: '', misc_amount: '', petty_description: '', petty_amount: '' });
  const [expLines, setExpLines] = useState<{ category: string; amount: string; description: string }[]>([{ category: '', amount: '', description: '' }]);
  const [invLines, setInvLines] = useState<{ item: string; counted: string; used: string }[]>([{ item: '', counted: '', used: '' }]);
  const [creditLines, setCreditLines] = useState<CreditLineForm[]>([emptyCreditLine()]);
  const [kitchenLines, setKitchenLines] = useState<{ item: string; prepared: string; served: string; wasted: string }[]>([{ item: '', prepared: '', served: '', wasted: '' }]);
  const [opsForm, setOpsForm] = useState<OperationsDetails>({ key_activities: '', challenges: '', observations: '', suggestions: '' });

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
        .select('id, user_id, report_type, report_date, submitted_at, status, title, summary, amount, payment_method, details, timeliness_score, quality_score, performance_score, grade, review_note, reviewed_at, converted_ref')
        .eq('user_id', user!.id).order('submitted_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Report[];
    },
    enabled: !!user,
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ['report-products'],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select('id, name, uom, price').order('name');
      if (error) throw error;
      return (data ?? []) as Product[];
    },
    enabled: !!user,
  });

  const assignedTypes = useMemo(() => assignments.map(a => a.report_type), [assignments]);
  const typeOptions = (assignedTypes.length ? assignedTypes : (Object.keys(REPORT_TYPES) as ReportType[]));

  const summary = useMemo(() => summarizePerformance(reports), [reports]);

  const resetForm = () => {
    setForm({ report_date: today(), title: '', summary: '', amount: '', payment_method: 'cash', sale_type: 'daily', source: '', is_supplier: false, due_date: '', misc_description: '', misc_amount: '', petty_description: '', petty_amount: '' });
    setExpLines([{ category: '', amount: '', description: '' }]);
    setInvLines([{ item: '', counted: '', used: '' }]);
    setCreditLines([emptyCreditLine()]);
    setKitchenLines([{ item: '', prepared: '', served: '', wasted: '' }]);
    setOpsForm({ key_activities: '', challenges: '', observations: '', suggestions: '' });
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
        details.sale_type = form.sale_type;
      } else if (type === 'expense') {
        const lines = expLines
          .map(l => ({ category: l.category.trim(), amount: parseFloat(l.amount) || 0, description: l.description.trim() }))
          .filter(l => l.category && l.amount > 0);
        const miscAmt = parseFloat(form.misc_amount) || 0;
        if (miscAmt > 0) lines.push({ category: 'Miscellaneous', amount: miscAmt, description: form.misc_description.trim() });
        const pettyAmt = parseFloat(form.petty_amount) || 0;
        if (pettyAmt > 0) lines.push({ category: 'Petty Cash', amount: pettyAmt, description: form.petty_description.trim() });
        if (lines.length === 0) throw new Error('Add at least one expense line (or a miscellaneous / petty cash amount)');
        amount = lines.reduce((s, l) => s + l.amount, 0);
        details.lines = lines;
      } else if (type === 'credit') {
        const lines = creditLines
          .map(l => {
            const item = l.kind === 'misc'
              ? (l.item.trim() || 'Miscellaneous')
              : l.item.trim();
            return {
              kind: l.kind,
              product_id: l.kind === 'product' && l.product_id ? l.product_id : null,
              item,
              qty: parseFloat(l.qty) || null,
              amount: parseFloat(l.amount) || 0,
            };
          })
          .filter(l => l.item && l.amount > 0);
        if (lines.length === 0) throw new Error('Add at least one item bought on credit');
        amount = lines.reduce((s, l) => s + l.amount, 0);
        details.lines = lines;
        details.source = form.source.trim() || null;
        details.is_supplier = form.is_supplier;
        if (form.due_date) details.due_date = form.due_date;
      } else if (type === 'inventory') {
        const lines = invLines
          .map(l => ({ item: l.item.trim(), counted: parseFloat(l.counted) || 0, used: parseFloat(l.used) || 0 }))
          .filter(l => l.item);
        details.lines = lines;
      } else if (type === 'kitchen') {
        const lines = kitchenLines
          .map(l => ({ item: l.item.trim(), prepared: parseFloat(l.prepared) || 0, served: parseFloat(l.served) || 0, wasted: parseFloat(l.wasted) || 0 }))
          .filter(l => l.item);
        if (lines.length === 0) throw new Error('Add at least one kitchen item');
        details.lines = lines;
      } else if (type === 'operations') {
        const ops: OperationsDetails = {
          key_activities: opsForm.key_activities?.trim() || '',
          challenges: opsForm.challenges?.trim() || '',
          observations: opsForm.observations?.trim() || '',
          suggestions: opsForm.suggestions?.trim() || '',
        };
        if (!ops.key_activities && !ops.challenges && !ops.observations && !ops.suggestions)
          throw new Error('Fill in at least one section of the operations report');
        details.operations = ops;
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

      {/* Quick performance summary */}
      {reports.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Reports submitted</p>
              <p className="text-2xl font-bold mt-1">{summary.total}</p>
              <p className="text-xs text-muted-foreground mt-1">{summary.pending} awaiting review</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">On-time rate</p>
              <p className="text-2xl font-bold mt-1">{summary.onTimeRate != null ? `${summary.onTimeRate}%` : '—'}</p>
              <p className="text-xs text-muted-foreground mt-1">{summary.onTime} of {summary.total} on time</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Average score</p>
              <p className="text-2xl font-bold mt-1">{summary.avgScore ?? '—'}</p>
              <p className="text-xs text-muted-foreground mt-1">across graded reports</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Overall grade</p>
              <div className="mt-1">
                <Badge className={`text-lg px-2.5 py-0.5 border ${gradeColor(summary.grade)}`}>{summary.grade}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{summary.approved} approved · {summary.rejected} rejected</p>
            </CardContent>
          </Card>
        </div>
      )}

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
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map(r => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setViewing(r)}>
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
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); setViewing(r); }}>
                        <Eye className="h-3.5 w-3.5 mr-1" />View
                      </Button>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="space-y-2">
                  <Label>Sales channel</Label>
                  <Select value={form.sale_type} onValueChange={v => setForm(f => ({ ...f, sale_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Shop sales</SelectItem>
                      <SelectItem value="event">Event sales</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {type === 'expense' && (
              <>
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

                <div className="space-y-2 rounded-lg border p-2">
                  <Label>Miscellaneous</Label>
                  <p className="text-xs text-muted-foreground">List small uncategorised expenses here; their total is added to the report.</p>
                  <Textarea rows={2} placeholder="e.g. fuel ₦2,000; bottled water ₦500; parking ₦300" value={form.misc_description} onChange={e => setForm(f => ({ ...f, misc_description: e.target.value }))} />
                  <Input type="number" min="0" step="0.01" placeholder="Total amount (₦)" value={form.misc_amount} onChange={e => setForm(f => ({ ...f, misc_amount: e.target.value }))} />
                </div>

                <div className="space-y-2 rounded-lg border p-2">
                  <Label>Petty cash</Label>
                  <p className="text-xs text-muted-foreground">Cash spent from the petty cash float.</p>
                  <Textarea rows={2} placeholder="What the petty cash was spent on" value={form.petty_description} onChange={e => setForm(f => ({ ...f, petty_description: e.target.value }))} />
                  <Input type="number" min="0" step="0.01" placeholder="Amount (₦)" value={form.petty_amount} onChange={e => setForm(f => ({ ...f, petty_amount: e.target.value }))} />
                </div>
              </>
            )}

            {type === 'credit' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Items bought on credit</Label>
                  {creditLines.map((l, i) => {
                    const update = (patch: Partial<CreditLineForm>) =>
                      setCreditLines(p => p.map((x, idx) => idx === i ? { ...x, ...patch } : x));
                    return (
                      <div key={i} className="rounded-lg border p-2 space-y-2">
                        <div className="flex gap-2">
                          <Select
                            value={l.kind}
                            onValueChange={v => update({ kind: v as CreditLineKind, product_id: '', item: v === 'misc' ? '' : l.item })}
                          >
                            <SelectTrigger className="w-36 shrink-0"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="product">From product list</SelectItem>
                              <SelectItem value="manual">Type manually</SelectItem>
                              <SelectItem value="misc">Miscellaneous</SelectItem>
                            </SelectContent>
                          </Select>
                          {l.kind === 'product' ? (
                            <Select
                              value={l.product_id}
                              onValueChange={v => {
                                const p = products.find(pr => pr.id === v);
                                update({ product_id: v, item: p?.name ?? '', amount: l.amount || (p?.price ? String(p.price) : '') });
                              }}
                            >
                              <SelectTrigger className="flex-1"><SelectValue placeholder="Select product" /></SelectTrigger>
                              <SelectContent>
                                {products.length === 0
                                  ? <SelectItem value="none" disabled>No products found</SelectItem>
                                  : products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.uom ? ` (${p.uom})` : ''}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              className="flex-1"
                              placeholder={l.kind === 'misc' ? 'Description (optional)' : 'Item description'}
                              value={l.item}
                              onChange={e => update({ item: e.target.value })}
                            />
                          )}
                          <Button type="button" variant="ghost" size="icon" className="text-destructive shrink-0"
                            onClick={() => setCreditLines(p => p.length > 1 ? p.filter((_, idx) => idx !== i) : p)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Input className="w-24" type="number" min="0" placeholder="Qty" value={l.qty} onChange={e => update({ qty: e.target.value })} />
                          <Input className="flex-1" type="number" min="0" step="0.01" placeholder="Amount (₦)" value={l.amount} onChange={e => update({ amount: e.target.value })} />
                        </div>
                      </div>
                    );
                  })}
                  <Button type="button" variant="outline" size="sm" onClick={() => setCreditLines(p => [...p, emptyCreditLine()])}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Add item
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2"><Label>Bought from (optional)</Label><Input placeholder="Supplier / person / shop" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} /></div>
                  <div className="space-y-2"><Label>Due date (optional)</Label><Input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-2">
                  <div>
                    <Label className="text-sm">From a registered supplier</Label>
                    <p className="text-xs text-muted-foreground">Not all credit is from suppliers.</p>
                  </div>
                  <Switch checked={form.is_supplier} onCheckedChange={v => setForm(f => ({ ...f, is_supplier: v }))} />
                </div>
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

            {type === 'kitchen' && (
              <div className="space-y-2">
                <Label>Food prepared</Label>
                <p className="text-xs text-muted-foreground">Log what was prepared, how much was served and how much was wasted.</p>
                <div className="hidden sm:flex gap-2 text-xs text-muted-foreground px-1">
                  <span className="flex-1">Item</span><span className="w-24">Prepared</span><span className="w-24">Served</span><span className="w-24">Wasted</span><span className="w-9" />
                </div>
                {kitchenLines.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <Input className="flex-1" placeholder="Item" value={l.item} onChange={e => setKitchenLines(p => p.map((x, idx) => idx === i ? { ...x, item: e.target.value } : x))} />
                    <Input className="w-24" type="number" min="0" placeholder="Prepared" value={l.prepared} onChange={e => setKitchenLines(p => p.map((x, idx) => idx === i ? { ...x, prepared: e.target.value } : x))} />
                    <Input className="w-24" type="number" min="0" placeholder="Served" value={l.served} onChange={e => setKitchenLines(p => p.map((x, idx) => idx === i ? { ...x, served: e.target.value } : x))} />
                    <Input className="w-24" type="number" min="0" placeholder="Wasted" value={l.wasted} onChange={e => setKitchenLines(p => p.map((x, idx) => idx === i ? { ...x, wasted: e.target.value } : x))} />
                    <Button type="button" variant="ghost" size="icon" className="text-destructive shrink-0" onClick={() => setKitchenLines(p => p.length > 1 ? p.filter((_, idx) => idx !== i) : p)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setKitchenLines(p => [...p, { item: '', prepared: '', served: '', wasted: '' }])}><Plus className="h-3.5 w-3.5 mr-1" />Add item</Button>
              </div>
            )}

            {type === 'operations' && (
              <div className="space-y-3">
                {OPERATIONS_FIELDS.map(f => (
                  <div key={f.key} className="space-y-2">
                    <Label>{f.label}</Label>
                    <Textarea rows={2} placeholder={f.placeholder} value={opsForm[f.key] ?? ''} onChange={e => setOpsForm(p => ({ ...p, [f.key]: e.target.value }))} />
                  </div>
                ))}
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

      {/* Report details — full view of a submitted report, including the review outcome */}
      <ReportDetailsDialog
        report={viewing}
        open={!!viewing}
        onOpenChange={o => { if (!o) setViewing(null); }}
      />
    </div>
  );
}
