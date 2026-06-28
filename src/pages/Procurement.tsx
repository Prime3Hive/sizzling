import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatNairaCompact } from '@/lib/currency';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ui/responsive-table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Plus, Search, MoreHorizontal, Eye, Pencil, Send, PackageCheck,
  Download, XCircle, ShoppingCart, Clock, CheckCircle2, TrendingUp,
  X, FileText, Copy,
} from 'lucide-react';
import LPOSheet, { type LPO, type SourceRequest } from '@/components/procurement/LPOSheet';
import ReceiveGoodsDialog from '@/components/procurement/ReceiveGoodsDialog';
import { generateLPOPDF, generateBlankLPOPDF, getStoredCompany, saveCompanyDetails, CompanyDetails } from '@/lib/lpo-pdf';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

// ─── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  draft:              { label: 'Draft',              cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  sent:               { label: 'Sent',               cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  received:           { label: 'Received',           cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  partially_received: { label: 'Partial',            cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  cancelled:          { label: 'Cancelled',          cls: 'bg-red-100 text-red-700 border-red-200' },
};

// ─── Compact company details dialog for quick PDF export ──────────────────────
function CompanyDialog({
  open, onOpenChange, onExport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onExport: (c: CompanyDetails) => void;
}) {
  const [form, setForm] = useState<CompanyDetails>(getStoredCompany);
  const f = (k: keyof CompanyDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Company Details for PDF</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <p className="text-muted-foreground text-xs">Saved locally and printed on every exported LPO.</p>
          {([
            ['name', 'Company Name'], ['tagline', 'Tagline / Slogan'],
            ['address', 'Street Address'], ['city', 'City / State'],
            ['phone', 'Phone'], ['email', 'Email'], ['taxId', 'Tax ID / RC Number'],
          ] as [keyof CompanyDetails, string][]).map(([k, label]) => (
            <div key={k} className="space-y-1">
              <Label>{label}</Label>
              <Input value={form[k]} onChange={f(k)} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { saveCompanyDetails(form); onExport(form); onOpenChange(false); }}>
            <Download className="h-4 w-4 mr-2" />Export PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card className="border-border/50 overflow-hidden">
      <div className={`h-1 ${color}`} />
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${color.replace('bg-', 'bg-').replace('-500', '-100')} dark:bg-opacity-20`}>
            <Icon className={`h-5 w-5 ${color.replace('bg-', 'text-')}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function Procurement() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | 'view'>('create');
  const [selectedLPO, setSelectedLPO] = useState<LPO | null>(null);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveLPO, setReceiveLPO] = useState<LPO | null>(null);

  const [templateLPO, setTemplateLPO] = useState<LPO | undefined>(undefined);
  const [sourceRequest, setSourceRequest] = useState<SourceRequest | undefined>(undefined);

  // Reorder hand-off: Inventory low-stock "Reorder" navigates here with state
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const reorder = (location.state as any)?.reorder as SourceRequest | undefined;
    if (reorder) {
      setSelectedLPO(null);
      setTemplateLPO(undefined);
      setSourceRequest(reorder);
      setSheetMode('create');
      setSheetOpen(true);
      // clear the navigation state so it doesn't re-open on back/refresh
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const [companyDlgOpen, setCompanyDlgOpen] = useState(false);
  const [exportLPO, setExportLPO] = useState<LPO | null>(null);
  const [blankDlgOpen, setBlankDlgOpen] = useState(false);

  // ── Fetch LPOs ──────────────────────────────────────────────────────────────
  const { data: lpos = [], isLoading: lposLoading } = useQuery({
    queryKey: ['lpos'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('lpos')
        .select('*, lpo_items(*)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as LPO[];
    },
    staleTime: 2 * 60_000,
  });

  // ── Fetch GRNs ──────────────────────────────────────────────────────────────
  const { data: grns = [], isLoading: grnsLoading } = useQuery({
    queryKey: ['lpo-receipts-all'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('lpo_receipts')
        .select('*, lpos(lpo_number, supplier_name)')
        .order('received_date', { ascending: false });
      return (data ?? []) as any[];
    },
    staleTime: 2 * 60_000,
  });

  // ── Derived stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = lpos.length;
    const pending = lpos.filter(l => l.status === 'sent' || l.status === 'partially_received').length;
    const totalValue = lpos.reduce((s, l) => s + Number(l.total_amount), 0);
    const received = lpos.filter(l => l.status === 'received').length;
    return { total, pending, totalValue, received };
  }, [lpos]);

  // ── Filtered LPOs ────────────────────────────────────────────────────────────
  const filteredLPOs = useMemo(() => {
    let list = lpos;
    if (statusFilter !== 'all') list = list.filter(l => l.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(l =>
        l.lpo_number.toLowerCase().includes(q) ||
        l.supplier_name.toLowerCase().includes(q) ||
        (l.cost_center ?? '').toLowerCase().includes(q) ||
        (l.expense_category ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [lpos, search, statusFilter]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setSelectedLPO(null);
    setTemplateLPO(undefined);
    setSourceRequest(undefined);
    setSheetMode('create');
    setSheetOpen(true);
  };

  const openRepeat = (lpo: LPO) => {
    setSelectedLPO(null);
    setTemplateLPO(lpo);
    setSheetMode('create');
    setSheetOpen(true);
  };

  const openView = (lpo: LPO) => {
    setSelectedLPO(lpo);
    setTemplateLPO(undefined);
    setSheetMode('view');
    setSheetOpen(true);
  };

  const openEdit = (lpo: LPO) => {
    setSelectedLPO(lpo);
    setTemplateLPO(undefined);
    setSheetMode('edit');
    setSheetOpen(true);
  };

  const openReceive = (lpo: LPO) => {
    setReceiveLPO(lpo);
    setReceiveOpen(true);
  };

  const triggerExport = (lpo: LPO) => {
    setExportLPO(lpo);
    setCompanyDlgOpen(true);
  };

  const markSent = async (lpo: LPO) => {
    const { error } = await (supabase as any).from('lpos').update({ status: 'sent' }).eq('id', lpo.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'LPO marked as Sent' });
    qc.invalidateQueries({ queryKey: ['lpos'] });
  };

  const cancelLPO = async (lpo: LPO) => {
    const { error } = await (supabase as any).from('lpos').update({ status: 'cancelled' }).eq('id', lpo.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'LPO cancelled' });
    qc.invalidateQueries({ queryKey: ['lpos'] });
  };

  // ── Table column definitions ──────────────────────────────────────────────────
  const lpoColumns: ResponsiveColumn<LPO>[] = [
    {
      key: 'lpo_number', header: 'LPO Number', primary: true,
      cell: (lpo) => <span className="font-mono font-medium text-sm">{lpo.lpo_number}</span>,
    },
    {
      key: 'supplier', header: 'Supplier',
      cell: (lpo) => (
        <div className="max-w-[180px]">
          <p className="truncate text-sm font-medium">{lpo.supplier_name}</p>
          {lpo.supplier_phone && <p className="text-xs text-muted-foreground truncate">{lpo.supplier_phone}</p>}
        </div>
      ),
    },
    {
      key: 'order_date', header: 'Order Date',
      cell: (lpo) => <span className="text-sm text-muted-foreground">{format(new Date(lpo.order_date), 'dd MMM yyyy')}</span>,
    },
    {
      key: 'expected', header: 'Expected Delivery',
      cell: (lpo) => (
        <span className="text-sm text-muted-foreground">
          {lpo.expected_delivery ? format(new Date(lpo.expected_delivery), 'dd MMM yyyy') : <span className="text-muted-foreground/40">—</span>}
        </span>
      ),
    },
    {
      key: 'cost_center', header: 'Cost Centre',
      cell: (lpo) => <span className="text-sm text-muted-foreground">{lpo.cost_center ?? '—'}</span>,
    },
    {
      key: 'status', header: 'Status',
      cell: (lpo) => {
        const sc = STATUS_CFG[lpo.status] ?? STATUS_CFG.draft;
        return <Badge variant="outline" className={`border text-xs ${sc.cls}`}>{sc.label}</Badge>;
      },
    },
    {
      key: 'total', header: 'Total (₦)', align: 'right',
      cell: (lpo) => (
        <span className="font-semibold tabular-nums">
          {Number(lpo.total_amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: 'actions', header: '', align: 'right', mobileFooter: true,
      cell: (lpo) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 max-md:w-full max-md:border max-md:rounded-md">
              <MoreHorizontal className="h-4 w-4" />
              <span className="md:hidden ml-2">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => openView(lpo)}>
              <Eye className="h-3.5 w-3.5 mr-2" />View
            </DropdownMenuItem>
            {lpo.status === 'draft' && (
              <>
                <DropdownMenuItem onClick={() => openEdit(lpo)}>
                  <Pencil className="h-3.5 w-3.5 mr-2" />Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => markSent(lpo)}>
                  <Send className="h-3.5 w-3.5 mr-2" />Mark Sent
                </DropdownMenuItem>
              </>
            )}
            {(lpo.status === 'sent' || lpo.status === 'partially_received') && (
              <DropdownMenuItem onClick={() => openReceive(lpo)} className="text-emerald-700 focus:text-emerald-700">
                <PackageCheck className="h-3.5 w-3.5 mr-2" />Receive Goods
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openRepeat(lpo)}>
              <Copy className="h-3.5 w-3.5 mr-2" />Repeat Order
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => triggerExport(lpo)}>
              <Download className="h-3.5 w-3.5 mr-2" />Export PDF
            </DropdownMenuItem>
            {lpo.status !== 'cancelled' && lpo.status !== 'received' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => cancelLPO(lpo)} className="text-destructive focus:text-destructive">
                  <XCircle className="h-3.5 w-3.5 mr-2" />Cancel LPO
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const grnColumns: ResponsiveColumn<any>[] = [
    { key: 'grn', header: 'GRN Number', primary: true, cell: (g) => <span className="font-mono font-medium text-sm">{g.receipt_number}</span> },
    { key: 'lpo', header: 'LPO', cell: (g) => <span className="font-mono text-sm text-muted-foreground">{g.lpos?.lpo_number ?? '—'}</span> },
    { key: 'supplier', header: 'Supplier', cell: (g) => <span className="text-sm">{g.lpos?.supplier_name ?? '—'}</span> },
    { key: 'date', header: 'Received Date', cell: (g) => <span className="text-sm text-muted-foreground">{format(new Date(g.received_date), 'dd MMM yyyy')}</span> },
    {
      key: 'amount', header: 'Amount (₦)', align: 'right',
      cell: (g) => <span className="font-semibold tabular-nums">{Number(g.total_received_amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</span>,
    },
    {
      key: 'expense', header: 'Expense',
      cell: (g) => g.expense_id
        ? <Badge variant="outline" className="text-xs text-emerald-700 border-emerald-200 bg-emerald-50"><CheckCircle2 className="h-3 w-3 mr-1" />Linked</Badge>
        : <Badge variant="outline" className="text-xs text-muted-foreground">None</Badge>,
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-1 sm:p-4 md:p-6 max-w-7xl mx-auto">

      {/* ── Page header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Procurement</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage Local Purchase Orders, goods receipt, and supplier expenses
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBlankDlgOpen(true)} className="gap-2">
            <FileText className="h-4 w-4" />
            Blank Template
          </Button>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            New LPO
          </Button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total LPOs" value={stats.total}
          icon={FileText} color="bg-indigo-500"
        />
        <StatCard
          label="Pending Delivery" value={stats.pending}
          sub="Sent or partially received"
          icon={Clock} color="bg-amber-500"
        />
        <StatCard
          label="Total Order Value" value={formatNairaCompact(stats.totalValue)}
          icon={TrendingUp} color="bg-violet-500"
        />
        <StatCard
          label="Fully Received" value={stats.received}
          icon={CheckCircle2} color="bg-emerald-500"
        />
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="lpos">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <TabsList>
            <TabsTrigger value="lpos" className="gap-2">
              <ShoppingCart className="h-3.5 w-3.5" />LPOs
            </TabsTrigger>
            <TabsTrigger value="grn" className="gap-2">
              <PackageCheck className="h-3.5 w-3.5" />Goods Received
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search LPOs…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9 w-full sm:w-52 text-sm"
              />
              {search && (
                <button
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearch('')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-36 sm:w-44 shrink-0">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(STATUS_CFG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── LPOs table ── */}
        <TabsContent value="lpos">
          <Card className="border-border/50">
            <CardContent className="p-0">
              {lposLoading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
                </div>
              ) : filteredLPOs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                  <ShoppingCart className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-muted-foreground font-medium">
                    {search || statusFilter !== 'all' ? 'No LPOs match your filters' : 'No LPOs yet'}
                  </p>
                  {!search && statusFilter === 'all' && (
                    <Button variant="outline" size="sm" onClick={openCreate}>
                      <Plus className="h-3.5 w-3.5 mr-1" />Create your first LPO
                    </Button>
                  )}
                </div>
              ) : (
                <div className="px-2 md:px-0">
                  <ResponsiveTable
                    columns={lpoColumns}
                    data={filteredLPOs}
                    rowKey={(lpo) => lpo.id}
                    onRowClick={openView}
                    mobileSubtitle={(lpo) => lpo.supplier_name}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {filteredLPOs.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2 text-right">
              Showing {filteredLPOs.length} of {lpos.length} LPOs
            </p>
          )}
        </TabsContent>

        {/* ── GRN table ── */}
        <TabsContent value="grn">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Goods Received Notes</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {grnsLoading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
                </div>
              ) : grns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <PackageCheck className="h-10 w-10 text-muted-foreground/40" />
                  <p className="text-muted-foreground font-medium">No goods received yet</p>
                </div>
              ) : (
                <div className="px-2 md:px-0">
                  <ResponsiveTable
                    columns={grnColumns}
                    data={grns}
                    rowKey={(g) => g.id}
                    mobileSubtitle={(g) => g.lpos?.supplier_name ?? undefined}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── LPO Sheet ── */}
      <LPOSheet
        mode={sheetMode}
        lpo={selectedLPO ?? undefined}
        templateLPO={templateLPO}
        sourceRequest={sourceRequest}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['lpos'] })}
        onReceive={lpo => { setSheetOpen(false); openReceive(lpo); }}
      />

      {/* ── Receive Goods Dialog ── */}
      <ReceiveGoodsDialog
        lpo={receiveLPO}
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['lpos'] });
          qc.invalidateQueries({ queryKey: ['lpo-receipts-all'] });
        }}
      />

      {/* ── Company / PDF Export Dialog ── */}
      <CompanyDialog
        open={companyDlgOpen}
        onOpenChange={setCompanyDlgOpen}
        onExport={company => {
          if (exportLPO) generateLPOPDF(exportLPO, company).catch(console.error);
        }}
      />

      {/* ── Blank template export dialog ── */}
      <CompanyDialog
        open={blankDlgOpen}
        onOpenChange={setBlankDlgOpen}
        onExport={company => {
          generateBlankLPOPDF(company).catch(console.error);
        }}
      />
    </div>
  );
}
