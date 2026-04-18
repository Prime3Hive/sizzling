import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { BarChart2, RefreshCw, Lock, Loader2, Users, CheckCircle, Award } from "lucide-react";

interface TaskRow {
  staff_profile_id: string;
  weight: number;
  max_score: number;
  score: number | null;
  status: string;
}

interface SavedScore {
  id: string;
  staff_profile_id: string;
  total_score: number;
  max_possible_score: number;
  percentage: number;
  grade: string;
  notes: string | null;
  finalized: boolean;
  finalized_by: string | null;
  finalized_at: string | null;
}

interface StaffProfile {
  id: string;
  full_name: string;
}

const gradeColors: Record<string, string> = {
  A:   "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  B:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  C:   "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  D:   "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  F:   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  "N/A": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function computeGrade(pct: number): string {
  if (pct >= 90) return "A";
  if (pct >= 75) return "B";
  if (pct >= 60) return "C";
  if (pct >= 40) return "D";
  return "F";
}

export default function KPIStaffScores() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isAdmin, isManager, isHR } = useRoles();
  const canManageKPI = isAdmin || isManager;

  const [selectedPeriod, setSelectedPeriod] = useState<string>("");

  if (!isAdmin && !isManager && !isHR) return null;

  // Periods
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

  // Auto-select first active period
  useEffect(() => {
    if (selectedPeriod || !(periods as any[]).length) return;
    const active = (periods as any[]).find((p) => p.status === "active");
    setSelectedPeriod(active?.id ?? (periods as any[])[0]?.id ?? "");
  }, [periods]);

  // Staff profiles
  const { data: staffList = [] } = useQuery<StaffProfile[]>({
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

  // Task assignments for selected period
  const { data: tasks = [], isLoading: loadingTasks } = useQuery<TaskRow[]>({
    queryKey: ["kpi-tasks-for-scores", selectedPeriod],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_task_assignments")
        .select("staff_profile_id, weight, max_score, score, status")
        .eq("period_id", selectedPeriod);
      if (error) throw error;
      return (data || []) as TaskRow[];
    },
    enabled: !!selectedPeriod,
  });

  // Saved staff scores for selected period
  const { data: savedScores = [], isLoading: loadingScores } = useQuery<SavedScore[]>({
    queryKey: ["kpi-staff-scores", selectedPeriod],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_staff_scores")
        .select("id, staff_profile_id, total_score, max_possible_score, percentage, grade, notes, finalized, finalized_by, finalized_at")
        .eq("period_id", selectedPeriod);
      if (error) throw error;
      return (data || []) as SavedScore[];
    },
    enabled: !!selectedPeriod,
  });

  // Aggregate task scores per staff member
  const aggregates = useMemo(() => {
    const map: Record<string, { totalScore: number; maxPossible: number; scoredCount: number; totalCount: number }> = {};
    for (const t of tasks) {
      if (!map[t.staff_profile_id]) {
        map[t.staff_profile_id] = { totalScore: 0, maxPossible: 0, scoredCount: 0, totalCount: 0 };
      }
      map[t.staff_profile_id].totalCount++;
      if (t.status === "scored" && t.score !== null) {
        map[t.staff_profile_id].totalScore  += t.score;
        map[t.staff_profile_id].maxPossible += t.max_score;
        map[t.staff_profile_id].scoredCount++;
      }
    }
    return map;
  }, [tasks]);

  const savedScoresMap = useMemo(() => {
    const map: Record<string, SavedScore> = {};
    for (const s of savedScores) map[s.staff_profile_id] = s;
    return map;
  }, [savedScores]);

  const staffName = (id: string) =>
    (staffList as StaffProfile[]).find((s) => s.id === id)?.full_name ?? id.slice(0, 8) + "…";

  // Sorted leaderboard: by saved percentage desc, then by live computed desc
  const sortedStaffIds = useMemo(() => {
    const ids = Object.keys(aggregates);
    return ids.sort((a, b) => {
      const pctA = savedScoresMap[a]?.percentage ?? (aggregates[a].maxPossible > 0 ? (aggregates[a].totalScore / aggregates[a].maxPossible) * 100 : 0);
      const pctB = savedScoresMap[b]?.percentage ?? (aggregates[b].maxPossible > 0 ? (aggregates[b].totalScore / aggregates[b].maxPossible) * 100 : 0);
      return pctB - pctA;
    });
  }, [aggregates, savedScoresMap]);

  const calculateAndSave = useMutation({
    mutationFn: async (staffId: string) => {
      const agg = aggregates[staffId] ?? { totalScore: 0, maxPossible: 0 };
      const { error } = await supabase
        .from("kpi_staff_scores")
        .upsert(
          {
            period_id:          selectedPeriod,
            staff_profile_id:   staffId,
            total_score:        agg.totalScore,
            max_possible_score: agg.maxPossible,
            updated_at:         new Date().toISOString(),
          },
          { onConflict: "period_id,staff_profile_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-staff-scores", selectedPeriod] });
    },
    onError: (e: any) => toast({ title: "Error saving score", description: e.message, variant: "destructive" }),
  });

  const finalizeScore = useMutation({
    mutationFn: async (scoreId: string) => {
      const { error } = await supabase
        .from("kpi_staff_scores")
        .update({
          finalized:    true,
          finalized_by: user?.id,
          finalized_at: new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        })
        .eq("id", scoreId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-staff-scores", selectedPeriod] });
      toast({ title: "Score finalized" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleSaveAll = async () => {
    if (!sortedStaffIds.length) return;
    await Promise.all(sortedStaffIds.map((id) => calculateAndSave.mutateAsync(id)));
    toast({ title: "All scores calculated and saved" });
  };

  const isLoading = loadingTasks || loadingScores;

  // Summary counts
  const fullyScored = sortedStaffIds.filter((id) => {
    const agg = aggregates[id];
    return agg.totalCount > 0 && agg.scoredCount === agg.totalCount;
  }).length;
  const finalizedCount = savedScores.filter((s) => s.finalized).length;

  if (!(periods as any[]).length) {
    return (
      <Card>
        <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
          <BarChart2 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">No periods found. Create a period in the KPI Periods tab first.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-primary" /> Scores & Reports
          </h2>
          <p className="text-sm text-muted-foreground">Leaderboard and score management for the selected period.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {(periods as any[]).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} <span className="text-muted-foreground ml-1 capitalize">({p.status})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManageKPI && (
            <Button
              onClick={handleSaveAll}
              disabled={calculateAndSave.isPending || !sortedStaffIds.length}
              variant="outline"
              className="gap-2"
            >
              {calculateAndSave.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Calculate All
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Staff with Tasks</p>
              <p className="text-2xl font-bold">{sortedStaffIds.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Fully Scored</p>
              <p className="text-2xl font-bold">{fullyScored}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/10">
              <Award className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Finalized</p>
              <p className="text-2xl font-bold">{finalizedCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Leaderboard</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : sortedStaffIds.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No tasks assigned for this period yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Staff Member</TableHead>
                    <TableHead className="text-center">Tasks Scored</TableHead>
                    <TableHead className="text-center">Score</TableHead>
                    <TableHead className="text-center">Max</TableHead>
                    <TableHead className="text-center">%</TableHead>
                    <TableHead className="text-center">Grade</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    {canManageKPI && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedStaffIds.map((staffId, idx) => {
                    const saved = savedScoresMap[staffId];
                    const agg   = aggregates[staffId];
                    const livePct   = agg.maxPossible > 0 ? (agg.totalScore / agg.maxPossible) * 100 : 0;
                    const liveGrade = agg.maxPossible > 0 ? computeGrade(livePct) : "N/A";
                    const displayPct   = saved ? saved.percentage : livePct;
                    const displayGrade = saved ? saved.grade : liveGrade;

                    return (
                      <TableRow key={staffId}>
                        <TableCell className="font-medium text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{staffName(staffId)}</TableCell>
                        <TableCell className="text-center text-sm">
                          {agg.scoredCount} / {agg.totalCount}
                        </TableCell>
                        <TableCell className="text-center">
                          {saved ? saved.total_score : agg.totalScore}
                        </TableCell>
                        <TableCell className="text-center">
                          {saved ? saved.max_possible_score : agg.maxPossible}
                        </TableCell>
                        <TableCell className="text-center font-semibold">
                          {displayPct > 0 ? `${Number(displayPct).toFixed(1)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge className={`${gradeColors[displayGrade]} text-xs font-bold`}>
                            {displayGrade}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {saved?.finalized ? (
                            <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs">
                              Finalized
                            </Badge>
                          ) : saved ? (
                            <Badge variant="outline" className="text-xs">Saved</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Unsaved</Badge>
                          )}
                        </TableCell>
                        {canManageKPI && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              {!saved?.finalized && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1 text-xs h-7"
                                  onClick={() => calculateAndSave.mutate(staffId)}
                                  disabled={calculateAndSave.isPending}
                                >
                                  <RefreshCw className="h-3 w-3" /> Save
                                </Button>
                              )}
                              {saved && !saved.finalized && isAdmin && (
                                <Button
                                  size="sm"
                                  className="gap-1 text-xs h-7"
                                  onClick={() => finalizeScore.mutate(saved.id)}
                                  disabled={finalizeScore.isPending}
                                >
                                  <Lock className="h-3 w-3" /> Finalize
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
