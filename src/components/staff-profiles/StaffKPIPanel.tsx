import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Star, BarChart2, Loader2, Library, PlayCircle, ChevronDown,
  ChevronUp, Save, ClipboardList,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Period {
  id: string;
  name: string;
  status: string;
  period_type: string;
}

interface Category {
  id: string;
  name: string;
  color: string;
  weight: number;
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

interface TaskAssignment {
  id: string;
  title: string;
  description: string | null;
  status: string;
  weight: number;
  max_score: number;
  score: number | null;
  score_comment: string | null;
  due_date: string | null;
  assigned_at: string;
  category_id: string | null;
  period_id: string;
  kpi_categories: { id: string; name: string; color: string; weight: number } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800 border-emerald-200",
  B: "bg-blue-100 text-blue-800 border-blue-200",
  C: "bg-yellow-100 text-yellow-800 border-yellow-200",
  D: "bg-orange-100 text-orange-800 border-orange-200",
  F: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_COLORS: Record<string, string> = {
  pending:     "bg-slate-100 text-slate-600",
  in_progress: "bg-blue-100 text-blue-700",
  submitted:   "bg-purple-100 text-purple-700",
  scored:      "bg-emerald-100 text-emerald-700",
};

const STATUS_LABELS: Record<string, string> = {
  pending:     "Pending",
  in_progress: "In Progress",
  submitted:   "Submitted",
  scored:      "Scored",
};

// ── Grade computation (identical formula to KPIStaffScores) ───────────────────
// overall% = Σ [ (Σ task_pct×task_wt / Σ task_wt) × cat_weight/100 ]
// Unscored tasks contribute 0 to numerator but full weight to denominator.

function computeGrade(tasks: TaskAssignment[]) {
  type Bucket = { totalWt: number; scoredSum: number; catWt: number };
  const cats: Record<string, Bucket> = {};
  let scoredCount = 0;

  for (const t of tasks) {
    const key = t.category_id ?? "__none__";
    const cw  = t.kpi_categories?.weight ?? 0;
    if (!cats[key]) cats[key] = { totalWt: 0, scoredSum: 0, catWt: cw };
    cats[key].totalWt += t.weight;
    if (t.status === "scored" && t.score !== null) {
      const pct = t.max_score > 0 ? (t.score / t.max_score) * 100 : 0;
      cats[key].scoredSum += pct * t.weight;
      scoredCount++;
    }
  }

  let weightedPct = 0;
  for (const b of Object.values(cats)) {
    if (b.totalWt > 0 && b.catWt > 0) {
      weightedPct += (b.scoredSum / b.totalWt) * (b.catWt / 100);
    }
  }

  const pct   = Math.round(weightedPct * 10) / 10;
  const grade = pct >= 90 ? "A" : pct >= 75 ? "B" : pct >= 60 ? "C" : pct >= 40 ? "D" : "F";
  return { pct, grade, scoredCount };
}

// ── Assign form defaults ──────────────────────────────────────────────────────

const BLANK_ASSIGN = {
  category_id:  "",
  title:        "",
  description:  "",
  target_value: "",
  weight:       "25",
  max_score:    "100",
  due_date:     "",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface StaffKPIPanelProps {
  staffProfileId: string;
  staffName: string;
  canScore: boolean;
}

export default function StaffKPIPanel({
  staffProfileId,
  staffName,
  canScore,
}: StaffKPIPanelProps) {
  const { user }  = useAuth();
  const { toast } = useToast();
  const qc        = useQueryClient();

  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [assignOpen, setAssignOpen]             = useState(false);
  const [assignForm, setAssignForm]             = useState(BLANK_ASSIGN);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [assignPeriodType, setAssignPeriodType] = useState<"daily" | "weekly" | "monthly">("monthly");

  // task being graded (expanded inline)
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [scoreInputs, setScoreInputs] = useState<Record<string, { score: string; comment: string }>>({});

  const TASK_QK = ["kpi-staff-tasks", staffProfileId, selectedPeriodId] as const;

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: periods = [] } = useQuery<Period[]>({
    queryKey: ["kpi-periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_periods")
        .select("id, name, status, period_type")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Period[];
    },
    staleTime: 5 * 60_000,
  });

  // Auto-select the active period on first load
  useEffect(() => {
    if (selectedPeriodId || !periods.length) return;
    const active = periods.find((p) => p.status === "active");
    setSelectedPeriodId(active?.id ?? periods[0]?.id ?? "");
  }, [periods, selectedPeriodId]);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<TaskAssignment[]>({
    queryKey: TASK_QK,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_task_assignments")
        .select("id, title, description, status, weight, max_score, score, score_comment, due_date, assigned_at, category_id, period_id, kpi_categories(id, name, color, weight)")
        .eq("staff_profile_id", staffProfileId)
        .eq("period_id", selectedPeriodId)
        .order("assigned_at");
      if (error) throw error;
      return (data ?? []) as unknown as TaskAssignment[];
    },
    enabled: !!selectedPeriodId,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["kpi-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_categories")
        .select("id, name, color, weight, department_id")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Category[];
    },
    staleTime: 10 * 60_000,
  });

  // The staff member's department — scopes which categories/templates can be assigned
  const { data: staffDeptId } = useQuery<string | null>({
    queryKey: ["staff-department", staffProfileId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("department_id")
        .eq("id", staffProfileId)
        .single();
      if (error) throw error;
      return (data as any)?.department_id ?? null;
    },
    staleTime: 10 * 60_000,
  });

  const { data: templates = [] } = useQuery<TaskTemplate[]>({
    queryKey: ["kpi-task-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_task_templates")
        .select("id, category_id, title, description, target, weight, max_score")
        .order("sort_order")
        .order("title");
      if (error) throw error;
      return (data ?? []) as TaskTemplate[];
    },
    staleTime: 10 * 60_000,
  });

  // ── Derived ─────────────────────────────────────────────────────────────────

  const { pct, grade, scoredCount } = useMemo(() => computeGrade(tasks), [tasks]);

  // Find the best period ID for the chosen assign type:
  // prefer active → any; fallback to the currently viewed period.
  const assignPeriodId = useMemo(() => {
    const ofType = periods.filter((p) => p.period_type === assignPeriodType);
    const active  = ofType.find((p) => p.status === "active");
    return active?.id ?? ofType[0]?.id ?? selectedPeriodId;
  }, [periods, assignPeriodType, selectedPeriodId]);

  // Categories scoped to the staff member's department
  const deptCategories = useMemo(
    () => staffDeptId ? categories.filter((c) => c.department_id === staffDeptId) : categories,
    [categories, staffDeptId],
  );

  const filteredTemplates = useMemo(
    () => templates.filter((t) => t.category_id === assignForm.category_id),
    [templates, assignForm.category_id],
  );

  // ── Mutations ────────────────────────────────────────────────────────────────

  const assignMut = useMutation({
    mutationFn: async () => {
      if (!assignPeriodId) throw new Error(`No ${assignPeriodType} period found. Create one in KPI Periods first.`);
      const { error } = await supabase.from("kpi_task_assignments").insert({
        period_id:        assignPeriodId,
        staff_profile_id: staffProfileId,
        category_id:      assignForm.category_id || null,
        title:            assignForm.title.trim(),
        description:      assignForm.description.trim() || null,
        target_value:     assignForm.target_value.trim() || null,
        weight:           Number(assignForm.weight),
        max_score:        Number(assignForm.max_score),
        due_date:         assignForm.due_date || null,
        status:           "pending",
        assigned_by:      user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Task assigned", description: `Task assigned to ${staffName}` });
      qc.invalidateQueries({ queryKey: TASK_QK });
      setAssignOpen(false);
      setAssignForm(BLANK_ASSIGN);
      setSelectedTemplate("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const startMut = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase
        .from("kpi_task_assignments")
        .update({ status: "in_progress", updated_at: new Date().toISOString() })
        .eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: TASK_QK }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const scoreMut = useMutation({
    mutationFn: async (taskId: string) => {
      const inp = scoreInputs[taskId];
      if (!inp) throw new Error("No score input");
      const task = tasks.find((t) => t.id === taskId);
      if (!task) throw new Error("Task not found");
      const scoreVal = Number(inp.score);
      if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > task.max_score) {
        throw new Error(`Score must be 0 – ${task.max_score}`);
      }
      const { error } = await supabase
        .from("kpi_task_assignments")
        .update({
          score:         scoreVal,
          score_comment: inp.comment.trim() || null,
          status:        "scored",
          scored_by:     user?.id,
          scored_at:     new Date().toISOString(),
          updated_at:    new Date().toISOString(),
        })
        .eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: (_, taskId) => {
      toast({ title: "Task graded" });
      qc.invalidateQueries({ queryKey: TASK_QK });
      setScoringId(null);
      setScoreInputs((prev) => { const n = { ...prev }; delete n[taskId]; return n; });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveGradeMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("kpi_staff_scores")
        .upsert(
          {
            period_id:          selectedPeriodId,
            staff_profile_id:   staffProfileId,
            total_score:        pct,
            max_possible_score: 100,
            updated_at:         new Date().toISOString(),
          },
          { onConflict: "period_id,staff_profile_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "KPI grade saved", description: `${staffName} — ${grade} (${pct}%)` });
      qc.invalidateQueries({ queryKey: ["kpi-staff-scores"] });
    },
    onError: (e: any) => toast({ title: "Error saving grade", description: e.message, variant: "destructive" }),
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function applyTemplate(templateId: string) {
    const tpl = templates.find((t) => t.id === templateId);
    if (!tpl) return;
    setAssignForm((prev) => ({
      ...prev,
      title:        tpl.title,
      description:  tpl.description ?? "",
      target_value: tpl.target ?? "",
      weight:       String(tpl.weight),
      max_score:    String(tpl.max_score),
    }));
    setSelectedTemplate(templateId);
  }

  function toggleScoring(taskId: string) {
    if (scoringId === taskId) {
      setScoringId(null);
    } else {
      setScoringId(taskId);
      const task = tasks.find((t) => t.id === taskId);
      if (task && !scoreInputs[taskId]) {
        setScoreInputs((prev) => ({
          ...prev,
          [taskId]: {
            score:   task.score !== null ? String(task.score) : "",
            comment: task.score_comment ?? "",
          },
        }));
      }
    }
  }

  const noPeriods   = !periods.length;
  const noTasks     = !tasksLoading && tasks.length === 0 && !!selectedPeriodId;
  const hasScored   = scoredCount > 0;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">

      {/* Period selector + assign button */}
      <div className="flex items-center gap-2">
        <Select
          value={selectedPeriodId}
          onValueChange={setSelectedPeriodId}
          disabled={noPeriods}
        >
          <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
            <SelectValue placeholder={noPeriods ? "No periods" : "Select period"} />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                <span>{p.name}</span>
                <span className={`ml-2 text-[10px] ${p.status === "active" ? "text-emerald-600" : "text-muted-foreground"}`}>
                  {p.status}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canScore && !!selectedPeriodId && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs shrink-0" onClick={() => setAssignOpen(true)}>
            <Plus className="h-3 w-3" />Assign Task
          </Button>
        )}
      </div>

      {/* Grade card */}
      {hasScored && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
          <div className={`h-12 w-12 rounded-full flex items-center justify-center text-xl font-bold border-2 ${GRADE_COLORS[grade]}`}>
            {grade}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold leading-none">{pct}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {scoredCount} of {tasks.length} task{tasks.length !== 1 ? "s" : ""} graded
            </p>
          </div>
          {canScore && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs shrink-0"
              onClick={() => saveGradeMut.mutate()}
              disabled={saveGradeMut.isPending}
            >
              {saveGradeMut.isPending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Save className="h-3 w-3" />
              }
              Save Grade
            </Button>
          )}
        </div>
      )}

      {/* Task list */}
      {tasksLoading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />Loading tasks…
        </div>
      ) : noTasks ? (
        <div className="flex flex-col items-center justify-center py-6 text-center gap-2">
          <ClipboardList className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">
            {canScore ? "No tasks assigned for this period. Assign one to start." : "No tasks assigned for this period."}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {tasks.map((task) => {
            const isScoring = scoringId === task.id;
            const inp       = scoreInputs[task.id];

            return (
              <div
                key={task.id}
                className={`rounded-lg border transition-colors ${isScoring ? "border-primary/30 bg-primary/5" : "border-border/60 bg-card"}`}
              >
                {/* Main task row */}
                <div className="flex items-center gap-2 px-3 py-2">
                  {/* Category colour dot */}
                  <div
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: task.kpi_categories?.color ?? "#94a3b8" }}
                  />

                  {/* Title + category label */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate leading-tight">{task.title}</p>
                    {task.kpi_categories && (
                      <p className="text-[10px] text-muted-foreground truncate">{task.kpi_categories.name}</p>
                    )}
                  </div>

                  {/* Weight */}
                  <span className="text-[10px] text-muted-foreground shrink-0">wt:{task.weight}%</span>

                  {/* Score */}
                  <span className="text-xs font-semibold tabular-nums shrink-0 w-14 text-right">
                    {task.status === "scored" && task.score !== null
                      ? `${task.score}/${task.max_score}`
                      : "—"}
                  </span>

                  {/* Status badge */}
                  <Badge className={`text-[10px] px-1.5 py-0 shrink-0 ${STATUS_COLORS[task.status]}`} variant="outline">
                    {STATUS_LABELS[task.status]}
                  </Badge>

                  {/* Action buttons */}
                  {canScore && task.status === "pending" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      title="Mark In Progress"
                      onClick={() => startMut.mutate(task.id)}
                      disabled={startMut.isPending}
                    >
                      <PlayCircle className="h-3.5 w-3.5 text-blue-500" />
                    </Button>
                  )}

                  {canScore && (task.status === "submitted" || task.status === "scored") && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      title={isScoring ? "Close grading" : "Grade task"}
                      onClick={() => toggleScoring(task.id)}
                    >
                      {isScoring
                        ? <ChevronUp className="h-3.5 w-3.5" />
                        : <Star className="h-3.5 w-3.5 text-amber-500" />
                      }
                    </Button>
                  )}
                </div>

                {/* Inline score entry (expanded) */}
                {isScoring && canScore && inp && (
                  <div className="px-3 pb-3 space-y-2 border-t border-border/40 pt-2">
                    <div className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-[11px]">Score (max {task.max_score})</Label>
                        <Input
                          type="number"
                          min={0}
                          max={task.max_score}
                          className="h-8 text-sm"
                          value={inp.score}
                          onChange={(e) =>
                            setScoreInputs((prev) => ({
                              ...prev,
                              [task.id]: { ...prev[task.id], score: e.target.value },
                            }))
                          }
                          placeholder="0"
                        />
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-[11px]">Pct</Label>
                        <div className="h-8 flex items-center text-sm text-muted-foreground">
                          {inp.score !== "" && !isNaN(Number(inp.score)) && task.max_score > 0
                            ? `${Math.round((Number(inp.score) / task.max_score) * 1000) / 10}%`
                            : "—"}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Comment (optional)</Label>
                      <Textarea
                        className="text-xs min-h-[52px] resize-none"
                        value={inp.comment}
                        onChange={(e) =>
                          setScoreInputs((prev) => ({
                            ...prev,
                            [task.id]: { ...prev[task.id], comment: e.target.value },
                          }))
                        }
                        placeholder="Feedback or scoring notes…"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setScoringId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => scoreMut.mutate(task.id)}
                        disabled={scoreMut.isPending || inp.score === ""}
                      >
                        {scoreMut.isPending
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Star className="h-3 w-3" />
                        }
                        Save Grade
                      </Button>
                    </div>
                  </div>
                )}

                {/* Scorer comment visible even when not editing */}
                {!isScoring && task.status === "scored" && task.score_comment && (
                  <p className="px-3 pb-2 text-[10px] text-muted-foreground italic leading-snug">
                    {task.score_comment}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Save grade bar — shown when there are scored tasks */}
      {hasScored && canScore && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            <BarChart2 className="h-3 w-3 inline mr-1" />
            Live: {grade} at {pct}%
          </span>
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => saveGradeMut.mutate()}
            disabled={saveGradeMut.isPending}
          >
            {saveGradeMut.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Save className="h-3 w-3" />
            }
            Save KPI Grade
          </Button>
        </div>
      )}

      {/* ── Assign Task Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Assign Task — {staffName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Period type */}
            <div className="space-y-1.5">
              <Label className="text-xs">Period</Label>
              <Select
                value={assignPeriodType}
                onValueChange={(v) => setAssignPeriodType(v as "daily" | "weekly" | "monthly")}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
              {assignPeriodId ? (
                <p className="text-[11px] text-muted-foreground">
                  Linked to: {periods.find((p) => p.id === assignPeriodId)?.name ?? "—"}
                </p>
              ) : (
                <p className="text-[11px] text-amber-600">
                  No active {assignPeriodType} period found. Create one in KPI Periods first.
                </p>
              )}
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select
                value={assignForm.category_id}
                onValueChange={(v) => {
                  setAssignForm((prev) => ({ ...prev, category_id: v }));
                  setSelectedTemplate("");
                }}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select category…" />
                </SelectTrigger>
                <SelectContent>
                  {deptCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                        {c.name} <span className="text-muted-foreground text-[10px] ml-1">{c.weight}%</span>
                      </div>
                    </SelectItem>
                  ))}
                  {deptCategories.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No categories for this staff member's department.
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Template picker (shows when category is selected) */}
            {assignForm.category_id && filteredTemplates.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  <Library className="h-3 w-3" />Task Template
                </Label>
                <Select value={selectedTemplate} onValueChange={applyTemplate}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Pick from library (optional)…" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="text-sm">
                        {t.title} <span className="text-muted-foreground text-[10px] ml-1">wt:{t.weight}%</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Title */}
            <div className="space-y-1.5">
              <Label className="text-xs">Task Title <span className="text-destructive">*</span></Label>
              <Input
                className="text-sm h-9"
                value={assignForm.title}
                onChange={(e) => setAssignForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="e.g. Weekly Sales Report"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs">Description / Scoring Criteria</Label>
              <Textarea
                className="text-sm min-h-[64px] resize-none"
                value={assignForm.description}
                onChange={(e) => setAssignForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="What is expected and how it will be scored…"
              />
            </div>

            {/* Weight + Max Score + Due Date */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Weight (%)</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  className="text-sm h-9"
                  value={assignForm.weight}
                  onChange={(e) => setAssignForm((prev) => ({ ...prev, weight: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Max Score</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  className="text-sm h-9"
                  value={assignForm.max_score}
                  onChange={(e) => setAssignForm((prev) => ({ ...prev, max_score: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Due Date</Label>
                <Input
                  type="date"
                  className="text-sm h-9"
                  value={assignForm.due_date}
                  onChange={(e) => setAssignForm((prev) => ({ ...prev, due_date: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setAssignOpen(false); setAssignForm(BLANK_ASSIGN); setSelectedTemplate(""); }}>
              Cancel
            </Button>
            <Button
              onClick={() => assignMut.mutate()}
              disabled={assignMut.isPending || !assignForm.title.trim() || !assignPeriodId}
            >
              {assignMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Assign Task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
