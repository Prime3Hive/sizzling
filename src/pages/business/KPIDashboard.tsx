import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Users, CalendarCheck, AlertTriangle, Clock, TrendingUp, Award, Building2, UserCheck, LayoutDashboard, CalendarRange, Tag, ClipboardList, Star, BarChart2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRoles";
import KPIPeriods from "@/components/kpi/KPIPeriods";
import KPITaskLibrary from "@/components/kpi/KPITaskLibrary";
import KPIAssignTasks from "@/components/kpi/KPIAssignTasks";
import KPIScoreEntry from "@/components/kpi/KPIScoreEntry";
import KPIStaffScores from "@/components/kpi/KPIStaffScores";

const leaveTypeLabels: Record<string, string> = {
  casual: "Casual",
  sick: "Sick",
  unpaid: "Unpaid",
};

const statusColors: Record<string, string> = {
  approved: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  rejected: "bg-red-100 text-red-700",
};

const KPIDashboard = () => {
  const navigate = useNavigate();
  const { isAdmin, isManager, isHR } = useRoles();
  const canManageKPI = isAdmin || isManager;

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['kpi-staff-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('id, full_name, position, employment_type, employment_date, year_of_joining, departments(name)');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: leaveRequests = [] } = useQuery({
    queryKey: ['kpi-leave-requests'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_leave_requests')
        .select('id, user_id, leave_type, status, start_date, end_date, days_requested');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: complaints = [] } = useQuery({
    queryKey: ['kpi-complaints'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_complaints')
        .select('id, status, created_at');
      if (error) throw error;
      return data || [];
    },
  });

  // ── Computed metrics ──────────────────────────────────────
  const totalStaff = staffProfiles.length;

  const today = new Date().toISOString().split('T')[0];
  const onLeaveToday = leaveRequests.filter(r =>
    r.status === 'approved' &&
    r.start_date <= today &&
    r.end_date >= today
  ).length;

  const pendingLeave = leaveRequests.filter(r => r.status === 'pending').length;
  const openComplaints = complaints.filter(c => c.status === 'pending' || c.status === 'open').length;

  const calcTenureYears = (emp: any) => {
    const start = emp.employment_date
      ? new Date(emp.employment_date).getFullYear()
      : emp.year_of_joining;
    return start ? new Date().getFullYear() - start : null;
  };

  const tenures = staffProfiles.map(calcTenureYears).filter(t => t !== null) as number[];
  const avgTenure = tenures.length
    ? (tenures.reduce((a, b) => a + b, 0) / tenures.length).toFixed(1)
    : 'N/A';

  const deptMap: Record<string, number> = {};
  staffProfiles.forEach((p: any) => {
    const name = p.departments?.name || 'Unassigned';
    deptMap[name] = (deptMap[name] || 0) + 1;
  });
  const deptBreakdown = Object.entries(deptMap).sort((a, b) => b[1] - a[1]);
  const maxDept = Math.max(...Object.values(deptMap), 1);

  const leaveByType: Record<string, { approved: number; pending: number; rejected: number }> = {};
  ['casual', 'sick', 'unpaid'].forEach(t => {
    leaveByType[t] = { approved: 0, pending: 0, rejected: 0 };
  });
  leaveRequests.forEach(r => {
    const type = r.leave_type in leaveByType ? r.leave_type : 'casual';
    if (r.status in leaveByType[type]) {
      leaveByType[type][r.status as 'approved' | 'pending' | 'rejected']++;
    }
  });

  const posMap: Record<string, number> = {};
  staffProfiles.forEach((p: any) => {
    const label = p.position?.replace(/_/g, ' ') || 'Staff';
    posMap[label] = (posMap[label] || 0) + 1;
  });

  const empTypeMap: Record<string, number> = {};
  staffProfiles.forEach((p: any) => {
    const label = p.employment_type?.replace(/_/g, ' ') || 'Unspecified';
    empTypeMap[label] = (empTypeMap[label] || 0) + 1;
  });

  const resolvedComplaints = complaints.filter(c => c.status === 'resolved').length;
  const resolutionRate = complaints.length
    ? Math.round((resolvedComplaints / complaints.length) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/business")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-foreground">Staff Performance KPI</h1>
          <p className="text-muted-foreground mt-1">Monitor workforce metrics, manage KPI periods, assign tasks, and score performance</p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-muted/50 p-1 flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" className="data-[state=active]:bg-background data-[state=active]:shadow-card gap-2">
            <LayoutDashboard className="h-4 w-4" /> Overview
          </TabsTrigger>
          {canManageKPI && (
            <TabsTrigger value="periods" className="data-[state=active]:bg-background data-[state=active]:shadow-card gap-2">
              <CalendarRange className="h-4 w-4" /> KPI Periods
            </TabsTrigger>
          )}
          {canManageKPI && (
            <TabsTrigger value="library" className="data-[state=active]:bg-background data-[state=active]:shadow-card gap-2">
              <Tag className="h-4 w-4" /> Task Library
            </TabsTrigger>
          )}
          {canManageKPI && (
            <TabsTrigger value="assign" className="data-[state=active]:bg-background data-[state=active]:shadow-card gap-2">
              <ClipboardList className="h-4 w-4" /> Assign Tasks
            </TabsTrigger>
          )}
          {canManageKPI && (
            <TabsTrigger value="score" className="data-[state=active]:bg-background data-[state=active]:shadow-card gap-2">
              <Star className="h-4 w-4" /> Score Tasks
            </TabsTrigger>
          )}
          {(canManageKPI || isHR) && (
            <TabsTrigger value="reports" className="data-[state=active]:bg-background data-[state=active]:shadow-card gap-2">
              <BarChart2 className="h-4 w-4" /> Scores & Reports
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Overview Tab ── */}
        <TabsContent value="overview" className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 rounded-lg"><Users className="h-5 w-5 text-blue-600" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Staff</p>
                    <p className="text-3xl font-bold">{totalStaff}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 rounded-lg"><CalendarCheck className="h-5 w-5 text-orange-600" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">On Leave Today</p>
                    <p className="text-3xl font-bold">{onLeaveToday}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-yellow-100 rounded-lg"><Clock className="h-5 w-5 text-yellow-600" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Pending Leave</p>
                    <p className="text-3xl font-bold">{pendingLeave}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 rounded-lg"><AlertTriangle className="h-5 w-5 text-red-600" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Open Complaints</p>
                    <p className="text-3xl font-bold">{openComplaints}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg"><TrendingUp className="h-5 w-5 text-purple-600" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Avg Tenure</p>
                    <p className="text-3xl font-bold">{avgTenure} <span className="text-base font-normal text-muted-foreground">yrs</span></p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-100 rounded-lg"><Award className="h-5 w-5 text-green-600" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Complaint Resolution</p>
                    <p className="text-3xl font-bold">{resolutionRate}<span className="text-base font-normal text-muted-foreground">%</span></p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-teal-100 rounded-lg"><UserCheck className="h-5 w-5 text-teal-600" /></div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Active Staff</p>
                    <p className="text-3xl font-bold">{totalStaff - onLeaveToday}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Department Breakdown + Leave Analysis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  Staff by Department
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {deptBreakdown.length === 0 && (
                  <p className="text-sm text-muted-foreground">No department data available.</p>
                )}
                {deptBreakdown.map(([dept, count]) => (
                  <div key={dept}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{dept}</span>
                      <span className="text-muted-foreground">{count} staff</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${(count / maxDept) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarCheck className="h-4 w-4 text-muted-foreground" />
                  Leave Requests by Type
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="divide-y">
                  {Object.entries(leaveByType).map(([type, counts]) => (
                    <div key={type} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-sm font-semibold mb-2">{leaveTypeLabels[type] || type} Leave</p>
                      <div className="flex gap-2 flex-wrap">
                        {(['approved', 'pending', 'rejected'] as const).map(s => (
                          <span key={s} className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[s]}`}>
                            {counts[s]} {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Position + Employment Type */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  Staff by Position
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(posMap).map(([pos, count]) => (
                    <div key={pos} className="flex items-center gap-2 bg-muted px-3 py-2 rounded-lg">
                      <span className="text-sm capitalize font-medium">{pos}</span>
                      <Badge variant="secondary">{count}</Badge>
                    </div>
                  ))}
                  {Object.keys(posMap).length === 0 && (
                    <p className="text-sm text-muted-foreground">No position data available.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCheck className="h-4 w-4 text-muted-foreground" />
                  Employment Type Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(empTypeMap).map(([type, count]) => (
                    <div key={type} className="flex items-center gap-2 bg-muted px-3 py-2 rounded-lg">
                      <span className="text-sm capitalize font-medium">{type}</span>
                      <Badge variant="outline">{count}</Badge>
                    </div>
                  ))}
                  {Object.keys(empTypeMap).length === 0 && (
                    <p className="text-sm text-muted-foreground">No employment type data.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Staff Tenure Table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                Staff Tenure Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-left">
                      <th className="pb-2 font-medium">Name</th>
                      <th className="pb-2 font-medium">Position</th>
                      <th className="pb-2 font-medium">Department</th>
                      <th className="pb-2 font-medium">Employment Type</th>
                      <th className="pb-2 font-medium text-right">Tenure</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {staffProfiles.map((p: any) => {
                      const yrs = calcTenureYears(p);
                      return (
                        <tr key={p.id} className="hover:bg-muted/40 transition-colors">
                          <td className="py-2 font-medium">{p.full_name}</td>
                          <td className="py-2 capitalize text-muted-foreground">{p.position?.replace(/_/g, ' ') || '—'}</td>
                          <td className="py-2 text-muted-foreground">{p.departments?.name || '—'}</td>
                          <td className="py-2 capitalize text-muted-foreground">{p.employment_type?.replace(/_/g, ' ') || '—'}</td>
                          <td className="py-2 text-right">
                            {yrs !== null ? (
                              <Badge variant={yrs >= 3 ? "default" : "secondary"}>
                                {yrs === 0 ? '< 1 yr' : `${yrs} yr${yrs !== 1 ? 's' : ''}`}
                              </Badge>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {staffProfiles.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          No staff profiles found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── KPI Periods Tab ── */}
        {canManageKPI && (
          <TabsContent value="periods">
            <KPIPeriods />
          </TabsContent>
        )}

        {/* ── Task Library Tab ── */}
        {canManageKPI && (
          <TabsContent value="library">
            <KPITaskLibrary />
          </TabsContent>
        )}

        {/* ── Assign Tasks Tab ── */}
        {canManageKPI && (
          <TabsContent value="assign">
            <KPIAssignTasks />
          </TabsContent>
        )}

        {/* ── Score Tasks Tab ── */}
        {canManageKPI && (
          <TabsContent value="score">
            <KPIScoreEntry />
          </TabsContent>
        )}

        {/* ── Scores & Reports Tab ── */}
        {(canManageKPI || isHR) && (
          <TabsContent value="reports">
            <KPIStaffScores />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};

export default KPIDashboard;
