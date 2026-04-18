import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ClipboardList, Plus, Trash2, Loader2, UserCircle } from "lucide-react";
import { format } from "date-fns";

interface TaskAssignment {
  id: string;
  title: string;
  description: string | null;
  status: string;
  weight: number;
  max_score: number;
  score: number | null;
  due_date: string | null;
  assigned_at: string;
  staff_profiles: { full_name: string } | null;
  kpi_categories: { name: string; color: string } | null;
  kpi_periods: { name: string } | null;
}

const blank = {
  period_id: "",
  staff_profile_id: "",
  category_id: "",
  title: "",
  description: "",
  target_value: "",
  weight: "1",
  max_score: "10",
  due_date: "",
};

const statusColors: Record<string, string> = {
  pending:     "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  submitted:   "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  scored:      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

export default function KPIAssignTasks() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [filterPeriod, setFilterPeriod] = useState("all");

  // Periods (active/draft only for assigning)
  const { data: periods = [] } = useQuery({
    queryKey: ["kpi-periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_periods").select("id, name, status").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Categories
  const { data: categories = [] } = useQuery({
    queryKey: ["kpi-categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("kpi_categories").select("id, name, color").order("name");
      if (error) throw error;
      return data || [];
    },
  });

  // Staff profiles
  const { data: staff = [] } = useQuery({
    queryKey: ["staff-profiles-select"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles").select("id, full_name").order("full_name");
      if (error) throw error;
      return data || [];
    },
  });

  // All assignments
  const { data: tasks = [], isLoading } = useQuery<TaskAssignment[]>({
    queryKey: ["kpi-task-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_task_assignments")
        .select(`id, title, description, status, weight, max_score, score, due_date, assigned_at,
          staff_profiles(full_name), kpi_categories(name, color), kpi_periods(name)`)
        .order("assigned_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as TaskAssignment[];
    },
  });

  const assign = useMutation({
    mutationFn: async (payload: typeof blank) => {
      const { error } = await supabase.from("kpi_task_assignments").insert({
        period_id:        payload.period_id,
        staff_profile_id: payload.staff_profile_id,
        category_id:      payload.category_id || null,
        title:            payload.title,
        description:      payload.description || null,
        target_value:     payload.target_value || null,
        weight:           parseInt(payload.weight),
        max_score:        parseInt(payload.max_score),
        due_date:         payload.due_date || null,
        assigned_by:      user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-task-assignments"] });
      toast({ title: "Task assigned successfully" });
      setOpen(false); setForm(blank);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("kpi_task_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-task-assignments"] });
      toast({ title: "Task removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!form.period_id || !form.staff_profile_id || !form.title) {
      toast({ title: "Please fill in Period, Staff member and Task Title", variant: "destructive" });
      return;
    }
    assign.mutate(form);
  };

  const filtered = filterPeriod === "all" ? tasks : tasks.filter((t) => {
    const period = periods.find((p: any) => p.name === t.kpi_periods?.name);
    return period?.id === filterPeriod;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Assign Tasks</h2>
          <p className="text-sm text-muted-foreground">Assign KPI tasks to individual staff members.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterPeriod} onValueChange={setFilterPeriod}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Periods</SelectItem>
              {periods.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Assign Task
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground">No tasks assigned yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => (
            <Card key={task.id} className="group hover:shadow-sm transition-shadow">
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{task.title}</span>
                      <Badge className={`text-xs ${statusColors[task.status]}`}>
                        {task.status.replace("_", " ")}
                      </Badge>
                      {task.kpi_categories && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                          style={{ backgroundColor: task.kpi_categories.color }}
                        >
                          {task.kpi_categories.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <UserCircle className="h-3 w-3" />
                        {task.staff_profiles?.full_name || "—"}
                      </span>
                      <span>Period: {task.kpi_periods?.name || "—"}</span>
                      {task.due_date && <span>Due: {format(new Date(task.due_date), "MMM d, yyyy")}</span>}
                      <span>Weight: {task.weight} · Max: {task.max_score} pts</span>
                      {task.score != null && (
                        <span className="text-green-600 font-semibold">Score: {task.score}/{task.max_score}</span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{task.description}</p>
                    )}
                  </div>
                  {task.status === "pending" && (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={() => remove.mutate(task.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Assign Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign New Task</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Review Period *</Label>
              <Select value={form.period_id} onValueChange={(v) => setForm({ ...form, period_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select period" /></SelectTrigger>
                <SelectContent>
                  {periods.filter((p: any) => p.status !== "closed").map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Staff Member *</Label>
              <Select value={form.staff_profile_id} onValueChange={(v) => setForm({ ...form, staff_profile_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>
                  {(staff as any[]).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {(categories as any[]).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Task Title *</Label>
              <Input placeholder="e.g. Achieve 98% order accuracy"
                value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea rows={2} placeholder="Describe the task…"
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Target / Expected Output</Label>
              <Input placeholder="e.g. 100 units, 95%, 5 reports"
                value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label>Weight (1–10)</Label>
                <Input type="number" min={1} max={10} value={form.weight}
                  onChange={(e) => setForm({ ...form, weight: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Max Score</Label>
                <Input type="number" min={1} max={100} value={form.max_score}
                  onChange={(e) => setForm({ ...form, max_score: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Due Date</Label>
                <Input type="date" value={form.due_date}
                  onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={assign.isPending}>
              {assign.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Assign Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
