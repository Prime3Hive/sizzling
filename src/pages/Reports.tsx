import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Progress } from "@/components/ui/progress";
import {
  BarChart3, Download, TrendingUp, TrendingDown, Calendar, DollarSign,
  Banknote, CreditCard, Wallet, Receipt, FileText, ShoppingCart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatNairaCompact, formatNairaShort } from "@/lib/currency";
import { format } from "date-fns";

const RANGE_LABELS: Record<string, string> = {
  "current-week": "This Week",
  "current-month": "This Month",
  "last-month": "Last Month",
  "current-year": "This Year",
  custom: "Custom Range",
};

const Reports = () => {
  const { toast } = useToast();
  const [timeRange, setTimeRange] = useState("current-month");
  const [customStart, setCustomStart] = useState<Date>();
  const [customEnd, setCustomEnd] = useState<Date>();

  const { start, end } = useMemo(() => {
    const now = new Date();
    let s: Date, e: Date;
    switch (timeRange) {
      case "current-week": {
        const day = now.getDay();
        const offset = day === 0 ? 6 : day - 1;
        s = new Date(now); s.setDate(now.getDate() - offset);
        e = new Date(s); e.setDate(s.getDate() + 6); break;
      }
      case "last-month":
        s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        e = new Date(now.getFullYear(), now.getMonth(), 0); break;
      case "current-year":
        s = new Date(now.getFullYear(), 0, 1);
        e = new Date(now.getFullYear(), 11, 31); break;
      case "custom":
        s = customStart || new Date(now.getFullYear(), now.getMonth(), 1);
        e = customEnd || new Date(now.getFullYear(), now.getMonth() + 1, 0); break;
      case "current-month":
      default:
        s = new Date(now.getFullYear(), now.getMonth(), 1);
        e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }
    return { start: s.toISOString().split("T")[0], end: e.toISOString().split("T")[0] };
  }, [timeRange, customStart, customEnd]);

  // ── Queries (company-wide finance) ──
  const { data: invoices = [] } = useQuery({
    queryKey: ["rep-invoices", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices")
        .select("total_amount, invoice_type, issue_date, status")
        .eq("status", "invoice").gte("issue_date", start).lte("issue_date", end);
      if (error) throw error; return data || [];
    },
  });
  const { data: sales = [] } = useQuery({
    queryKey: ["rep-sales", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales")
        .select("total_amount, sale_date, status").neq("status", "cancelled")
        .gte("sale_date", start).lte("sale_date", end);
      if (error) throw error; return data || [];
    },
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ["rep-expenses", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.from("expenses")
        .select("amount, category, account_type, date").gte("date", start).lte("date", end);
      if (error) throw error; return data || [];
    },
  });
  const { data: payroll = [] } = useQuery({
    queryKey: ["rep-payroll", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.from("payroll_records")
        .select("net_pay, status, period_start").eq("status", "paid")
        .gte("period_start", start).lte("period_start", end);
      if (error) throw error; return data || [];
    },
  });
  const { data: salePayments = [] } = useQuery({
    queryKey: ["rep-sale-payments", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments")
        .select("amount, payment_date, status").eq("status", "completed")
        .gte("payment_date", start).lte("payment_date", end);
      if (error) throw error; return data || [];
    },
  });
  const { data: invoiceReceipts = [] } = useQuery({
    queryKey: ["rep-invoice-receipts", start, end],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("invoice_payments")
        .select("amount, payment_date").gte("payment_date", start).lte("payment_date", end);
      if (error) throw error; return data || [];
    },
  });
  const { data: outstanding = [] } = useQuery({
    queryKey: ["rep-outstanding"],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices")
        .select("total_amount, amount_paid, payment_status, status")
        .eq("status", "invoice").in("payment_status", ["unpaid", "partial"]);
      if (error) throw error; return data || [];
    },
  });

  // ── Derived ──
  const r = useMemo(() => {
    const invoiceRevenue = invoices.reduce((s: number, i: any) => s + Number(i.total_amount), 0);
    const eventRevenue = invoices.filter((i: any) => i.invoice_type === "event").reduce((s: number, i: any) => s + Number(i.total_amount), 0);
    const dailyInvoiceRevenue = invoiceRevenue - eventRevenue;
    const salesRevenue = sales.reduce((s: number, x: any) => s + Number(x.total_amount), 0);
    const grossRevenue = invoiceRevenue + salesRevenue;

    const cogs = expenses.filter((e: any) => (e.account_type || "COGS") === "COGS").reduce((s: number, e: any) => s + Number(e.amount), 0);
    const opex = expenses.filter((e: any) => e.account_type === "OpEX").reduce((s: number, e: any) => s + Number(e.amount), 0);
    const otherExp = expenses.filter((e: any) => e.account_type && e.account_type !== "COGS" && e.account_type !== "OpEX").reduce((s: number, e: any) => s + Number(e.amount), 0);
    const expenseTotal = expenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
    const payrollCost = payroll.reduce((s: number, p: any) => s + Number(p.net_pay), 0);

    const grossProfit = grossRevenue - cogs;
    const totalCosts = expenseTotal + payrollCost;
    const netProfit = grossRevenue - totalCosts;
    const margin = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

    const cashCollected =
      salePayments.reduce((s: number, p: any) => s + Number(p.amount), 0) +
      invoiceReceipts.reduce((s: number, p: any) => s + Number(p.amount), 0);

    const receivables = outstanding.reduce((s: number, i: any) => s + (Number(i.total_amount) - Number(i.amount_paid)), 0);

    const byCat: Record<string, number> = {};
    expenses.forEach((e: any) => { byCat[e.category] = (byCat[e.category] ?? 0) + Number(e.amount); });
    if (payrollCost > 0) byCat["payroll"] = (byCat["payroll"] ?? 0) + payrollCost;
    const expenseByCategory = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

    return {
      invoiceRevenue, eventRevenue, dailyInvoiceRevenue, salesRevenue, grossRevenue,
      cogs, opex, otherExp, expenseTotal, payrollCost, totalCosts,
      grossProfit, netProfit, margin, cashCollected, receivables, expenseByCategory,
    };
  }, [invoices, sales, expenses, payroll, salePayments, invoiceReceipts, outstanding]);

  const rangeLabel = RANGE_LABELS[timeRange] ?? "This Month";

  const exportCSV = () => {
    const rows: string[] = [];
    rows.push("Finance Report");
    rows.push(`Period,${start} to ${end} (${rangeLabel})`);
    rows.push("");
    rows.push("Income Statement,Amount (NGN)");
    rows.push(`Invoice Revenue,${r.invoiceRevenue.toFixed(2)}`);
    rows.push(`  Daily Sales Invoices,${r.dailyInvoiceRevenue.toFixed(2)}`);
    rows.push(`  Event Invoices,${r.eventRevenue.toFixed(2)}`);
    rows.push(`Legacy Sales Revenue,${r.salesRevenue.toFixed(2)}`);
    rows.push(`Gross Revenue,${r.grossRevenue.toFixed(2)}`);
    rows.push(`Cost of Goods Sold,${r.cogs.toFixed(2)}`);
    rows.push(`Gross Profit,${r.grossProfit.toFixed(2)}`);
    rows.push(`Operating Expenses,${r.opex.toFixed(2)}`);
    rows.push(`Payroll,${r.payrollCost.toFixed(2)}`);
    rows.push(`Other Expenses,${r.otherExp.toFixed(2)}`);
    rows.push(`Total Costs,${r.totalCosts.toFixed(2)}`);
    rows.push(`Net Profit,${r.netProfit.toFixed(2)}`);
    rows.push(`Net Margin %,${r.margin.toFixed(1)}`);
    rows.push("");
    rows.push("Cash & Receivables,Amount (NGN)");
    rows.push(`Cash Collected,${r.cashCollected.toFixed(2)}`);
    rows.push(`Outstanding Receivables,${r.receivables.toFixed(2)}`);
    rows.push("");
    rows.push("Expense Breakdown,Amount (NGN)");
    r.expenseByCategory.forEach(([cat, amt]) => rows.push(`${cat},${amt.toFixed(2)}`));

    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-report-${start}_to_${end}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast({ title: "Finance report exported", description: "Downloaded as CSV." });
  };

  const Kpi = ({ label, value, sub, icon: Icon, accent, valueClass }: any) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${accent}`}><Icon className="h-4 w-4" /></div>
      </CardHeader>
      <CardContent>
        <div className={`text-xl font-bold ${valueClass ?? ""}`}>{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />Finance Report
          </h1>
          <p className="text-muted-foreground">Revenue, costs, profit, cash and receivables for the selected period.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="current-week">This Week</SelectItem>
              <SelectItem value="current-month">This Month</SelectItem>
              <SelectItem value="last-month">Last Month</SelectItem>
              <SelectItem value="current-year">This Year</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
          {timeRange === "custom" && (
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-36 justify-start text-left font-normal">
                    <Calendar className="mr-2 h-4 w-4" />{customStart ? format(customStart, "MMM d, yyyy") : "Start"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent mode="single" selected={customStart} onSelect={setCustomStart} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-36 justify-start text-left font-normal">
                    <Calendar className="mr-2 h-4 w-4" />{customEnd ? format(customEnd, "MMM d, yyyy") : "End"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent mode="single" selected={customEnd} onSelect={setCustomEnd} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          )}
          <Button onClick={exportCSV} variant="outline">
            <Download className="h-4 w-4 mr-2" />Export CSV
          </Button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Gross Revenue" value={formatNairaCompact(r.grossRevenue)} sub={rangeLabel} icon={DollarSign} accent="bg-green-100 text-green-700" />
        <Kpi label="Net Profit" value={`${r.netProfit < 0 ? "−" : ""}${formatNairaCompact(Math.abs(r.netProfit))}`} sub={`${r.margin.toFixed(1)}% margin`} icon={r.netProfit >= 0 ? TrendingUp : TrendingDown} accent={r.netProfit >= 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"} valueClass={r.netProfit >= 0 ? "text-success" : "text-destructive"} />
        <Kpi label="Cash Collected" value={formatNairaCompact(r.cashCollected)} sub="Received in period" icon={Banknote} accent="bg-blue-100 text-blue-700" />
        <Kpi label="Receivables" value={formatNairaCompact(r.receivables)} sub="Outstanding now" icon={CreditCard} accent="bg-amber-100 text-amber-700" />
        <Kpi label="Total Costs" value={formatNairaCompact(r.totalCosts)} sub={`Exp ${formatNairaShort(r.expenseTotal)} · Pay ${formatNairaShort(r.payrollCost)}`} icon={Receipt} accent="bg-red-100 text-red-700" />
        <Kpi label="Payroll" value={formatNairaCompact(r.payrollCost)} sub={rangeLabel} icon={Wallet} accent="bg-orange-100 text-orange-700" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Income statement summary */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Income Statement — {rangeLabel}</CardTitle>
            <CardDescription>{start} to {end}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm max-w-lg">
              <Line label="Invoice Revenue" value={r.invoiceRevenue} />
              <Sub label="Daily Sales Invoices" value={r.dailyInvoiceRevenue} />
              <Sub label="Event Invoices" value={r.eventRevenue} />
              <Line label="Legacy Sales Revenue" value={r.salesRevenue} />
              <Total label="Gross Revenue" value={r.grossRevenue} />
              <Line label="Cost of Goods Sold" value={-r.cogs} neg />
              <Total label="Gross Profit" value={r.grossProfit} />
              <Line label="Operating Expenses" value={-r.opex} neg />
              <Line label="Payroll" value={-r.payrollCost} neg />
              {r.otherExp > 0 && <Line label="Other Expenses" value={-r.otherExp} neg />}
              <div className="border-t-2 pt-2 flex justify-between font-bold text-base">
                <span>Net {r.netProfit >= 0 ? "Profit" : "Loss"}</span>
                <span className={r.netProfit >= 0 ? "text-success" : "text-destructive"}>
                  {r.netProfit < 0 ? "−" : ""}{formatNairaCompact(Math.abs(r.netProfit))}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Expense breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Expense Breakdown</CardTitle>
            <CardDescription>{rangeLabel} · {formatNairaCompact(r.totalCosts)}</CardDescription>
          </CardHeader>
          <CardContent>
            {r.expenseByCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No costs in this period.</p>
            ) : (
              <div className="space-y-3">
                {r.expenseByCategory.slice(0, 8).map(([cat, amt]) => {
                  const pct = r.totalCosts > 0 ? (amt / r.totalCosts) * 100 : 0;
                  return (
                    <div key={cat} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="capitalize text-muted-foreground truncate">{cat}</span>
                        <span className="font-medium shrink-0 ml-2">{formatNairaShort(amt)}</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue split + cash */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-green-600" />Revenue Split</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />Invoices</span><span className="font-semibold">{formatNairaCompact(r.invoiceRevenue)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground flex items-center gap-1.5"><ShoppingCart className="h-3.5 w-3.5" />Legacy Sales</span><span className="font-semibold">{formatNairaCompact(r.salesRevenue)}</span></div>
            <div className="border-t pt-2 flex justify-between font-bold"><span>Total</span><span className="text-green-700">{formatNairaCompact(r.grossRevenue)}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Banknote className="h-4 w-4 text-blue-600" />Cash Position</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Cash Collected ({rangeLabel})</span><span className="font-semibold">{formatNairaCompact(r.cashCollected)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Outstanding Receivables</span><span className="font-semibold text-amber-600">{formatNairaCompact(r.receivables)}</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// Small statement-line helpers
const Line = ({ label, value, neg }: { label: string; value: number; neg?: boolean }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground">{label}</span>
    <span className={neg ? "text-destructive" : ""}>{value < 0 ? "−" : ""}{formatNairaCompact(Math.abs(value))}</span>
  </div>
);
const Sub = ({ label, value }: { label: string; value: number }) => (
  <div className="flex justify-between text-xs pl-3">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-muted-foreground">{formatNairaCompact(value)}</span>
  </div>
);
const Total = ({ label, value }: { label: string; value: number }) => (
  <div className="border-t pt-2 flex justify-between font-semibold">
    <span>{label}</span>
    <span className={value >= 0 ? "text-success" : "text-destructive"}>{value < 0 ? "−" : ""}{formatNairaCompact(Math.abs(value))}</span>
  </div>
);

export default Reports;
