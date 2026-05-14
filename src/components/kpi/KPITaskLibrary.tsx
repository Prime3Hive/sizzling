import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Plus, Loader2, Tag, Trash2, Pencil, ChevronDown, ChevronRight,
  Scale, AlertTriangle, CheckCircle,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string;
  weight: number;
  sort_order: number;
}

interface TaskTemplate {
  id: string;
  category_id: string;
  title: string;
  description: string | null;
  target: string | null;
  weight: number;
  max_score: number;
  sort_order: number;
}

// ── Blank forms ────────────────────────────────────────────────────────────────

const blankCat  = { name: "", description: "", color: "#6366f1", weight: 0 };
const blankTask = { title: "", description: "", target: "", weight: 25, max_score: 100 };

// ── Helpers ────────────────────────────────────────────────────────────────────

function weightBadge(total: number) {
  const ok = total === 100;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full
      ${ok ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
           : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"}`}>
      {ok ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
      {total}%
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function KPITaskLibrary() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  // expanded category IDs
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // category dialog
  const [catOpen,    setCatOpen]    = useState(false);
  const [catEditing, setCatEditing] = useState<Category | null>(null);
  const [catForm,    setCatForm]    = useState(blankCat);

  // task dialog
  const [taskOpen,    setTaskOpen]    = useState(false);
  const [taskEditing, setTaskEditing] = useState<TaskTemplate | null>(null);
  const [taskCatId,   setTaskCatId]   = useState<string>("");
  const [taskForm,    setTaskForm]    = useState(blankTask);

  // delete confirmations
  const [deleteCatId,  setDeleteCatId]  = useState<string | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: categories = [], isLoading: catsLoading } = useQuery<Category[]>({
    queryKey: ["kpi-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_categories")
        .select("id, name, description, color, weight, sort_order")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data || []) as unknown as Category[];
    },
  });

  const { data: templates = [], isLoading: tmplLoading } = useQuery<TaskTemplate[]>({
    queryKey: ["kpi-task-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_task_templates")
        .select("id, category_id, title, description, target, weight, max_score, sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data || []) as unknown as TaskTemplate[];
    },
  });

  // ── Category mutations ────────────────────────────────────────────────────────

  const upsertCat = useMutation({
    mutationFn: async (payload: Omit<typeof blankCat, "">) => {
      if (catEditing) {
        const { error } = await supabase
          .from("kpi_categories").update(payload).eq("id", catEditing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("kpi_categories").insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-categories"] });
      toast({ title: catEditing ? "Category updated" : "Category created" });
      setCatOpen(false); setCatEditing(null); setCatForm(blankCat);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteCat = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("kpi_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-categories"] });
      qc.invalidateQueries({ queryKey: ["kpi-task-templates"] });
      toast({ title: "Category deleted" });
      setDeleteCatId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Task template mutations ───────────────────────────────────────────────────

  const upsertTask = useMutation({
    mutationFn: async (payload: typeof blankTask & { category_id: string }) => {
      if (taskEditing) {
        const { error } = await supabase
          .from("kpi_task_templates").update(payload).eq("id", taskEditing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("kpi_task_templates").insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-task-templates"] });
      toast({ title: taskEditing ? "Task updated" : "Task added" });
      setTaskOpen(false); setTaskEditing(null); setTaskForm(blankTask);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteTask = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("kpi_task_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-task-templates"] });
      toast({ title: "Task deleted" });
      setDeleteTaskId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Rebalance mutations ───────────────────────────────────────────────────────

  const rebalanceCats = useMutation({
    mutationFn: async () => {
      if (categories.length === 0) return;
      const base = Math.floor(100 / categories.length);
      const rem  = 100 - base * categories.length;
      const updates = categories.map((c, i) =>
        supabase.from("kpi_categories")
          .update({ weight: base + (i < rem ? 1 : 0) })
          .eq("id", c.id)
      );
      const results = await Promise.all(updates);
      const err = results.find(r => r.error);
      if (err?.error) throw err.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-categories"] });
      toast({ title: "Category weights redistributed to 100%" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const rebalanceTasks = useMutation({
    mutationFn: async (catId: string) => {
      const catTasks = templates.filter(t => t.category_id === catId);
      if (catTasks.length === 0) return;
      const base = Math.floor(100 / catTasks.length);
      const rem  = 100 - base * catTasks.length;
      const updates = catTasks.map((t, i) =>
        supabase.from("kpi_task_templates")
          .update({ weight: base + (i < rem ? 1 : 0) })
          .eq("id", t.id)
      );
      const results = await Promise.all(updates);
      const err = results.find(r => r.error);
      if (err?.error) throw err.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-task-templates"] });
      toast({ title: "Task weights redistributed to 100%" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Derived values ────────────────────────────────────────────────────────────

  const totalCatWeight = categories.reduce((s, c) => s + (c.weight || 0), 0);

  const tasksByCat = (catId: string) => templates.filter(t => t.category_id === catId);
  const taskWeightTotal = (catId: string) =>
    tasksByCat(catId).reduce((s, t) => s + (t.weight || 0), 0);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openAddCat = () => {
    setCatEditing(null); setCatForm(blankCat); setCatOpen(true);
  };
  const openEditCat = (c: Category) => {
    setCatEditing(c);
    setCatForm({ name: c.name, description: c.description || "", color: c.color, weight: c.weight });
    setCatOpen(true);
  };

  const openAddTask = (catId: string) => {
    setTaskEditing(null); setTaskCatId(catId); setTaskForm(blankTask); setTaskOpen(true);
  };
  const openEditTask = (t: TaskTemplate) => {
    setTaskEditing(t);
    setTaskCatId(t.category_id);
    setTaskForm({
      title: t.title,
      description: t.description || "",
      target: t.target || "",
      weight: t.weight,
      max_score: t.max_score,
    });
    setTaskOpen(true);
  };

  // ── Loading state ─────────────────────────────────────────────────────────────

  if (catsLoading || tmplLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Tag className="h-5 w-5 text-muted-foreground" />
            Task Library
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Define KPI categories and reusable task templates. Category weights must sum to 100%.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => rebalanceCats.mutate()}
            disabled={rebalanceCats.isPending || categories.length === 0 || totalCatWeight === 100}
          >
            {rebalanceCats.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Scale className="h-3.5 w-3.5" />}
            Rebalance Categories
          </Button>
          <Button size="sm" className="gap-1.5" onClick={openAddCat}>
            <Plus className="h-4 w-4" /> Add Category
          </Button>
        </div>
      </div>

      {/* ── Category weight summary ── */}
      <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
        <span className="text-sm text-muted-foreground font-medium">Total category weight:</span>
        {weightBadge(totalCatWeight)}
        {totalCatWeight !== 100 && (
          <span className="text-xs text-orange-600 dark:text-orange-400">
            — adjust category weights so they sum to exactly 100%
          </span>
        )}
      </div>

      {/* ── Category list ── */}
      {categories.length === 0 ? (
        <Card>
          <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
            <Tag className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">No categories yet. Add one to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {categories.map((cat) => {
            const isOpen   = expanded.has(cat.id);
            const catTasks = tasksByCat(cat.id);
            const twTotal  = taskWeightTotal(cat.id);

            return (
              <Card key={cat.id} className="overflow-hidden">

                {/* ── Category row ── */}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors"
                  onClick={() => toggleExpand(cat.id)}
                >
                  {isOpen
                    ? <ChevronDown  className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}

                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />

                  <span className="flex-1 font-semibold text-sm text-left">{cat.name}</span>

                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    <Badge variant="outline" className="tabular-nums font-semibold text-xs">
                      {cat.weight}% weight
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {catTasks.length} task{catTasks.length !== 1 ? "s" : ""}
                    </Badge>
                    <Button size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => openEditCat(cat)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      onClick={() => setDeleteCatId(cat.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </button>

                {/* ── Expanded task list ── */}
                {isOpen && (
                  <div className="border-t bg-muted/10">

                    {/* Category meta + task weight summary */}
                    <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap border-b">
                      <div className="space-y-0.5">
                        {cat.description && (
                          <p className="text-xs text-muted-foreground">{cat.description}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Task weights within category:</span>
                          {weightBadge(twTotal)}
                          {twTotal !== 100 && catTasks.length > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs gap-1 px-2"
                              onClick={() => rebalanceTasks.mutate(cat.id)}
                              disabled={rebalanceTasks.isPending}
                            >
                              {rebalanceTasks.isPending
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <Scale className="h-3 w-3" />}
                              Rebalance
                            </Button>
                          )}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs"
                        onClick={() => openAddTask(cat.id)}>
                        <Plus className="h-3.5 w-3.5" /> Add Task
                      </Button>
                    </div>

                    {/* Tasks */}
                    {catTasks.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        No tasks yet — click "Add Task" to add the first one.
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/20 text-muted-foreground text-left">
                            <th className="px-4 py-2 font-medium w-8">#</th>
                            <th className="px-2 py-2 font-medium">Task</th>
                            <th className="px-2 py-2 font-medium hidden md:table-cell">Target</th>
                            <th className="px-2 py-2 font-medium text-center w-24">Weight</th>
                            <th className="px-2 py-2 font-medium text-center w-24 hidden sm:table-cell">Max Score</th>
                            <th className="px-2 py-2 font-medium text-right w-20"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {catTasks.map((t, i) => (
                            <tr key={t.id} className="hover:bg-muted/30 transition-colors group">
                              <td className="px-4 py-2.5 text-muted-foreground tabular-nums text-xs">{i + 1}</td>
                              <td className="px-2 py-2.5">
                                <p className="font-medium leading-snug">{t.title}</p>
                                {t.description && (
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
                                )}
                              </td>
                              <td className="px-2 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                                {t.target || "—"}
                              </td>
                              <td className="px-2 py-2.5 text-center">
                                <span className="font-semibold tabular-nums text-sm">{t.weight}%</span>
                              </td>
                              <td className="px-2 py-2.5 text-center hidden sm:table-cell">
                                <Badge variant="secondary" className="tabular-nums text-xs">{t.max_score}</Badge>
                              </td>
                              <td className="px-2 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Button size="icon" variant="ghost" className="h-6 w-6"
                                    onClick={() => openEditTask(t)}>
                                    <Pencil className="h-3 w-3" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive"
                                    onClick={() => setDeleteTaskId(t.id)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Category dialog ── */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{catEditing ? "Edit Category" : "Add Category"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input placeholder="e.g. Operational Leadership"
                value={catForm.name}
                onChange={e => setCatForm({ ...catForm, name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea rows={2} placeholder="Brief description of this category…"
                value={catForm.description}
                onChange={e => setCatForm({ ...catForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>Colour</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={catForm.color}
                    onChange={e => setCatForm({ ...catForm, color: e.target.value })}
                    className="h-9 w-14 cursor-pointer rounded border border-input bg-background" />
                  <span className="text-xs text-muted-foreground">{catForm.color}</span>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Weight % *</Label>
                <Input
                  type="number" min={0} max={100} placeholder="0–100"
                  value={catForm.weight}
                  onChange={e => setCatForm({ ...catForm, weight: Math.min(100, Math.max(0, Number(e.target.value))) })}
                />
                <p className="text-xs text-muted-foreground -mt-1">All categories must sum to 100%.</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatOpen(false)}>Cancel</Button>
            <Button
              onClick={() => upsertCat.mutate(catForm)}
              disabled={upsertCat.isPending || !catForm.name.trim()}>
              {upsertCat.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {catEditing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Task template dialog ── */}
      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{taskEditing ? "Edit Task" : "Add Task"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Task Title *</Label>
              <Input placeholder="e.g. Daily walk-through completed"
                value={taskForm.title}
                onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Target</Label>
              <Input placeholder="e.g. ≥ 95% across all departments"
                value={taskForm.target}
                onChange={e => setTaskForm({ ...taskForm, target: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Scoring Criteria / Description</Label>
              <Textarea rows={3}
                placeholder="100% = … | 80% = … | 60% = … | 0% = …"
                value={taskForm.description}
                onChange={e => setTaskForm({ ...taskForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>Weight within category %</Label>
                <Input
                  type="number" min={0} max={100}
                  value={taskForm.weight}
                  onChange={e => setTaskForm({ ...taskForm, weight: Math.min(100, Math.max(0, Number(e.target.value))) })} />
                <p className="text-xs text-muted-foreground -mt-1">Tasks in category must sum to 100%.</p>
              </div>
              <div className="grid gap-1.5">
                <Label>Max Score</Label>
                <Input
                  type="number" min={1} max={100}
                  value={taskForm.max_score}
                  onChange={e => setTaskForm({ ...taskForm, max_score: Math.min(100, Math.max(1, Number(e.target.value))) })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskOpen(false)}>Cancel</Button>
            <Button
              onClick={() => upsertTask.mutate({ ...taskForm, category_id: taskCatId })}
              disabled={upsertTask.isPending || !taskForm.title.trim()}>
              {upsertTask.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {taskEditing ? "Save" : "Add Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete category confirm ── */}
      <AlertDialog open={!!deleteCatId} onOpenChange={open => !open && setDeleteCatId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the category and all its task templates. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteCatId && deleteCat.mutate(deleteCatId)}>
              {deleteCat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete task confirm ── */}
      <AlertDialog open={!!deleteTaskId} onOpenChange={open => !open && setDeleteTaskId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task?</AlertDialogTitle>
            <AlertDialogDescription>
              This task template will be permanently removed from the library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTaskId && deleteTask.mutate(deleteTaskId)}>
              {deleteTask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
