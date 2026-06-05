import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, ChevronDown, ChevronRight, Trophy, Award,
  Target, Star, Users, TrendingUp, CheckCircle, Clock, Medal,
} from "lucide-react";
import { safeFormat } from "@/lib/safeDate";
import { useRoles } from "@/hooks/useRoles";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Period { id: string; name: string; status: string; }

interface StaffScore {
  total_score:        number | null;
  max_possible_score: number | null;
  percentage:         number | null;
  grade:              string | null;
  notes:              string | null;
  finalized:          boolean;
}

interface TaskAssignment {
  id:            string;
  title:         string;
  description:   string | null;
  status:        string;
  weight:        number;
  max_score:     number;
  score:         number | null;
  score_comment: string | null;
  due_date:      string | null;
  scored_at:     string | null;
  kpi_categories: { name: string; color: string } | null;
}

interface HistoryScore {
  id:          string;
  period_id:   string;
  percentage:  number | null;
  grade:       string | null;
  kpi_periods: { name: string } | null;
}

interface TeamRanking {
  id:               string;
  staff_profile_id: string;
  percentage:       number | null;
  grade:            string | null;
  staff_profiles:   { full_name: string } | null;
}

interface PeriodSummary {
  my_rank:               number;
  total_staff:           number;
  cnt_excellent:         number;
  cnt_good:              number;
  cnt_satisfactory:      number;
  cnt_needs_improvement: number;
  cnt_poor:              number;
}

// ── Performance bands ─────────────────────────────────────────────────────────

const BANDS = [
  { min: 90, label: "Excellent",         color: "#10b981", tw: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  { min: 75, label: "Good",              color: "#3b82f6", tw: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  { min: 60, label: "Satisfactory",      color: "#f59e0b", tw: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  { min: 40, label: "Needs Improvement", color: "#f97316", tw: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" },
  { min: 0,  label: "Poor",              color: "#ef4444", tw: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
];

function getBand(pct: number | null) {
  if (pct === null) return BANDS[BANDS.length - 1];
  return BANDS.find(b => pct >= b.min) ?? BANDS[BANDS.length - 1];
}

function getNarrative(pct: number | null): string {
  if (pct === null) return "Your score for this period has not been calculated yet.";
  if (pct >= 90) return "Outstanding! You're setting the standard for excellence this period.";
  if (pct >= 75) return "Great work. You're consistently delivering quality results.";
  if (pct >= 60) return "You're on track. There's room to push further and strengthen your score.";
  if (pct >= 40) return "This period needs attention. Consider discussing improvement strategies with your manager.";
  return "Your performance needs significant improvement. Please reach out to your manager for support.";
}

// ── ScoreRing ─────────────────────────────────────────────────────────────────

function ScoreRing({ pct }: { pct: number | null }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const safePct = Math.max(0, Math.min(100, pct ?? 0));
  const dash = (safePct / 100) * circ;
  const band = getBand(pct);
  return (
    <div className="relative w-[140px] h-[140px] shrink-0">
      <svg width="140" height="140" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx="70" cy="70" r={r} fill="none"
          stroke={band.color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <span className="text-2xl font-bold leading-none tabular-nums" style={{ color: band.color }}>
          {pct !== null ? `${Math.round(pct)}%` : "—"}
        </span>
        <span className="text-[10px] text-muted-foreground font-medium tracking-wide uppercase">{band.label}</span>
      </div>
    </div>
  );
}

// ── BandScale ─────────────────────────────────────────────────────────────────

function BandScale({ pct }: { pct: number | null }) {
  const currentBand = getBand(pct);
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Performance Scale</p>
      <div className="flex rounded-full overflow-hidden h-2.5 gap-px">
        {[...BANDS].reverse().map(b => (
          <div
            key={b.label}
            className="flex-1"
            style={{ backgroundColor: b.color + (currentBand.label === b.label ? "ff" : "50") }}
            title={`${b.label} (${b.min}%+)`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[...BANDS].reverse().map(b => {
          const isCurrent = currentBand.label === b.label;
          return (
            <span
              key={b.label}
              className={`text-xs px-2 py-0.5 rounded-full border ${b.tw} ${isCurrent ? "font-bold border-current" : "border-transparent opacity-70"}`}
            >
              {b.min}%+ {b.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── SparkBar ──────────────────────────────────────────────────────────────────

function SparkBar({ history }: { history: HistoryScore[] }) {
  return (
    <div className="flex items-end gap-1 h-12">
      {history.map(h => {
        const pct = h.percentage ?? 0;
        const band = getBand(pct);
        const height = Math.max(4, (pct / 100) * 48);
        return (
          <div
            key={h.id}
            className="flex-1 min-w-[6px] rounded-sm"
            style={{ height: `${height}px`, backgroundColor: band.color }}
            title={`${h.kpi_periods?.name || "—"}: ${Math.round(pct)}%`}
          />
        );
      })}
    </div>
  );
}

// ── TaskRow ───────────────────────────────────────────────────────────────────

const taskStatusStyles: Record<string, string> = {
  scored:      "text-emerald-600",
  submitted:   "text-purple-600",
  in_progress: "text-blue-600",
  pending:     "text-slate-400",
};

function TaskRow({ task }: { task: TaskAssignment }) {
  const [open, setOpen] = useState(false);
  const pct = task.score !== null && task.max_score > 0
    ? Math.round((task.score / task.max_score) * 100)
    : null;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {open
          ? <ChevronDown  className="h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="flex-1 text-sm font-medium truncate">{task.title}</span>
        <div className="flex items-center gap-2 shrink-0">
          {task.kpi_categories && (
            <span
              className="text-xs px-2 py-0.5 rounded-full text-white font-medium hidden sm:inline-block"
              style={{ backgroundColor: task.kpi_categories.color }}
            >
              {task.kpi_categories.name}
            </span>
          )}
          <span className={`text-xs font-medium capitalize ${taskStatusStyles[task.status] || "text-muted-foreground"}`}>
            {task.status.replace("_", " ")}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {task.score !== null ? task.score : "—"}/{task.max_score}
          </span>
          {pct !== null && (
            <span className="text-xs font-bold tabular-nums w-9 text-right" style={{ color: getBand(pct).color }}>
              {pct}%
            </span>
          )}
        </div>
      </button>
      {open && (
        <div className="border-t bg-muted/20 px-4 py-3 space-y-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>Weight: <strong className="text-foreground">{task.weight}</strong></span>
            <span>Max: <strong className="text-foreground">{task.max_score} pts</strong></span>
            {task.due_date && <span>Due: <strong className="text-foreground">{safeFormat(task.due_date, "MMM d, yyyy")}</strong></span>}
            {task.scored_at && <span>Scored: <strong className="text-foreground">{safeFormat(task.scored_at, "MMM d, yyyy")}</strong></span>}
          </div>
          {task.description && <p>{task.description}</p>}
          {task.score_comment && (
            <p className="italic border-l-2 border-primary/40 pl-3">&ldquo;{task.score_comment}&rdquo;</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── RankIcon ──────────────────────────────────────────────────────────────────

function RankIcon({ rank }: { rank: number }) {
  if (rank === 0) return <Trophy className="h-4 w-4 text-amber-500" />;
  if (rank === 1) return <Award  className="h-4 w-4 text-slate-400" />;
  if (rank === 2) return <Award  className="h-4 w-4 text-amber-700" />;
  return <span className="text-xs font-semibold text-muted-foreground">{rank + 1}</span>;
}

// ── KPIMyScore ────────────────────────────────────────────────────────────────

export default function KPIMyScore() {
  const { user } = useAuth();
  const { isAdmin, isManager, isHR } = useRoles();
  const canSeeFullLeaderboard = isAdmin || isManager || isHR;
  const [selectedPeriod, setSelectedPeriod] = useState<string>("latest");

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["my-staff-profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("id, full_name")
        .eq("linked_user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; full_name: string } | null;
    },
    enabled: !!user?.id,
  });

  const { data: allPeriods = [] } = useQuery<Period[]>({
    queryKey: ["kpi-periods-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_periods")
        .select("id, name, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: history = [], isLoading: histLoading } = useQuery<HistoryScore[]>({
    queryKey: ["my-kpi-history", profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_staff_scores")
        .select("id, period_id, percentage, grade, kpi_periods(name)")
        .eq("staff_profile_id", profile!.id)
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data || []) as unknown as HistoryScore[];
    },
    enabled: !!profile?.id,
  });

  const effectivePeriodId =
    selectedPeriod === "latest"
      ? (history[0]?.period_id ?? allPeriods.find(p => p.status === "active")?.id ?? allPeriods[0]?.id)
      : selectedPeriod;

  const { data: myScore, isLoading: scoreLoading } = useQuery<StaffScore | null>({
    queryKey: ["my-kpi-score", profile?.id, effectivePeriodId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_staff_scores")
        .select("total_score, max_possible_score, percentage, grade, notes, finalized")
        .eq("staff_profile_id", profile!.id)
        .eq("period_id", effectivePeriodId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as StaffScore | null;
    },
    enabled: !!profile?.id && !!effectivePeriodId,
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<TaskAssignment[]>({
    queryKey: ["my-kpi-tasks", profile?.id, effectivePeriodId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_task_assignments")
        .select("id, title, description, status, weight, max_score, score, score_comment, due_date, scored_at, kpi_categories(name, color)")
        .eq("staff_profile_id", profile!.id)
        .eq("period_id", effectivePeriodId!)
        .order("assigned_at");
      if (error) throw error;
      return (data || []) as unknown as TaskAssignment[];
    },
    enabled: !!profile?.id && !!effectivePeriodId,
  });

  const { data: teamRankings = [] } = useQuery<TeamRanking[]>({
    queryKey: ["team-kpi-rankings", effectivePeriodId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_staff_scores")
        .select("id, staff_profile_id, percentage, grade, staff_profiles(full_name)")
        .eq("period_id", effectivePeriodId!)
        .order("percentage", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as TeamRanking[];
    },
    enabled: !!effectivePeriodId && canSeeFullLeaderboard,
  });

  // For regular staff: aggregate rank + band counts via a SECURITY DEFINER function
  // (bypasses RLS without exposing individual peer scores)
  const { data: periodSummary } = useQuery<PeriodSummary | null>({
    queryKey: ["kpi-period-summary", profile?.id, effectivePeriodId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_kpi_period_summary", {
        p_period_id:        effectivePeriodId,
        p_staff_profile_id: profile!.id,
      });
      if (error) throw error;
      return (data as any)?.[0] ?? null;
    },
    enabled: !!profile?.id && !!effectivePeriodId && !canSeeFullLeaderboard,
  });

  const periodName    = allPeriods.find(p => p.id === effectivePeriodId)?.name ?? "—";
  const pct           = myScore?.percentage ?? null;
  const band          = getBand(pct);
  const scoredCount   = tasks.filter(t => t.status === "scored").length;
  const submittedCount = tasks.filter(t => t.status === "submitted").length;
  const activeCount   = tasks.filter(t => t.status === "in_progress" || t.status === "pending").length;

  if (profileLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <Card>
        <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
          <Target className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">No staff profile linked to your account.</p>
          <p className="text-xs text-muted-foreground">Contact your administrator to set up your performance profile.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header + period selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-500" />
            My Performance
          </h2>
          <p className="text-sm text-muted-foreground">{profile.full_name} — KPI score and task results.</p>
        </div>
        <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Latest Period</SelectItem>
            {allPeriods.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name} ({p.status})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {scoreLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="bg-muted/50 p-1 gap-1">
            <TabsTrigger value="overview" className="data-[state=active]:bg-background data-[state=active]:shadow-sm gap-2">
              <Target className="h-4 w-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="tasks" className="data-[state=active]:bg-background data-[state=active]:shadow-sm gap-2">
              <Star className="h-4 w-4" /> My Tasks
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-background data-[state=active]:shadow-sm gap-2">
              <TrendingUp className="h-4 w-4" /> History
            </TabsTrigger>
            <TabsTrigger value="team" className="data-[state=active]:bg-background data-[state=active]:shadow-sm gap-2">
              <Users className="h-4 w-4" /> My Team
            </TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card>
                <CardContent className="pt-6 pb-6">
                  {myScore ? (
                    <div className="flex items-center gap-6">
                      <ScoreRing pct={pct} />
                      <div className="space-y-2 flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{periodName}</p>
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-3xl font-bold tabular-nums">
                            {myScore.total_score ?? 0}/{myScore.max_possible_score ?? 0}
                          </span>
                          <Badge className={band.tw}>{band.label}</Badge>
                        </div>
                        {myScore.grade && (
                          <p className="text-5xl font-extrabold leading-none" style={{ color: band.color }}>
                            {myScore.grade}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">{getNarrative(pct)}</p>
                        {myScore.finalized && (
                          <Badge variant="outline" className="text-xs gap-1 w-fit">
                            <CheckCircle className="h-3 w-3 text-emerald-500" /> Finalized
                          </Badge>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-6 text-center">
                      <Target className="h-10 w-10 text-muted-foreground/40" />
                      <p className="text-muted-foreground">No score available for this period.</p>
                      <p className="text-xs text-muted-foreground">Scores appear once your tasks are reviewed and calculated.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardContent className="pt-5 pb-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-3">Task Outcomes</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { icon: <CheckCircle className="h-4 w-4 text-emerald-500" />, value: scoredCount,    label: "Scored" },
                        { icon: <Clock       className="h-4 w-4 text-purple-500"  />, value: submittedCount, label: "Submitted" },
                        { icon: <Target      className="h-4 w-4 text-blue-500"    />, value: activeCount,    label: "In Progress" },
                        { icon: <Star        className="h-4 w-4 text-amber-500"   />, value: tasks.length,   label: "Total" },
                      ].map(item => (
                        <div key={item.label} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2.5">
                          {item.icon}
                          <span className="text-lg font-bold tabular-nums">{item.value}</span>
                          <span className="text-xs text-muted-foreground">{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5 pb-5">
                    <BandScale pct={pct} />
                  </CardContent>
                </Card>
              </div>
            </div>

            {myScore?.notes && (
              <Card>
                <CardContent className="pt-5 pb-5">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-2">Manager Notes</p>
                  <p className="text-sm italic text-muted-foreground border-l-2 border-primary/30 pl-3">{myScore.notes}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ── My Tasks ── */}
          <TabsContent value="tasks" className="space-y-3">
            {tasksLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : tasks.length === 0 ? (
              <Card>
                <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
                  <Star className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-muted-foreground">No tasks assigned for this period.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {tasks.length} task{tasks.length !== 1 ? "s" : ""} for <strong>{periodName}</strong>. Click a row to expand details.
                </p>
                <div className="space-y-2">
                  {tasks.map(t => <TaskRow key={t.id} task={t} />)}
                </div>
              </>
            )}
          </TabsContent>

          {/* ── History ── */}
          <TabsContent value="history" className="space-y-4">
            {histLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <Card>
                <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
                  <TrendingUp className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-muted-foreground">No performance history yet.</p>
                  <p className="text-xs text-muted-foreground">Finalized period scores will appear here over time.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> Score Trend
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <SparkBar history={[...history].reverse()} />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{history.length > 1 ? (history[history.length - 1]?.kpi_periods?.name || "Earliest") : ""}</span>
                      <span>{history[0]?.kpi_periods?.name || "Latest"}</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4 pb-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-left">
                          <th className="pb-2 pr-4 font-medium">Period</th>
                          <th className="pb-2 font-medium text-center">Grade</th>
                          <th className="pb-2 font-medium text-right">Score</th>
                          <th className="pb-2 font-medium text-right">Band</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {history.map(h => {
                          const b = getBand(h.percentage);
                          return (
                            <tr key={h.id} className="hover:bg-muted/40 transition-colors">
                              <td className="py-2 pr-4 font-medium">{h.kpi_periods?.name || "—"}</td>
                              <td className="py-2 text-center">
                                <span className="text-lg font-bold" style={{ color: b.color }}>{h.grade || "—"}</span>
                              </td>
                              <td className="py-2 text-right text-muted-foreground tabular-nums">
                                {h.percentage !== null ? `${Math.round(h.percentage)}%` : "—"}
                              </td>
                              <td className="py-2 text-right">
                                <Badge className={`text-xs ${b.tw}`}>{b.label}</Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* ── My Team ── */}
          <TabsContent value="team" className="space-y-4">
            {canSeeFullLeaderboard ? (
              /* ── Full leaderboard for admin / manager / HR ── */
              teamRankings.length === 0 ? (
                <Card>
                  <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
                    <Users className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-muted-foreground">No rankings available for this period.</p>
                    <p className="text-xs text-muted-foreground">Rankings appear once scores are calculated.</p>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Trophy className="h-4 w-4 text-amber-500" /> Team Rankings — {periodName}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5 pb-4">
                    {teamRankings.map((r, i) => {
                      const b    = getBand(r.percentage);
                      const isMe = r.staff_profile_id === profile.id;
                      return (
                        <div
                          key={r.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${isMe ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted/40"}`}
                        >
                          <span className="w-5 flex items-center justify-center shrink-0">
                            <RankIcon rank={i} />
                          </span>
                          <span className="flex-1 text-sm font-medium truncate">
                            {r.staff_profiles?.full_name || "—"}
                            {isMe && <span className="ml-2 text-xs text-primary font-normal">you</span>}
                          </span>
                          <span className="text-sm font-bold tabular-nums" style={{ color: b.color }}>
                            {r.percentage !== null ? `${Math.round(r.percentage)}%` : "—"}
                          </span>
                          <Badge className={`text-xs ${b.tw} shrink-0`}>{r.grade || b.label.split(" ")[0]}</Badge>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )
            ) : (
              /* ── Rank + band distribution for regular staff ── */
              !periodSummary || periodSummary.total_staff === 0 ? (
                <Card>
                  <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
                    <Users className="h-10 w-10 text-muted-foreground/40" />
                    <p className="text-muted-foreground">No team rankings yet for this period.</p>
                    <p className="text-xs text-muted-foreground">Rankings appear once scores are calculated for all staff.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* Rank card */}
                  <Card>
                    <CardContent className="pt-6 pb-6 flex flex-col items-center gap-3 text-center">
                      <Medal className="h-8 w-8 text-amber-500" />
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Your Ranking — {periodName}
                      </p>
                      <div className="flex items-baseline gap-1">
                        <span className="text-5xl font-extrabold tabular-nums" style={{ color: band.color }}>
                          #{periodSummary.my_rank}
                        </span>
                        <span className="text-lg text-muted-foreground font-medium">
                          of {periodSummary.total_staff}
                        </span>
                      </div>
                      {/* percentile bar */}
                      <div className="w-full space-y-1">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.round(((periodSummary.total_staff - periodSummary.my_rank + 1) / periodSummary.total_staff) * 100)}%`,
                              backgroundColor: band.color,
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Top {Math.round(((periodSummary.my_rank) / periodSummary.total_staff) * 100)}% of your team
                        </p>
                      </div>
                      <Badge className={band.tw}>{band.label}</Badge>
                    </CardContent>
                  </Card>

                  {/* Band distribution card */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        Team Band Distribution
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2.5 pb-5">
                      {[
                        { label: "Excellent",          min: 90, count: periodSummary.cnt_excellent,         tw: BANDS[0].tw, color: BANDS[0].color },
                        { label: "Good",               min: 75, count: periodSummary.cnt_good,              tw: BANDS[1].tw, color: BANDS[1].color },
                        { label: "Satisfactory",       min: 60, count: periodSummary.cnt_satisfactory,      tw: BANDS[2].tw, color: BANDS[2].color },
                        { label: "Needs Improvement",  min: 40, count: periodSummary.cnt_needs_improvement, tw: BANDS[3].tw, color: BANDS[3].color },
                        { label: "Poor",               min: 0,  count: periodSummary.cnt_poor,              tw: BANDS[4].tw, color: BANDS[4].color },
                      ].map(row => {
                        const isMyBand = band.label === row.label;
                        const barWidth = periodSummary.total_staff > 0
                          ? Math.max(4, (row.count / periodSummary.total_staff) * 100)
                          : 0;
                        return (
                          <div key={row.label} className={`rounded-lg px-3 py-2 ${isMyBand ? "ring-1 ring-inset" : ""}`}
                            style={isMyBand ? { ringColor: row.color, backgroundColor: row.color + "15" } : {}}>
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className={`text-xs font-medium ${isMyBand ? "font-semibold" : ""}`}>
                                {row.label}
                                {isMyBand && <span className="ml-1.5 text-[10px] font-normal opacity-70">(you)</span>}
                              </span>
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {row.count} staff
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${barWidth}%`, backgroundColor: row.color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                </div>
              )
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
