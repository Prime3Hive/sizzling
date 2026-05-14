import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PlusCircle,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
  BarChart3,
  Users,
  Wallet,
  LineChart,
  User,
  CalendarDays,
  AlertTriangle,
  Mail,
  Cake,
  ClipboardList,
  PackageX,
  Building2,
  Landmark,
  UserCog,
  ShieldCheck,
  ArrowRight,
  ShoppingCart,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { formatNairaCompact } from '@/lib/currency';

const Dashboard = () => {
  const { user } = useAuth();
  const { isAdmin, isHR, isManager, isEmployee, isPending, userRole } = useRoles();
  const isStaff = !isAdmin && !isHR && !isManager && !isEmployee;
  const canViewFinancials = isAdmin || isManager;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const yearStart = `${now.getFullYear()}-01-01`;
  const yearEnd = `${now.getFullYear()}-12-31`;

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const currentDate = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  // Monthly expenses
  const { data: monthlyExpenses = [], isLoading: expLoading } = useQuery({
    queryKey: ['dashboard-expenses', monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('amount, category, account_type')
        .gte('date', monthStart)
        .lte('date', monthEnd);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });

  // YTD Sales
  const { data: ytdSales = [], isLoading: salesLoading } = useQuery({
    queryKey: ['dashboard-sales', yearStart, yearEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('total_amount, sale_type, sale_date')
        .gte('sale_date', yearStart)
        .lte('sale_date', yearEnd);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });

  // YTD Expenses for P/L
  const { data: ytdExpenses = [], isLoading: ytdExpLoading } = useQuery({
    queryKey: ['dashboard-ytd-expenses', yearStart, yearEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('amount, account_type')
        .gte('date', yearStart)
        .lte('date', yearEnd);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });

  // Payroll summary
  const { data: payrollRecords = [], isLoading: payrollLoading } = useQuery({
    queryKey: ['dashboard-payroll'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_records')
        .select('net_pay, status, salary_period, period_start, period_end')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && isAdmin,
  });

  // Budgets
  const { data: budgets = [] } = useQuery({
    queryKey: ['dashboard-budgets', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('budgets').select('total_budget').eq('user_id', user!.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Recent expenses
  const { data: recentExpenses = [] } = useQuery({
    queryKey: ['dashboard-recent-expenses', canViewFinancials ? 'all' : user?.id],
    queryFn: async () => {
      let q = supabase
        .from('expenses')
        .select('id, description, category, date, amount')
        .order('created_at', { ascending: false })
        .limit(5);
      if (!canViewFinancials) q = q.eq('user_id', user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Upcoming birthdays
  const { data: upcomingBirthdays = [] } = useQuery({
    queryKey: ['dashboard-upcoming-birthdays'],
    queryFn: async () => {
      const { data } = await supabase
        .from('staff_profiles')
        .select('full_name, date_of_birth')
        .not('date_of_birth', 'is', null);
      if (!data) return [];
      const today = new Date();
      return data.filter(s => {
        const dob = new Date(s.date_of_birth!);
        const next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
        if (next < today) next.setFullYear(today.getFullYear() + 1);
        const diff = (next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
        return diff <= 7;
      }).map(s => {
        const dob = new Date(s.date_of_birth!);
        const next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
        if (next < today) next.setFullYear(today.getFullYear() + 1);
        return { name: s.full_name, date: next };
      }).sort((a, b) => a.date.getTime() - b.date.getTime());
    },
    enabled: !!user && isAdmin,
  });

  // Pending leave count
  const { data: allPendingLeave = 0 } = useQuery({
    queryKey: ['dashboard-admin-pending-leave'],
    queryFn: async () => {
      const { count } = await supabase
        .from('staff_leave_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      return count || 0;
    },
    enabled: !!user && isAdmin,
  });

  // Low-stock count
  const { data: lowStockCount = 0 } = useQuery({
    queryKey: ['dashboard-low-stock'],
    queryFn: async () => {
      const { data } = await supabase.from('skus').select('stock_quantity, reorder_level').gt('reorder_level', 0);
      return (data || []).filter((s: any) => Number(s.stock_quantity) <= Number(s.reorder_level)).length;
    },
    enabled: !!user && isAdmin,
  });

  // Unread messages
  const { data: unreadMsgCount = 0 } = useQuery({
    queryKey: ['admin-unread-messages'],
    queryFn: async () => {
      const { count } = await supabase
        .from('staff_messages')
        .select('id', { count: 'exact', head: true })
        .eq('read', false);
      return count || 0;
    },
    enabled: !!user && isAdmin,
  });

  // Staff profile for employees/managers
  const { data: staffProfile } = useQuery({
    queryKey: ['dashboard-staff-profile', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('staff_profiles')
        .select('full_name, position, department_id, departments(name), employment_type, employment_date')
        .eq('linked_user_id', user!.id)
        .maybeSingle();
      return data || null;
    },
    enabled: !!user && (isStaff || isEmployee || isManager),
  });

  // Pending leave for staff
  const { data: pendingLeaveCount = 0 } = useQuery({
    queryKey: ['dashboard-pending-leave', user?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from('staff_leave_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('status', 'pending');
      return count || 0;
    },
    enabled: !!user && (isStaff || isEmployee || isManager),
  });

  const isLoading = expLoading || salesLoading || ytdExpLoading || payrollLoading;

  const monthlySpent = monthlyExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalBudget = budgets.reduce((sum, b) => sum + Number(b.total_budget), 0);

  const pendingPayroll = payrollRecords.filter(r => r.status === 'pending');
  const totalPendingPay = pendingPayroll.reduce((sum, r) => sum + Number(r.net_pay), 0);
  const paidPayroll = payrollRecords.filter(r => r.status === 'paid');
  const totalPaidPay = paidPayroll.reduce((sum, r) => sum + Number(r.net_pay), 0);

  const ytdRevenue = ytdSales.reduce((sum, s) => sum + Number(s.total_amount), 0);
  const ytdCOGS = ytdExpenses.filter(e => (e.account_type || 'COGS') === 'COGS').reduce((sum, e) => sum + Number(e.amount), 0);
  const ytdOpEX = ytdExpenses.filter(e => e.account_type === 'OpEX').reduce((sum, e) => sum + Number(e.amount), 0);
  const ytdPayrollOpEX = paidPayroll.reduce((sum, r) => sum + Number(r.net_pay), 0);
  const ytdGrossProfit = ytdRevenue - ytdCOGS;
  const ytdTotalOpEX = ytdOpEX + ytdPayrollOpEX;
  const ytdNetProfit = ytdGrossProfit - ytdTotalOpEX;
  const profitMargin = ytdRevenue > 0 ? (ytdNetProfit / ytdRevenue) * 100 : 0;

  const monthlySales = ytdSales
    .filter(s => s.sale_date >= monthStart && s.sale_date <= monthEnd)
    .reduce((sum, s) => sum + Number(s.total_amount), 0);

  const displayName = user?.user_metadata?.full_name as string | undefined;
  const firstName = displayName?.split(' ')[0] || 'there';

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardHeader className="pb-2"><Skeleton className="h-4 w-20" /></CardHeader><CardContent><Skeleton className="h-8 w-24" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  // Pending role: show waiting screen
  if (isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
        <div className="p-4 rounded-full bg-warning/10 border border-warning/20">
          <Users className="h-12 w-12 text-warning" />
        </div>
        <h2 className="text-2xl font-bold">Role Pending Approval</h2>
        <p className="text-muted-foreground max-w-md">
          Your <span className="font-semibold capitalize">{userRole?.role}</span> role has been assigned but is awaiting administrator approval.
          You'll gain full access once it's approved.
        </p>
        <div className="flex gap-3 mt-4">
          <Link to="/my-profile">
            <Button variant="outline"><User className="h-4 w-4 mr-2" />My Profile</Button>
          </Link>
          <Link to="/staff-portal">
            <Button variant="outline"><Mail className="h-4 w-4 mr-2" />My Requests</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Staff / Employee / Manager — personal dashboard
  if (isStaff || isEmployee || isManager) {
    const positionLabel = staffProfile?.position
      ? staffProfile.position.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
      : null;

    return (
      <div className="space-y-8">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-1">{currentDate}</p>
          <h1 className="text-2xl sm:text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            {greeting}{staffProfile?.full_name ? `, ${staffProfile.full_name.split(' ')[0]}` : ''}!
          </h1>
          <p className="text-muted-foreground sm:text-lg mt-1">Here's your staff overview.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Link to="/my-profile">
            <Card className="hover:shadow-primary transition-all duration-300 bg-gradient-card border-border/50 cursor-pointer hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">My Profile</CardTitle>
                <div className="p-2 rounded-full bg-gradient-primary"><User className="h-4 w-4 text-white" /></div>
              </CardHeader>
              <CardContent>
                {staffProfile ? (
                  <>
                    <p className="text-lg font-bold">{staffProfile.full_name}</p>
                    <p className="text-xs text-muted-foreground">{positionLabel} • {(staffProfile as any).departments?.name || 'No department'}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">View & update your profile</p>
                )}
              </CardContent>
            </Card>
          </Link>

          <Link to="/my-profile?tab=leave">
            <Card className="hover:shadow-secondary transition-all duration-300 bg-gradient-card border-border/50 cursor-pointer hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Leave Requests</CardTitle>
                <div className="p-2 rounded-full bg-gradient-primary"><CalendarDays className="h-4 w-4 text-white" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{pendingLeaveCount}</div>
                <p className="text-xs text-muted-foreground">Pending requests</p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/my-profile?tab=messages">
            <Card className="hover:shadow-primary transition-all duration-300 bg-gradient-card border-border/50 cursor-pointer hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Messages</CardTitle>
                <div className="p-2 rounded-full bg-gradient-primary"><Mail className="h-4 w-4 text-white" /></div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">Send messages to management</p>
              </CardContent>
            </Card>
          </Link>
        </div>

        <Card className="shadow-elegant border-border/50 bg-gradient-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">Send a Request</CardTitle>
            <CardDescription>Submit requests or reports to management</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Link to="/my-profile?tab=leave">
                <Button variant="outline" className="w-full justify-start h-auto py-4">
                  <CalendarDays className="h-5 w-5 mr-3 text-primary" />
                  <div className="text-left">
                    <p className="font-medium">Leave Request</p>
                    <p className="text-xs text-muted-foreground">Annual, sick, casual & more</p>
                  </div>
                </Button>
              </Link>
              <Link to="/my-profile?tab=complaints">
                <Button variant="outline" className="w-full justify-start h-auto py-4">
                  <AlertTriangle className="h-5 w-5 mr-3 text-warning" />
                  <div className="text-left">
                    <p className="font-medium">Log a Complaint</p>
                    <p className="text-xs text-muted-foreground">Report issues or concerns</p>
                  </div>
                </Button>
              </Link>
              <Link to="/my-profile?tab=messages">
                <Button variant="outline" className="w-full justify-start h-auto py-4">
                  <Mail className="h-5 w-5 mr-3 text-secondary" />
                  <div className="text-left">
                    <p className="font-medium">Send a Message</p>
                    <p className="text-xs text-muted-foreground">Ideas, suggestions, observations</p>
                  </div>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // HR dashboard
  if (isHR) {
    return (
      <div className="space-y-8">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-1">{currentDate}</p>
          <h1 className="text-2xl sm:text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">HR Dashboard</h1>
          <p className="text-muted-foreground sm:text-lg mt-1">Manage staff profiles and personnel records.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Link to="/staff-profiles">
            <Card className="hover:shadow-primary transition-all duration-300 bg-gradient-card border-border/50 cursor-pointer hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Staff Profiles</CardTitle>
                <div className="p-2 rounded-full bg-gradient-primary"><Users className="h-4 w-4 text-white" /></div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">View, add and edit staff profiles</p>
              </CardContent>
            </Card>
          </Link>
          <Link to="/my-profile">
            <Card className="hover:shadow-secondary transition-all duration-300 bg-gradient-card border-border/50 cursor-pointer hover:scale-105">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">My Profile</CardTitle>
                <div className="p-2 rounded-full bg-gradient-primary"><User className="h-4 w-4 text-white" /></div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">View and update your personal information</p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    );
  }

  // ── Admin Dashboard ──
  const hasAlerts = allPendingLeave > 0 || lowStockCount > 0 || upcomingBirthdays.length > 0 || unreadMsgCount > 0;

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium mb-1">{currentDate}</p>
          <h1 className="text-2xl sm:text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            {greeting}, {firstName}!
          </h1>
          <p className="text-muted-foreground sm:text-lg mt-1">Here's your business at a glance.</p>
        </div>
        <Link to="/expenses">
          <Button className="bg-gradient-primary hover:shadow-primary transition-all duration-300 shrink-0">
            <PlusCircle className="h-4 w-4 mr-2" />Add Expense
          </Button>
        </Link>
      </div>

      {/* Action Alerts */}
      {hasAlerts && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Action Required</p>
          <div className="flex flex-wrap gap-3">
            {allPendingLeave > 0 && (
              <Link to="/staff-portal?tab=leave" className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/10 px-4 py-3 hover:shadow-md transition-all cursor-pointer">
                  <div className="p-2 bg-yellow-500/10 rounded-lg shrink-0"><ClipboardList className="h-4 w-4 text-yellow-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-400">{allPendingLeave} Pending Leave{allPendingLeave !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-yellow-600 dark:text-yellow-500">Awaiting approval</p>
                  </div>
                </div>
              </Link>
            )}
            {unreadMsgCount > 0 && (
              <Link to="/staff-portal?tab=messages" className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 hover:shadow-md transition-all cursor-pointer">
                  <div className="p-2 bg-primary/10 rounded-lg shrink-0"><Mail className="h-4 w-4 text-primary" /></div>
                  <div>
                    <p className="text-sm font-semibold text-primary">{unreadMsgCount} Unread Message{unreadMsgCount !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-primary/70">From staff</p>
                  </div>
                </div>
              </Link>
            )}
            {lowStockCount > 0 && (
              <Link to="/business/inventory" className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/10 px-4 py-3 hover:shadow-md transition-all cursor-pointer">
                  <div className="p-2 bg-red-500/10 rounded-lg shrink-0"><PackageX className="h-4 w-4 text-red-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-red-800 dark:text-red-400">{lowStockCount} Low Stock Item{lowStockCount !== 1 ? 's' : ''}</p>
                    <p className="text-xs text-red-600 dark:text-red-500">At or below reorder point</p>
                  </div>
                </div>
              </Link>
            )}
            {upcomingBirthdays.length > 0 && (
              <Link to="/birthdays" className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-3 rounded-lg border border-pink-200 bg-pink-50 dark:bg-pink-900/10 px-4 py-3 hover:shadow-md transition-all cursor-pointer">
                  <div className="p-2 bg-pink-500/10 rounded-lg shrink-0"><Cake className="h-4 w-4 text-pink-600" /></div>
                  <div>
                    <p className="text-sm font-semibold text-pink-800 dark:text-pink-400">
                      {upcomingBirthdays[0].name.split(' ')[0]}{upcomingBirthdays.length > 1 ? ` +${upcomingBirthdays.length - 1} more` : ''}
                    </p>
                    <p className="text-xs text-pink-600 dark:text-pink-500">Birthday{upcomingBirthdays.length !== 1 ? 's' : ''} in 7 days</p>
                  </div>
                </div>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Financial Pulse */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Financial Pulse</p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Link to="/profit-loss">
            <Card className="hover:shadow-primary transition-all duration-300 bg-gradient-card border-border/50 cursor-pointer hover:scale-[1.02]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">YTD Revenue</CardTitle>
                <div className="p-2 rounded-full bg-gradient-primary"><DollarSign className="h-4 w-4 text-white" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNairaCompact(ytdRevenue)}</div>
                <p className="text-xs text-muted-foreground mt-1">This month: {formatNairaCompact(monthlySales)}</p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/profit-loss">
            <Card className="hover:shadow-secondary transition-all duration-300 bg-gradient-card border-border/50 cursor-pointer hover:scale-[1.02]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">YTD Net Profit</CardTitle>
                <div className="p-2 rounded-full bg-gradient-primary">
                  {ytdNetProfit >= 0 ? <TrendingUp className="h-4 w-4 text-white" /> : <TrendingDown className="h-4 w-4 text-white" />}
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${ytdNetProfit >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {ytdNetProfit < 0 ? '-' : ''}{formatNairaCompact(Math.abs(ytdNetProfit))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Margin: {profitMargin.toFixed(1)}%</p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/expenses">
            <Card className="hover:shadow-primary transition-all duration-300 bg-gradient-card border-border/50 cursor-pointer hover:scale-[1.02]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Monthly Expenses</CardTitle>
                <div className="p-2 rounded-full bg-gradient-primary"><Receipt className="h-4 w-4 text-white" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatNairaCompact(monthlySpent)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {totalBudget > 0 ? `${((monthlySpent / totalBudget) * 100).toFixed(1)}% of budget` : 'No budget set'}
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/payroll">
            <Card className="hover:shadow-secondary transition-all duration-300 bg-gradient-card border-border/50 cursor-pointer hover:scale-[1.02]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Payroll</CardTitle>
                <div className="p-2 rounded-full bg-gradient-primary"><Wallet className="h-4 w-4 text-white" /></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-warning">{formatNairaCompact(totalPendingPay)}</div>
                <p className="text-xs text-muted-foreground mt-1">{pendingPayroll.length} pending · {paidPayroll.length} paid</p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Hub Navigation */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Navigate</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Link to="/business">
            <Card className="group h-full hover:shadow-primary transition-all duration-300 border-border/50 hover:border-primary/30 cursor-pointer hover:scale-[1.02]">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                    <ShoppingCart className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors mt-1" />
                </div>
                <p className="font-semibold text-sm">Commerce</p>
                <p className="text-xs text-muted-foreground mt-0.5">Sales · Payments · Invoices · Inventory</p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/expenses">
            <Card className="group h-full hover:shadow-secondary transition-all duration-300 border-border/50 hover:border-secondary/30 cursor-pointer hover:scale-[1.02]">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2.5 rounded-xl bg-secondary/10 text-secondary">
                    <Landmark className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-secondary transition-colors mt-1" />
                </div>
                <p className="font-semibold text-sm">Finance</p>
                <p className="text-xs text-muted-foreground mt-0.5">Expenses · Budgets · P&L · Reports</p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/staff-profiles">
            <Card className="group h-full hover:shadow-primary transition-all duration-300 border-border/50 hover:border-primary/30 cursor-pointer hover:scale-[1.02]">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/20 text-purple-600">
                    <UserCog className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-purple-600 transition-colors mt-1" />
                </div>
                <p className="font-semibold text-sm">People</p>
                <p className="text-xs text-muted-foreground mt-0.5">Staff · Payroll · KPI · Requests</p>
              </CardContent>
            </Card>
          </Link>

          <Link to="/users">
            <Card className="group h-full hover:shadow-elegant transition-all duration-300 border-border/50 hover:border-muted-foreground/30 cursor-pointer hover:scale-[1.02]">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2.5 rounded-xl bg-muted text-muted-foreground">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors mt-1" />
                </div>
                <p className="font-semibold text-sm">Administration</p>
                <p className="text-xs text-muted-foreground mt-0.5">Users · Access Control · Files</p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* Detail cards: P&L Summary + Recent Expenses */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-elegant border-border/50 bg-gradient-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><LineChart className="h-4 w-4 text-primary" />P&L Summary — {now.getFullYear()}</CardTitle>
            <CardDescription>Year-to-date financial performance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2.5">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Revenue</span><span className="font-medium">{formatNairaCompact(ytdRevenue)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">COGS</span><span className="font-medium text-destructive">−{formatNairaCompact(ytdCOGS)}</span></div>
              <div className="border-t pt-2 flex justify-between text-sm"><span className="font-medium">Gross Profit</span><span className={ytdGrossProfit >= 0 ? 'text-success font-semibold' : 'text-destructive font-semibold'}>{formatNairaCompact(ytdGrossProfit)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">OpEX</span><span className="font-medium text-destructive">−{formatNairaCompact(ytdOpEX)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Payroll</span><span className="font-medium text-destructive">−{formatNairaCompact(ytdPayrollOpEX)}</span></div>
              <div className="border-t pt-2 flex justify-between text-sm"><span className="font-semibold">Net Profit</span><span className={`font-bold ${ytdNetProfit >= 0 ? 'text-success' : 'text-destructive'}`}>{ytdNetProfit < 0 ? '−' : ''}{formatNairaCompact(Math.abs(ytdNetProfit))}</span></div>
            </div>
            <Link to="/profit-loss">
              <Button variant="outline" size="sm" className="w-full mt-4">View Full P&L Report</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="shadow-elegant border-border/50 bg-gradient-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4 text-primary" />Recent Expenses</CardTitle>
            <CardDescription>Latest recorded transactions</CardDescription>
          </CardHeader>
          <CardContent>
            {recentExpenses.length === 0 ? (
              <div className="text-center py-6">
                <Receipt className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">No expenses yet</p>
                <Link to="/expenses"><Button variant="outline" size="sm" className="mt-2">Add your first expense</Button></Link>
              </div>
            ) : (
              <div className="space-y-3">
                {recentExpenses.map((expense: any) => (
                  <div key={expense.id} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{expense.description}</p>
                      <p className="text-xs text-muted-foreground">{expense.category} · {new Date(expense.date).toLocaleDateString()}</p>
                    </div>
                    <p className="font-semibold text-sm ml-3 shrink-0">{formatNairaCompact(Number(expense.amount))}</p>
                  </div>
                ))}
                <Link to="/expenses"><Button variant="outline" size="sm" className="w-full mt-1">View All Expenses</Button></Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
};

export default Dashboard;
