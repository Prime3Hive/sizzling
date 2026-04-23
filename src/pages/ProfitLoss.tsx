import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowDown, ArrowUp, TrendingUp, TrendingDown, DollarSign, BarChart3, FileSpreadsheet, BookOpen, ShoppingCart, Users } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { formatNairaCompact } from '@/lib/currency';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, Area, AreaChart } from 'recharts';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import MonthlyExpenseLedger from '@/components/profitloss/MonthlyExpenseLedger';
import WeeklySalesEntry from '@/components/profitloss/WeeklySalesEntry';
import { MONTHS } from '@/lib/expenseConstants';

interface MonthlyPL {
  month: string;
  monthIndex: number;
  dailySales: number;
  eventSales: number;
  invoiceRevenue: number;
  totalSales: number;
  dailyCOGS: number;
  eventCOGS: number;
  totalCOGS: number;
  dailyGrossProfit: number;
  eventGrossProfit: number;
  totalGrossProfit: number;
  dailyOpEX: number;
  eventOpEX: number;
  payrollOpEX: number;
  totalOpEX: number;
  dailyNetProfit: number;
  eventNetProfit: number;
  totalNetProfit: number;
  profitMargin: number;
}

const ProfitLoss = () => {
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [plFilter, setPlFilter] = useState<'all' | 'daily' | 'event'>('all');
  const yearNum = parseInt(selectedYear);

  const yearStart = `${selectedYear}-01-01`;
  const yearEnd = `${selectedYear}-12-31`;

  // Fetch sales data
  const { data: sales = [], isLoading: salesLoading, refetch: refetchSales } = useQuery({
    queryKey: ['pl-sales', selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('id, sale_date, sale_number, total_amount, sale_type, status, customer_name, notes')
        .gte('sale_date', yearStart)
        .lte('sale_date', yearEnd)
        .order('sale_date');
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch expenses data
  const { data: expenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ['pl-expenses', selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id, date, amount, category, account_type, cost_center, description, payment_method, bank_account')
        .gte('date', yearStart)
        .lte('date', yearEnd)
        .order('date');
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch finance ledger invoice revenue for the year
  const { data: invoiceLedger = [], isLoading: invoiceLedgerLoading } = useQuery({
    queryKey: ['pl-invoice-ledger', selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('finance_ledger')
        .select('entry_date, amount, invoice_type, cost_center')
        .eq('entry_type', 'revenue')
        .eq('source_type', 'invoice')
        .gte('entry_date', yearStart)
        .lte('entry_date', yearEnd);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch paid payroll records for the year
  const { data: payrollRecords = [], isLoading: payrollLoading } = useQuery({
    queryKey: ['pl-payroll', selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_records')
        .select('id, staff_name, net_pay, status, period_start, period_end, paid_at')
        .eq('status', 'paid')
        .gte('period_start', yearStart)
        .lte('period_end', yearEnd);
      if (error) throw error;
      return data || [];
    },
  });

  const isLoading = salesLoading || expensesLoading || payrollLoading || invoiceLedgerLoading;

  // Compute monthly P&L (includes payroll as OpEX and invoice revenue from ledger)
  const monthlyData: MonthlyPL[] = useMemo(() => {
    return MONTHS.map((month, index) => {
      const monthSales    = sales.filter(s => new Date(s.sale_date).getMonth() === index);
      const monthExpenses = expenses.filter(e => new Date(e.date).getMonth() === index);
      const monthPayroll  = payrollRecords.filter(p => new Date(p.period_start).getMonth() === index);
      const monthInvoices = invoiceLedger.filter(l => new Date(l.entry_date).getMonth() === index);

      const dailySales = monthSales
        .filter(s => (s.sale_type || 'daily') === 'daily')
        .reduce((sum, s) => sum + Number(s.total_amount), 0);
      const eventSales = monthSales
        .filter(s => s.sale_type === 'event')
        .reduce((sum, s) => sum + Number(s.total_amount), 0);
      const invoiceRevenue = monthInvoices.reduce((sum, l) => sum + Number(l.amount), 0);
      const totalSales = dailySales + eventSales + invoiceRevenue;

      const dailyCOGS = monthExpenses
        .filter(e => (e.account_type || 'COGS') === 'COGS' && (e.cost_center || 'Daily Orders') !== 'Event Account')
        .reduce((sum, e) => sum + Number(e.amount), 0);
      const eventCOGS = monthExpenses
        .filter(e => (e.account_type || 'COGS') === 'COGS' && e.cost_center === 'Event Account')
        .reduce((sum, e) => sum + Number(e.amount), 0);
      const totalCOGS = dailyCOGS + eventCOGS;

      const dailyGrossProfit = dailySales - dailyCOGS;
      const eventGrossProfit = eventSales - eventCOGS;
      const totalGrossProfit = totalSales - totalCOGS;

      const dailyOpEX = monthExpenses
        .filter(e => e.account_type === 'OpEX' && (e.cost_center || 'Daily Orders') !== 'Event Account')
        .reduce((sum, e) => sum + Number(e.amount), 0);
      const eventOpEX = monthExpenses
        .filter(e => e.account_type === 'OpEX' && e.cost_center === 'Event Account')
        .reduce((sum, e) => sum + Number(e.amount), 0);
      
      // Paid payroll counts as OpEX
      const payrollOpEX = monthPayroll.reduce((sum, p) => sum + Number(p.net_pay), 0);
      const totalOpEX = dailyOpEX + eventOpEX + payrollOpEX;

      const dailyNetProfit = dailyGrossProfit - dailyOpEX;
      const eventNetProfit = eventGrossProfit - eventOpEX;
      const totalNetProfit = totalGrossProfit - totalOpEX;

      const profitMargin = totalSales > 0 ? (totalNetProfit / totalSales) * 100 : 0;

      return {
        month, monthIndex: index,
        dailySales, eventSales, invoiceRevenue, totalSales,
        dailyCOGS, eventCOGS, totalCOGS,
        dailyGrossProfit, eventGrossProfit, totalGrossProfit,
        dailyOpEX, eventOpEX, payrollOpEX, totalOpEX,
        dailyNetProfit, eventNetProfit, totalNetProfit,
        profitMargin,
      };
    });
  }, [sales, expenses, payrollRecords]);

  // Totals row
  const totals = useMemo(() => {
    return monthlyData.reduce((acc, m) => ({
      dailySales: acc.dailySales + m.dailySales,
      eventSales: acc.eventSales + m.eventSales,
      invoiceRevenue: acc.invoiceRevenue + m.invoiceRevenue,
      totalSales: acc.totalSales + m.totalSales,
      dailyCOGS: acc.dailyCOGS + m.dailyCOGS,
      eventCOGS: acc.eventCOGS + m.eventCOGS,
      totalCOGS: acc.totalCOGS + m.totalCOGS,
      dailyGrossProfit: acc.dailyGrossProfit + m.dailyGrossProfit,
      eventGrossProfit: acc.eventGrossProfit + m.eventGrossProfit,
      totalGrossProfit: acc.totalGrossProfit + m.totalGrossProfit,
      dailyOpEX: acc.dailyOpEX + m.dailyOpEX,
      eventOpEX: acc.eventOpEX + m.eventOpEX,
      payrollOpEX: acc.payrollOpEX + m.payrollOpEX,
      totalOpEX: acc.totalOpEX + m.totalOpEX,
      dailyNetProfit: acc.dailyNetProfit + m.dailyNetProfit,
      eventNetProfit: acc.eventNetProfit + m.eventNetProfit,
      totalNetProfit: acc.totalNetProfit + m.totalNetProfit,
    }), {
      dailySales: 0, eventSales: 0, invoiceRevenue: 0, totalSales: 0,
      dailyCOGS: 0, eventCOGS: 0, totalCOGS: 0,
      dailyGrossProfit: 0, eventGrossProfit: 0, totalGrossProfit: 0,
      dailyOpEX: 0, eventOpEX: 0, payrollOpEX: 0, totalOpEX: 0,
      dailyNetProfit: 0, eventNetProfit: 0, totalNetProfit: 0,
    });
  }, [monthlyData]);

  const totalProfitMargin = totals.totalSales > 0 ? (totals.totalNetProfit / totals.totalSales) * 100 : 0;

  // Chart data
  const chartData = monthlyData.map(m => ({
    name: m.month.substring(0, 3),
    'Revenue': m.totalSales,
    'COGS': m.totalCOGS,
    'Gross Profit': m.totalGrossProfit,
    'Net Profit': m.totalNetProfit,
    'OpEX': m.totalOpEX,
  }));

  const exportToExcel = () => {
    const headers = [
      'MONTH', 'DAILY SALES', 'EVENT SALES', 'INVOICE REVENUE', 'TOTAL SALES',
      'DAILY COGS', 'EVENT COGS', 'TOTAL COGS',
      'GROSS PROFIT', 'EXPENSE OpEX', 'PAYROLL OpEX', 'TOTAL OpEX',
      'NET PROFIT/LOSS', 'MARGIN',
    ];

    const rows = monthlyData.map(m => [
      m.month, m.dailySales, m.eventSales, m.invoiceRevenue, m.totalSales,
      m.dailyCOGS, m.eventCOGS, m.totalCOGS,
      m.totalGrossProfit, m.dailyOpEX + m.eventOpEX, m.payrollOpEX, m.totalOpEX,
      m.totalNetProfit, m.profitMargin > 0 ? `${m.profitMargin.toFixed(1)}%` : '',
    ]);

    rows.push([
      'TOTAL', totals.dailySales, totals.eventSales, totals.invoiceRevenue, totals.totalSales,
      totals.dailyCOGS, totals.eventCOGS, totals.totalCOGS,
      totals.totalGrossProfit, totals.dailyOpEX + totals.eventOpEX, totals.payrollOpEX, totals.totalOpEX,
      totals.totalNetProfit, `${totalProfitMargin.toFixed(1)}%`,
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'P&L Dashboard');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([wbout], { type: 'application/octet-stream' }), `PL_Dashboard_${selectedYear}.xlsx`);
  };

  const ValueCell = ({ value, isCurrency = true }: { value: number; isCurrency?: boolean }) => (
    <span className={value < 0 ? 'text-destructive font-semibold' : value > 0 ? 'text-success font-semibold' : 'text-muted-foreground'}>
      {isCurrency ? (value < 0 ? `-${formatNairaCompact(Math.abs(value))}` : formatNairaCompact(value)) : `${value.toFixed(1)}%`}
    </span>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Profit & Loss Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">Financial performance overview — {selectedYear}</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={plFilter} onValueChange={(v: 'all' | 'daily' | 'event') => setPlFilter(v)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All P&L</SelectItem>
              <SelectItem value="daily">Daily Sales</SelectItem>
              <SelectItem value="event">Events</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportToExcel} className="shadow-card">
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="shadow-card hover:shadow-card-hover transition-shadow border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {plFilter === 'all' ? 'Revenue' : plFilter === 'daily' ? 'Daily Revenue' : 'Event Revenue'}
            </CardTitle>
            <div className="h-8 w-8 rounded-lg bg-gradient-primary flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-primary-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {formatNairaCompact(plFilter === 'daily' ? totals.dailySales : plFilter === 'event' ? totals.eventSales : totals.totalSales)}
            </div>
            {plFilter === 'all' && (
              <div className="flex gap-2 mt-1">
                <span className="text-xs text-muted-foreground">Daily: {formatNairaCompact(totals.dailySales)}</span>
                <span className="text-xs text-muted-foreground">•</span>
                <span className="text-xs text-muted-foreground">Event: {formatNairaCompact(totals.eventSales)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card hover:shadow-card-hover transition-shadow border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">COGS</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center">
              <ArrowDown className="h-4 w-4 text-destructive" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {formatNairaCompact(plFilter === 'daily' ? totals.dailyCOGS : plFilter === 'event' ? totals.eventCOGS : totals.totalCOGS)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {totals.totalSales > 0 ? `${(((plFilter === 'daily' ? totals.dailyCOGS : plFilter === 'event' ? totals.eventCOGS : totals.totalCOGS) / (plFilter === 'daily' ? totals.dailySales : plFilter === 'event' ? totals.eventSales : totals.totalSales || 1)) * 100).toFixed(1)}% of revenue` : 'No sales yet'}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-card hover:shadow-card-hover transition-shadow border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Gross Profit</CardTitle>
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${totals.totalGrossProfit >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
              <TrendingUp className={`h-4 w-4 ${totals.totalGrossProfit >= 0 ? 'text-success' : 'text-destructive'}`} />
            </div>
          </CardHeader>
          <CardContent>
            {(() => {
              const gp = plFilter === 'daily' ? totals.dailyGrossProfit : plFilter === 'event' ? totals.eventGrossProfit : totals.totalGrossProfit;
              return (
                <div className={`text-2xl font-bold tracking-tight ${gp >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {gp < 0 ? '-' : ''}{formatNairaCompact(Math.abs(gp))}
                </div>
              );
            })()}
            <p className="text-xs text-muted-foreground mt-1">After cost of goods sold</p>
          </CardContent>
        </Card>

        <Card className="shadow-card hover:shadow-card-hover transition-shadow border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">OpEX + Payroll</CardTitle>
            <div className="h-8 w-8 rounded-lg bg-warning/10 flex items-center justify-center">
              <Users className="h-4 w-4 text-warning" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {formatNairaCompact(plFilter === 'daily' ? (totals.dailyOpEX + totals.payrollOpEX) : plFilter === 'event' ? totals.eventOpEX : totals.totalOpEX)}
            </div>
            <div className="flex gap-2 mt-1">
              <span className="text-xs text-muted-foreground">Expenses: {formatNairaCompact(plFilter === 'daily' ? totals.dailyOpEX : plFilter === 'event' ? totals.eventOpEX : totals.dailyOpEX + totals.eventOpEX)}</span>
              {plFilter !== 'event' && (
                <>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground">Payroll: {formatNairaCompact(totals.payrollOpEX)}</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card hover:shadow-card-hover transition-shadow border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Net Profit</CardTitle>
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${totals.totalNetProfit >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
              {totals.totalNetProfit >= 0 ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
            </div>
          </CardHeader>
          <CardContent>
            {(() => {
              const np = plFilter === 'daily' ? totals.dailyNetProfit : plFilter === 'event' ? totals.eventNetProfit : totals.totalNetProfit;
              const sales = plFilter === 'daily' ? totals.dailySales : plFilter === 'event' ? totals.eventSales : totals.totalSales;
              const margin = sales > 0 ? (np / sales) * 100 : 0;
              return (
                <>
                  <div className={`text-2xl font-bold tracking-tight ${np >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {np < 0 ? '-' : ''}{formatNairaCompact(Math.abs(np))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Margin: <span className="font-medium">{margin.toFixed(1)}%</span>
                  </p>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="table" className="space-y-6">
        <TabsList className="bg-muted/50 p-1">
          <TabsTrigger value="table" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <BarChart3 className="h-4 w-4 mr-2" />P&L Table
          </TabsTrigger>
          <TabsTrigger value="ledger" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <BookOpen className="h-4 w-4 mr-2" />Expense Ledger
          </TabsTrigger>
          <TabsTrigger value="sales" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <ShoppingCart className="h-4 w-4 mr-2" />Weekly Sales
          </TabsTrigger>
          <TabsTrigger value="chart" className="data-[state=active]:bg-background data-[state=active]:shadow-card">
            <TrendingUp className="h-4 w-4 mr-2" />Charts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="table">
          <Card className="shadow-card border-border/50">
            <CardHeader>
              <CardTitle>Monthly Profit & Loss Statement — {selectedYear}</CardTitle>
              <CardDescription>Breakdown by Daily Orders and Event Orders (Payroll included in OpEX)</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="sticky left-0 bg-muted/30 z-10 min-w-[100px] font-semibold">Month</TableHead>
                    <TableHead className="text-right min-w-[110px]">Daily Sales</TableHead>
                    <TableHead className="text-right min-w-[110px]">Event Sales</TableHead>
                    <TableHead className="text-right min-w-[110px]">Invoice Rev.</TableHead>
                    <TableHead className="text-right min-w-[120px] font-semibold border-l border-border/30">Total Sales</TableHead>
                    <TableHead className="text-right min-w-[110px]">Daily COGS</TableHead>
                    <TableHead className="text-right min-w-[110px]">Event COGS</TableHead>
                    <TableHead className="text-right min-w-[120px] font-semibold border-l border-border/30">Total COGS</TableHead>
                    <TableHead className="text-right min-w-[130px] font-semibold border-l border-border/30">Gross Profit</TableHead>
                    <TableHead className="text-right min-w-[110px]">Exp. OpEX</TableHead>
                    <TableHead className="text-right min-w-[110px]">Payroll</TableHead>
                    <TableHead className="text-right min-w-[120px] font-semibold border-l border-border/30">Total OpEX</TableHead>
                    <TableHead className="text-right min-w-[140px] font-semibold border-l border-border/30">Net P/L</TableHead>
                    <TableHead className="text-right min-w-[80px]">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyData.map((m) => {
                    const hasData = m.totalSales > 0 || m.totalCOGS > 0 || m.totalOpEX > 0;
                    return (
                      <TableRow key={m.month} className={!hasData ? 'opacity-40' : 'hover:bg-muted/20'}>
                        <TableCell className="sticky left-0 bg-background z-10 font-medium">{m.month.substring(0, 3)}</TableCell>
                        <TableCell className="text-right text-sm">{formatNairaCompact(m.dailySales)}</TableCell>
                        <TableCell className="text-right text-sm">{formatNairaCompact(m.eventSales)}</TableCell>
                        <TableCell className="text-right text-sm">{m.invoiceRevenue > 0 ? formatNairaCompact(m.invoiceRevenue) : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-right font-semibold text-sm border-l border-border/30">{formatNairaCompact(m.totalSales)}</TableCell>
                        <TableCell className="text-right text-sm">{formatNairaCompact(m.dailyCOGS)}</TableCell>
                        <TableCell className="text-right text-sm">{formatNairaCompact(m.eventCOGS)}</TableCell>
                        <TableCell className="text-right font-semibold text-sm border-l border-border/30">{formatNairaCompact(m.totalCOGS)}</TableCell>
                        <TableCell className="text-right border-l border-border/30">
                          <ValueCell value={m.totalGrossProfit} />
                        </TableCell>
                        <TableCell className="text-right text-sm">{formatNairaCompact(m.dailyOpEX + m.eventOpEX)}</TableCell>
                        <TableCell className="text-right text-sm">{formatNairaCompact(m.payrollOpEX)}</TableCell>
                        <TableCell className="text-right font-semibold text-sm border-l border-border/30">{formatNairaCompact(m.totalOpEX)}</TableCell>
                        <TableCell className="text-right border-l border-border/30">
                          <ValueCell value={m.totalNetProfit} />
                        </TableCell>
                        <TableCell className="text-right">
                          {m.totalSales > 0 ? (
                            <Badge variant={m.profitMargin >= 0 ? 'default' : 'destructive'} className="text-xs font-mono">
                              {m.profitMargin.toFixed(1)}%
                            </Badge>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals Row */}
                  <TableRow className="border-t-2 border-primary/30 font-bold bg-muted/40 hover:bg-muted/40">
                    <TableCell className="sticky left-0 bg-muted/40 z-10 font-bold">TOTAL</TableCell>
                    <TableCell className="text-right">{formatNairaCompact(totals.dailySales)}</TableCell>
                    <TableCell className="text-right">{formatNairaCompact(totals.eventSales)}</TableCell>
                    <TableCell className="text-right">{formatNairaCompact(totals.invoiceRevenue)}</TableCell>
                    <TableCell className="text-right border-l border-border/30">{formatNairaCompact(totals.totalSales)}</TableCell>
                    <TableCell className="text-right">{formatNairaCompact(totals.dailyCOGS)}</TableCell>
                    <TableCell className="text-right">{formatNairaCompact(totals.eventCOGS)}</TableCell>
                    <TableCell className="text-right border-l border-border/30">{formatNairaCompact(totals.totalCOGS)}</TableCell>
                    <TableCell className="text-right border-l border-border/30"><ValueCell value={totals.totalGrossProfit} /></TableCell>
                    <TableCell className="text-right">{formatNairaCompact(totals.dailyOpEX + totals.eventOpEX)}</TableCell>
                    <TableCell className="text-right">{formatNairaCompact(totals.payrollOpEX)}</TableCell>
                    <TableCell className="text-right border-l border-border/30">{formatNairaCompact(totals.totalOpEX)}</TableCell>
                    <TableCell className="text-right border-l border-border/30"><ValueCell value={totals.totalNetProfit} /></TableCell>
                    <TableCell className="text-right">
                      <Badge variant={totalProfitMargin >= 0 ? 'default' : 'destructive'} className="font-mono">
                        {totalProfitMargin.toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Breakdown Cards */}
          <div className="grid gap-4 md:grid-cols-3 mt-6">
            <Card className="shadow-card border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                  Daily Orders
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Sales</span><span className="font-medium">{formatNairaCompact(totals.dailySales)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">COGS</span><span className="font-medium text-destructive">-{formatNairaCompact(totals.dailyCOGS)}</span></div>
                  <div className="border-t pt-2 flex justify-between"><span className="font-medium">Gross Profit</span><ValueCell value={totals.dailyGrossProfit} /></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">OpEX</span><span className="font-medium text-destructive">-{formatNairaCompact(totals.dailyOpEX)}</span></div>
                  <div className="border-t pt-2 flex justify-between"><span className="font-semibold">Net Profit</span><ValueCell value={totals.dailyNetProfit} /></div>
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-card border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-secondary" />
                  Event Orders
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Sales</span><span className="font-medium">{formatNairaCompact(totals.eventSales)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">COGS</span><span className="font-medium text-destructive">-{formatNairaCompact(totals.eventCOGS)}</span></div>
                  <div className="border-t pt-2 flex justify-between"><span className="font-medium">Gross Profit</span><ValueCell value={totals.eventGrossProfit} /></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">OpEX</span><span className="font-medium text-destructive">-{formatNairaCompact(totals.eventOpEX)}</span></div>
                  <div className="border-t pt-2 flex justify-between"><span className="font-semibold">Net Profit</span><ValueCell value={totals.eventNetProfit} /></div>
                </div>
              </CardContent>
            </Card>
            <Card className="shadow-card border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-warning" />
                  Payroll (OpEX)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total Paid Payroll</span><span className="font-medium">{formatNairaCompact(totals.payrollOpEX)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Records</span><span className="font-medium">{payrollRecords.length} paid</span></div>
                  <div className="border-t pt-2">
                    <p className="text-xs text-muted-foreground">Paid staff salaries are automatically included in monthly OpEX calculations.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="ledger">
          <MonthlyExpenseLedger expenses={expenses} selectedYear={selectedYear} />
        </TabsContent>

        <TabsContent value="sales">
          <WeeklySalesEntry sales={sales} selectedYear={selectedYear} onSaleAdded={() => refetchSales()} />
        </TabsContent>

        <TabsContent value="chart">
          <div className="grid gap-6">
            <Card className="shadow-card border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Monthly Revenue vs Costs</CardTitle>
                <CardDescription>Side-by-side comparison of revenue, COGS, and operating expenses</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={380}>
                  <BarChart data={chartData} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v) => `₦${(v / 1000000).toFixed(1)}M`} fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: number) => formatNairaCompact(value)} contentStyle={{ borderRadius: '0.75rem', border: '1px solid hsl(var(--border))' }} />
                    <Legend />
                    <Bar dataKey="Revenue" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="COGS" fill="hsl(var(--destructive))" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="OpEX" fill="hsl(var(--warning))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="shadow-card border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Profit Trends</CardTitle>
                <CardDescription>Monthly gross and net profit trajectory</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="grossGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v) => `₦${(v / 1000000).toFixed(1)}M`} fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value: number) => formatNairaCompact(value)} contentStyle={{ borderRadius: '0.75rem', border: '1px solid hsl(var(--border))' }} />
                    <Legend />
                    <Area type="monotone" dataKey="Gross Profit" stroke="hsl(142, 76%, 36%)" fillOpacity={1} fill="url(#grossGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="Net Profit" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#netGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ProfitLoss;
