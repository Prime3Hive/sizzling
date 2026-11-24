import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Package, Plus, Receipt, X } from 'lucide-react';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import PayeeField, { ONE_OFF } from '@/components/expenses/PayeeField';
import ReceiptUpload from '@/components/expenses/ReceiptUpload';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { useItemUnits } from '@/hooks/useItemUnits';
import { useInventorySettings } from '@/hooks/useInventorySettings';
import {
  useBankAccounts, useBudgetsWithSpend, useExpenseCategories, budgetOptions,
} from '@/hooks/useExpenseReference';
import { formatNairaCompact } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { fmtQty, normaliseUnit } from '@/lib/units';
import {
  PAY_METHODS, buildLinesPayload, calcStockLine, checkReceipt, isBlankLine, totalsByCategory,
  type LineDraft, type OtherLineDraft, type PayMethod, type StockLineDraft,
} from '@/lib/receiving';

// Receive: every purchase enters here. One save creates the receipt, a
// stock-in for each stock line and an expense for each line, together
// (fn_receive_stock). Started from a purchase order it arrives filled in;
// started from nothing it is a market run.

const db = supabase as any;

export interface ReceiveOrderItem {
  id: string;
  item_name: string;
  sku_id: string | null;
  quantity: number;
  quantity_received: number;
  unit_of_measure: string;
  unit_price: number;
}

export interface ReceivePrefill {
  /** Receive against this purchase order. */
  lpo?: {
    id: string;
    lpo_number: string;
    supplier_name: string;
    payee_id?: string | null;
    payment_method?: string | null;
    budget_id?: string | null;
    expense_category?: string | null;
    inventory_request_id?: string | null;
    lpo_items?: ReceiveOrderItem[];
  };
  /** Start with this item on the first line. */
  skuId?: string;
  /** A suggested quantity for that item, in stock units. */
  quantity?: number;
  /** Start with these items (the To buy list or a market list); quantity is in `unit`. */
  items?: { skuId: string; quantity: number; unit?: string }[];
  /** Start with a non-stock cost (from the expense form). */
  other?: { category?: string; description?: string; amount?: string };
  date?: string;
  payeeId?: string;
  supplierName?: string;
}

interface SkuRow {
  id: string; name: string; category: string; unit_of_measure: string;
  stock_quantity: number; cost_per_unit: number; is_archived: boolean;
}

let seq = 0;
const nextKey = () => ++seq;
const today = () => new Date().toISOString().slice(0, 10);
const blankStock = (): StockLineDraft => ({ key: nextKey(), kind: 'stock', sku_id: '', quantity: '', unit: '', factor: '', priceMode: 'unit', price: '' });
const blankOther = (): OtherLineDraft => ({ key: nextKey(), kind: 'other', category: '', description: '', amount: '' });
const selectCls = 'h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';
const naira = (minor: number) => formatNairaCompact(minor / 100);

const methodFrom = (m: string | null | undefined): PayMethod | '' => {
  const s = (m ?? '').trim().toLowerCase();
  if (s === 'cash') return 'cash';
  if (s === 'credit') return 'credit';
  if (['transfer', 'bank transfer', 'pos', 'card'].includes(s)) return 'transfer';
  return '';
};

export default function ReceiveSheet({ open, onOpenChange, prefill, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: ReceivePrefill | null;
  onDone?: (receipt: { id: string; receipt_number: string }) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { bySku: unitsBySku } = useItemUnits();
  const { settings } = useInventorySettings();
  const { data: categories = [] } = useExpenseCategories();
  const { data: banks = [] } = useBankAccounts();
  const { data: budgetRows = [] } = useBudgetsWithSpend(user?.id);
  const { data: skus = [] } = useQuery<SkuRow[]>({
    queryKey: ['skus-for-stock-in'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from('skus')
        .select('id, name, category, unit_of_measure, stock_quantity, cost_per_unit, is_archived').order('name');
      if (error) throw error;
      return (data ?? []) as unknown as SkuRow[];
    },
  });

  const lpo = prefill?.lpo;
  const [payee, setPayee] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState<PayMethod | ''>('');
  const [bank, setBank] = useState('');
  const [budget, setBudget] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const itemOf = (id: string) => {
    const s = byId.get(id);
    if (!s) return undefined;
    return { name: s.name, category: s.category, units: unitsBySku.get(id), unit: s.unit_of_measure };
  };

  // Fill the form once each time it opens.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (wasOpen.current) return;
    wasOpen.current = true;

    setDate(prefill?.date ?? today());
    setBank(''); setPhoto(null); setReason(''); setNotes('');
    setDirty(false); setTried(false);

    if (lpo) {
      setPayee(lpo.payee_id ?? ONE_OFF);
      setPayeeName(lpo.payee_id ? '' : lpo.supplier_name);
      setMethod(methodFrom(lpo.payment_method));
      setBudget(lpo.budget_id ?? '');
      // One line per order line still to come, at the quantity outstanding.
      const rows: LineDraft[] = [];
      for (const it of lpo.lpo_items ?? []) {
        const left = Math.max(0, Number(it.quantity) - Number(it.quantity_received || 0));
        if (left <= 0) continue;
        if (it.sku_id) {
          rows.push({
            key: nextKey(), kind: 'stock', sku_id: it.sku_id, quantity: String(left),
            unit: normaliseUnit(it.unit_of_measure), factor: '', priceMode: 'unit',
            price: it.unit_price ? String(it.unit_price) : '', lpo_item_id: it.id,
          });
        } else {
          rows.push({
            key: nextKey(), kind: 'other', category: lpo.expense_category ?? '', description: it.item_name,
            amount: it.unit_price ? String(Math.round(left * Number(it.unit_price) * 100) / 100) : '',
            lpo_item_id: it.id, quantity: String(left),
          });
        }
      }
      setLines(rows.length ? rows : [blankStock()]);
    } else {
      setPayee(prefill?.payeeId ?? (prefill?.supplierName ? ONE_OFF : ''));
      setPayeeName(prefill?.supplierName ?? '');
      setMethod('');
      setBudget('');
      const first: LineDraft[] = (prefill?.items ?? []).map((it) => ({
        ...blankStock(), sku_id: it.skuId, quantity: it.quantity ? String(it.quantity) : '', unit: normaliseUnit(it.unit),
      }));
      if (prefill?.skuId) {
        first.push({ ...blankStock(), sku_id: prefill.skuId, quantity: prefill.quantity ? String(prefill.quantity) : '' });
      }
      if (prefill?.other) {
        first.push({ ...blankOther(), category: prefill.other.category ?? '', description: prefill.other.description ?? '', amount: prefill.other.amount ?? '' });
      }
      setLines(first.length ? first : [blankStock()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // An item chosen with no usual supplier yet picked: offer its usual supplier
  // and its usual purchase unit.
  const chooseItem = (key: number, skuId: string) => {
    const u = unitsBySku.get(skuId);
    setLines((p) => p.map((l) => (l.key === key && l.kind === 'stock'
      ? { ...l, sku_id: skuId, unit: skuId ? (u?.purchaseUnit ?? '') : '', factor: '' } : l)));
    if (skuId && !payee && !payeeName && u?.payeeId) setPayee(u.payeeId);
    setDirty(true);
  };
  const patch = (key: number, p: Partial<StockLineDraft> | Partial<OtherLineDraft>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? ({ ...l, ...p } as LineDraft) : l)));
    setDirty(true);
  };
  const remove = (key: number) => { setLines((p) => p.filter((l) => l.key !== key)); setDirty(true); };

  const active = useMemo(() => skus.filter((s) => !s.is_archived), [skus]);
  const itemOptions = (key: number): SelectOption[] => {
    const taken = new Set(lines.filter((l) => l.kind === 'stock' && l.key !== key).map((l) => (l as StockLineDraft).sku_id).filter(Boolean));
    return active.filter((s) => !taken.has(s.id)).map((s) => ({
      value: s.id, label: s.name,
      hint: `${fmtQty(Number(s.stock_quantity))} ${unitsBySku.get(s.id)?.stockUnit ?? s.unit_of_measure} on hand`,
    }));
  };
  const categoryOpts = useMemo(() => categories.map((c) => ({ value: c.name, label: c.name })), [categories]);

  const photoAbove = settings.receipt_photo_above_minor ?? null;
  const check = checkReceipt(
    { payeeId: payee && payee !== ONE_OFF ? payee : '', supplierName: payeeName, date, method, bankAccountId: bank, budgetId: budget, hasPhoto: !!photo, noReceiptReason: reason },
    lines,
    { itemOf, today: today(), photoAboveMinor: photoAbove, bankRequired: banks.length > 0 },
  );
  const err = (m?: string) => (tried ? m ?? null : null);
  const byCategory = totalsByCategory(lines, itemOf);
  const photoWanted = photoAbove != null && check.totalMinor > photoAbove;

  const save = async () => {
    setTried(true);
    if (!check.ok) {
      const first = Object.values(check.header)[0] ?? Object.values(check.lines)[0];
      toast({ title: 'Some details are missing', description: first, variant: 'destructive' });
      return;
    }
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      let receiptPath: string | null = null;
      if (photo && user) {
        const ext = photo.name.split('.').pop() || 'jpg';
        receiptPath = `${user.id}/${Date.now()}.${ext}`;
        const up = await supabase.storage.from('receipts').upload(receiptPath, photo);
        if (up.error) throw up.error;
      }

      const { data, error } = await db.rpc('fn_receive_stock', {
        p_header: {
          lpo_id: lpo?.id ?? null,
          payee_id: payee && payee !== ONE_OFF ? payee : null,
          supplier_name: payeeName.trim() || null,
          received_date: date,
          payment_method: method,
          bank_account_id: method === 'transfer' ? bank || null : null,
          budget_id: budget || null,
          receipt_path: receiptPath,
          no_receipt_reason: receiptPath ? null : reason.trim() || null,
          notes: notes.trim() || null,
        },
        p_lines: buildLinesPayload(lines, itemOf),
      });
      if (error) throw new Error(error.message);

      // It is saved. Empty and close before anything else, so it cannot be
      // saved a second time.
      setLines([blankStock()]);
      setDirty(false);
      onOpenChange(false);

      toast({
        title: `${data.receipt_number} saved`,
        description: `${naira(Number(data.total_minor))} recorded as expenses and stock added${method === 'credit' ? '. It is owed to the supplier until paid.' : '.'}`,
      });

      // A request this order was raised from is fulfilled once the order is in.
      if (lpo?.inventory_request_id) {
        const { data: after } = await db.from('lpos').select('status').eq('id', lpo.id).maybeSingle();
        if (after?.status === 'received') {
          await db.from('inventory_requests')
            .update({ status: 'fulfilled', fulfilled_date: date, purchase_cost: Number(data.total_minor) / 100 })
            .eq('id', lpo.inventory_request_id);
        }
      }

      for (const key of [
        ['inventory-data'], ['inventory-item'], ['item-units'], ['skus-for-stock-in'], ['stock-receipts'],
        ['expenses'], ['lpos'], ['lpo-receipts-all'], ['inventory-requests'], ['admin-payables'],
        ['profit-and-loss'], ['journal-entries'], ['journal-all-lines'], ['budgets-with-spend'], ['ops-low-stock'], ['payees'],
      ]) qc.invalidateQueries({ queryKey: key });
      onDone?.({ id: data.id, receipt_number: data.receipt_number });
    } catch (e) {
      toast({ title: 'Could not save the receipt', description: (e as Error).message, variant: 'destructive' });
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const liveCount = lines.filter((l) => !isBlankLine(l)).length;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      size="wide"
      title={lpo ? `Receive ${lpo.lpo_number}` : 'Receive'}
      description={lpo
        ? `From ${lpo.supplier_name}. Change any quantity that differs from the order; the order then shows as part received.`
        : 'One step for a purchase: the stock is added and the expense is recorded together.'}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm sm:mr-auto" role="status">
            {liveCount} line{liveCount === 1 ? '' : 's'} · total <b className="tabular-nums">{naira(check.totalMinor)}</b>
          </span>
          <div className="flex gap-2.5">
            <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="h-11 flex-[2] sm:flex-none" onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save receipt
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* ── Who, when, how it was paid ── */}
        <section className="grid gap-4 sm:grid-cols-2">
          <Field id="rcv-supplier" label="Supplier" required error={err(check.header.supplier)}
            hint="For a market run with no one supplier, type “Market”.">
            <PayeeField id="rcv-supplier" value={payee} name={payeeName} invalid={!!err(check.header.supplier)}
              onChange={(v, n) => { setPayee(v); setPayeeName(n); setDirty(true); }} />
          </Field>
          <Field id="rcv-date" label="Date received" required error={err(check.header.date)}>
            <Input id="rcv-date" type="date" max={today()} value={date} onChange={(e) => { setDate(e.target.value); setDirty(true); }} />
          </Field>

          <Field id="rcv-method" label="How it was paid" required error={err(check.header.method)} className="sm:col-span-2">
            <div id="rcv-method" role="radiogroup" aria-label="How it was paid" className="grid grid-cols-3 gap-2">
              {PAY_METHODS.map((m) => (
                <button key={m.value} type="button" role="radio" aria-checked={method === m.value}
                  onClick={() => { setMethod(m.value); setDirty(true); }}
                  className={cn('flex flex-col items-center gap-0.5 rounded-xl border p-2.5 text-center transition-colors',
                    method === m.value ? 'border-primary bg-primary/5' : 'text-muted-foreground hover:border-foreground/30')}>
                  <span className="text-sm font-semibold">{m.label}</span>
                  <span className="hidden text-[11.5px] leading-tight sm:block">{m.hint}</span>
                </button>
              ))}
            </div>
          </Field>
          {method === 'credit' && (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
              The total is recorded as owed to the supplier. Paying it later is recorded as a payment, not as a second expense.
            </p>
          )}
          {method === 'transfer' && banks.length > 0 && (
            <Field id="rcv-bank" label="Paid from" required error={err(check.header.bank)}>
              <select id="rcv-bank" className={selectCls} value={bank} onChange={(e) => { setBank(e.target.value); setDirty(true); }}>
                <option value="">Choose the account</option>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.bank_name} · {b.account_number}</option>)}
              </select>
            </Field>
          )}
          <Field id="rcv-budget" label="Budget" hint="Left alone, it goes to the budget for the date.">
            <SearchableSelect id="rcv-budget" options={budgetOptions(budgetRows)} value={budget}
              onChange={(v) => { setBudget(v); setDirty(true); }}
              title="Choose a budget" placeholder="By date" emptyOptionLabel="By date" />
          </Field>
        </section>

        {/* ── What was bought ── */}
        <section className="space-y-3">
          <div className="text-sm font-medium">What was bought</div>
          {err(check.header.lines) && <p role="alert" className="text-xs text-destructive">⚠ {check.header.lines}</p>}

          {lines.map((l) => {
            const lineErr = err(check.lines[l.key]);
            if (l.kind === 'stock') {
              const s = byId.get(l.sku_id);
              const u = unitsBySku.get(l.sku_id);
              const c = calcStockLine(l, u, s?.unit_of_measure);
              return (
                <div key={l.key} className={cn('space-y-2 rounded-xl border p-3', lineErr && 'border-destructive/50')}>
                  <div className="flex items-start gap-2">
                    <Package className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <SearchableSelect options={itemOptions(l.key)} value={l.sku_id} title="Choose the item"
                        placeholder="Search items…" onChange={(v) => chooseItem(l.key, v)} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Remove line" onClick={() => remove(l.key)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_7rem_minmax(0,1fr)_9rem]">
                    <Input type="number" inputMode="decimal" min="0" step="any" placeholder="Qty"
                      aria-label={`Quantity${s ? ` of ${s.name}` : ''}`}
                      value={l.quantity} onChange={(e) => patch(l.key, { quantity: e.target.value })} />
                    <select aria-label="Unit" className={selectCls} disabled={!s} value={c.unit}
                      onChange={(e) => patch(l.key, { unit: e.target.value, factor: '' })}>
                      {!s && <option value="">unit</option>}
                      {(u?.units ?? (s ? [{ name: c.stockUnit, factor: 1 }] : [])).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
                      {s && c.unit && !(u?.units ?? [{ name: c.stockUnit }]).some((x) => x.name === c.unit) && <option value={c.unit}>{c.unit}</option>}
                    </select>
                    <Input type="number" inputMode="decimal" min="0" step="any"
                      placeholder={l.priceMode === 'total' ? 'Total paid (₦)' : `Price per ${c.unit || 'unit'} (₦)`}
                      aria-label={l.priceMode === 'total' ? 'Total paid' : `Price per ${c.unit || 'unit'}`}
                      value={l.price} onChange={(e) => patch(l.key, { price: e.target.value })} />
                    <select aria-label="Which price is on the receipt" className={selectCls} value={l.priceMode}
                      onChange={(e) => {
                        const next = e.target.value as 'unit' | 'total';
                        const p = parseFloat(l.price);
                        // Carry the figure across so nothing is retyped.
                        const carried = p > 0 && c.qty > 0 ? String(Math.round((next === 'total' ? p * c.qty : p / c.qty) * 100) / 100) : l.price;
                        patch(l.key, { priceMode: next, price: carried });
                      }}>
                      <option value="unit">per {c.unit || 'unit'}</option>
                      <option value="total">total paid</option>
                    </select>
                  </div>
                  {s && c.converted && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>In this delivery, 1 {c.unit} =</span>
                      <Input type="number" inputMode="decimal" min="0" step="any" className="h-8 w-20 px-2 text-xs"
                        aria-label={`${c.stockUnit} in one ${c.unit} for this delivery`}
                        placeholder={c.convertible || l.factor ? String(c.itemFactor) : '?'}
                        value={l.factor} onChange={(e) => patch(l.key, { factor: e.target.value })} />
                      <span>{c.stockUnit}</span>
                    </div>
                  )}
                  {s && c.qty > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <b className="font-semibold text-foreground">
                        {fmtQty(c.qty)} {c.unit}{c.converted && c.convertible ? ` = ${fmtQty(c.stockQty)} ${c.stockUnit}` : ''}
                      </b>
                      {c.amountMinor > 0 && <> · {naira(c.amountMinor)} · {formatNairaCompact(c.unitCost)} per {c.stockUnit}</>}
                      {' '}· {fmtQty(Number(s.stock_quantity))} {c.stockUnit} on hand now
                    </p>
                  )}
                  {lineErr && <p role="alert" className="text-xs text-destructive">⚠ {lineErr}</p>}
                </div>
              );
            }
            return (
              <div key={l.key} className={cn('space-y-2 rounded-xl border border-dashed p-3', lineErr && 'border-destructive/50')}>
                <div className="flex items-start gap-2">
                  <Receipt className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_9rem]">
                    <SearchableSelect options={categoryOpts} value={l.category} title="Choose a category"
                      placeholder="Category" onChange={(v) => patch(l.key, { category: v })} />
                    <Input aria-label="What it was for" placeholder="What it was for, e.g. bus fuel"
                      value={l.description} onChange={(e) => patch(l.key, { description: e.target.value })} />
                    <Input type="number" inputMode="decimal" min="0" step="any" aria-label="Amount paid" placeholder="Amount (₦)"
                      value={l.amount} onChange={(e) => patch(l.key, { amount: e.target.value })} />
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Remove line" onClick={() => remove(l.key)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Not kept in stock: recorded as an expense only.</p>
                {lineErr && <p role="alert" className="text-xs text-destructive">⚠ {lineErr}</p>}
              </div>
            );
          })}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => { setLines((p) => [...p, blankStock()]); setDirty(true); }}>
              <Plus className="mr-1.5 h-4 w-4" />Add an item
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => { setLines((p) => [...p, blankOther()]); setDirty(true); }}>
              <Plus className="mr-1.5 h-4 w-4" />Add another cost (transport, repairs)
            </Button>
          </div>

          {byCategory.length > 0 && (
            <div className="rounded-xl bg-muted/60 px-4 py-3 text-sm">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Expenses this creates</div>
              {byCategory.map((x) => (
                <div key={x.category} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{x.category}</span>
                  <span className="tabular-nums">{naira(x.minor)}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between gap-3 border-t pt-1 font-semibold">
                <span>Total</span><span className="tabular-nums">{naira(check.totalMinor)}</span>
              </div>
            </div>
          )}
        </section>

        {/* ── The supplier's receipt ── */}
        <section className="space-y-3">
          <ReceiptUpload id="rcv-photo" file={photo} onChange={(f) => { setPhoto(f); setDirty(true); }}
            required={photoWanted && !reason.trim()} error={err(check.header.photo)} />
          {!photo && (
            <Field id="rcv-noreceipt" label="No receipt? Say why" hint={photoWanted ? 'Needed for a receipt this size when there is no photo.' : 'Optional.'}>
              <Input id="rcv-noreceipt" value={reason} placeholder="e.g. open market, the trader gives no receipt"
                onChange={(e) => { setReason(e.target.value); setDirty(true); }} />
            </Field>
          )}
          <Field id="rcv-notes" label="Notes">
            <Textarea id="rcv-notes" rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
              placeholder="Condition of the goods, anything short or swapped" />
          </Field>
        </section>
      </div>
    </FormSheet>
  );
}
