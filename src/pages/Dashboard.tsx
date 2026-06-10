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
import { formatNairaCompact, formatNairaShort } from '@/lib/currency';
import { Banknote, FileText, CreditCard, Briefcase, Activity, PiggyBank } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  Legend, ResponsiveContainer,
} from 'recharts';

function ExecKpi({ to, label, value, sub, icon: Icon, accent, valueClass }: {
  to: string; label: string; value: string; sub?: string;
  icon: React.ElementType; accent: string; valueClass?: string;
}) {
  return (
    <Link to={to}>
      <Card className="h-full hover:shadow-primary transition-all duration-300 bg-gradient-card border-border/50 cursor-pointer hover:scale-[1.02]">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
            <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
              <Icon className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className={`text-lg font-bold tracking-tight ${valueClass ?? ''}`}>{value}</div>
          {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}

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
  const sixAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().split('T')[0];

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

  // ── Executive financial data (admin) ──────────────────────────────────────────

  // Invoices issued YTD (primary revenue source)
  const { data: ytdInvoices = [] } = useQuery({
    queryKey: ['dash-ytd-invoices', yearStart, yearEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('total_amount, issue_date, invoice_type')
        .eq('status', 'invoice')
        .gte('issue_date', yearStart).lte('issue_date', yearEnd);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });

  // Outstanding invoices (receivables)
  const { data: dashOutstanding = [] } = useQuery({
    queryKey: ['dash-outstanding'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('total_amount, amount_paid, issue_date')
        .eq('status', 'invoice').in('payment_status', ['unpaid', 'partial']);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });

  // Cash collected this month — sale payments + dated invoice receipts
  const { data: mtdSalePayments = [] } = useQuery({
    queryKey: ['dash-mtd-sale-payments', monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments').select('amount, payment_date, status')
        .eq('status', 'completed')
        .gte('payment_date', monthStart).lte('payment_date', monthEnd);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });
  const { data: mtdInvoiceReceipts = [] } = useQuery({
    queryKey: ['dash-mtd-invoice-receipts', monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('invoice_payments').select('amount, payment_date')
        .gte('payment_date', monthStart).lte('payment_date', monthEnd);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });

  // 6-month trend: sales, invoices, expenses
  const { data: sixSales = [] } = useQuery({
    queryKey: ['dash-6m-sales', sixAgo],
    queryFn: async () => {
      const { data, error } = await supabase.from('sales')
        .select('total_amount, sale_date, status').gte('sale_date', sixAgo).neq('status', 'cancelled');
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });
  const { data: sixInvoices = [] } = useQuery({
    queryKey: ['dash-6m-invoices', sixAgo],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoices')
        .select('total_amount, issue_date, status').eq('status', 'invoice').gte('issue_date', sixAgo);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });
  const { data: sixExpenses = [] } = useQuery({
    queryKey: ['dash-6m-expenses', sixAgo],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses')
        .select('amount, date').gte('date', sixAgo);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });

  // Headcount + department spread
  const { data: headcount = [] } = useQuery({
    queryKey: ['dash-headcount'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_profiles').select('id, departments(name)');
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && isAdmin,
  });

  // Recent finance ledger activity
  const { data: recentLedger = [] } = useQuery({
    queryKey: ['dash-recent-ledger'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('finance_ledger')
        .select('id, entry_date, entry_type, description, amount')
        .order('entry_date', { ascending: false }).limit(6);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
  });

  // Monthly expense categories (this month)
  const { data: mtdExpenseCats = [] } = useQuery({
    queryKey: ['dash-mtd-expense-cats', monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses').select('amount, category')
        .gte('date', monthStart).lte('date', monthEnd);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && canViewFinancials,
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

  // Revenue = legacy sales + issued invoices (single source of truth, matches Finance)
  const ytdSalesRevenue   = ytdSales.reduce((sum, s) => sum + Number(s.total_amount), 0);
  const ytdInvoiceRevenue = ytdInvoices.reduce((sum, i) => sum + Number(i.total_amount), 0);
  const ytdRevenue = ytdSalesRevenue + ytdInvoiceRevenue;

  const ytdCOGS = ytdExpenses.filter(e => (e.account_type || 'COGS') === 'COGS').reduce((sum, e) => sum + Number(e.amount), 0);
  const ytdOpEX = ytdExpenses.filter(e => e.account_type === 'OpEX').reduce((sum, e) => sum + Number(e.amount), 0);
  const ytdPayrollOpEX = paidPayroll.reduce((sum, r) => sum + Number(r.net_pay), 0);
  const ytdGrossProfit = ytdRevenue - ytdCOGS;
  const ytdTotalOpEX = ytdOpEX + ytdPayrollOpEX;
  const ytdNetProfit = ytdGrossProfit - ytdTotalOpEX;
  const profitMargin = ytdRevenue > 0 ? (ytdNetProfit / ytdRevenue) * 100 : 0;

  const monthlySalesRev = ytdSales
    .filter(s => s.sale_date >= monthStart && s.sale_date <= monthEnd)
    .reduce((sum, s) => sum + Number(s.total_amount), 0);
  const monthlyInvoiceRev = ytdInvoices
    .filter(i => i.issue_date >= monthStart && i.issue_date <= monthEnd)
    .reduce((sum, i) => sum + Number(i.total_amount), 0);
  const monthlySales = monthlySalesRev + monthlyInvoiceRev;

  // Cash collected this month (dated)
  const mtdCash =
    mtdSalePayments.reduce((s, p) => s + Number(p.amount), 0) +
    mtdInvoiceReceipts.reduce((s: number, r: any) => s + Number(r.amount), 0);

  // Receivables (outstanding invoices)
  const receivablesTotal = dashOutstanding.reduce((s, i) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0);
  const overdueReceivables = dashOutstanding.filter(i => {
    const days = (now.getTime() - new Date(i.issue_date).getTime()) / 86400000;
    return days > 30;
  }).length;

  // 6-month trend chart data
  const monthsBack = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return { y: d.getFullYear(), m: d.getMonth(), label: d.toLocaleDateString('en-US', { month: 'short' }) };
  });
  const trendData = monthsBack.map(({ y, m, label }) => {
    const inMonth = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.getFullYear() === y && d.getMonth() === m;
    };
    const rev =
      sixSales.filter(s => inMonth(s.sale_date)).reduce((a, s) => a + Number(s.total_amount), 0) +
      sixInvoices.filter(i => inMonth(i.issue_date)).reduce((a, i) => a + Number(i.total_amount), 0);
    const exp = sixExpenses.filter(e => inMonth(e.date)).reduce((a, e) => a + Number(e.amount), 0);
    return { name: label, Revenue: rev, Expenses: exp };
  });

  // Top expense categories this month
  const expenseCatMap: Record<string, number> = {};
  mtdExpenseCats.forEach((e: any) => { expenseCatMap[e.category] = (expenseCatMap[e.category] ?? 0) + Number(e.amount); });
  const topExpenseCats = Object.entries(expenseCatMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Headcount + departments
  const totalStaff = headcount.length;
  const deptCount = new Set(headcount.map((h: any) => h.departments?.name).filter(Boolean)).size;

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
        <div className="flex gap-2 shrink-0">
          <Link to="/business/invoices">
            <Button variant="outline" className="transition-all duration-300">
              <FileText className="h-4 w-4 mr-2" />New Invoice
            </Button>
          </Link>
          <Link to="/expenses">
            <Button className="bg-gradient-primary hover:shadow-primary transition-all duration-300">
              <PlusCircle className="h-4 w-4 mr-2" />Add Expense
            </Button>
          </Link>
        </div>
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

      {/* Executive KPI strip */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Financial Pulse — {now.getFullYear()}</p>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <ExecKpi
            to="/business/finance" label="Revenue (YTD)" value={formatNairaCompact(ytdRevenue)}
            sub={`This month ${formatNairaShort(monthlySales)}`}
            icon={DollarSign} accent="bg-green-100 text-green-700"
          />
          <ExecKpi
            to="/profit-loss" label="Net Profit (YTD)"
            value={`${ytdNetProfit < 0 ? '−' : ''}${formatNairaCompact(Math.abs(ytdNetProfit))}`}
            sub={`${profitMargin.toFixed(1)}% margin`}
            icon={ytdNetProfit >= 0 ? TrendingUp : TrendingDown}
            accent={ytdNetProfit >= 0 ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}
            valueClass={ytdNetProfit >= 0 ? 'text-success' : 'text-destructive'}
          />
          <ExecKpi
            to="/business/finance" label="Cash In (MTD)" value={formatNairaCompact(mtdCash)}
            sub="Collected this month"
            icon={Banknote} accent="bg-blue-100 text-blue-700"
          />
          <ExecKpi
            to="/business/finance" label="Receivables" value={formatNairaCompact(receivablesTotal)}
            sub={`${dashOutstanding.length} open · ${overdueReceivables} overdue`}
            icon={CreditCard} accent={overdueReceivables > 0 ? 'bg-amber-100 text-amber-700' : 'bg-muted text-muted-foreground'}
          />
          <ExecKpi
            to="/expenses" label="Expenses (MTD)" value={formatNairaCompact(monthlySpent)}
            sub={totalBudget > 0 ? `${((monthlySpent / totalBudget) * 100).toFixed(0)}% of budget` : 'No budget set'}
            icon={Receipt} accent="bg-red-100 text-red-700"
          />
          <ExecKpi
            to="/payroll" label="Payroll Due" value={formatNairaCompact(totalPendingPay)}
            sub={`${pendingPayroll.length} pending · ${paidPayroll.length} paid`}
            icon={Wallet} accent="bg-orange-100 text-orange-700"
            valueClass={totalPendingPay > 0 ? 'text-warning' : ''}
          />
        </div>
      </div>

      {/* Trend chart + Top expenses */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 shadow-elegant border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4 text-primary" />Revenue vs Expenses</CardTitle>
            <CardDescription>Last 6 months — revenue (invoices + sales) against total expenses</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trendData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={v => formatNairaShort(v)} fontSize={11} tickLine={false} axisLine={false} width={48} />
                <RTooltip formatter={(v: number) => formatNairaCompact(v)} contentStyle={{ borderRadius: '0.75rem', border: '1px solid hsl(var(--border))' }} />
                <Legend />
                <Bar dataKey="Revenue"  fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Expenses" fill="hsl(0, 72%, 55%)"    radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-elegant border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><PiggyBank className="h-4 w-4 text-primary" />Top Expenses</CardTitle>
            <CardDescription>This month · {formatNairaCompact(monthlySpent)}</CardDescription>
          </CardHeader>
          <CardContent>
            {topExpenseCats.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No expenses this month.</p>
            ) : (
              <div className="space-y-3">
                {topExpenseCats.map(([cat, amt]) => {
                  const pct = monthlySpent > 0 ? (amt / monthlySpent) * 100 : 0;
                  return (
                    <div key={cat} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="capitalize text-muted-foreground truncate">{cat}</span>
                        <span className="font-medium shrink-0 ml-2">{formatNairaShort(amt)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
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

      {/* Detail row 1: P&L Summary · Receivables · Recent Activity */}
      <div className="grid gap-6 lg:grid-cols-3">
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
            <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-primary" />Receivables</CardTitle>
            <CardDescription>Outstanding customer invoices</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center py-2">
              <p className="text-3xl font-bold">{formatNairaCompact(receivablesTotal)}</p>
              <p className="text-xs text-muted-foreground mt-1">{dashOutstanding.length} open invoice{dashOutstanding.length !== 1 ? 's' : ''}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                <p className="text-lg font-bold text-amber-600">{overdueReceivables}</p>
                <p className="text-[11px] text-muted-foreground">Overdue (30d+)</p>
              </div>
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-center">
                <p className="text-lg font-bold text-blue-600">{formatNairaShort(mtdCash)}</p>
                <p className="text-[11px] text-muted-foreground">Collected (MTD)</p>
              </div>
            </div>
            <Link to="/business/finance">
              <Button variant="outline" size="sm" className="w-full mt-4">Open Finance</Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="shadow-elegant border-border/50 bg-gradient-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-primary" />Recent Activity</CardTitle>
            <CardDescription>Latest finance ledger entries</CardDescription>
          </CardHeader>
          <CardContent>
            {recentLedger.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No activity yet.</p>
            ) : (
              <div className="space-y-2.5">
                {recentLedger.map((e: any) => (
                  <div key={e.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${e.entry_type === 'payment_received' ? 'bg-blue-500' : 'bg-green-500'}`} />
                      <div className="min-w-0">
                        <p className="text-sm truncate">{e.description}</p>
                        <p className="text-[11px] text-muted-foreground">{new Date(e.entry_date).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold shrink-0">{formatNairaShort(Number(e.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail row 2: Recent Expenses · People */}
      <div className="grid gap-6 md:grid-cols-2">
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

        <Card className="shadow-elegant border-border/50 bg-gradient-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" />People</CardTitle>
            <CardDescription>Workforce at a glance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link to="/staff-profiles" className="rounded-lg bg-muted/50 px-3 py-3 text-center hover:bg-muted transition-colors">
                <p className="text-2xl font-bold">{totalStaff}</p>
                <p className="text-[11px] text-muted-foreground">Total Staff</p>
              </Link>
              <div className="rounded-lg bg-muted/50 px-3 py-3 text-center">
                <p className="text-2xl font-bold">{deptCount}</p>
                <p className="text-[11px] text-muted-foreground">Departments</p>
              </div>
              <Link to="/staff-portal?tab=leave" className="rounded-lg bg-muted/50 px-3 py-3 text-center hover:bg-muted transition-colors">
                <p className="text-2xl font-bold text-amber-600">{allPendingLeave}</p>
                <p className="text-[11px] text-muted-foreground">Pending Leave</p>
              </Link>
              <Link to="/payroll" className="rounded-lg bg-muted/50 px-3 py-3 text-center hover:bg-muted transition-colors">
                <p className="text-2xl font-bold">{formatNairaShort(totalPaidPay)}</p>
                <p className="text-[11px] text-muted-foreground">Payroll Paid</p>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

    </div>
  );
};

export default Dashboard;
