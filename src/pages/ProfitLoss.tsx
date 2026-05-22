import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3,
  FileSpreadsheet, BookOpen, ShoppingCart, Users,
  Search, Download, ChevronRight, FileText, Activity,
  X, Receipt,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { formatNairaCompact } from '@/lib/currency';
import { format } from 'date-fns';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Area, AreaChart, ComposedChart,
  Bar, Line, PieChart, Pie, Cell, ReferenceLine,
} from 'recharts';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
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

const PIE_COLORS = ['#ef4444', '#f97316', '#8b5cf6'];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-background border border-border rounded-xl shadow-lg p-3 text-xs min-w-[180px]">
      <p className="font-semibold text-sm mb-2">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span style={{ color: p.color }}>●</span>
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium ml-auto pl-3">
            {p.name === 'Margin %'
              ? `${Number(p.value).toFixed(1)}%`
              : formatNairaCompact(Number(p.value))}
          </span>
        </div>
      ))}
    </div>
  );
};

const PLSkeleton = () => (
  <div className="space-y-6">
    <div className="flex justify-between">
      <Skeleton className="h-10 w-52" />
      <Skeleton className="h-10 w-44" />
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
    </div>
    <Skeleton className="h-36 rounded-xl" />
    <Skeleton className="h-96 rounded-xl" />
  </div>
);

const ValueCell = ({ value }: { value: number }) => (
  <span className={
    value < 0 ? 'text-destructive font-semibold' :
    value > 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' :
    'text-muted-foreground'
  }>
    {value < 0 ? `-${formatNairaCompact(Math.abs(value))}` : formatNairaCompact(value)}
  </span>
);

// ─── Main Component ──────────────────────────────────────────────────────────
const ProfitLoss = () => {
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear.toString());
  const [plFilter, setPlFilter] = useState<'all' | 'daily' | 'event'>('all');
  const [tableSearch, setTableSearch] = useState('');
  const [detailMonthIdx, setDetailMonthIdx] = useState<number | null>(null);

  const yearStart = `${selectedYear}-01-01`;
  const yearEnd = `${selectedYear}-12-31`;

  // ── Queries ────────────────────────────────────────────────────────────────
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

  // ── Monthly P&L Computation ────────────────────────────────────────────────
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
  }, [sales, expenses, payrollRecords, invoiceLedger]);

  const totals = useMemo(() => monthlyData.reduce((acc, m) => ({
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
  }), [monthlyData]);

  const totalProfitMargin = totals.totalSales > 0
    ? (totals.totalNetProfit / totals.totalSales) * 100
    : 0;

  // ── Derived values ─────────────────────────────────────────────────────────
  const filteredMonths = monthlyData.filter(m =>
    m.month.toLowerCase().includes(tableSearch.toLowerCase())
  );

  const detailMonth = detailMonthIdx !== null ? monthlyData[detailMonthIdx] : null;
  const detailSales = detailMonthIdx !== null
    ? sales.filter(s => new Date(s.sale_date).getMonth() === detailMonthIdx)
    : [];
  const detailExpenses = detailMonthIdx !== null
    ? expenses.filter(e => new Date(e.date).getMonth() === detailMonthIdx)
    : [];

  const activeRevenue = plFilter === 'daily' ? totals.dailySales
    : plFilter === 'event' ? totals.eventSales : totals.totalSales;
  const activeCOGS = plFilter === 'daily' ? totals.dailyCOGS
    : plFilter === 'event' ? totals.eventCOGS : totals.totalCOGS;
  const activeGP = plFilter === 'daily' ? totals.dailyGrossProfit
    : plFilter === 'event' ? totals.eventGrossProfit : totals.totalGrossProfit;
  const activeOpEX = plFilter === 'daily' ? (totals.dailyOpEX + totals.payrollOpEX)
    : plFilter === 'event' ? totals.eventOpEX : totals.totalOpEX;
  const activeNP = plFilter === 'daily' ? totals.dailyNetProfit
    : plFilter === 'event' ? totals.eventNetProfit : totals.totalNetProfit;

  // ── Chart data ─────────────────────────────────────────────────────────────
  const chartData = monthlyData.map(m => ({
    name: m.month.substring(0, 3),
    'Revenue': m.totalSales,
    'COGS': m.totalCOGS,
    'OpEX': m.totalOpEX,
    'Gross Profit': m.totalGrossProfit,
    'Net Profit': m.totalNetProfit,
    'Margin %': m.totalSales > 0 ? parseFloat(m.profitMargin.toFixed(1)) : null,
  }));

  const costPieData = [
    { name: 'COGS', value: totals.totalCOGS },
    { name: 'OpEX', value: totals.dailyOpEX + totals.eventOpEX },
    { name: 'Payroll', value: totals.payrollOpEX },
  ].filter(d => d.value > 0);

  // ── Exports ────────────────────────────────────────────────────────────────
  const exportToExcel = () => {
    const headers = [
      'MONTH', 'DAILY SALES', 'EVENT SALES', 'INVOICE REVENUE', 'TOTAL SALES',
      'DAILY COGS', 'EVENT COGS', 'TOTAL COGS',
      'GROSS PROFIT', 'EXPENSE OPEX', 'PAYROLL OPEX', 'TOTAL OPEX',
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

  const exportToCSV = () => {
    const headers = ['Month', 'Revenue', 'COGS', 'Gross Profit', 'OpEX', 'Payroll', 'Net Profit', 'Margin'];
    const rows = monthlyData.map(m => [
      m.month, m.totalSales, m.totalCOGS, m.totalGrossProfit,
      m.dailyOpEX + m.eventOpEX, m.payrollOpEX, m.totalNetProfit,
      `${m.profitMargin.toFixed(1)}%`,
    ]);
    rows.push([
      'TOTAL', totals.totalSales, totals.totalCOGS, totals.totalGrossProfit,
      totals.dailyOpEX + totals.eventOpEX, totals.payrollOpEX, totals.totalNetProfit,
      `${totalProfitMargin.toFixed(1)}%`,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    saveAs(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `PL_Dashboard_${selectedYear}.csv`);
  };

  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const margin = 14;
    const contentW = W - margin * 2;
    let y = 0;

    // Header bar
    doc.setFillColor(79, 70, 229);
    doc.rect(0, 0, W, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('PROFIT & LOSS STATEMENT', margin, 14);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `${selectedYear}  |  ${format(new Date(), 'dd MMM yyyy')}`,
      W - margin, 14, { align: 'right' },
    );

    y = 30;

    // Summary boxes
    const boxW = (contentW - 12) / 4;
    const boxes = [
      { label: 'TOTAL REVENUE', val: formatNairaCompact(totals.totalSales), r: 59, g: 130, b: 246 },
      { label: 'TOTAL COGS', val: formatNairaCompact(totals.totalCOGS), r: 239, g: 68, b: 68 },
      {
        label: 'GROSS PROFIT',
        val: (totals.totalGrossProfit < 0 ? '-' : '') + formatNairaCompact(Math.abs(totals.totalGrossProfit)),
        r: totals.totalGrossProfit >= 0 ? 22 : 239,
        g: totals.totalGrossProfit >= 0 ? 163 : 68,
        b: totals.totalGrossProfit >= 0 ? 74 : 68,
      },
      {
        label: 'NET PROFIT',
        val: (totals.totalNetProfit < 0 ? '-' : '') + formatNairaCompact(Math.abs(totals.totalNetProfit)),
        r: totals.totalNetProfit >= 0 ? 22 : 239,
        g: totals.totalNetProfit >= 0 ? 163 : 68,
        b: totals.totalNetProfit >= 0 ? 74 : 68,
      },
    ];

    boxes.forEach((box, i) => {
      const bx = margin + i * (boxW + 4);
      doc.setFillColor(box.r, box.g, box.b);
      doc.rect(bx, y, boxW, 16, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(box.val, bx + boxW / 2, y + 8, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(box.label, bx + boxW / 2, y + 14, { align: 'center' });
    });

    y += 22;

    // Meta row
    doc.setFillColor(245, 245, 250);
    doc.rect(margin, y, contentW, 8, 'F');
    doc.setTextColor(79, 70, 229);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Net Margin: ${totalProfitMargin.toFixed(1)}%`, margin + 4, y + 5.5);
    doc.setTextColor(80, 80, 80);
    doc.setFont('helvetica', 'normal');
    const filterLabel = plFilter === 'all' ? 'All P&L' : plFilter === 'daily' ? 'Daily Sales Only' : 'Event Sales Only';
    doc.text(`Filter: ${filterLabel}`, W - margin, y + 5.5, { align: 'right' });

    y += 14;

    // Table columns
    const colDefs = [
      { label: 'MONTH', w: 22 },
      { label: 'REVENUE', w: 37 },
      { label: 'COGS', w: 32 },
      { label: 'GROSS P', w: 34 },
      { label: 'EXP OPEX', w: 34 },
      { label: 'PAYROLL', w: 30 },
      { label: 'NET P/L', w: 36 },
      { label: 'MARGIN', w: 22 },
    ];
    let cx = margin;
    const cols = colDefs.map(c => { const x = cx; cx += c.w; return { ...c, x }; });

    // Table header
    doc.setFillColor(240, 240, 250);
    doc.rect(margin, y, contentW, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(60, 60, 60);
    cols.forEach((c, i) => {
      if (i === 0) doc.text(c.label, c.x + 2, y + 5.5);
      else doc.text(c.label, c.x + c.w, y + 5.5, { align: 'right' });
    });

    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);

    monthlyData.forEach((m, i) => {
      const hasData = m.totalSales > 0 || m.totalCOGS > 0 || m.totalOpEX > 0;
      if (i % 2 === 0) {
        doc.setFillColor(250, 250, 252);
        doc.rect(margin, y, contentW, 7, 'F');
      }
      const baseGray = hasData ? 30 : 160;
      doc.setTextColor(baseGray, baseGray, baseGray);
      doc.text(m.month.substring(0, 3), cols[0].x + 2, y + 5);
      doc.text(formatNairaCompact(m.totalSales), cols[1].x + cols[1].w, y + 5, { align: 'right' });
      doc.text(formatNairaCompact(m.totalCOGS), cols[2].x + cols[2].w, y + 5, { align: 'right' });

      doc.setTextColor(m.totalGrossProfit >= 0 ? 22 : 220, m.totalGrossProfit >= 0 ? 163 : 38, m.totalGrossProfit >= 0 ? 74 : 38);
      doc.text(
        (m.totalGrossProfit < 0 ? '-' : '') + formatNairaCompact(Math.abs(m.totalGrossProfit)),
        cols[3].x + cols[3].w, y + 5, { align: 'right' },
      );

      doc.setTextColor(30, 30, 30);
      doc.text(formatNairaCompact(m.dailyOpEX + m.eventOpEX), cols[4].x + cols[4].w, y + 5, { align: 'right' });
      doc.text(formatNairaCompact(m.payrollOpEX), cols[5].x + cols[5].w, y + 5, { align: 'right' });

      doc.setTextColor(m.totalNetProfit >= 0 ? 22 : 220, m.totalNetProfit >= 0 ? 163 : 38, m.totalNetProfit >= 0 ? 74 : 38);
      doc.text(
        (m.totalNetProfit < 0 ? '-' : '') + formatNairaCompact(Math.abs(m.totalNetProfit)),
        cols[6].x + cols[6].w, y + 5, { align: 'right' },
      );

      doc.setTextColor(30, 30, 30);
      doc.text(
        m.totalSales > 0 ? `${m.profitMargin.toFixed(1)}%` : '—',
        cols[7].x + cols[7].w, y + 5, { align: 'right' },
      );
      y += 7;
    });

    // Totals row
    doc.setFillColor(230, 228, 252);
    doc.rect(margin, y, contentW, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 30, 30);
    doc.text('TOTAL', cols[0].x + 2, y + 5.5);
    doc.text(formatNairaCompact(totals.totalSales), cols[1].x + cols[1].w, y + 5.5, { align: 'right' });
    doc.text(formatNairaCompact(totals.totalCOGS), cols[2].x + cols[2].w, y + 5.5, { align: 'right' });

    doc.setTextColor(totals.totalGrossProfit >= 0 ? 22 : 220, totals.totalGrossProfit >= 0 ? 163 : 38, totals.totalGrossProfit >= 0 ? 74 : 38);
    doc.text(
      (totals.totalGrossProfit < 0 ? '-' : '') + formatNairaCompact(Math.abs(totals.totalGrossProfit)),
      cols[3].x + cols[3].w, y + 5.5, { align: 'right' },
    );

    doc.setTextColor(30, 30, 30);
    doc.text(formatNairaCompact(totals.dailyOpEX + totals.eventOpEX), cols[4].x + cols[4].w, y + 5.5, { align: 'right' });
    doc.text(formatNairaCompact(totals.payrollOpEX), cols[5].x + cols[5].w, y + 5.5, { align: 'right' });

    doc.setTextColor(totals.totalNetProfit >= 0 ? 22 : 220, totals.totalNetProfit >= 0 ? 163 : 38, totals.totalNetProfit >= 0 ? 74 : 38);
    doc.text(
      (totals.totalNetProfit < 0 ? '-' : '') + formatNairaCompact(Math.abs(totals.totalNetProfit)),
      cols[6].x + cols[6].w, y + 5.5, { align: 'right' },
    );

    doc.setTextColor(30, 30, 30);
    doc.text(`${totalProfitMargin.toFixed(1)}%`, cols[7].x + cols[7].w, y + 5.5, { align: 'right' });

    doc.save(`ProfitLoss_${selectedYear}.pdf`);
  };

  if (isLoading) return <PLSkeleton />;

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Profit & Loss
          </h1>
          <p className="text-muted-foreground mt-0.5">
            Financial performance overview — {selectedYear}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filter pills */}
          <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5 gap-0.5">
            {(['all', 'daily', 'event'] as const).map(f => (
              <button
                key={f}
                onClick={() => setPlFilter(f)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  plFilter === f
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f === 'all' ? 'All P&L' : f === 'daily' ? 'Daily' : 'Events'}
              </button>
            ))}
          </div>

          {/* Year picker */}
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-24 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map(y => (
                <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Export dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={exportToExcel} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportToCSV} className="gap-2 cursor-pointer">
                <FileText className="h-4 w-4 text-blue-600" />
                CSV (.csv)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={exportToPDF} className="gap-2 cursor-pointer">
                <FileText className="h-4 w-4 text-red-500" />
                PDF Statement
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── KPI Cards ────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">

        {/* Revenue */}
        <Card className="border-border/50 overflow-hidden">
          <div className="h-1 bg-blue-500" />
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Revenue</p>
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-blue-600" />
              </div>
            </div>
            <p className="text-2xl font-bold tracking-tight">{formatNairaCompact(activeRevenue)}</p>
            {plFilter === 'all' && (
              <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Daily</span><span className="font-medium">{formatNairaCompact(totals.dailySales)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Event</span><span className="font-medium">{formatNairaCompact(totals.eventSales)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* COGS */}
        <Card className="border-border/50 overflow-hidden">
          <div className="h-1 bg-red-500" />
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">COGS</p>
              <div className="h-8 w-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                <Receipt className="h-4 w-4 text-red-500" />
              </div>
            </div>
            <p className="text-2xl font-bold tracking-tight">{formatNairaCompact(activeCOGS)}</p>
            {activeRevenue > 0 && (
              <div className="mt-2">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-muted-foreground">% of revenue</span>
                  <span className="font-medium">{((activeCOGS / activeRevenue) * 100).toFixed(1)}%</span>
                </div>
                <Progress value={Math.min((activeCOGS / activeRevenue) * 100, 100)} className="h-1" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Gross Profit */}
        <Card className="border-border/50 overflow-hidden">
          <div className={`h-1 ${activeGP >= 0 ? 'bg-emerald-500' : 'bg-destructive'}`} />
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Gross Profit</p>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${activeGP >= 0 ? 'bg-emerald-500/10' : 'bg-destructive/10'}`}>
                <TrendingUp className={`h-4 w-4 ${activeGP >= 0 ? 'text-emerald-600' : 'text-destructive'}`} />
              </div>
            </div>
            <p className={`text-2xl font-bold tracking-tight ${activeGP >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
              {activeGP < 0 ? '-' : ''}{formatNairaCompact(Math.abs(activeGP))}
            </p>
            {activeRevenue > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Gross margin: <span className="font-medium">{((activeGP / activeRevenue) * 100).toFixed(1)}%</span>
              </p>
            )}
          </CardContent>
        </Card>

        {/* OpEX */}
        <Card className="border-border/50 overflow-hidden">
          <div className="h-1 bg-amber-500" />
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">OpEX + Payroll</p>
              <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Users className="h-4 w-4 text-amber-600" />
              </div>
            </div>
            <p className="text-2xl font-bold tracking-tight">{formatNairaCompact(activeOpEX)}</p>
            {plFilter !== 'event' && (
              <div className="mt-2 text-xs text-muted-foreground flex justify-between">
                <span>Payroll</span>
                <span className="font-medium">{formatNairaCompact(totals.payrollOpEX)}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Net Profit */}
        <Card className="border-border/50 overflow-hidden">
          <div className={`h-1 ${activeNP >= 0 ? 'bg-violet-500' : 'bg-destructive'}`} />
          <CardContent className="pt-4 pb-4">
            <div className="flex items-start justify-between mb-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Net Profit</p>
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${activeNP >= 0 ? 'bg-violet-500/10' : 'bg-destructive/10'}`}>
                {activeNP >= 0
                  ? <TrendingUp className="h-4 w-4 text-violet-600" />
                  : <TrendingDown className="h-4 w-4 text-destructive" />}
              </div>
            </div>
            <p className={`text-2xl font-bold tracking-tight ${activeNP >= 0 ? 'text-violet-600 dark:text-violet-400' : 'text-destructive'}`}>
              {activeNP < 0 ? '-' : ''}{formatNairaCompact(Math.abs(activeNP))}
            </p>
            <div className="mt-2 text-xs">
              <span className="text-muted-foreground">Margin: </span>
              <span className={`font-semibold ${activeNP >= 0 ? 'text-violet-600 dark:text-violet-400' : 'text-destructive'}`}>
                {activeRevenue > 0 ? `${((activeNP / activeRevenue) * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Net Profit Sparkline ─────────────────────────────────────────────── */}
      <Card className="border-border/50">
        <CardContent className="pt-4 pb-2 px-5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              12-Month Profit Trend — {selectedYear}
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-emerald-500 inline-block rounded-full" />Gross Profit
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-violet-500 inline-block rounded-full" />Net Profit
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={108}>
            <AreaChart data={chartData} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="sparkGross" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="sparkNet" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="4 3" />
              <Area type="monotone" dataKey="Gross Profit" stroke="#10b981" fill="url(#sparkGross)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="Net Profit" stroke="#8b5cf6" fill="url(#sparkNet)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="table" className="space-y-4">
        <TabsList className="bg-muted/50 p-1 flex-wrap h-auto gap-1">
          <TabsTrigger value="table" className="data-[state=active]:bg-background data-[state=active]:shadow-card gap-1.5">
            <BarChart3 className="h-4 w-4" />P&L Table
          </TabsTrigger>
          <TabsTrigger value="ledger" className="data-[state=active]:bg-background data-[state=active]:shadow-card gap-1.5">
            <BookOpen className="h-4 w-4" />Expense Ledger
          </TabsTrigger>
          <TabsTrigger value="sales" className="data-[state=active]:bg-background data-[state=active]:shadow-card gap-1.5">
            <ShoppingCart className="h-4 w-4" />Weekly Sales
          </TabsTrigger>
          <TabsTrigger value="analytics" className="data-[state=active]:bg-background data-[state=active]:shadow-card gap-1.5">
            <Activity className="h-4 w-4" />Analytics
          </TabsTrigger>
        </TabsList>

        {/* ── P&L Table Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="table" className="space-y-4">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base">Monthly P&L Statement — {selectedYear}</CardTitle>
                  <CardDescription className="text-xs mt-0.5">Click any active month row to view full breakdown</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search month..."
                      value={tableSearch}
                      onChange={e => setTableSearch(e.target.value)}
                      className="pl-8 h-8 w-36 text-sm"
                    />
                  </div>
                  {tableSearch && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTableSearch('')}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30 border-b border-border/50">
                      <TableHead className="sticky left-0 bg-muted/30 z-10 font-semibold pl-4 w-[110px]">Month</TableHead>
                      <TableHead className="text-right min-w-[100px]">Daily Sales</TableHead>
                      <TableHead className="text-right min-w-[100px]">Event Sales</TableHead>
                      <TableHead className="text-right min-w-[90px]">Invoice</TableHead>
                      <TableHead className="text-right min-w-[110px] font-semibold">Total Revenue</TableHead>
                      <TableHead className="text-right min-w-[95px]">COGS</TableHead>
                      <TableHead className="text-right min-w-[110px] font-semibold">Gross Profit</TableHead>
                      <TableHead className="text-right min-w-[90px]">OpEX</TableHead>
                      <TableHead className="text-right min-w-[90px]">Payroll</TableHead>
                      <TableHead className="text-right min-w-[110px] font-semibold">Net P/L</TableHead>
                      <TableHead className="text-right min-w-[80px]">Margin</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMonths.map(m => {
                      const hasData = m.totalSales > 0 || m.totalCOGS > 0 || m.totalOpEX > 0;
                      return (
                        <TableRow
                          key={m.month}
                          className={`transition-colors ${hasData
                            ? 'cursor-pointer hover:bg-muted/25'
                            : 'opacity-35 pointer-events-none'
                          }`}
                          onClick={() => hasData && setDetailMonthIdx(m.monthIndex)}
                        >
                          <TableCell className="sticky left-0 bg-background z-10 font-medium pl-4">
                            <div className="flex items-center gap-2">
                              {hasData && (
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.totalNetProfit >= 0 ? 'bg-emerald-500' : 'bg-destructive'}`} />
                              )}
                              {m.month.substring(0, 3)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatNairaCompact(m.dailySales)}</TableCell>
                          <TableCell className="text-right text-sm">{formatNairaCompact(m.eventSales)}</TableCell>
                          <TableCell className="text-right text-sm">
                            {m.invoiceRevenue > 0
                              ? formatNairaCompact(m.invoiceRevenue)
                              : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-sm">{formatNairaCompact(m.totalSales)}</TableCell>
                          <TableCell className="text-right text-sm">{formatNairaCompact(m.totalCOGS)}</TableCell>
                          <TableCell className="text-right"><ValueCell value={m.totalGrossProfit} /></TableCell>
                          <TableCell className="text-right text-sm">{formatNairaCompact(m.dailyOpEX + m.eventOpEX)}</TableCell>
                          <TableCell className="text-right text-sm">{formatNairaCompact(m.payrollOpEX)}</TableCell>
                          <TableCell className="text-right"><ValueCell value={m.totalNetProfit} /></TableCell>
                          <TableCell className="text-right">
                            {m.totalSales > 0 ? (
                              <Badge
                                variant="outline"
                                className={`text-xs font-mono tabular-nums ${
                                  m.profitMargin >= 0
                                    ? 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-400 dark:border-emerald-900 dark:bg-emerald-950/30'
                                    : 'text-destructive border-destructive/30 bg-destructive/5'
                                }`}
                              >
                                {m.profitMargin.toFixed(1)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {hasData && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </TableCell>
                        </TableRow>
                      );
                    })}

                    {/* Totals Row */}
                    <TableRow className="border-t-2 border-primary/20 font-bold bg-muted/50 hover:bg-muted/50">
                      <TableCell className="sticky left-0 bg-muted/50 z-10 font-bold pl-4">TOTAL</TableCell>
                      <TableCell className="text-right">{formatNairaCompact(totals.dailySales)}</TableCell>
                      <TableCell className="text-right">{formatNairaCompact(totals.eventSales)}</TableCell>
                      <TableCell className="text-right">{formatNairaCompact(totals.invoiceRevenue)}</TableCell>
                      <TableCell className="text-right">{formatNairaCompact(totals.totalSales)}</TableCell>
                      <TableCell className="text-right">{formatNairaCompact(totals.totalCOGS)}</TableCell>
                      <TableCell className="text-right"><ValueCell value={totals.totalGrossProfit} /></TableCell>
                      <TableCell className="text-right">{formatNairaCompact(totals.dailyOpEX + totals.eventOpEX)}</TableCell>
                      <TableCell className="text-right">{formatNairaCompact(totals.payrollOpEX)}</TableCell>
                      <TableCell className="text-right"><ValueCell value={totals.totalNetProfit} /></TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={totalProfitMargin >= 0 ? 'default' : 'destructive'}
                          className="font-mono tabular-nums"
                        >
                          {totalProfitMargin.toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Breakdown mini-cards */}
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                label: 'Daily Orders',
                accent: 'bg-blue-500',
                rows: [
                  { label: 'Sales', value: totals.dailySales, cost: false },
                  { label: 'COGS', value: -totals.dailyCOGS, cost: true },
                  { label: 'Gross Profit', value: totals.dailyGrossProfit, sep: true },
                  { label: 'OpEX', value: -totals.dailyOpEX, cost: true },
                  { label: 'Net Profit', value: totals.dailyNetProfit, sep: true },
                ],
              },
              {
                label: 'Event Orders',
                accent: 'bg-violet-500',
                rows: [
                  { label: 'Sales', value: totals.eventSales, cost: false },
                  { label: 'COGS', value: -totals.eventCOGS, cost: true },
                  { label: 'Gross Profit', value: totals.eventGrossProfit, sep: true },
                  { label: 'OpEX', value: -totals.eventOpEX, cost: true },
                  { label: 'Net Profit', value: totals.eventNetProfit, sep: true },
                ],
              },
              {
                label: 'Payroll (OpEX)',
                accent: 'bg-amber-500',
                rows: [
                  { label: 'Total Paid', value: totals.payrollOpEX, cost: false },
                  { label: 'Records', value: null, text: `${payrollRecords.length} paid` },
                ],
              },
            ].map(({ label, accent, rows }) => (
              <Card key={label} className="border-border/50 overflow-hidden">
                <div className={`h-1 ${accent}`} />
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-sm font-semibold">{label}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm pb-4 space-y-1.5">
                  {rows.map((row, i) => (
                    <div key={i}>
                      {row.sep && <Separator className="my-2" />}
                      <div className="flex justify-between items-center">
                        <span className={row.sep ? 'font-semibold' : 'text-muted-foreground'}>{row.label}</span>
                        {row.text ? (
                          <span className="font-medium">{row.text}</span>
                        ) : (
                          <ValueCell value={row.value!} />
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Expense Ledger Tab ─────────────────────────────────────────────── */}
        <TabsContent value="ledger">
          <MonthlyExpenseLedger expenses={expenses} selectedYear={selectedYear} />
        </TabsContent>

        {/* ── Weekly Sales Tab ───────────────────────────────────────────────── */}
        <TabsContent value="sales">
          <WeeklySalesEntry sales={sales} selectedYear={selectedYear} onSaleAdded={() => refetchSales()} />
        </TabsContent>

        {/* ── Analytics Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="analytics" className="space-y-4">

          {/* Revenue vs Costs vs Margin */}
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Revenue vs. Costs vs. Margin</CardTitle>
              <CardDescription>Monthly comparison with profit margin overlay (right axis)</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={chartData} barGap={3} barCategoryGap="28%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                  <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={v => `₦${(v / 1_000_000).toFixed(1)}M`}
                    fontSize={11} tickLine={false} axisLine={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={v => `${v}%`}
                    fontSize={11} tickLine={false} axisLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="Revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar yAxisId="left" dataKey="COGS" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar yAxisId="left" dataKey="OpEX" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="Margin %"
                    stroke="#8b5cf6"
                    strokeWidth={2.5}
                    dot={{ fill: '#8b5cf6', r: 3, strokeWidth: 0 }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Profit Trajectory + Cost Composition */}
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3 border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Profit Trajectory</CardTitle>
                <CardDescription>Gross and net profit month by month</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="areaGross" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="areaNet" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} vertical={false} />
                    <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={v => `₦${(v / 1_000_000).toFixed(1)}M`} fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="4 3" />
                    <Area type="monotone" dataKey="Gross Profit" stroke="#10b981" fill="url(#areaGross)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="Net Profit" stroke="#8b5cf6" fill="url(#areaNet)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2 border-border/50">
              <CardHeader>
                <CardTitle className="text-base">Cost Composition</CardTitle>
                <CardDescription>Annual cost breakdown by type</CardDescription>
              </CardHeader>
              <CardContent>
                {costPieData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={170}>
                      <PieChart>
                        <Pie
                          data={costPieData}
                          cx="50%" cy="50%"
                          innerRadius={52} outerRadius={76}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {costPieData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: number) => formatNairaCompact(v)}
                          contentStyle={{ borderRadius: '0.75rem', border: '1px solid hsl(var(--border))' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2 mt-1">
                      {costPieData.map((d, i) => {
                        const total = costPieData.reduce((s, x) => s + x.value, 0);
                        return (
                          <div key={d.name} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i] }} />
                              <span className="text-muted-foreground">{d.name}</span>
                            </div>
                            <div className="text-right">
                              <span className="font-medium">{formatNairaCompact(d.value)}</span>
                              <span className="text-muted-foreground ml-2 text-xs tabular-nums">
                                {((d.value / total) * 100).toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center h-[170px] text-muted-foreground text-sm">
                    No cost data for {selectedYear}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Month Detail Sheet ───────────────────────────────────────────────── */}
      <Sheet
        open={detailMonthIdx !== null}
        onOpenChange={open => { if (!open) setDetailMonthIdx(null); }}
      >
        <SheetContent className="w-full sm:max-w-lg p-0 gap-0">
          {detailMonth && (
            <>
              {/* Gradient header */}
              <div className={`p-6 pb-5 ${detailMonth.totalNetProfit >= 0
                ? 'bg-gradient-to-br from-violet-600 to-indigo-700'
                : 'bg-gradient-to-br from-rose-600 to-red-700'
              }`}>
                <SheetHeader>
                  <SheetTitle className="text-white text-xl font-bold">
                    {detailMonth.month} {selectedYear}
                  </SheetTitle>
                </SheetHeader>
                <div className="mt-4 grid grid-cols-3 gap-2.5">
                  {[
                    { label: 'Revenue', val: formatNairaCompact(detailMonth.totalSales) },
                    {
                      label: 'Net P/L',
                      val: `${detailMonth.totalNetProfit < 0 ? '-' : ''}${formatNairaCompact(Math.abs(detailMonth.totalNetProfit))}`,
                    },
                    {
                      label: 'Margin',
                      val: detailMonth.totalSales > 0 ? `${detailMonth.profitMargin.toFixed(1)}%` : '—',
                    },
                  ].map(({ label, val }) => (
                    <div key={label} className="bg-white/15 rounded-xl p-3 backdrop-blur-sm">
                      <p className="text-white/70 text-xs">{label}</p>
                      <p className="text-white font-bold mt-0.5 text-sm leading-tight">{val}</p>
                    </div>
                  ))}
                </div>
              </div>

              <ScrollArea className="h-[calc(100vh-230px)]">
                <div className="p-6 space-y-6">

                  {/* Revenue */}
                  <section>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Revenue</h3>
                    <div className="space-y-2 text-sm">
                      {[
                        { label: 'Daily Sales', val: detailMonth.dailySales },
                        { label: 'Event Sales', val: detailMonth.eventSales },
                        { label: 'Invoice Revenue', val: detailMonth.invoiceRevenue },
                      ].map(r => (
                        <div key={r.label} className="flex justify-between">
                          <span className="text-muted-foreground">{r.label}</span>
                          <span className="font-medium">{formatNairaCompact(r.val)}</span>
                        </div>
                      ))}
                      <Separator />
                      <div className="flex justify-between font-semibold">
                        <span>Total Revenue</span>
                        <span>{formatNairaCompact(detailMonth.totalSales)}</span>
                      </div>
                    </div>
                  </section>

                  {/* COGS */}
                  <section>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Cost of Goods Sold</h3>
                    <div className="space-y-2 text-sm">
                      {[
                        { label: 'Daily COGS', val: detailMonth.dailyCOGS },
                        { label: 'Event COGS', val: detailMonth.eventCOGS },
                      ].map(r => (
                        <div key={r.label} className="flex justify-between">
                          <span className="text-muted-foreground">{r.label}</span>
                          <span className="font-medium text-destructive">-{formatNairaCompact(r.val)}</span>
                        </div>
                      ))}
                      <Separator />
                      <div className="flex justify-between font-semibold">
                        <span>Total COGS</span>
                        <span className="text-destructive">-{formatNairaCompact(detailMonth.totalCOGS)}</span>
                      </div>
                    </div>
                  </section>

                  {/* Gross Profit highlight */}
                  <div className={`rounded-xl p-3.5 ${detailMonth.totalGrossProfit >= 0
                    ? 'bg-emerald-50 border border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/30'
                    : 'bg-red-50 border border-red-100 dark:bg-red-950/20 dark:border-red-900/30'
                  }`}>
                    <div className="flex justify-between items-center text-sm font-bold">
                      <span>Gross Profit</span>
                      <ValueCell value={detailMonth.totalGrossProfit} />
                    </div>
                    {detailMonth.totalSales > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Gross margin: {((detailMonth.totalGrossProfit / detailMonth.totalSales) * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>

                  {/* OpEX */}
                  <section>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Operating Expenses</h3>
                    <div className="space-y-2 text-sm">
                      {[
                        { label: 'Daily OpEX', val: detailMonth.dailyOpEX },
                        { label: 'Event OpEX', val: detailMonth.eventOpEX },
                        { label: 'Payroll', val: detailMonth.payrollOpEX },
                      ].map(r => (
                        <div key={r.label} className="flex justify-between">
                          <span className="text-muted-foreground">{r.label}</span>
                          <span className="font-medium">{formatNairaCompact(r.val)}</span>
                        </div>
                      ))}
                      <Separator />
                      <div className="flex justify-between font-semibold">
                        <span>Total OpEX</span>
                        <span>{formatNairaCompact(detailMonth.totalOpEX)}</span>
                      </div>
                    </div>
                  </section>

                  {/* Net Profit highlight */}
                  <div className={`rounded-xl p-4 flex items-center justify-between ${detailMonth.totalNetProfit >= 0
                    ? 'bg-violet-50 border border-violet-100 dark:bg-violet-950/20 dark:border-violet-900/30'
                    : 'bg-red-50 border border-red-100 dark:bg-red-950/20 dark:border-red-900/30'
                  }`}>
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Net Profit / Loss</p>
                      <p className={`text-2xl font-bold ${detailMonth.totalNetProfit >= 0
                        ? 'text-violet-700 dark:text-violet-400'
                        : 'text-destructive'
                      }`}>
                        {detailMonth.totalNetProfit < 0 ? '-' : ''}
                        {formatNairaCompact(Math.abs(detailMonth.totalNetProfit))}
                      </p>
                    </div>
                    {detailMonth.totalSales > 0 && (
                      <Badge className={`text-sm px-3 py-1 ${detailMonth.profitMargin >= 0
                        ? 'bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-900/30 dark:text-violet-300'
                        : 'bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300'
                      }`}>
                        {detailMonth.profitMargin.toFixed(1)}%
                      </Badge>
                    )}
                  </div>

                  {/* Top Expenses */}
                  {detailExpenses.length > 0 && (
                    <section>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Top Expenses ({detailExpenses.length})
                      </h3>
                      <div className="space-y-0">
                        {detailExpenses
                          .sort((a, b) => Number(b.amount) - Number(a.amount))
                          .slice(0, 6)
                          .map(e => (
                            <div
                              key={e.id}
                              className="flex items-start justify-between gap-3 py-2.5 border-b border-border/40 last:border-0 text-sm"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium truncate">{e.description || e.category}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {e.category} · {format(new Date(e.date), 'MMM d')}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="font-semibold text-destructive">-{formatNairaCompact(Number(e.amount))}</p>
                                <Badge variant="outline" className="text-xs mt-0.5">{e.account_type || 'COGS'}</Badge>
                              </div>
                            </div>
                          ))}
                        {detailExpenses.length > 6 && (
                          <p className="text-xs text-muted-foreground text-center pt-2">
                            +{detailExpenses.length - 6} more — see Expense Ledger tab
                          </p>
                        )}
                      </div>
                    </section>
                  )}

                  {/* Sales entries */}
                  {detailSales.length > 0 && (
                    <section>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Sales Entries ({detailSales.length})
                      </h3>
                      <div className="space-y-0">
                        {detailSales
                          .sort((a, b) => Number(b.total_amount) - Number(a.total_amount))
                          .slice(0, 6)
                          .map(s => (
                            <div
                              key={s.id}
                              className="flex items-start justify-between gap-3 py-2.5 border-b border-border/40 last:border-0 text-sm"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium truncate">{s.customer_name || s.sale_number}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {format(new Date(s.sale_date), 'MMM d')} ·{' '}
                                  {(s.sale_type || 'daily') === 'daily' ? 'Shop' : 'Event'}
                                </p>
                              </div>
                              <p className="font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                                {formatNairaCompact(Number(s.total_amount))}
                              </p>
                            </div>
                          ))}
                        {detailSales.length > 6 && (
                          <p className="text-xs text-muted-foreground text-center pt-2">
                            +{detailSales.length - 6} more — see Weekly Sales tab
                          </p>
                        )}
                      </div>
                    </section>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default ProfitLoss;
