import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ClipboardList, Plus, Trash2, Loader2, UserCircle, Library, Building2, Check, ListPlus } from "lucide-react";
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

interface Category {
  id: string;
  name: string;
  color: string;
  department_id: string | null;
}

interface TaskTemplate {
  id: string;
  category_id: string;
  title: string;
  description: string | null;
  target: string | null;
  weight: number;
  max_score: number;
}

interface StaffMember {
  id: string;
  full_name: string;
  department_id: string | null;
}

interface Department {
  id: string;
  name: string;
}

/** A single task queued for assignment (from the library or entered manually). */
interface TaskDraft {
  _key: string;
  title: string;
  description: string;
  target_value: string;
  category_id: string;
  weight: string;
  max_score: string;
  due_date: string;
}

const blank = {
  department_id:    "",
  period_id:        "",
  staff_profile_id: "",
  category_id:      "",
  title:            "",
  description:      "",
  target_value:     "",
  weight:           "25",
  max_score:        "100",
  due_date:         "",
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
  const [open, setOpen]             = useState(false);
  const [form, setForm]             = useState(blank);
  const [filterPeriod, setFilterPeriod] = useState("all");
  const [queue, setQueue]           = useState<TaskDraft[]>([]);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: departments = [] } = useQuery<Department[]>({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments").select("id, name").order("name");
      if (error) throw error;
      return (data || []) as Department[];
    },
  });

  const { data: periods = [] } = useQuery({
    queryKey: ["kpi-periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_periods").select("id, name, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["kpi-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_categories")
        .select("id, name, color, department_id")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as Category[];
    },
  });

  const { data: templates = [] } = useQuery<TaskTemplate[]>({
    queryKey: ["kpi-task-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_task_templates")
        .select("id, category_id, title, description, target, weight, max_score")
        .order("sort_order");
      if (error) throw error;
      return (data || []) as unknown as TaskTemplate[];
    },
  });

  const { data: staff = [] } = useQuery<StaffMember[]>({
    queryKey: ["staff-profiles-select"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles").select("id, full_name, department_id").order("full_name");
      if (error) throw error;
      return (data || []) as unknown as StaffMember[];
    },
  });

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

  // Periods selectable for assignment: prefer open (non-closed); if every period
  // is closed, fall back to showing all so the user is never stuck with an empty list.
  const openPeriods = useMemo(
    () => (periods as any[]).filter((p) => p.status !== "closed"),
    [periods],
  );
  const periodOptions = openPeriods.length ? openPeriods : (periods as any[]);

  // Auto-select the active period (or first open one) once the dialog is open
  // and periods have loaded, so Review Period isn't left blank.
  useEffect(() => {
    if (!open || form.period_id || periodOptions.length === 0) return;
    const active = (periods as any[]).find((p) => p.status === "active");
    setForm((prev) => ({ ...prev, period_id: (active ?? periodOptions[0])?.id ?? "" }));
  }, [open, periods, periodOptions, form.period_id]);

  // ── Department-scoped derived lists ────────────────────────────────────────────

  // Staff strictly within the selected department
  const deptStaff = useMemo(
    () => form.department_id ? staff.filter(s => s.department_id === form.department_id) : [],
    [staff, form.department_id],
  );

  // Categories belonging to the selected department
  const deptCategories = useMemo(
    () => form.department_id ? categories.filter(c => c.department_id === form.department_id) : [],
    [categories, form.department_id],
  );

  // Template library scoped to the selected department's categories
  const deptCategoryIds = useMemo(() => new Set(deptCategories.map(c => c.id)), [deptCategories]);
  const deptTemplates = useMemo(
    () => templates.filter(t => deptCategoryIds.has(t.category_id)),
    [templates, deptCategoryIds],
  );
  // Optionally narrow templates by chosen category
  const pickerTemplates = useMemo(
    () => form.category_id ? deptTemplates.filter(t => t.category_id === form.category_id) : deptTemplates,
    [deptTemplates, form.category_id],
  );

  const categoryById = useMemo(() => {
    const m: Record<string, Category> = {};
    categories.forEach(c => { m[c.id] = c; });
    return m;
  }, [categories]);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const assign = useMutation({
    mutationFn: async (vars: { drafts: TaskDraft[]; period_id: string; staff_profile_id: string }) => {
      const rows = vars.drafts.map((d) => ({
        period_id:        vars.period_id,
        staff_profile_id: vars.staff_profile_id,
        category_id:      d.category_id || null,
        title:            d.title,
        description:      d.description || null,
        target_value:     d.target_value || null,
        weight:           parseInt(d.weight) || 0,
        max_score:        parseInt(d.max_score) || 100,
        due_date:         d.due_date || null,
        assigned_by:      user?.id,
      }));
      const { error } = await supabase.from("kpi_task_assignments").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["kpi-task-assignments"] });
      toast({ title: `${count} task${count === 1 ? "" : "s"} assigned successfully` });
      setOpen(false); resetDialog();
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

  // ── Queue helpers ──────────────────────────────────────────────────────────────

  const isQueued = (templateId: string) => queue.some((d) => d._key === `tpl-${templateId}`);

  const toggleTemplate = (t: TaskTemplate) => {
    const key = `tpl-${t.id}`;
    setQueue((prev) => {
      if (prev.some((d) => d._key === key)) return prev.filter((d) => d._key !== key);
      return [...prev, {
        _key:         key,
        title:        t.title,
        description:  t.description || "",
        target_value: t.target || "",
        category_id:  t.category_id,
        weight:       String(t.weight),
        max_score:    String(t.max_score),
        due_date:     "",
      }];
    });
  };

  const addCustomToQueue = () => {
    if (!form.title.trim()) {
      toast({ title: "Enter a task title to add it", variant: "destructive" });
      return;
    }
    setQueue((prev) => [...prev, {
      _key:         `custom-${Date.now()}`,
      title:        form.title.trim(),
      description:  form.description,
      target_value: form.target_value,
      category_id:  form.category_id,
      weight:       form.weight,
      max_score:    form.max_score,
      due_date:     form.due_date,
    }]);
    // Clear the manual entry fields, keep weight/max defaults for the next one
    setForm((prev) => ({ ...prev, title: "", description: "", target_value: "", due_date: "" }));
  };

  const removeFromQueue = (key: string) =>
    setQueue((prev) => prev.filter((d) => d._key !== key));

  const updateQueueWeight = (key: string, weight: string) =>
    setQueue((prev) => prev.map((d) => (d._key === key ? { ...d, weight } : d)));

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const resetDialog = () => { setForm(blank); setQueue([]); };

  const handleSubmit = () => {
    if (!form.department_id || !form.period_id || !form.staff_profile_id) {
      toast({ title: "Please select Department, Review Period and Staff member", variant: "destructive" });
      return;
    }
    // Include an in-progress manual task (title typed but not yet added to the list)
    const drafts = [...queue];
    if (form.title.trim()) {
      drafts.push({
        _key:         `inline-${Date.now()}`,
        title:        form.title.trim(),
        description:  form.description,
        target_value: form.target_value,
        category_id:  form.category_id,
        weight:       form.weight,
        max_score:    form.max_score,
        due_date:     form.due_date,
      });
    }
    if (drafts.length === 0) {
      toast({
        title: "No tasks to assign",
        description: "Pick one or more tasks from the library, or enter a task title.",
        variant: "destructive",
      });
      return;
    }
    assign.mutate({ drafts, period_id: form.period_id, staff_profile_id: form.staff_profile_id });
  };

  // Changing department resets staff, category, template selection and the queue
  // (categories/templates are department-scoped, so the queue is no longer valid).
  const setDepartment = (deptId: string) => {
    setForm(prev => ({ ...prev, department_id: deptId, staff_profile_id: "", category_id: "" }));
    setQueue([]);
  };

  const filtered = filterPeriod === "all" ? tasks : tasks.filter((t) => {
    const period = (periods as any[]).find((p) => p.name === t.kpi_periods?.name);
    return period?.id === filterPeriod;
  });

  const openDialog = () => { resetDialog(); setOpen(true); };

  const selectedStaffName = deptStaff.find((s) => s.id === form.staff_profile_id)?.full_name;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold">Assign Tasks</h2>
          <p className="text-sm text-muted-foreground">
            Pick a department, then assign one or more KPI tasks to staff within that department.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterPeriod} onValueChange={setFilterPeriod}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Filter by period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Periods</SelectItem>
              {(periods as any[]).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openDialog} className="gap-2">
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
                      <span>Weight: {task.weight}% · Max: {task.max_score} pts</span>
                      {task.score != null && (
                        <span className="text-green-600 font-semibold">Score: {task.score}/{task.max_score}</span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{task.description}</p>
                    )}
                  </div>
                  {task.status === "pending" && (
                    <Button
                      size="icon" variant="ghost"
                      className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
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

      {/* ── Assign Dialog ── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Tasks</DialogTitle>
            <DialogDescription>
              Choose a department and staff member, then add one or more tasks to assign together.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">

            {/* ── Department (drives everything below) ── */}
            <div className="grid gap-1.5">
              <Label className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> Department *
              </Label>
              <Select value={form.department_id} onValueChange={setDepartment}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ── Review Period + Staff ── */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Review Period *</Label>
                <Select value={form.period_id} onValueChange={(v) => setForm({ ...form, period_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select period" /></SelectTrigger>
                  <SelectContent>
                    {periodOptions.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}{p.status === "closed" ? " (closed)" : ""}
                      </SelectItem>
                    ))}
                    {periodOptions.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No review periods yet. Create one in the KPI Periods tab.
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Staff Member *</Label>
                <Select
                  value={form.staff_profile_id}
                  onValueChange={(v) => setForm({ ...form, staff_profile_id: v })}
                  disabled={!form.department_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={form.department_id ? "Select staff" : "Select a department first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {deptStaff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.department_id && deptStaff.length === 0 && (
              <p className="text-xs text-amber-600 -mt-2">No staff assigned to this department yet.</p>
            )}

            {/* ── Library picker (multi-select, scoped to department) ── */}
            {form.department_id && deptTemplates.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-medium flex items-center gap-1.5">
                  <Library className="h-3.5 w-3.5" /> Pick tasks from library
                  <span className="text-muted-foreground font-normal">(tap to add / remove)</span>
                </p>
                {/* Optional category filter for the library list */}
                {deptCategories.length > 0 && (
                  <Select
                    value={form.category_id || "all"}
                    onValueChange={(v) => setForm({ ...form, category_id: v === "all" ? "" : v })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {deptCategories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="max-h-44 overflow-y-auto space-y-1">
                  {pickerTemplates.map(t => {
                    const queued = isQueued(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTemplate(t)}
                        className={`w-full text-left text-xs px-2.5 py-1.5 rounded-md transition-colors flex items-center justify-between gap-2 group
                          ${queued ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-primary/10"}`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border
                            ${queued ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                            {queued && <Check className="h-3 w-3" />}
                          </span>
                          <span className="font-medium truncate">{t.title}</span>
                        </span>
                        <span className="text-muted-foreground shrink-0 group-hover:text-primary">{t.weight}% wt</span>
                      </button>
                    );
                  })}
                  {pickerTemplates.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-2">No templates in this category.</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Tasks queued for assignment ── */}
            {queue.length > 0 && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <ListPlus className="h-3.5 w-3.5" /> Tasks to assign ({queue.length})
                </p>
                <div className="space-y-1.5">
                  {queue.map((d) => {
                    const cat = d.category_id ? categoryById[d.category_id] : undefined;
                    return (
                      <div key={d._key} className="flex items-center gap-2 rounded-md bg-background border px-2.5 py-1.5">
                        {cat && (
                          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: cat.color }} />
                        )}
                        <span className="text-xs font-medium flex-1 truncate">{d.title}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Input
                            type="number" min={0} max={100}
                            value={d.weight}
                            onChange={(e) => updateQueueWeight(d._key, e.target.value)}
                            className="h-7 w-14 text-xs px-1.5 text-center"
                          />
                          <span className="text-[10px] text-muted-foreground">% wt</span>
                        </div>
                        <Button
                          size="icon" variant="ghost"
                          className="h-6 w-6 text-destructive shrink-0"
                          onClick={() => removeFromQueue(d._key)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Custom / manual task entry ── */}
            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Add a custom task</p>
              <div className="grid gap-1.5">
                <Label>Category</Label>
                <Select
                  value={form.category_id}
                  onValueChange={(v) => setForm({ ...form, category_id: v })}
                  disabled={!form.department_id}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={form.department_id ? "Select category" : "Select a department first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {deptCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                          {c.name}
                        </div>
                      </SelectItem>
                    ))}
                    {form.department_id && deptCategories.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        No categories for this department yet. Add one in the Task Library tab.
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Task Title</Label>
                <Input placeholder="e.g. Daily walk-through completed"
                  value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Scoring Criteria / Description</Label>
                <Textarea rows={2} placeholder="100% = … | 80% = … | 60% = … | 0% = …"
                  value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Target</Label>
                <Input placeholder="e.g. ≥ 95% across all departments"
                  value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                  <Label>Weight %</Label>
                  <Input type="number" min={0} max={100}
                    value={form.weight}
                    onChange={(e) => setForm({ ...form, weight: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Max Score</Label>
                  <Input type="number" min={1} max={100}
                    value={form.max_score}
                    onChange={(e) => setForm({ ...form, max_score: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Due Date</Label>
                  <Input type="date" value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
                </div>
              </div>
              <Button
                type="button" variant="outline" size="sm" className="gap-1.5 w-full"
                onClick={addCustomToQueue}
              >
                <ListPlus className="h-3.5 w-3.5" /> Add to list
              </Button>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <p className="text-xs text-muted-foreground mr-auto self-center">
              {queue.length > 0
                ? `${queue.length} task${queue.length === 1 ? "" : "s"} ready${selectedStaffName ? ` for ${selectedStaffName}` : ""}`
                : "Pick tasks from the library or add a custom one"}
            </p>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={assign.isPending}>
              {assign.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Assign {queue.length + (form.title.trim() ? 1 : 0) || ""} {queue.length + (form.title.trim() ? 1 : 0) === 1 ? "Task" : "Tasks"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
