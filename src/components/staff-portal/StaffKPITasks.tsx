import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ClipboardList, Loader2, TrendingUp, PlayCircle, SendHorizonal, Info, Award } from "lucide-react";
import { format } from "date-fns";

interface MyTask {
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
  kpi_categories: { name: string; color: string } | null;
  kpi_periods: { id: string; name: string; status: string } | null;
}

interface MyScore {
  period_id: string;
  total_score: number;
  max_possible_score: number;
  percentage: number;
  grade: string;
  finalized: boolean;
  kpi_periods: { name: string } | null;
}

const statusColors: Record<string, string> = {
  pending:     "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  submitted:   "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  scored:      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const gradeColors: Record<string, string> = {
  A:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  B:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  C:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  D:   "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  F:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  "N/A": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const nextStatus = (current: string): "in_progress" | "submitted" | null => {
  if (current === "pending")     return "in_progress";
  if (current === "in_progress") return "submitted";
  return null;
};

const actionLabel = (current: string): string | null => {
  if (current === "pending")     return "Start Task";
  if (current === "in_progress") return "Submit for Review";
  return null;
};

export default function StaffKPITasks() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Resolve linked staff profile
  const { data: staffProfile, isLoading: profileLoading } = useQuery({
    queryKey: ["my-staff-profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("id, full_name")
        .eq("linked_user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Get active period IDs (reuses cached kpi-periods query)
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

  const activePeriodIds = useMemo(
    () => (periods as any[]).filter((p) => p.status === "active").map((p) => p.id),
    [periods]
  );

  // My tasks in active periods
  const { data: tasks = [], isLoading: tasksLoading } = useQuery<MyTask[]>({
    queryKey: ["my-kpi-tasks", staffProfile?.id],
    queryFn: async () => {
      let q = supabase
        .from("kpi_task_assignments")
        .select(`
          id, title, description, status, weight, max_score,
          score, score_comment, due_date, assigned_at,
          kpi_categories(name, color),
          kpi_periods(id, name, status)
        `)
        .eq("staff_profile_id", staffProfile!.id)
        .order("assigned_at", { ascending: false });

      if (activePeriodIds.length > 0) {
        q = q.in("period_id", activePeriodIds);
      } else {
        // No active periods — return empty
        return [];
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as MyTask[];
    },
    enabled: !!staffProfile?.id && periods.length > 0,
  });

  // My finalized scores
  const { data: myScores = [] } = useQuery<MyScore[]>({
    queryKey: ["my-kpi-scores", staffProfile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_staff_scores")
        .select("period_id, total_score, max_possible_score, percentage, grade, finalized, kpi_periods(name)")
        .eq("staff_profile_id", staffProfile!.id)
        .eq("finalized", true);
      if (error) throw error;
      return (data || []) as unknown as MyScore[];
    },
    enabled: !!staffProfile?.id,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "in_progress" | "submitted" }) => {
      const { error } = await supabase
        .from("kpi_task_assignments")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["my-kpi-tasks", staffProfile?.id] });
      toast({
        title: vars.status === "submitted"
          ? "Task submitted for scoring"
          : "Task marked as in progress",
      });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!staffProfile) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
          <Info className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-muted-foreground font-medium">No staff profile linked</p>
          <p className="text-sm text-muted-foreground">
            Your user account is not yet linked to a staff profile. Contact your administrator.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Finalized grade banners */}
      {myScores.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Award className="h-4 w-4" /> Finalized Results
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {myScores.map((s) => (
              <Card key={s.period_id} className="border-2 border-primary/20">
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                        {(s.kpi_periods as any)?.name ?? "Period"}
                      </p>
                      <p className="text-2xl font-bold mt-1">{Number(s.percentage).toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {s.total_score} / {s.max_possible_score} pts
                      </p>
                    </div>
                    <Badge className={`${gradeColors[s.grade] ?? gradeColors["N/A"]} text-2xl font-bold px-4 py-2`}>
                      {s.grade}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Active task list */}
      <div>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" /> My Active KPI Tasks
        </h2>

        {tasksLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <Card>
            <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
              <ClipboardList className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-muted-foreground">No tasks assigned in active periods.</p>
              <p className="text-xs text-muted-foreground">
                Tasks will appear here once your manager assigns them during an active KPI period.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => {
              const next  = nextStatus(task.status);
              const label = actionLabel(task.status);
              return (
                <Card key={task.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* Title + status + category */}
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

                        {/* Meta row */}
                        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                          <span>Period: {task.kpi_periods?.name || "—"}</span>
                          {task.due_date && (
                            <span>Due: {format(new Date(task.due_date), "MMM d, yyyy")}</span>
                          )}
                          <span>Weight: {task.weight} · Max: {task.max_score} pts</span>
                          {task.score !== null && (
                            <span className="text-green-600 font-semibold">
                              Score: {task.score}/{task.max_score}
                            </span>
                          )}
                        </div>

                        {/* Score comment from reviewer */}
                        {task.score_comment && (
                          <p className="text-xs text-muted-foreground italic">
                            Reviewer: "{task.score_comment}"
                          </p>
                        )}

                        {/* Task description */}
                        {task.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
                        )}
                      </div>

                      {/* Action button */}
                      {next && label && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 flex-shrink-0"
                          onClick={() => updateStatus.mutate({ id: task.id, status: next })}
                          disabled={updateStatus.isPending}
                        >
                          {updateStatus.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : next === "in_progress" ? (
                            <PlayCircle className="h-3.5 w-3.5" />
                          ) : (
                            <SendHorizonal className="h-3.5 w-3.5" />
                          )}
                          {label}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

