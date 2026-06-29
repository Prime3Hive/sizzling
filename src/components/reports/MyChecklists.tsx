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
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ListChecks, Loader2, ClipboardCheck } from 'lucide-react';
import { gradeColor } from '@/lib/reports';
import {
  CHECKLIST_STATUS_COLOR, checklistTypeLabel, checklistAutoScore, completionScore,
  type ChecklistItem, type ChecklistResult,
} from '@/lib/checklists';

interface Template { id: string; name: string; checklist_type: string; description: string | null; items: ChecklistItem[]; }
interface Assignment { id: string; template_id: string; cadence: string; due_time: string | null; active: boolean; }
interface Submission {
  id: string; template_id: string | null; checklist_date: string; submitted_at: string;
  status: string; title: string | null; completion_score: number | null;
  performance_score: number | null; grade: string | null; review_note: string | null;
}

const db = supabase as any;
const today = () => new Date().toISOString().slice(0, 10);

export default function MyChecklists() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<{ assignment: Assignment; template: Template } | null>(null);
  const [date, setDate] = useState(today());
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');

  const { data: assignments = [] } = useQuery<Assignment[]>({
    queryKey: ['my-checklist-assignments', user?.id],
    queryFn: async () => {
      const { data, error } = await db.from('checklist_assignments')
        .select('id, template_id, cadence, due_time, active')
        .eq('user_id', user!.id).eq('active', true);
      if (error) throw error;
      return (data ?? []) as Assignment[];
    },
    enabled: !!user,
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['my-checklist-templates', assignments.map(a => a.template_id).join(',')],
    queryFn: async () => {
      const ids = assignments.map(a => a.template_id);
      if (ids.length === 0) return [];
      const { data, error } = await db.from('checklist_templates')
        .select('id, name, checklist_type, description, items').in('id', ids);
      if (error) throw error;
      return (data ?? []) as Template[];
    },
    enabled: !!user && assignments.length > 0,
  });

  const { data: submissions = [] } = useQuery<Submission[]>({
    queryKey: ['my-checklist-submissions', user?.id],
    queryFn: async () => {
      const { data, error } = await db.from('checklist_submissions')
        .select('id, template_id, checklist_date, submitted_at, status, title, completion_score, performance_score, grade, review_note')
        .eq('user_id', user!.id).order('submitted_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Submission[];
    },
    enabled: !!user,
  });

  const templateById = useMemo(() => Object.fromEntries(templates.map(t => [t.id, t])), [templates]);
  const cards = assignments
    .map(a => ({ assignment: a, template: templateById[a.template_id] }))
    .filter((c): c is { assignment: Assignment; template: Template } => !!c.template);

  const openComplete = (c: { assignment: Assignment; template: Template }) => {
    setActive(c);
    setDate(today());
    setChecks(Object.fromEntries(c.template.items.map(i => [i.id, false])));
    setNotes('');
    setOpen(true);
  };

  const livePct = active ? completionScore(active.template.items.map(i => ({ id: i.id, label: i.label, done: !!checks[i.id] }))) : 0;

  const submit = useMutation({
    mutationFn: async () => {
      if (!active) return;
      const results: ChecklistResult[] = active.template.items.map(i => ({
        id: i.id, label: i.label, done: !!checks[i.id],
      }));
      const score = checklistAutoScore({
        results, checklistDate: date, submittedAt: new Date(), dueTime: active.assignment.due_time,
      });
      const { error } = await db.from('checklist_submissions').insert({
        user_id: user!.id,
        assignment_id: active.assignment.id,
        template_id: active.template.id,
        checklist_date: date,
        title: active.template.name,
        results,
        notes: notes.trim() || null,
        completion_score: score.completion,
        timeliness_score: score.timeliness,
        performance_score: score.performance,
        grade: score.grade,
        status: 'submitted',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Checklist submitted', description: 'Sent for review.' });
      setOpen(false); setActive(null);
      qc.invalidateQueries({ queryKey: ['my-checklist-submissions'] });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">My Checklists</h2>
        <p className="text-sm text-muted-foreground">Complete the checklists assigned to you — completion and timeliness are graded.</p>
      </div>

      {/* Assigned checklists */}
      {cards.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(c => (
            <Card key={c.assignment.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-primary" />{c.template.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="capitalize">{checklistTypeLabel(c.template.checklist_type)}</Badge>
                  <Badge variant="outline">{c.template.items.length} items</Badge>
                </div>
                <p className="capitalize">Required: {c.assignment.cadence}{c.assignment.due_time ? ` · by ${c.assignment.due_time}` : ''}</p>
                <Button size="sm" variant="outline" className="mt-1" onClick={() => openComplete(c)}>Complete now</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card><CardContent className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2">
          <ClipboardCheck className="h-8 w-8 opacity-30" /><p className="text-sm">No checklists assigned to you yet.</p>
        </CardContent></Card>
      )}

      {/* History */}
      <Card>
        <CardContent className="p-0">
          {submissions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2">
              <ListChecks className="h-8 w-8 opacity-30" /><p className="text-sm">You have not completed any checklists yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Checklist</TableHead><TableHead>For date</TableHead><TableHead>Submitted</TableHead>
                  <TableHead>Completion</TableHead><TableHead>Status</TableHead><TableHead>Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.title ?? '—'}</TableCell>
                    <TableCell className="text-sm">{format(parseISO(s.checklist_date), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format(parseISO(s.submitted_at), 'dd MMM, HH:mm')}</TableCell>
                    <TableCell>{s.completion_score != null ? `${s.completion_score}%` : '—'}</TableCell>
                    <TableCell><Badge className={`text-xs border capitalize ${CHECKLIST_STATUS_COLOR[s.status as keyof typeof CHECKLIST_STATUS_COLOR] ?? ''}`}>{s.status}</Badge></TableCell>
                    <TableCell><Badge className={`text-xs border ${gradeColor(s.grade ?? '—')}`}>{s.grade ?? '—'}{s.performance_score != null ? ` · ${s.performance_score}` : ''}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Complete dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle>{active.template.name}</DialogTitle>
                <DialogDescription>{active.template.description || 'Check off each item as you complete it.'}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-1">
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div className="space-y-2">
                    <Label>For date</Label>
                    <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                  </div>
                  <div className="text-right">
                    <Badge variant="outline">{livePct}% complete</Badge>
                  </div>
                </div>
                <div className="rounded-lg border divide-y">
                  {active.template.items.map(it => (
                    <label key={it.id} className="flex items-start gap-3 p-3 cursor-pointer">
                      <Checkbox checked={!!checks[it.id]} onCheckedChange={v => setChecks(c => ({ ...c, [it.id]: !!v }))} className="mt-0.5" />
                      <span className="text-sm">
                        {it.label}
                        {it.required && <Badge variant="outline" className="ml-2 text-[10px] py-0">Required</Badge>}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Textarea rows={2} placeholder="Anything to flag about today's checklist" value={notes} onChange={e => setNotes(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
                  {submit.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Submit
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
