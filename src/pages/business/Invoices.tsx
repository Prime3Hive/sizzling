import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Plus, Search, X, FileText, ShoppingCart, CalendarDays,
  TrendingUp, Clock, CheckCircle2, XCircle,
} from "lucide-react";
import { format } from "date-fns";
import { formatNairaCompact } from "@/lib/currency";
import {
  type Invoice, type InvoiceType, type InvoiceStatus,
  STATUS_LABELS, TYPE_LABELS, PAYMENT_STATUS_LABELS,
} from "@/types/invoices";
import InvoiceFormDialog from "@/components/invoices/InvoiceFormDialog";
import InvoiceViewDialog from "@/components/invoices/InvoiceViewDialog";

const STATUS_BADGE: Record<string, string> = {
  quotation: "bg-amber-100 text-amber-700 border-amber-200",
  invoice:   "bg-green-100 text-green-700 border-green-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

const PAYMENT_BADGE: Record<string, string> = {
  unpaid:  "bg-red-100 text-red-700 border-red-200",
  partial: "bg-amber-100 text-amber-700 border-amber-200",
  paid:    "bg-green-100 text-green-700 border-green-200",
};

type TabValue = "all" | InvoiceStatus | InvoiceType;

export default function Invoices() {
  const { user } = useAuth();

  // Dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [formType, setFormType] = useState<InvoiceType | undefined>(undefined);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [viewOpen, setViewOpen] = useState(false);

  // Filter state
  const [tab, setTab] = useState<TabValue>("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const { data: invData, error } = await supabase
        .from("invoices")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      if (!invData || invData.length === 0) return [];

      const ids = invData.map((i: any) => i.id);
      const { data: itemsData, error: itemsErr } = await supabase
        .from("invoice_items")
        .select("*")
        .in("invoice_id", ids)
        .order("sort_order", { ascending: true });
      if (itemsErr) throw itemsErr;

      return invData.map((inv: any) => ({
        ...inv,
        items: (itemsData ?? []).filter((it: any) => it.invoice_id === inv.id),
      })) as Invoice[];
    },
    enabled: !!user,
  });

  // KPI stats
  const stats = useMemo(() => {
    const quotations = invoices.filter((i) => i.status === "quotation");
    const active = invoices.filter((i) => i.status === "invoice");
    const totalRevenue = active
      .filter((i) => !i.recorded_in_finance === false || i.recorded_in_finance)
      .reduce((s, i) => s + i.total_amount, 0);
    const outstanding = active
      .filter((i) => i.payment_status !== "paid")
      .reduce((s, i) => s + (i.total_amount - i.amount_paid), 0);
    return { quotations: quotations.length, active: active.length, totalRevenue, outstanding };
  }, [invoices]);

  // Filtered list
  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (tab === "quotation" && inv.status !== "quotation") return false;
      if (tab === "invoice" && inv.status !== "invoice") return false;
      if (tab === "cancelled" && inv.status !== "cancelled") return false;
      if (tab === "daily_sales" && inv.invoice_type !== "daily_sales") return false;
      if (tab === "event" && inv.invoice_type !== "event") return false;

      if (search) {
        const q = search.toLowerCase();
        const match =
          inv.customer_name.toLowerCase().includes(q) ||
          inv.quotation_number.toLowerCase().includes(q) ||
          (inv.invoice_number ?? "").toLowerCase().includes(q) ||
          (inv.event_name ?? "").toLowerCase().includes(q);
        if (!match) return false;
      }

      if (dateFrom && inv.issue_date < dateFrom) return false;
      if (dateTo && inv.issue_date > dateTo) return false;
      if (paymentFilter !== "all" && inv.payment_status !== paymentFilter) return false;

      return true;
    });
  }, [invoices, tab, search, dateFrom, dateTo, paymentFilter]);

  const clearFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setPaymentFilter("all");
  };

  const hasFilters = search || dateFrom || dateTo || paymentFilter !== "all";

  const openCreate = (type?: InvoiceType) => {
    setEditingInvoice(null);
    setFormType(type);
    setFormOpen(true);
  };

  const openEdit = (inv: Invoice) => {
    setEditingInvoice(inv);
    setFormType(undefined);
    setFormOpen(true);
  };

  const openView = (inv: Invoice) => {
    setViewingInvoice(inv);
    setViewOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Quotations, daily sales invoices and event invoices
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => openCreate("daily_sales")}>
            <ShoppingCart className="h-4 w-4 mr-1.5" /> Daily Sales
          </Button>
          <Button onClick={() => openCreate("event")}>
            <CalendarDays className="h-4 w-4 mr-1.5" /> Event Invoice
          </Button>
          <Button variant="secondary" onClick={() => openCreate()}>
            <Plus className="h-4 w-4 mr-1.5" /> New Quotation
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Open Quotations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              <span className="text-2xl font-bold">{stats.quotations}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Active Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="text-2xl font-bold">{stats.active}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Total Invoiced
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-500" />
              <span className="text-lg font-bold">{formatNairaCompact(stats.totalRevenue)}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-500" />
              <span className="text-lg font-bold">{formatNairaCompact(stats.outstanding)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs + filters */}
      <div className="space-y-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="quotation">Quotations</TabsTrigger>
            <TabsTrigger value="invoice">Invoices</TabsTrigger>
            <TabsTrigger value="daily_sales">Daily Sales</TabsTrigger>
            <TabsTrigger value="event">Events</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by number, customer, event…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Input
            type="date"
            className="w-36"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
          />
          <Input
            type="date"
            className="w-36"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
          />
          <Select value={paymentFilter} onValueChange={setPaymentFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Payment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Payments</SelectItem>
              <SelectItem value="unpaid">Unpaid</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4 mr-1" /> Clear
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden md:table-cell">Date</TableHead>
              <TableHead className="hidden lg:table-cell">Valid Until</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Payment</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FileText className="h-8 w-8 opacity-40" />
                    <p>No invoices found</p>
                    <Button size="sm" variant="outline" onClick={() => openCreate()}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Create your first quotation
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((inv) => (
                <TableRow
                  key={inv.id}
                  className="cursor-pointer hover:bg-muted/40 transition-colors"
                  onClick={() => openView(inv)}
                >
                  <TableCell>
                    <div className="font-mono text-xs font-semibold">
                      {inv.invoice_number ?? inv.quotation_number}
                    </div>
                    {inv.invoice_number && (
                      <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                        {inv.quotation_number}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {inv.invoice_type === "event" ? (
                        <CalendarDays className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                      ) : (
                        <ShoppingCart className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      )}
                      <span className="text-xs">{TYPE_LABELS[inv.invoice_type]}</span>
                    </div>
                    {inv.event_name && (
                      <div className="text-[10px] text-muted-foreground truncate max-w-28 mt-0.5">
                        {inv.event_name}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium max-w-36 truncate">
                    {inv.customer_name}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {format(new Date(inv.issue_date), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {inv.valid_until
                      ? format(new Date(inv.valid_until), "dd MMM yyyy")
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-xs ${STATUS_BADGE[inv.status]}`}>
                      {STATUS_LABELS[inv.status]}
                    </Badge>
                    {inv.recorded_in_finance && (
                      <div className="mt-0.5">
                        <Badge variant="outline" className="text-[9px] bg-blue-50 text-blue-600 border-blue-200">
                          Finance
                        </Badge>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {inv.status === "invoice" ? (
                      <Badge variant="outline" className={`text-xs ${PAYMENT_BADGE[inv.payment_status]}`}>
                        {PAYMENT_STATUS_LABELS[inv.payment_status]}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatNairaCompact(inv.total_amount)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {filtered.length} record{filtered.length !== 1 ? "s" : ""} · Click a row to view details
      </p>

      {/* Dialogs */}
      <InvoiceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingInvoice={editingInvoice}
        defaultType={formType}
      />
      <InvoiceViewDialog
        invoice={viewingInvoice}
        open={viewOpen}
        onOpenChange={setViewOpen}
        onEdit={(inv) => {
          setViewOpen(false);
          openEdit(inv);
        }}
      />
    </div>
  );
}
