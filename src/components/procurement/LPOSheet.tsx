import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { formatNairaCompact } from '@/lib/currency';
import { format } from 'date-fns';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Plus, Trash2, Download, Check, ChevronsUpDown, Package,
  Pencil, Send, PackageCheck, X,
} from 'lucide-react';
import { ACCOUNT_TYPES, COST_CENTERS } from '@/lib/expenseConstants';
import { useExpenseCategories, usePayees } from '@/hooks/useExpenseReference';
import { UNITS_OF_MEASURE } from '@/lib/inventoryConstants';

// How the supplier is paid. "Credit" = owed: receiving the goods records the
// cost against Accounts Payable until "Pay supplier" settles it.
const LPO_PAYMENT_METHODS = ['Credit', 'Transfer', 'Cash', 'POS', 'Card'] as const;
import { generateLPOPDF, getStoredCompany, saveCompanyDetails, CompanyDetails } from '@/lib/lpo-pdf';

// ─── Types ────────────────────────────────────────────────────────────────────
import { useItemUnits, type ItemUnitInfo } from '@/hooks/useItemUnits';
import { factorOf, fmtQty, normaliseUnit } from '@/lib/units';

const NO_UNITS = new Map<string, ItemUnitInfo>();

export interface LPOItem {
  id: string;
  lpo_id: string;
  item_name: string;
  sku_id: string | null;
  product_id?: string | null;
  description: string | null;
  quantity: number;
  unit_of_measure: string;
  unit_price: number;
  total_price: number;
  quantity_received: number;
}

export interface LPO {
  id: string;
  lpo_number: string;
  supplier_name: string;
  supplier_email: string | null;
  supplier_phone: string | null;
  supplier_address: string | null;
  status: 'draft' | 'sent' | 'received' | 'partially_received' | 'cancelled';
  order_date: string;
  expected_delivery: string | null;
  notes: string | null;
  total_amount: number;
  account_type: string | null;
  cost_center: string | null;
  expense_category: string | null;
  payment_method: string | null;
  budget_id: string | null;
  inventory_request_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  lpo_items?: LPOItem[];
}

/** Pre-fill a new LPO from an approved inventory request */
export interface SourceRequestItem {
  item_name: string;
  sku_id: string | null;
  quantity: number;
  unit_of_measure: string;
  unit_price: number;
}

export interface SourceRequest {
  id: string;
  item_name: string;
  sku_id: string | null;
  quantity: number;
  unit_of_measure: string;
  unit_price: number;
  requester_name?: string;
  /** When a request has multiple items, all of them are pre-filled as LPO lines. */
  items?: SourceRequestItem[];
}

interface LineDraft {
  _key: string;
  item_name: string;
  sku_id: string | null;
  product_id: string | null;
  description: string;
  quantity: number;
  unit_of_measure: string;
  unit_price: number;
  total_price: number;
}

interface LPOSheetProps {
  mode: 'create' | 'edit' | 'view';
  lpo?: LPO;
  /** Pre-fill a new LPO from an existing one (repeat order). Only used when mode === 'create'. */
  templateLPO?: LPO;
  /** Pre-fill a new LPO from an approved inventory request. Only used when mode === 'create'. */
  sourceRequest?: SourceRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  onReceive?: (lpo: LPO) => void;
}

// ─── Status badge config ──────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  draft:              { label: 'Draft',              cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  sent:               { label: 'Sent',               cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  received:           { label: 'Received',           cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  partially_received: { label: 'Partially Received', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  cancelled:          { label: 'Cancelled',          cls: 'bg-red-100 text-red-700 border-red-200' },
};

const newLine = (): LineDraft => ({
  _key: crypto.randomUUID(),
  item_name: '', sku_id: null, product_id: null, description: '',
  quantity: 1, unit_of_measure: 'unit', unit_price: 0, total_price: 0,
});

const defaultForm = () => ({
  supplier_name: '', supplier_email: '', supplier_phone: '', supplier_address: '',
  order_date: format(new Date(), 'yyyy-MM-dd'),
  expected_delivery: '',
  account_type: 'COGS',
  cost_center: 'Daily Orders',
  expense_category: '',
  payment_method: 'Credit',
  budget_id: '',
  notes: '',
});

// ─── Quick-create SKU dialog ──────────────────────────────────────────────────
function QuickCreateProductDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (product: { id: string; name: string; uom: string; price: number }) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ name: '', uom: 'kg', price: '', item_type: 'non_sellable' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase as any).from('products').insert({
        name: form.name.trim(),
        uom: form.uom || 'kg',
        price: form.price ? parseFloat(form.price) : 0,
        // Procurement items: the entered price is what we pay — it is the cost
        // used for inventory valuation and COGS.
        cost_price: form.price ? parseFloat(form.price) : 0,
        item_type: form.item_type,
        // Placed from the item's name by the database (Proteins, Fresh Produce …).
        category: 'Procurement',
        created_by: user?.id,
        user_id: user?.id!,
      }).select('id, name, uom, price').single();
      if (error) throw error;
      toast({ title: 'Item created', description: `"${data.name}" added to inventory` });
      onCreated(data);
      onOpenChange(false);
      setForm({ name: '', uom: 'kg', price: '', item_type: 'non_sellable' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create New Inventory Item</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Item Name <span className="text-destructive">*</span></Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Fresh Chicken" required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Unit of Measure</Label>
              <Select value={form.uom} onValueChange={v => setForm(f => ({ ...f, uom: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS_OF_MEASURE.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Cost / Price (₦)</Label>
              <Input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Item Type</Label>
            <Select value={form.item_type} onValueChange={v => setForm(f => ({ ...f, item_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="non_sellable">Non-sellable (supply / raw material)</SelectItem>
                <SelectItem value="sellable">Sellable (invoiceable)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Item'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Product Combobox cell (item master) ──────────────────────────────────────
function ProductCombobox({
  value, onSelect, products, onCreateNew,
}: {
  value: string;
  onSelect: (name: string, productId: string | null, skuId: string | null, uom: string, price: number) => void;
  products: any[];
  onCreateNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() =>
    products.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 12),
    [products, query],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between h-8 text-sm font-normal truncate"
        >
          <span className="truncate">{value || 'Select an inventory item…'}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search items…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              <div className="py-2 px-3 text-sm text-muted-foreground">No items found.</div>
            </CommandEmpty>
            <CommandGroup heading="Inventory items">
              {filtered.map(p => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => {
                    onSelect(p.name, p.id, p.sku_id ?? null, p.uom ?? 'unit', Number(p.price) || 0);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <Check className={`mr-2 h-3.5 w-3.5 ${value === p.name ? 'opacity-100' : 'opacity-0'}`} />
                  <div>
                    <p className="text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.uom ?? 'unit'}
                      {p.price ? ` · ₦${Number(p.price).toLocaleString()}` : ''}
                      {p.item_type === 'non_sellable' ? ' · non-sellable' : ''}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup>
              <CommandItem
                onSelect={() => { setOpen(false); onCreateNew(); }}
                className="text-primary font-medium"
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                Create new item…
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Company details dialog ───────────────────────────────────────────────────
function CompanyDialog({
  open, onOpenChange, onExport, lpo,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onExport: (c: CompanyDetails) => void;
  lpo: LPO | undefined;
}) {
  const [form, setForm] = useState<CompanyDetails>(getStoredCompany);
  const f = (k: keyof CompanyDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Company Details for PDF</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2 text-sm">
          <p className="text-muted-foreground text-xs">These details appear on the exported LPO document. They are saved locally.</p>
          {([
            ['name',    'Company Name'],
            ['tagline', 'Tagline / Slogan'],
            ['address', 'Street Address'],
            ['city',    'City / State'],
            ['phone',   'Phone Number'],
            ['email',   'Email Address'],
            ['taxId',   'Tax ID / RC Number'],
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

// ─── Main LPOSheet component ──────────────────────────────────────────────────
export default function LPOSheet({ mode, lpo, templateLPO, sourceRequest, open, onOpenChange, onSuccess, onReceive }: LPOSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState(defaultForm());
  const { data: expenseCategories = [] } = useExpenseCategories();
  const { data: payees = [] } = usePayees();
  const supplierNames = payees.filter(p => p.kind === 'supplier').map(p => p.name);
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  // Pack sizes are offered only once goods received notes convert them
  // (migration 20261123200000); before that an order stays in the stock unit.
  const { bySku: allUnitsBySku, ready: unitsReady } = useItemUnits();
  const unitsBySku = unitsReady ? allUnitsBySku : NO_UNITS;
  const [saving, setSaving] = useState(false);
  const [showCreateSKU, setShowCreateSKU] = useState(false);
  const [showCompanyDlg, setShowCompanyDlg] = useState(false);
  const [internalMode, setInternalMode] = useState<'create' | 'edit' | 'view'>(mode);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-lpo'],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('products')
        .select('id, name, uom, price, sku_id, item_type')
        .order('name');
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const { data: budgets = [] } = useQuery({
    queryKey: ['budgets-for-lpo'],
    queryFn: async () => {
      const { data } = await supabase.from('budgets').select('id, title').order('title');
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const { data: receipts = [] } = useQuery({
    queryKey: ['lpo-receipts', lpo?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('lpo_receipts')
        .select('*')
        .eq('lpo_id', lpo!.id)
        .order('received_date', { ascending: false });
      return (data ?? []) as any[];
    },
    enabled: !!lpo?.id && internalMode === 'view',
  });

  // ── Sync form when lpo changes ───────────────────────────────────────────────
  useEffect(() => {
    setInternalMode(mode);
    if ((mode === 'edit' || mode === 'view') && lpo) {
      setForm({
        supplier_name: lpo.supplier_name,
        supplier_email: lpo.supplier_email ?? '',
        supplier_phone: lpo.supplier_phone ?? '',
        supplier_address: lpo.supplier_address ?? '',
        order_date: lpo.order_date,
        expected_delivery: lpo.expected_delivery ?? '',
        account_type: lpo.account_type ?? 'COGS',
        cost_center: lpo.cost_center ?? 'Daily Orders',
        expense_category: lpo.expense_category ?? '',
        payment_method: lpo.payment_method ?? '',
        budget_id: lpo.budget_id ?? '',
        notes: lpo.notes ?? '',
      });
      setLines(
        lpo.lpo_items?.length
          ? lpo.lpo_items.map(i => ({
              _key: i.id,
              item_name: i.item_name,
              sku_id: i.sku_id,
              product_id: i.product_id ?? null,
              description: i.description ?? '',
              quantity: i.quantity,
              unit_of_measure: i.unit_of_measure,
              unit_price: i.unit_price,
              total_price: i.total_price,
            }))
          : [newLine()],
      );
    } else if (mode === 'create') {
      if (templateLPO) {
        // Repeat order — pre-fill from template, fresh date, no id
        setForm({
          supplier_name: templateLPO.supplier_name,
          supplier_email: templateLPO.supplier_email ?? '',
          supplier_phone: templateLPO.supplier_phone ?? '',
          supplier_address: templateLPO.supplier_address ?? '',
          order_date: format(new Date(), 'yyyy-MM-dd'),
          expected_delivery: '',
          account_type: templateLPO.account_type ?? 'COGS',
          cost_center: templateLPO.cost_center ?? 'Daily Orders',
          expense_category: templateLPO.expense_category ?? '',
          payment_method: templateLPO.payment_method ?? '',
          budget_id: templateLPO.budget_id ?? '',
          notes: templateLPO.notes ?? '',
        });
        setLines(
          templateLPO.lpo_items?.length
            ? templateLPO.lpo_items.map(i => ({
                _key: crypto.randomUUID(),
                item_name: i.item_name,
                sku_id: i.sku_id,
                product_id: i.product_id ?? null,
                description: i.description ?? '',
                quantity: i.quantity,
                unit_of_measure: i.unit_of_measure,
                unit_price: i.unit_price,
                total_price: i.total_price,
              }))
            : [newLine()],
        );
      } else if (sourceRequest) {
        // From approved inventory request — pre-fill all of its line items
        setForm({
          ...defaultForm(),
          notes: sourceRequest.requester_name
            ? `Generated from inventory request by ${sourceRequest.requester_name}`
            : '',
        });
        const srcItems = sourceRequest.items?.length
          ? sourceRequest.items
          : [{
              item_name: sourceRequest.item_name,
              sku_id: sourceRequest.sku_id,
              quantity: sourceRequest.quantity,
              unit_of_measure: sourceRequest.unit_of_measure,
              unit_price: sourceRequest.unit_price,
            }];
        setLines(srcItems.map(it => ({
          _key: crypto.randomUUID(),
          item_name: it.item_name,
          sku_id: it.sku_id,
          product_id: null,
          description: '',
          quantity: it.quantity,
          unit_of_measure: it.unit_of_measure,
          unit_price: it.unit_price,
          total_price: it.quantity * it.unit_price,
        })));
      } else {
        setForm(defaultForm());
        setLines([newLine()]);
      }
    }
  }, [mode, lpo, templateLPO, sourceRequest, open]);

  // ── Line item helpers ─────────────────────────────────────────────────────────
  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines(prev => prev.map(l => {
      if (l._key !== key) return l;
      const updated = { ...l, ...patch };
      updated.total_price = updated.quantity * updated.unit_price;
      return updated;
    }));
  };

  const totalAmount = lines.reduce((s, l) => s + l.total_price, 0);

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.supplier_name.trim()) {
      toast({ title: 'Supplier name is required', variant: 'destructive' });
      return;
    }
    if (lines.some(l => !l.item_name.trim())) {
      toast({ title: 'All item rows must have a name', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const lpoPayload = {
        supplier_name: form.supplier_name.trim(),
        supplier_email: form.supplier_email || null,
        supplier_phone: form.supplier_phone || null,
        supplier_address: form.supplier_address || null,
        order_date: form.order_date,
        expected_delivery: form.expected_delivery || null,
        account_type: form.account_type,
        cost_center: form.cost_center,
        expense_category: form.expense_category,
        payment_method: form.payment_method || null,
        budget_id: form.budget_id || null,
        notes: form.notes || null,
        total_amount: totalAmount,
      };

      if (internalMode === 'create') {
        const lpoNumber = `LPO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
        const { data: created, error: lpoErr } = await (supabase as any)
          .from('lpos')
          .insert({
            ...lpoPayload,
            lpo_number: lpoNumber,
            created_by: user?.id,
            status: 'draft',
            inventory_request_id: sourceRequest?.id ?? null,
          })
          .select()
          .single();
        if (lpoErr) throw lpoErr;

        const itemsPayload = lines.map(l => ({
          lpo_id: created.id,
          item_name: l.item_name,
          sku_id: l.sku_id,
          product_id: l.product_id,
          description: l.description || null,
          quantity: l.quantity,
          unit_of_measure: l.unit_of_measure,
          unit_price: l.unit_price,
          total_price: l.total_price,
        }));
        const { error: itemsErr } = await (supabase as any).from('lpo_items').insert(itemsPayload);
        if (itemsErr) throw itemsErr;

        toast({ title: 'LPO created', description: `${lpoNumber} is in draft` });
      } else {
        // edit
        const { error: updErr } = await (supabase as any)
          .from('lpos')
          .update(lpoPayload)
          .eq('id', lpo!.id);
        if (updErr) throw updErr;

        // replace items
        await (supabase as any).from('lpo_items').delete().eq('lpo_id', lpo!.id);
        const itemsPayload = lines.map(l => ({
          lpo_id: lpo!.id,
          item_name: l.item_name,
          sku_id: l.sku_id,
          product_id: l.product_id,
          description: l.description || null,
          quantity: l.quantity,
          unit_of_measure: l.unit_of_measure,
          unit_price: l.unit_price,
          total_price: l.total_price,
        }));
        await (supabase as any).from('lpo_items').insert(itemsPayload);
        toast({ title: 'LPO updated' });
      }

      qc.invalidateQueries({ queryKey: ['lpos'] });
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleMarkSent = async () => {
    if (!lpo) return;
    const { error } = await (supabase as any).from('lpos').update({ status: 'sent' }).eq('id', lpo.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'LPO marked as Sent' });
    qc.invalidateQueries({ queryKey: ['lpos'] });
    onSuccess();
    onOpenChange(false);
  };

  const isEditable = internalMode !== 'view';
  const statusCfg = lpo ? STATUS_CFG[lpo.status] : null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-2xl p-0 gap-0 flex flex-col">
          {/* Header */}
          <div className={`p-5 shrink-0 ${internalMode === 'view' ? 'bg-gradient-to-r from-indigo-600 to-violet-600' : 'bg-muted/40 border-b border-border'}`}>
            <SheetHeader>
              <SheetTitle className={internalMode === 'view' ? 'text-white text-xl' : 'text-xl'}>
                {internalMode === 'create'
                  ? templateLPO    ? `Repeat Order — ${templateLPO.lpo_number}`
                  : sourceRequest  ? `Raise LPO — ${sourceRequest.item_name}`
                  : 'New Local Purchase Order'
                  : internalMode === 'edit' ? `Edit ${lpo?.lpo_number}`
                  : lpo?.lpo_number}
              </SheetTitle>
            </SheetHeader>
            {internalMode === 'view' && lpo && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge className={`border ${statusCfg?.cls} bg-transparent`}>{statusCfg?.label}</Badge>
                <span className="text-white/70 text-sm">{lpo.supplier_name}</span>
                <span className="text-white/70 text-sm ml-auto font-semibold">{formatNairaCompact(lpo.total_amount)}</span>
              </div>
            )}
            {/* View-mode action buttons */}
            {internalMode === 'view' && lpo && (
              <div className="mt-3 flex flex-wrap gap-2">
                {lpo.status === 'draft' && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setInternalMode('edit')}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                    </Button>
                    <Button size="sm" variant="secondary" onClick={handleMarkSent}>
                      <Send className="h-3.5 w-3.5 mr-1" />Mark Sent
                    </Button>
                  </>
                )}
                {(lpo.status === 'sent' || lpo.status === 'partially_received') && onReceive && (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { onOpenChange(false); onReceive(lpo); }}>
                    <PackageCheck className="h-3.5 w-3.5 mr-1" />Receive Goods
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setShowCompanyDlg(true)}>
                  <Download className="h-3.5 w-3.5 mr-1" />Export PDF
                </Button>
              </div>
            )}
          </div>

          <ScrollArea className="flex-1">
            <form id="lpo-form" onSubmit={handleSubmit}>
              <div className="p-5 space-y-6">

                {/* ── Supplier ─────────────────────────────────────────── */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Package className="h-3.5 w-3.5" />Supplier
                  </h3>
                  <div className="grid gap-3">
                    <div>
                      <Label>Supplier Name <span className="text-destructive">*</span></Label>
                      <Input
                        className="mt-1"
                        value={form.supplier_name}
                        onChange={f('supplier_name')}
                        placeholder="ABC Suppliers Ltd"
                        disabled={!isEditable}
                        list="lpo-supplier-list"
                        required
                      />
                      <datalist id="lpo-supplier-list">
                        {supplierNames.map(n => <option key={n} value={n} />)}
                      </datalist>
                      <p className="text-[11px] text-muted-foreground mt-1">Pick an existing supplier where you can; the same name is used for every LPO and expense.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label>Phone</Label>
                        <Input className="mt-1" value={form.supplier_phone} onChange={f('supplier_phone')} placeholder="+234…" disabled={!isEditable} />
                      </div>
                      <div>
                        <Label>Email</Label>
                        <Input className="mt-1" type="email" value={form.supplier_email} onChange={f('supplier_email')} placeholder="supplier@email.com" disabled={!isEditable} />
                      </div>
                    </div>
                    <div>
                      <Label>Address</Label>
                      <Input className="mt-1" value={form.supplier_address} onChange={f('supplier_address')} placeholder="Street, City" disabled={!isEditable} />
                    </div>
                  </div>
                </section>

                <Separator />

                {/* ── Dates & Financial Settings ───────────────────────── */}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Order Settings</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Order Date <span className="text-destructive">*</span></Label>
                      <Input className="mt-1" type="date" value={form.order_date} onChange={f('order_date')} disabled={!isEditable} required />
                    </div>
                    <div>
                      <Label>Expected Delivery</Label>
                      <Input className="mt-1" type="date" value={form.expected_delivery} onChange={f('expected_delivery')} disabled={!isEditable} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Account Type</Label>
                      <Select value={form.account_type} onValueChange={v => setForm(p => ({ ...p, account_type: v }))} disabled={!isEditable}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Cost Centre</Label>
                      <Select value={form.cost_center} onValueChange={v => setForm(p => ({ ...p, cost_center: v }))} disabled={!isEditable}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COST_CENTERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Expense Category</Label>
                      <Select value={form.expense_category || '__auto'} onValueChange={v => setForm(p => ({ ...p, expense_category: v === '__auto' ? '' : v }))} disabled={!isEditable}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="From the items" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__auto">From the items received</SelectItem>
                          {expenseCategories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Payment Method</Label>
                      <Select value={form.payment_method || '__none'} onValueChange={v => setForm(p => ({ ...p, payment_method: v === '__none' ? '' : v }))} disabled={!isEditable}>
                        <SelectTrigger className="mt-1"><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          {LPO_PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m === 'Credit' ? 'Credit (pay supplier later)' : `${m} (paid on the spot)`}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Budget (blank = the month's budget)</Label>
                    <Select value={form.budget_id || '__none'} onValueChange={v => setForm(p => ({ ...p, budget_id: v === '__none' ? '' : v }))} disabled={!isEditable}>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select budget…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">No budget</SelectItem>
                        {budgets.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </section>

                <Separator />

                {/* ── Line Items ───────────────────────────────────────── */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Line Items ({lines.length})
                    </h3>
                    {isEditable && (
                      <Button type="button" size="sm" variant="outline" onClick={() => setLines(p => [...p, newLine()])}>
                        <Plus className="h-3.5 w-3.5 mr-1" />Add Row
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    {lines.map((line, idx) => (
                      <div key={line._key} className="rounded-lg border border-border/60 p-3 space-y-2 bg-muted/20">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-5 shrink-0 text-center font-mono">{idx + 1}</span>
                          <div className="flex-1">
                            {isEditable ? (
                              <ProductCombobox
                                value={line.item_name}
                                products={products}
                                onSelect={(name, productId, skuId, uom, price) => {
                                  // Order in the unit it is bought in, priced per that unit.
                                  const u = skuId ? unitsBySku.get(skuId) : undefined;
                                  const unit = u?.purchaseUnit ?? uom;
                                  const perUnit = Math.round(price * (factorOf(u, unit) ?? 1) * 100) / 100;
                                  updateLine(line._key, { item_name: name, product_id: productId, sku_id: skuId, unit_of_measure: unit, unit_price: perUnit, total_price: line.quantity * perUnit });
                                }}
                                onCreateNew={() => setShowCreateSKU(true)}
                              />
                            ) : (
                              <p className="text-sm font-medium">{line.item_name}</p>
                            )}
                          </div>
                          {isEditable && (
                            <Button type="button" size="icon" variant="ghost" className="h-9 w-9 md:h-8 md:w-8 text-destructive hover:text-destructive shrink-0"
                              onClick={() => setLines(p => p.filter(l => l._key !== line._key))}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 ml-0 sm:ml-7">
                          <div>
                            <Label className="text-xs">Qty</Label>
                            <Input
                              type="number" min="0" step="any" className="mt-0.5 h-8 text-sm"
                              value={line.quantity}
                              onChange={e => updateLine(line._key, { quantity: parseFloat(e.target.value) || 0 })}
                              disabled={!isEditable}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Unit</Label>
                            {line.sku_id && unitsBySku.get(line.sku_id) ? (() => {
                              // A stocked item is ordered in its stock unit or one
                              // of its pack sizes; the database refuses any other.
                              const u = unitsBySku.get(line.sku_id!)!;
                              const current = normaliseUnit(line.unit_of_measure);
                              const f = factorOf(u, current);
                              return (
                                <>
                                  <select
                                    aria-label="Unit"
                                    className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                                    value={current}
                                    disabled={!isEditable}
                                    onChange={e => {
                                      // Keep the same price per stock unit when the unit changes.
                                      const nf = factorOf(u, e.target.value) ?? 1;
                                      const price = Math.round((line.unit_price / (f ?? 1)) * nf * 100) / 100;
                                      updateLine(line._key, { unit_of_measure: e.target.value, unit_price: price, total_price: line.quantity * price });
                                    }}
                                  >
                                    {f == null && <option value={current}>{current}</option>}
                                    {u.units.map(x => <option key={x.name} value={x.name}>{x.name}</option>)}
                                  </select>
                                  {f != null && f !== 1 && line.quantity > 0 && (
                                    <p className="mt-0.5 text-[11px] text-muted-foreground">= {fmtQty(line.quantity * f)} {u.stockUnit}</p>
                                  )}
                                </>
                              );
                            })() : (
                              <Input
                                className="mt-0.5 h-8 text-sm"
                                value={line.unit_of_measure}
                                onChange={e => updateLine(line._key, { unit_of_measure: e.target.value })}
                                placeholder="kg, bag…"
                                disabled={!isEditable}
                              />
                            )}
                          </div>
                          <div>
                            <Label className="text-xs">Unit Price (₦)</Label>
                            <Input
                              type="number" min="0" step="0.01" className="mt-0.5 h-8 text-sm"
                              value={line.unit_price}
                              onChange={e => updateLine(line._key, { unit_price: parseFloat(e.target.value) || 0 })}
                              disabled={!isEditable}
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Total</Label>
                            <div className="mt-0.5 h-8 flex items-center text-sm font-semibold text-emerald-700">
                              {formatNairaCompact(line.total_price)}
                            </div>
                          </div>
                        </div>

                        {(isEditable || line.description) && (
                          <div className="ml-7">
                            <Input
                              className="h-7 text-xs"
                              value={line.description}
                              onChange={e => updateLine(line._key, { description: e.target.value })}
                              placeholder="Description / notes for this item (optional)"
                              disabled={!isEditable}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Total */}
                  <div className="flex justify-end pt-1">
                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2 dark:bg-indigo-950/20 dark:border-indigo-900/30">
                      <span className="text-xs text-muted-foreground">Order Total</span>
                      <p className="text-xl font-bold text-indigo-700 dark:text-indigo-400">{formatNairaCompact(totalAmount)}</p>
                    </div>
                  </div>
                </section>

                <Separator />

                {/* ── Notes ────────────────────────────────────────────── */}
                <section>
                  <Label>Notes</Label>
                  <Textarea
                    className="mt-1"
                    value={form.notes}
                    onChange={f('notes')}
                    placeholder="Terms, delivery instructions, special requirements…"
                    rows={3}
                    disabled={!isEditable}
                  />
                </section>

                {/* ── Goods Received History (view mode) ───────────────── */}
                {internalMode === 'view' && receipts.length > 0 && (
                  <>
                    <Separator />
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Goods Received Notes</h3>
                      {receipts.map((r: any) => (
                        <div key={r.id} className="flex items-center justify-between rounded-lg border border-border/50 p-3 text-sm">
                          <div>
                            <p className="font-medium font-mono">{r.receipt_number}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(new Date(r.received_date), 'dd MMM yyyy')}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-emerald-600">{formatNairaCompact(r.total_received_amount)}</p>
                            {r.expense_id && (
                              <Badge variant="outline" className="text-xs mt-0.5 text-emerald-700 border-emerald-200 bg-emerald-50">
                                Expense created
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </section>
                  </>
                )}
              </div>
            </form>
          </ScrollArea>

          {/* Footer */}
          {isEditable && (
            <SheetFooter className="p-4 border-t border-border shrink-0 flex gap-2">
              <Button variant="outline" onClick={() => {
                if (internalMode === 'edit') setInternalMode('view');
                else onOpenChange(false);
              }}>
                <X className="h-4 w-4 mr-1" />Cancel
              </Button>
              <Button form="lpo-form" type="submit" disabled={saving} className="flex-1">
                {saving ? 'Saving…' : internalMode === 'create' ? 'Create LPO' : 'Save Changes'}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      <QuickCreateProductDialog
        open={showCreateSKU}
        onOpenChange={setShowCreateSKU}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['products-for-lpo'] });
        }}
      />

      <CompanyDialog
        open={showCompanyDlg}
        onOpenChange={setShowCompanyDlg}
        lpo={lpo}
        onExport={company => { generateLPOPDF({ ...lpo, lpo_items: lines }, company).catch(console.error); }}
      />
    </>
  );
}
