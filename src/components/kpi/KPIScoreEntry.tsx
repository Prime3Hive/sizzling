import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { Star, Loader2, UserCircle, CheckCircle, Pencil, PlayCircle } from "lucide-react";
import { format } from "date-fns";

interface ScoredTask {
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
  scored_at: string | null;
  staff_profiles: { id: string; full_name: string } | null;
  kpi_categories: { name: string; color: string } | null;
  kpi_periods: { name: string } | null;
}

const statusColors: Record<string, string> = {
  pending:     "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  submitted:   "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  scored:      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

export default function KPIScoreEntry() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isAdmin, isManager } = useRoles();

  const [selectedPeriod, setSelectedPeriod] = useState<string>("all");
  const [selectedStaff, setSelectedStaff] = useState<string>("all");
  const [scoreInputs, setScoreInputs] = useState<Record<string, { score: string; comment: string }>>({});
  const [editingScored, setEditingScored] = useState<Set<string>>(new Set());

  if (!isAdmin && !isManager) return null;

  // Periods (active + closed only — for scoring)
  const { data: periods = [] } = useQuery({
    queryKey: ["kpi-periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_periods")
        .select("id, name, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const scorablePeriods = (periods as any[]).filter((p) => p.status === "active" || p.status === "closed");

  // Staff list
  const { data: staff = [] } = useQuery({
    queryKey: ["staff-profiles-select"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("id, full_name")
        .order("full_name");
      if (error) throw error;
      return data || [];
    },
  });

  // Task assignments
  const { data: tasks = [], isLoading } = useQuery<ScoredTask[]>({
    queryKey: ["kpi-task-assignments-score", selectedPeriod, selectedStaff],
    queryFn: async () => {
      let q = supabase
        .from("kpi_task_assignments")
        .select(`
          id, title, description, status, weight, max_score,
          score, score_comment, due_date, assigned_at, scored_at,
          staff_profiles(id, full_name),
          kpi_categories(name, color),
          kpi_periods(name)
        `)
        .order("assigned_at", { ascending: false });

      if (selectedPeriod !== "all") q = q.eq("period_id", selectedPeriod);
      if (selectedStaff !== "all")  q = q.eq("staff_profile_id", selectedStaff);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as ScoredTask[];
    },
  });

  const saveScore = useMutation({
    mutationFn: async ({ id, score, comment }: { id: string; score: number; comment: string }) => {
      const { error } = await supabase
        .from("kpi_task_assignments")
        .update({
          score,
          score_comment: comment || null,
          status:        "scored",
          scored_by:     user?.id,
          scored_at:     new Date().toISOString(),
          updated_at:    new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["kpi-task-assignments-score"] });
      qc.invalidateQueries({ queryKey: ["kpi-tasks-for-scores"] });
      qc.invalidateQueries({ queryKey: ["kpi-task-assignments"] });
      setEditingScored((prev) => { const next = new Set(prev); next.delete(vars.id); return next; });
      toast({ title: "Score saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const advanceStatus = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("kpi_task_assignments")
        .update({ status: "in_progress", updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-task-assignments-score"] });
      toast({ title: "Task marked in progress" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSave = (task: ScoredTask) => {
    const input = scoreInputs[task.id];
    if (!input?.score) {
      toast({ title: "Please enter a score", variant: "destructive" }); return;
    }
    const scoreNum = parseFloat(input.score);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > task.max_score) {
      toast({ title: `Score must be between 0 and ${task.max_score}`, variant: "destructive" }); return;
    }
    saveScore.mutate({ id: task.id, score: scoreNum, comment: input.comment ?? "" });
  };

  const beginEdit = (task: ScoredTask) => {
    setScoreInputs((prev) => ({
      ...prev,
      [task.id]: { score: String(task.score ?? ""), comment: task.score_comment ?? "" },
    }));
    setEditingScored((prev) => new Set(prev).add(task.id));
  };

  const setInput = (id: string, field: "score" | "comment", value: string) => {
    setScoreInputs((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const byStatus = (status: string) => tasks.filter((t) => t.status === status);

  const renderTaskCard = (task: ScoredTask, showScoreForm: boolean, showAdvance: boolean) => (
    <Card key={task.id} className="hover:shadow-sm transition-shadow">
      <CardContent className="pt-4 pb-4 space-y-3">
        {/* Row 1: title + badges */}
        <div className="flex flex-wrap items-center gap-2">
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

        {/* Row 2: meta */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <UserCircle className="h-3 w-3" />
            {task.staff_profiles?.full_name || "—"}
          </span>
          <span>Period: {task.kpi_periods?.name || "—"}</span>
          {task.due_date && <span>Due: {format(new Date(task.due_date), "MMM d, yyyy")}</span>}
          <span>Weight: {task.weight} · Max: {task.max_score} pts</span>
          {task.score != null && !editingScored.has(task.id) && (
            <span className="text-green-600 font-semibold">Score: {task.score}/{task.max_score}</span>
          )}
        </div>

        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
        )}

        {/* Score form */}
        {showScoreForm && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-1 border-t">
            <div className="grid gap-1">
              <Label className="text-xs">Score (0 – {task.max_score})</Label>
              <Input
                type="number"
                min={0}
                max={task.max_score}
                placeholder="0"
                value={scoreInputs[task.id]?.score ?? ""}
                onChange={(e) => setInput(task.id, "score", e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Reviewer Comment</Label>
              <Textarea
                rows={1}
                placeholder="Optional comment…"
                value={scoreInputs[task.id]?.comment ?? ""}
                onChange={(e) => setInput(task.id, "comment", e.target.value)}
                className="resize-none"
              />
            </div>
            <Button
              onClick={() => handleSave(task)}
              disabled={saveScore.isPending}
              className="gap-2"
            >
              {saveScore.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Save Score
            </Button>
          </div>
        )}

        {/* Already scored — edit button */}
        {task.status === "scored" && !editingScored.has(task.id) && (
          <div className="flex items-center gap-2 pt-1 border-t">
            {task.score_comment && (
              <p className="text-xs text-muted-foreground flex-1 italic">"{task.score_comment}"</p>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-xs ml-auto"
              onClick={() => beginEdit(task)}
            >
              <Pencil className="h-3 w-3" /> Edit Score
            </Button>
          </div>
        )}

        {/* Already scored + editing */}
        {task.status === "scored" && editingScored.has(task.id) && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-1 border-t">
            <div className="grid gap-1">
              <Label className="text-xs">Score (0 – {task.max_score})</Label>
              <Input
                type="number"
                min={0}
                max={task.max_score}
                value={scoreInputs[task.id]?.score ?? ""}
                onChange={(e) => setInput(task.id, "score", e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Reviewer Comment</Label>
              <Textarea
                rows={1}
                value={scoreInputs[task.id]?.comment ?? ""}
                onChange={(e) => setInput(task.id, "comment", e.target.value)}
                className="resize-none"
              />
            </div>
            <Button
              onClick={() => handleSave(task)}
              disabled={saveScore.isPending}
              className="gap-2"
            >
              {saveScore.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Update Score
            </Button>
          </div>
        )}

        {/* Advance pending → in_progress */}
        {showAdvance && (
          <div className="pt-1 border-t">
            <Button
              size="sm"
              variant="outline"
              onClick={() => advanceStatus.mutate(task.id)}
              disabled={advanceStatus.isPending}
              className="gap-1 text-xs"
            >
              <PlayCircle className="h-3.5 w-3.5" /> Mark In Progress
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const SectionHeader = ({ label, count }: { label: string; count: number }) => (
    <div className="flex items-center gap-2 mt-6 mb-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{label}</h3>
      <Badge variant="secondary" className="text-xs">{count}</Badge>
    </div>
  );

  const submitted  = byStatus("submitted");
  const inProgress = byStatus("in_progress");
  const pending    = byStatus("pending");
  const scored     = byStatus("scored");

  return (
    <div className="space-y-2">
      {/* Header + filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-500" /> Score Tasks
          </h2>
          <p className="text-sm text-muted-foreground">Enter scores for submitted tasks.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All periods" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Periods</SelectItem>
              {scorablePeriods.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>{p.name} ({p.status})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedStaff} onValueChange={setSelectedStaff}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Staff</SelectItem>
              {(staff as any[]).map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
            <Star className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground">No tasks found for the selected filters.</p>
            <p className="text-xs text-muted-foreground">Tasks appear here once they are assigned to staff in active or closed periods.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {submitted.length > 0 && (
            <>
              <SectionHeader label="Ready to Score" count={submitted.length} />
              <div className="space-y-3">
                {submitted.map((t) => renderTaskCard(t, true, false))}
              </div>
            </>
          )}

          {inProgress.length > 0 && (
            <>
              <SectionHeader label="In Progress" count={inProgress.length} />
              <div className="space-y-3">
                {inProgress.map((t) => renderTaskCard(t, false, false))}
              </div>
            </>
          )}

          {pending.length > 0 && (
            <>
              <SectionHeader label="Pending" count={pending.length} />
              <div className="space-y-3">
                {pending.map((t) => renderTaskCard(t, false, true))}
              </div>
            </>
          )}

          {scored.length > 0 && (
            <>
              <SectionHeader label="Already Scored" count={scored.length} />
              <div className="space-y-3">
                {scored.map((t) => renderTaskCard(t, false, false))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
