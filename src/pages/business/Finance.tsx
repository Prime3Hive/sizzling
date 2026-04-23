import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatNairaCompact } from "@/lib/currency";
import {
  format, startOfMonth, endOfMonth, subMonths,
  differenceInDays, parseISO, getMonth, getYear,
} from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  TrendingUp, TrendingDown, DollarSign, CreditCard, AlertCircle,
  ChevronLeft, ChevronRight, Banknote, BarChart3, BookOpen, FileText,
  ShoppingCart, CalendarDays, ArrowUpRight, ArrowDownRight, Receipt,
  Target, Wallet,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SaleRow {
  id: string;
  sale_number: string;
  sale_date: string;
  customer_name: string | null;
  total_amount: number;
  status: string;
  sale_type: string | null;
}

interface PaymentRow {
  id: string;
  sale_id: string;
  amount: number;
  payment_method: string;
  payment_date: string | null;
  status: string;
  bank_reference: string | null;
  sales: { customer_name: string | null; sale_number: string; sale_type: string | null } | null;
}

interface ExpenseRow {
  id: string;
  date: string;
  amount: number;
  category: string;
  account_type: string | null;
  cost_center: string | null;
  description: string;
  budget_id: string | null;
}

interface BudgetRow {
  id: string;
  title: string;
  total_budget: number;
  type: string;
  start_date: string | null;
  end_date: string | null;
}

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  quotation_number: string;
  customer_name: string;
  invoice_type: string;
  total_amount: number;
  amount_paid: number;
  payment_status: string;
  issue_date: string;
}

interface LedgerRow {
  id: string;
  entry_date: string;
  entry_type: string;
  source_type: string;
  description: string;
  amount: number;
  cost_center: string | null;
  reference_number: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const agingBucket = (issuedDate: string) => {
  const days = differenceInDays(new Date(), parseISO(issuedDate));
  if (days <= 30) return "0–30 days";
  if (days <= 60) return "31–60 days";
  if (days <= 90) return "61–90 days";
  return "90+ days";
};
const agingColor: Record<string, string> = {
  "0–30 days":  "bg-green-100 text-green-700 border-green-200",
  "31–60 days": "bg-amber-100 text-amber-700 border-amber-200",
  "61–90 days": "bg-orange-100 text-orange-700 border-orange-200",
  "90+ days":   "bg-red-100   text-red-700   border-red-200",
};

const payMethodColor: Record<string, string> = {
  cash:         "bg-green-100 text-green-700",
  transfer:     "bg-blue-100  text-blue-700",
  card:         "bg-purple-100 text-purple-700",
  pos:          "bg-orange-100 text-orange-700",
};

// ── Finance Component ─────────────────────────────────────────────────────────

export default function Finance() {
  const today = new Date();
  const [periodDate, setPeriodDate] = useState(today);

  const periodStart = format(startOfMonth(periodDate), "yyyy-MM-dd");
  const periodEnd   = format(endOfMonth(periodDate),   "yyyy-MM-dd");
  const periodLabel = format(periodDate, "MMMM yyyy");
  const sixAgo      = format(startOfMonth(subMonths(today, 5)), "yyyy-MM-dd");

  const prevPeriod = () => setPeriodDate(d => subMonths(d, 1));
  const nextPeriod = () => {
    const next = subMonths(periodDate, -1);
    if (next <= today) setPeriodDate(next);
  };

  // ── Queries ──────────────────────────────────────────────────────────────────

  // Sales in period (source of truth for sales revenue)
  const { data: periodSales = [] } = useQuery<SaleRow[]>({
    queryKey: ["fin-sales", periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id, sale_number, sale_date, customer_name, total_amount, status, sale_type")
        .gte("sale_date", periodStart)
        .lte("sale_date", periodEnd)
        .neq("status", "cancelled")
        .order("sale_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Payments in period (source of truth for cash collected from sales)
  const { data: periodPayments = [] } = useQuery<PaymentRow[]>({
    queryKey: ["fin-payments", periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, sale_id, amount, payment_method, payment_date, status, bank_reference, sales(customer_name, sale_number, sale_type)")
        .gte("payment_date", periodStart)
        .lte("payment_date", periodEnd)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PaymentRow[];
    },
  });

  // Expenses in period
  const { data: periodExpenses = [] } = useQuery<ExpenseRow[]>({
    queryKey: ["fin-expenses", periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id, date, amount, category, account_type, cost_center, description, budget_id")
        .gte("date", periodStart)
        .lte("date", periodEnd)
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Invoices issued in period (for invoice revenue)
  const { data: periodInvoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ["fin-invoices-period", periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, quotation_number, customer_name, invoice_type, total_amount, amount_paid, payment_status, issue_date")
        .eq("status", "invoice")
        .gte("issue_date", periodStart)
        .lte("issue_date", periodEnd)
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // All outstanding invoices (unpaid/partial, any date) for receivables tab
  const { data: outstandingInvoices = [] } = useQuery<InvoiceRow[]>({
    queryKey: ["fin-outstanding"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, quotation_number, customer_name, invoice_type, total_amount, amount_paid, payment_status, issue_date")
        .eq("status", "invoice")
        .in("payment_status", ["unpaid", "partial"])
        .order("issue_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // All active budgets (overlapping with period)
  const { data: allBudgets = [] } = useQuery<BudgetRow[]>({
    queryKey: ["fin-budgets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("budgets")
        .select("id, title, total_budget, type, start_date, end_date")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // All expenses (to calculate budget utilization across all time)
  const { data: allExpenses = [] } = useQuery<ExpenseRow[]>({
    queryKey: ["fin-all-expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("id, budget_id, amount, category, date")
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // 6-month sales for chart
  const { data: sixMonthSales = [] } = useQuery<SaleRow[]>({
    queryKey: ["fin-6m-sales"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("sale_date, total_amount, status")
        .gte("sale_date", sixAgo)
        .neq("status", "cancelled");
      if (error) throw error;
      return (data ?? []) as SaleRow[];
    },
  });

  // 6-month expenses for chart
  const { data: sixMonthExpenses = [] } = useQuery<ExpenseRow[]>({
    queryKey: ["fin-6m-expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expenses")
        .select("date, amount")
        .gte("date", sixAgo);
      if (error) throw error;
      return (data ?? []) as ExpenseRow[];
    },
  });

  // Finance ledger for the period (audit feed — period-filtered)
  const { data: periodLedger = [] } = useQuery<LedgerRow[]>({
    queryKey: ["fin-ledger", periodStart, periodEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finance_ledger")
        .select("id, entry_date, entry_type, source_type, description, amount, cost_center, reference_number")
        .gte("entry_date", periodStart)
        .lte("entry_date", periodEnd)
        .order("entry_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── KPI Derivations ──────────────────────────────────────────────────────────

  const kpi = useMemo(() => {
    // Sales revenue: all non-cancelled sales in period (total invoice value)
    const salesRevenue = periodSales.reduce((s, r) => s + Number(r.total_amount), 0);

    // Invoice revenue: formally issued invoices in period
    const invoiceRevenue = periodInvoices.reduce((s, r) => s + Number(r.total_amount), 0);

    // Total gross revenue
    const totalRevenue = salesRevenue + invoiceRevenue;

    // Cash collected: actual payments received in the period
    const cashFromSales = periodPayments.reduce((s, p) => s + Number(p.amount), 0);
    const cashFromInvoices = periodInvoices.reduce((s, inv) => s + Number(inv.amount_paid), 0);
    const totalCash = cashFromSales + cashFromInvoices;

    // Total expenses in period
    const totalExpenses = periodExpenses.reduce((s, e) => s + Number(e.amount), 0);

    // Net profit = gross revenue − expenses
    const netProfit = totalRevenue - totalExpenses;
    const margin    = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    // Outstanding receivables
    const totalOutstanding = outstandingInvoices
      .reduce((s, inv) => s + (Number(inv.total_amount) - Number(inv.amount_paid)), 0);
    const overdueCount = outstandingInvoices
      .filter(inv => differenceInDays(new Date(), parseISO(inv.issue_date)) > 30).length;

    // Budget utilization (all time, across all budgets)
    const totalBudgeted = allBudgets.reduce((s, b) => s + Number(b.total_budget), 0);
    const totalSpent    = allExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const budgetPct     = totalBudgeted > 0 ? Math.min((totalSpent / totalBudgeted) * 100, 100) : 0;

    return {
      salesRevenue, invoiceRevenue, totalRevenue,
      cashFromSales, cashFromInvoices, totalCash,
      totalExpenses, netProfit, margin,
      totalOutstanding, overdueCount,
      totalBudgeted, totalSpent, budgetPct,
    };
  }, [periodSales, periodPayments, periodExpenses, periodInvoices, outstandingInvoices, allBudgets, allExpenses]);

  // ── 6-month Chart Data ───────────────────────────────────────────────────────

  const chartData = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(today, 5 - i);
    const m = getMonth(d);
    const y = getYear(d);
    const label = format(d, "MMM");

    const sales = sixMonthSales
      .filter(s => getMonth(parseISO(s.sale_date)) === m && getYear(parseISO(s.sale_date)) === y)
      .reduce((acc, s) => acc + Number(s.total_amount), 0);

    const expenses = sixMonthExpenses
      .filter(e => getMonth(parseISO(e.date)) === m && getYear(parseISO(e.date)) === y)
      .reduce((acc, e) => acc + Number(e.amount), 0);

    return { name: label, "Sales Revenue": sales, Expenses: expenses };
  }), [sixMonthSales, sixMonthExpenses]);

  // ── Expense breakdown by category ───────────────────────────────────────────

  const expenseByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    periodExpenses.forEach(e => {
      map[e.category] = (map[e.category] ?? 0) + Number(e.amount);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [periodExpenses]);

  // ── Budget utilization per budget ────────────────────────────────────────────

  const budgetUtilization = useMemo(() => {
    return allBudgets.map(b => {
      const spent = allExpenses
        .filter(e => e.budget_id === b.id)
        .reduce((s, e) => s + Number(e.amount), 0);
      const pct   = b.total_budget > 0 ? Math.min((spent / Number(b.total_budget)) * 100, 100) : 0;
      const remaining = Math.max(Number(b.total_budget) - spent, 0);
      return { ...b, spent, pct, remaining };
    }).sort((a, b) => b.pct - a.pct);
  }, [allBudgets, allExpenses]);

  // ── Payment method totals ────────────────────────────────────────────────────

  const paymentsByMethod = useMemo(() => {
    const map: Record<string, number> = {};
    periodPayments.forEach(p => {
      const key = p.payment_method?.toLowerCase() ?? "other";
      map[key] = (map[key] ?? 0) + Number(p.amount);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [periodPayments]);

  // ── Aging summary ────────────────────────────────────────────────────────────

  const agingSummary = useMemo(() => {
    const buckets: Record<string, number> = {
      "0–30 days": 0, "31–60 days": 0, "61–90 days": 0, "90+ days": 0,
    };
    outstandingInvoices.forEach(inv => {
      const b = agingBucket(inv.issue_date);
      buckets[b] += Number(inv.total_amount) - Number(inv.amount_paid);
    });
    return buckets;
  }, [outstandingInvoices]);

  // ── KPI Card ─────────────────────────────────────────────────────────────────

  const KpiCard = ({
    title, value, sub, icon: Icon, color, trend,
  }: {
    title: string; value: string; sub?: string;
    icon: React.ElementType; color: string; trend?: "up" | "down" | "neutral";
  }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold tracking-tight">{value}</div>
        {sub && (
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            {trend === "up"   && <ArrowUpRight  className="h-3 w-3 text-green-600" />}
            {trend === "down" && <ArrowDownRight className="h-3 w-3 text-red-600" />}
            {sub}
          </p>
        )}
      </CardContent>
    </Card>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Page header + period picker */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Finance Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Unified view of revenue, cash, expenses, budgets and receivables
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevPeriod}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-3 text-sm font-medium min-w-32 text-center">{periodLabel}</span>
          <Button
            variant="ghost" size="icon" className="h-7 w-7" onClick={nextPeriod}
            disabled={format(subMonths(periodDate, -1), "yyyy-MM") > format(today, "yyyy-MM")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          title="Gross Revenue"
          value={formatNairaCompact(kpi.totalRevenue)}
          sub={`Sales ₦${(kpi.salesRevenue / 1000).toFixed(0)}k · Inv ₦${(kpi.invoiceRevenue / 1000).toFixed(0)}k`}
          icon={TrendingUp}
          color="bg-green-100 text-green-700"
          trend="up"
        />
        <KpiCard
          title="Cash Collected"
          value={formatNairaCompact(kpi.totalCash)}
          sub={`Sales ₦${(kpi.cashFromSales / 1000).toFixed(0)}k · Inv ₦${(kpi.cashFromInvoices / 1000).toFixed(0)}k`}
          icon={Banknote}
          color="bg-blue-100 text-blue-700"
          trend="up"
        />
        <KpiCard
          title="Total Expenses"
          value={formatNairaCompact(kpi.totalExpenses)}
          sub={`${periodExpenses.length} expense entries`}
          icon={TrendingDown}
          color="bg-red-100 text-red-700"
          trend="down"
        />
        <KpiCard
          title="Net Profit"
          value={formatNairaCompact(kpi.netProfit)}
          sub={kpi.totalRevenue > 0 ? `${kpi.margin.toFixed(1)}% margin` : "No revenue yet"}
          icon={kpi.netProfit >= 0 ? DollarSign : AlertCircle}
          color={kpi.netProfit >= 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}
        />
        <KpiCard
          title="Receivables"
          value={formatNairaCompact(kpi.totalOutstanding)}
          sub={`${outstandingInvoices.length} invoices · ${kpi.overdueCount} overdue`}
          icon={CreditCard}
          color={kpi.overdueCount > 0 ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}
          trend={kpi.overdueCount > 0 ? "down" : "neutral"}
        />
        <KpiCard
          title="Budget Used"
          value={`${kpi.budgetPct.toFixed(0)}%`}
          sub={`${formatNairaCompact(kpi.totalSpent)} of ${formatNairaCompact(kpi.totalBudgeted)}`}
          icon={Target}
          color={kpi.budgetPct > 90 ? "bg-red-100 text-red-700" : kpi.budgetPct > 70 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}
          trend={kpi.budgetPct > 80 ? "down" : "neutral"}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" />Overview
          </TabsTrigger>
          <TabsTrigger value="payments">
            <Banknote className="h-3.5 w-3.5 mr-1.5" />Payments
            {periodPayments.length > 0 && (
              <Badge className="ml-1.5 text-[10px] px-1.5 py-0 bg-blue-500">{periodPayments.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="expenses">
            <Receipt className="h-3.5 w-3.5 mr-1.5" />Expenses & Budgets
          </TabsTrigger>
          <TabsTrigger value="receivables">
            <FileText className="h-3.5 w-3.5 mr-1.5" />Receivables
            {outstandingInvoices.length > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0">
                {outstandingInvoices.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="feed">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />Finance Feed
          </TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="space-y-4 mt-4">

          {/* 6-month chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sales Revenue vs Expenses — Last 6 Months</CardTitle>
              <CardDescription>Monthly sales revenue from all sales records against total expenses</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={v => `₦${(v / 1000).toFixed(0)}k`} fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number) => formatNairaCompact(v)} contentStyle={{ borderRadius: "0.75rem", border: "1px solid hsl(var(--border))" }} />
                  <Legend />
                  <Bar dataKey="Sales Revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Expenses"      fill="hsl(0, 72%, 55%)"    radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* 3-col summary grid */}
          <div className="grid md:grid-cols-3 gap-4">

            {/* Revenue split */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-600" />Revenue Split — {periodLabel}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <ShoppingCart className="h-3.5 w-3.5" />Sales ({periodSales.length})
                  </span>
                  <span className="font-semibold">{formatNairaCompact(kpi.salesRevenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />Invoices ({periodInvoices.length})
                  </span>
                  <span className="font-semibold">{formatNairaCompact(kpi.invoiceRevenue)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>Total</span>
                  <span className="text-green-700">{formatNairaCompact(kpi.totalRevenue)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Cash split */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Banknote className="h-4 w-4 text-blue-600" />Cash Collected — {periodLabel}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <ShoppingCart className="h-3.5 w-3.5" />From Sales ({periodPayments.length} payments)
                  </span>
                  <span className="font-semibold">{formatNairaCompact(kpi.cashFromSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />From Invoices
                  </span>
                  <span className="font-semibold">{formatNairaCompact(kpi.cashFromInvoices)}</span>
                </div>
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>Total</span>
                  <span className="text-blue-700">{formatNairaCompact(kpi.totalCash)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Receivables aging */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />Receivables Aging
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {Object.entries(agingSummary).map(([bucket, amount]) => (
                  <div key={bucket} className="flex items-center justify-between">
                    <Badge variant="outline" className={`text-xs ${agingColor[bucket]}`}>{bucket}</Badge>
                    <span className={`font-semibold ${amount > 0 ? "" : "text-muted-foreground"}`}>
                      {amount > 0 ? formatNairaCompact(amount) : "—"}
                    </span>
                  </div>
                ))}
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>Total</span>
                  <span>{formatNairaCompact(kpi.totalOutstanding)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Expense categories */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Top Expense Categories — {periodLabel}</CardTitle>
              <CardDescription>Breakdown of {periodExpenses.length} expense records totalling {formatNairaCompact(kpi.totalExpenses)}</CardDescription>
            </CardHeader>
            <CardContent>
              {expenseByCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No expenses recorded this period.</p>
              ) : (
                <div className="space-y-3">
                  {expenseByCategory.map(([cat, amt]) => {
                    const pct = kpi.totalExpenses > 0 ? (amt / kpi.totalExpenses) * 100 : 0;
                    return (
                      <div key={cat} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="capitalize text-muted-foreground">{cat}</span>
                          <span className="font-medium">{formatNairaCompact(amt)} <span className="text-xs text-muted-foreground">({pct.toFixed(0)}%)</span></span>
                        </div>
                        <Progress value={pct} className="h-1.5" />
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Payments ── */}
        <TabsContent value="payments" className="mt-4 space-y-4">

          {/* Payment method summary */}
          {paymentsByMethod.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {paymentsByMethod.map(([method, total]) => (
                <Card key={method}>
                  <CardContent className="pt-4 pb-3">
                    <Badge className={`text-xs capitalize mb-2 ${payMethodColor[method] ?? "bg-muted text-muted-foreground"}`}>
                      {method}
                    </Badge>
                    <p className="text-lg font-bold">{formatNairaCompact(total)}</p>
                    <p className="text-xs text-muted-foreground">
                      {periodPayments.filter(p => (p.payment_method?.toLowerCase() ?? "other") === method).length} payments
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">All Payments — {periodLabel}</CardTitle>
              <CardDescription>
                {periodPayments.length} payment{periodPayments.length !== 1 ? "s" : ""} · Total: {formatNairaCompact(kpi.cashFromSales)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {periodPayments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No payments recorded this period.</p>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Sale #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {periodPayments.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {p.payment_date ? format(parseISO(p.payment_date), "dd MMM yyyy") : "—"}
                          </TableCell>
                          <TableCell className="font-medium max-w-24 truncate">
                            {p.sales?.customer_name ?? "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{p.sales?.sale_number ?? "—"}</TableCell>
                          <TableCell>
                            <span className="text-xs capitalize text-muted-foreground">
                              {p.sales?.sale_type ?? "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge className={`text-xs capitalize ${payMethodColor[p.payment_method?.toLowerCase() ?? ""] ?? "bg-muted text-muted-foreground"}`}>
                              {p.payment_method}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {p.bank_reference ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatNairaCompact(Number(p.amount))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Expenses & Budgets ── */}
        <TabsContent value="expenses" className="mt-4 space-y-4">

          {/* Budget utilization */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4" />Budget Utilization
              </CardTitle>
              <CardDescription>
                {allBudgets.length} budget{allBudgets.length !== 1 ? "s" : ""} · {formatNairaCompact(kpi.totalSpent)} spent of {formatNairaCompact(kpi.totalBudgeted)} allocated
              </CardDescription>
            </CardHeader>
            <CardContent>
              {budgetUtilization.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No budgets created yet.</p>
              ) : (
                <div className="space-y-4">
                  {budgetUtilization.map(b => (
                    <div key={b.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{b.title}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{b.type}</Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatNairaCompact(b.spent)} / {formatNairaCompact(Number(b.total_budget))}
                        </span>
                      </div>
                      <Progress
                        value={b.pct}
                        className={`h-2 ${b.pct > 90 ? "[&>div]:bg-red-500" : b.pct > 70 ? "[&>div]:bg-amber-500" : "[&>div]:bg-green-500"}`}
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{b.pct.toFixed(0)}% used</span>
                        <span className={b.remaining > 0 ? "text-green-600" : "text-red-600"}>
                          {b.remaining > 0 ? `${formatNairaCompact(b.remaining)} remaining` : "Over budget"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Expense table for period */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" />Expense Records — {periodLabel}
              </CardTitle>
              <CardDescription>
                {periodExpenses.length} expense{periodExpenses.length !== 1 ? "s" : ""} · Total: {formatNairaCompact(kpi.totalExpenses)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {periodExpenses.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No expenses recorded this period.</p>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="hidden md:table-cell">Account Type</TableHead>
                        <TableHead className="hidden lg:table-cell">Cost Centre</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {periodExpenses.map(e => (
                        <TableRow key={e.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(parseISO(e.date), "dd MMM yyyy")}
                          </TableCell>
                          <TableCell className="max-w-40 truncate text-sm">{e.description}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize">{e.category}</Badge>
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground capitalize">
                            {e.account_type ?? "—"}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                            {e.cost_center ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-red-700">
                            {formatNairaCompact(Number(e.amount))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Receivables ── */}
        <TabsContent value="receivables" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Accounts Receivable</CardTitle>
              <CardDescription>
                {outstandingInvoices.length} outstanding invoice{outstandingInvoices.length !== 1 ? "s" : ""} · Total owed: {formatNairaCompact(kpi.totalOutstanding)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {outstandingInvoices.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No outstanding invoices. All invoices are paid.</p>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="hidden md:table-cell">Issued</TableHead>
                        <TableHead>Billed</TableHead>
                        <TableHead>Received</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                        <TableHead>Age</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outstandingInvoices.map(inv => {
                        const outstanding = Number(inv.total_amount) - Number(inv.amount_paid);
                        const bucket = agingBucket(inv.issue_date);
                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="font-mono text-xs font-semibold">
                              {inv.invoice_number ?? inv.quotation_number}
                            </TableCell>
                            <TableCell className="font-medium max-w-28 truncate">{inv.customer_name}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 text-xs capitalize">
                                {inv.invoice_type === "event"
                                  ? <CalendarDays className="h-3.5 w-3.5 text-purple-500" />
                                  : <ShoppingCart  className="h-3.5 w-3.5 text-blue-500" />}
                                {inv.invoice_type.replace("_", " ")}
                              </div>
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                              {format(parseISO(inv.issue_date), "dd MMM yyyy")}
                            </TableCell>
                            <TableCell className="text-sm">{formatNairaCompact(Number(inv.total_amount))}</TableCell>
                            <TableCell className="text-sm text-green-700">
                              {Number(inv.amount_paid) > 0 ? formatNairaCompact(Number(inv.amount_paid)) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-semibold">{formatNairaCompact(outstanding)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`text-xs ${agingColor[bucket]}`}>{bucket}</Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Finance Feed ── */}
        <TabsContent value="feed" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Finance Ledger — {periodLabel}</CardTitle>
              <CardDescription>
                Append-only audit trail of all recognised revenue and payment receipts for this period
              </CardDescription>
            </CardHeader>
            <CardContent>
              {periodLedger.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">
                  No ledger entries for this period. Post an invoice to finance or record a sale payment to begin.
                </p>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="hidden md:table-cell">Ref</TableHead>
                        <TableHead className="hidden lg:table-cell">Cost Centre</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {periodLedger.map(entry => (
                        <TableRow key={entry.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(parseISO(entry.entry_date), "dd MMM yyyy")}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${entry.entry_type === "payment_received" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                              {entry.entry_type === "payment_received" ? "Payment" : "Revenue"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground capitalize">{entry.source_type}</TableCell>
                          <TableCell className="max-w-48 truncate text-sm">{entry.description}</TableCell>
                          <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                            {entry.reference_number ?? "—"}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                            {entry.cost_center ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatNairaCompact(Number(entry.amount))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
