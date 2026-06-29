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
import { Plus, Trash2, Loader2, ListChecks, ClipboardCheck, CheckCircle2, XCircle, Pencil } from 'lucide-react';
import { CADENCES, gradeColor, gradeFromScore } from '@/lib/reports';
import {
  CHECKLIST_TYPES, CHECKLIST_STATUS_COLOR, checklistTypeLabel, checklistFinalScore,
  newItemId, type ChecklistItem, type ChecklistResult,
} from '@/lib/checklists';

interface Profile { user_id: string; full_name: string; }
interface Template { id: string; name: string; checklist_type: string; description: string | null; items: ChecklistItem[]; active: boolean; }
interface Assignment { id: string; template_id: string; user_id: string; cadence: string; due_time: string | null; active: boolean; }
interface Submission {
  id: string; user_id: string; template_id: string | null; assignment_id: string | null;
  checklist_date: string; submitted_at: string; status: string; title: string | null;
  results: ChecklistResult[]; notes: string | null; completion_score: number | null;
  timeliness_score: number | null; quality_score: number | null; performance_score: number | null;
  grade: string | null; review_note: string | null;
}

const db = supabase as any;

export default function ChecklistAdmin({ profiles, nameOf }: { profiles: Profile[]; nameOf: (id: string) => string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Template editor
  const [tplOpen, setTplOpen] = useState(false);
  const [editingTpl, setEditingTpl] = useState<Template | null>(null);
  const [tplForm, setTplForm] = useState({ name: '', checklist_type: 'opening', description: '' });
  const [tplItems, setTplItems] = useState<ChecklistItem[]>([{ id: newItemId(), label: '', required: false }]);

  // Assignment
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({ template_id: '', user_id: '', cadence: 'daily', due_time: '' });

  // Review
  const [review, setReview] = useState<Submission | null>(null);
  const [quality, setQuality] = useState('');
  const [reviewNote, setReviewNote] = useState('');

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['checklist-templates'],
    queryFn: async () => {
      const { data, error } = await db.from('checklist_templates').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Template[];
    },
  });
  const { data: assignments = [] } = useQuery<Assignment[]>({
    queryKey: ['checklist-assignments'],
    queryFn: async () => {
      const { data, error } = await db.from('checklist_assignments').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Assignment[];
    },
  });
  const { data: submissions = [] } = useQuery<Submission[]>({
    queryKey: ['checklist-submissions-admin'],
    queryFn: async () => {
      const { data, error } = await db.from('checklist_submissions').select('*').order('submitted_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Submission[];
    },
  });

  const templateName = useMemo(() => {
    const m = Object.fromEntries(templates.map(t => [t.id, t.name]));
    return (id: string | null) => (id ? (m[id] ?? '—') : '—');
  }, [templates]);

  const pending = submissions.filter(s => s.status === 'submitted');

  // ── Template create / edit ───────────────────────────────────────────────────
  const openNewTemplate = () => {
    setEditingTpl(null);
    setTplForm({ name: '', checklist_type: 'opening', description: '' });
    setTplItems([{ id: newItemId(), label: '', required: false }]);
    setTplOpen(true);
  };
  const openEditTemplate = (t: Template) => {
    setEditingTpl(t);
    setTplForm({ name: t.name, checklist_type: t.checklist_type, description: t.description ?? '' });
    setTplItems(t.items.length ? t.items : [{ id: newItemId(), label: '', required: false }]);
    setTplOpen(true);
  };

  const saveTemplate = useMutation({
    mutationFn: async () => {
      if (!tplForm.name.trim()) throw new Error('Give the checklist a name');
      const items = tplItems
        .map(i => ({ id: i.id || newItemId(), label: i.label.trim(), required: !!i.required }))
        .filter(i => i.label);
      if (items.length === 0) throw new Error('Add at least one checklist item');
      const payload = {
        name: tplForm.name.trim(), checklist_type: tplForm.checklist_type,
        description: tplForm.description.trim() || null, items,
      };
      if (editingTpl) {
        const { error } = await db.from('checklist_templates').update(payload).eq('id', editingTpl.id);
        if (error) throw error;
      } else {
        const { error } = await db.from('checklist_templates').insert({ ...payload, active: true, created_by: user!.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: editingTpl ? 'Checklist updated' : 'Checklist created' });
      setTplOpen(false);
      qc.invalidateQueries({ queryKey: ['checklist-templates'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const toggleTemplate = useMutation({
    mutationFn: async (t: Template) => {
      const { error } = await db.from('checklist_templates').update({ active: !t.active }).eq('id', t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklist-templates'] }),
  });

  // ── Assignments ──────────────────────────────────────────────────────────────
  const saveAssignment = useMutation({
    mutationFn: async () => {
      if (!assignForm.template_id) throw new Error('Select a checklist');
      if (!assignForm.user_id) throw new Error('Select a staff member');
      const { error } = await db.from('checklist_assignments').upsert({
        template_id: assignForm.template_id, user_id: assignForm.user_id,
        cadence: assignForm.cadence, due_time: assignForm.due_time || null,
        active: true, created_by: user!.id,
      }, { onConflict: 'template_id,user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Checklist assigned' });
      setAssignOpen(false);
      setAssignForm({ template_id: '', user_id: '', cadence: 'daily', due_time: '' });
      qc.invalidateQueries({ queryKey: ['checklist-assignments'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  const toggleAssignment = useMutation({
    mutationFn: async (a: Assignment) => {
      const { error } = await db.from('checklist_assignments').update({ active: !a.active }).eq('id', a.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['checklist-assignments'] }),
  });

  // ── Review / grade ───────────────────────────────────────────────────────────
  const decide = useMutation({
    mutationFn: async ({ s, status }: { s: Submission; status: 'approved' | 'rejected' }) => {
      const q = quality === '' ? null : Math.max(0, Math.min(100, parseFloat(quality)));
      const performance = status === 'approved' ? checklistFinalScore(s.performance_score ?? null, q) : null;
      const { error } = await db.from('checklist_submissions').update({
        status, quality_score: q,
        performance_score: status === 'approved' ? performance : s.performance_score,
        grade: status === 'approved' ? gradeFromScore(performance) : s.grade,
        review_note: reviewNote || null, reviewed_by: user!.id, reviewed_at: new Date().toISOString(),
      }).eq('id', s.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast({ title: v.status === 'approved' ? 'Checklist approved' : 'Checklist rejected' });
      setReview(null); setQuality(''); setReviewNote('');
      qc.invalidateQueries({ queryKey: ['checklist-submissions-admin'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  return (
    <Tabs defaultValue="review-cl">
      <TabsList>
        <TabsTrigger value="review-cl">Review{pending.length > 0 && <Badge className="ml-2 text-xs">{pending.length}</Badge>}</TabsTrigger>
        <TabsTrigger value="templates">Checklists</TabsTrigger>
        <TabsTrigger value="cl-assignments">Assignments</TabsTrigger>
      </TabsList>

      {/* Review queue */}
      <TabsContent value="review-cl" className="mt-4">
        <Card>
          <CardContent className="p-0">
            {submissions.length === 0 ? (
              <Empty icon={ClipboardCheck} msg="No checklist submissions yet." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead><TableHead>Checklist</TableHead><TableHead>For date</TableHead>
                    <TableHead>Completion</TableHead><TableHead>Status</TableHead><TableHead>Grade</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map(s => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{nameOf(s.user_id)}</TableCell>
                      <TableCell>{s.title ?? templateName(s.template_id)}</TableCell>
                      <TableCell className="text-sm">{format(parseISO(s.checklist_date), 'dd MMM yyyy')}</TableCell>
                      <TableCell>{s.completion_score != null ? `${s.completion_score}%` : '—'}</TableCell>
                      <TableCell><Badge className={`text-xs border capitalize ${CHECKLIST_STATUS_COLOR[s.status as keyof typeof CHECKLIST_STATUS_COLOR] ?? ''}`}>{s.status}</Badge></TableCell>
                      <TableCell><Badge className={`text-xs border ${gradeColor(s.grade ?? '—')}`}>{s.grade ?? '—'}{s.performance_score != null ? ` · ${s.performance_score}` : ''}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => { setReview(s); setQuality(s.quality_score?.toString() ?? ''); setReviewNote(s.review_note ?? ''); }}>
                          {s.status === 'submitted' ? 'Review' : 'View'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Templates */}
      <TabsContent value="templates" className="mt-4 space-y-3">
        <div className="flex justify-end">
          <Button onClick={openNewTemplate}><Plus className="h-4 w-4 mr-2" />New checklist</Button>
        </div>
        <Card>
          <CardContent className="p-0">
            {templates.length === 0 ? (
              <Empty icon={ListChecks} msg="No checklists created yet." />
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Items</TableHead><TableHead>Active</TableHead><TableHead className="text-right">Edit</TableHead></TableRow></TableHeader>
                <TableBody>
                  {templates.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell><Badge variant="outline" className="capitalize">{checklistTypeLabel(t.checklist_type)}</Badge></TableCell>
                      <TableCell>{t.items?.length ?? 0}</TableCell>
                      <TableCell><Switch checked={t.active} onCheckedChange={() => toggleTemplate.mutate(t)} /></TableCell>
                      <TableCell className="text-right"><Button size="icon" variant="ghost" onClick={() => openEditTemplate(t)}><Pencil className="h-4 w-4" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Assignments */}
      <TabsContent value="cl-assignments" className="mt-4 space-y-3">
        <div className="flex justify-end">
          <Button onClick={() => setAssignOpen(true)} disabled={templates.length === 0}><Plus className="h-4 w-4 mr-2" />Assign checklist</Button>
        </div>
        <Card>
          <CardContent className="p-0">
            {assignments.length === 0 ? (
              <Empty icon={ClipboardCheck} msg="No checklist assignments yet." />
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Staff</TableHead><TableHead>Checklist</TableHead><TableHead>Cadence</TableHead><TableHead>Due</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
                <TableBody>
                  {assignments.map(a => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{nameOf(a.user_id)}</TableCell>
                      <TableCell>{templateName(a.template_id)}</TableCell>
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

      {/* Template editor dialog */}
      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTpl ? 'Edit checklist' : 'New checklist'}</DialogTitle>
            <DialogDescription>Name the checklist, pick its type and add the items to be checked off.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label>Name</Label>
                <Input placeholder="e.g. Morning Opening" value={tplForm.name} onChange={e => setTplForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label>Checklist type</Label>
                <Select value={tplForm.checklist_type} onValueChange={v => setTplForm(f => ({ ...f, checklist_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CHECKLIST_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea rows={2} value={tplForm.description} onChange={e => setTplForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Items</Label>
              {tplItems.map((it, i) => (
                <div key={it.id} className="flex items-center gap-2">
                  <Input className="flex-1" placeholder="What needs to be done / checked" value={it.label} onChange={e => setTplItems(p => p.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
                  <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <Switch checked={!!it.required} onCheckedChange={v => setTplItems(p => p.map((x, idx) => idx === i ? { ...x, required: v } : x))} />
                    Required
                  </label>
                  <Button type="button" variant="ghost" size="icon" className="text-destructive shrink-0" onClick={() => setTplItems(p => p.length > 1 ? p.filter((_, idx) => idx !== i) : p)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setTplItems(p => [...p, { id: newItemId(), label: '', required: false }])}><Plus className="h-3.5 w-3.5 mr-1" />Add item</Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTplOpen(false)}>Cancel</Button>
            <Button onClick={() => saveTemplate.mutate()} disabled={saveTemplate.isPending}>
              {saveTemplate.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assignment dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign a checklist</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Checklist</Label>
              <Select value={assignForm.template_id} onValueChange={v => setAssignForm(f => ({ ...f, template_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select checklist" /></SelectTrigger>
                <SelectContent>{templates.filter(t => t.active).map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Staff member</Label>
              <Select value={assignForm.user_id} onValueChange={v => setAssignForm(f => ({ ...f, user_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>{profiles.map(p => <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Cadence</Label>
                <Select value={assignForm.cadence} onValueChange={v => setAssignForm(f => ({ ...f, cadence: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CADENCES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Due time (optional)</Label>
                <Input type="time" value={assignForm.due_time} onChange={e => setAssignForm(f => ({ ...f, due_time: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={() => saveAssignment.mutate()} disabled={saveAssignment.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review dialog */}
      <Dialog open={!!review} onOpenChange={o => { if (!o) setReview(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {review && (
            <>
              <DialogHeader>
                <DialogTitle>{review.title ?? templateName(review.template_id)}</DialogTitle>
                <DialogDescription>By {nameOf(review.user_id)} · for {format(parseISO(review.checklist_date), 'dd MMM yyyy')} · submitted {format(parseISO(review.submitted_at), 'dd MMM, HH:mm')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-1 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge className={`border capitalize ${CHECKLIST_STATUS_COLOR[review.status as keyof typeof CHECKLIST_STATUS_COLOR] ?? ''}`}>{review.status}</Badge>
                  <Badge variant="outline">Completion: {review.completion_score ?? '—'}%</Badge>
                  <Badge variant="outline">Timeliness: {review.timeliness_score ?? '—'}</Badge>
                  {review.grade && <Badge className={`border ${gradeColor(review.grade)}`}>Grade {review.grade}</Badge>}
                </div>
                <div className="rounded-lg border divide-y">
                  {(review.results ?? []).map((r, i) => (
                    <div key={i} className="flex items-start gap-2 p-2">
                      {r.done
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                        : <XCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
                      <div className="min-w-0">
                        <p className={r.done ? '' : 'text-muted-foreground'}>{r.label}</p>
                        {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                {review.notes && <p className="text-muted-foreground">{review.notes}</p>}

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
                  </div>
                )}
              </div>
              {review.status === 'submitted' && (
                <DialogFooter>
                  <Button variant="outline" className="text-red-700 border-red-300 hover:bg-red-50" onClick={() => decide.mutate({ s: review, status: 'rejected' })} disabled={decide.isPending}>
                    <XCircle className="h-4 w-4 mr-1" />Reject
                  </Button>
                  <Button onClick={() => decide.mutate({ s: review, status: 'approved' })} disabled={decide.isPending}>
                    {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}Approve
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}

function Empty({ icon: Icon, msg }: { icon: React.ElementType; msg: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2">
      <Icon className="h-8 w-8 opacity-30" /><p className="text-sm">{msg}</p>
    </div>
  );
}
