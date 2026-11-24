import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ListChecks, Loader2, Plus, SlidersHorizontal, X } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { supabase } from '@/integrations/supabase/client';
import { formatNairaCompact } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { recordStockMovements, type StockLine } from '@/lib/stockMovements';
import { useItemUnits, type ItemUnitInfo } from '@/hooks/useItemUnits';
import { costPerStockUnit, factorOf, fmtQty, normaliseUnit, toStock, unusualUsage } from '@/lib/units';

// One place to record stock: what was used, what came in, and corrections.
// Every mode goes through record_stock_movements, so the movement history and
// the negative-stock rule apply the same way to all three.
//
// Every quantity has its unit beside it. Stock is kept in the item's stock
// unit; anything typed in another unit (2 bag) is converted with the item's
// pack size and shown before saving (2 bag = 20 kg).

export type StockMode = 'usage' | 'in' | 'adjust';

export interface StockItem {
  id: string;
  name: string;
  unit_of_measure: string;
  stock_quantity: number;
  cost_per_unit: number;
  is_archived: boolean;
}

export interface StockPrefill {
  mode: StockMode;
  sku_id?: string;
  quantity?: number;
  /** Price per stock unit. */
  unit_price?: number;
  /** What was paid for the whole delivery (from an expense). */
  total_price?: number;
  note?: string;
  date?: string;
  /** Links the stock-in to the expense that paid for it. */
  reference?: { type: 'expense'; id: string };
}

interface Line { key: number; sku_id: string; quantity: string; unit: string }

const MODES: { value: StockMode; label: string; hint: string; icon: React.ElementType }[] = [
  { value: 'usage', label: 'Used', hint: 'Taken out for cooking, events or sale', icon: ArrowUpFromLine },
  { value: 'in', label: 'Received', hint: 'Bought or delivered, outside an LPO', icon: ArrowDownToLine },
  { value: 'adjust', label: 'Correction', hint: 'Fix a count that is wrong', icon: SlidersHorizontal },
];

const NO_UNITS = new Map<string, ItemUnitInfo>();

let seq = 0;
const nextKey = () => ++seq;
const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => parseFloat(s) || 0;

const selectCls = 'h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function RecordStockSheet({ open, onOpenChange, skus, allowNegative, prefill, onDone, onReceive }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skus: StockItem[];
  allowNegative: boolean;
  prefill?: StockPrefill | null;
  onDone: () => void;
  /**
   * Given once Receive is live: a purchase is then recorded there, with its
   * expense, and the manual "Received" entry is no longer offered here. A
   * stock-in linked to an existing expense (prefill.reference) still is.
   */
  onReceive?: (skuId?: string) => void;
}) {
  const manualIn = !onReceive || !!prefill?.reference;
  const { bySku: allUnitsBySku, ready: unitsReady, refetch: refetchUnits } = useItemUnits();
  // Before the units migration the database takes every number as stock units,
  // so pack sizes are not offered until it can convert them.
  const unitsBySku = unitsReady ? allUnitsBySku : NO_UNITS;

  const [mode, setMode] = useState<StockMode>('usage');
  const [lines, setLines] = useState<Line[]>([]);
  const [priceMode, setPriceMode] = useState<'unit' | 'total'>('unit');
  const [price, setPrice] = useState('');
  const [deliveryFactor, setDeliveryFactor] = useState('');
  const [direction, setDirection] = useState<'up' | 'down'>('down');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmedUnusual, setConfirmedUnusual] = useState(false);
  const [filling, setFilling] = useState(false);

  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const stockUnitOf = (id: string) => unitsBySku.get(id)?.stockUnit ?? normaliseUnit(byId.get(id)?.unit_of_measure) ?? '';
  const defaultUnit = (id: string, m: StockMode) => {
    const u = unitsBySku.get(id);
    if (!u) return stockUnitOf(id);
    return m === 'in' ? u.purchaseUnit : u.stockUnit;
  };

  // Set the form up once each time it opens. Not on every new `prefill`
  // object: a parent that builds the prefill inline would otherwise wipe what
  // has been typed whenever it re-renders.
  const wasOpen = useRef(false);
  const submitting = useRef(false);
  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (wasOpen.current) return;
    wasOpen.current = true;
    const m = prefill?.mode ?? 'usage';
    setMode(m);
    setLines([{
      key: nextKey(), sku_id: prefill?.sku_id ?? '',
      quantity: prefill?.quantity ? String(prefill.quantity) : '',
      // A prefilled quantity is in stock units (it comes from the reorder level).
      unit: prefill?.sku_id ? (prefill.quantity ? stockUnitOf(prefill.sku_id) : defaultUnit(prefill.sku_id, m)) : '',
    }]);
    if (prefill?.total_price) { setPriceMode('total'); setPrice(String(prefill.total_price)); }
    else { setPriceMode('unit'); setPrice(prefill?.unit_price ? String(prefill.unit_price) : ''); }
    setDeliveryFactor('');
    setDirection('down');
    setDate(prefill?.date ?? today());
    setNote(prefill?.note ?? '');
    setDirty(false);
    setConfirmedUnusual(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const active = useMemo(() => skus.filter((s) => !s.is_archived), [skus]);
  const options = useMemo<SelectOption[]>(() => active
    .map((s) => ({
      value: s.id, label: s.name,
      hint: `${fmtQty(Number(s.stock_quantity))} ${unitsBySku.get(s.id)?.stockUnit ?? s.unit_of_measure} on hand`,
    })),
  [active, unitsBySku]);
  // An item already on another line is left out: raise that line instead.
  const optionsFor = (i: number) => {
    const taken = new Set(lines.filter((_, j) => j !== i).map((l) => l.sku_id).filter(Boolean));
    return options.filter((o) => !taken.has(o.value));
  };

  const touch = () => { setDirty(true); setConfirmedUnusual(false); };
  const setLine = (i: number, patch: Partial<Line>) => { setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l))); touch(); };
  const multi = mode === 'usage';
  const incoming = mode === 'in' || (mode === 'adjust' && direction === 'up');

  // Everything about a line that depends on its unit.
  const calc = (l: Line) => {
    const s = byId.get(l.sku_id);
    const u = unitsBySku.get(l.sku_id);
    const stockUnit = s ? stockUnitOf(s.id) : '';
    const unit = l.unit || stockUnit;
    const itemFactor = factorOf(u, unit) ?? 1;
    const override = mode === 'in' && unit !== stockUnit ? num(deliveryFactor) : 0;
    const factor = override > 0 ? override : itemFactor;
    const qty = num(l.quantity);
    const stockQty = toStock(qty, factor);
    const onHand = Number(s?.stock_quantity ?? 0);
    const after = s ? onHand + (incoming ? stockQty : -stockQty) : null;
    return { s, u, stockUnit, unit, itemFactor, factor, qty, stockQty, onHand, after, converted: unit !== stockUnit };
  };

  const filled = lines.filter((l) => l.sku_id && num(l.quantity) > 0);
  const first = lines[0] ? calc(lines[0]) : null;

  // Stock-outs that would take an item below zero.
  const short = !incoming && !allowNegative
    ? filled.map(calc).filter((c) => c.s && c.stockQty > c.onHand)
    : [];
  // Usage far above the largest delivery on record: usually the wrong unit.
  const unusual = mode === 'usage'
    ? filled.map(calc).filter((c) => c.s && unusualUsage(c.stockQty, c.u?.largestReceipt))
    : [];

  const totalPaid = first
    ? (priceMode === 'total' ? num(price) : first.qty * num(price))
    : 0;
  const perStockUnit = first
    ? costPerStockUnit({ qty: first.qty, factor: first.factor, total: priceMode === 'total' ? num(price) : undefined, pricePerUnit: priceMode === 'unit' ? num(price) : undefined })
    : 0;

  const switchMode = (m: StockMode, keepSku?: string) => {
    setMode(m);
    setLines((p) => {
      const base = keepSku ? p.filter((l) => l.sku_id === keepSku) : p;
      const next = m === 'usage' ? base : base.slice(0, 1);
      return (next.length ? next : [{ key: nextKey(), sku_id: '', quantity: '', unit: '' }])
        .map((l) => ({ ...l, unit: l.sku_id ? defaultUnit(l.sku_id, m) : '', quantity: keepSku ? '' : l.quantity }));
    });
    if (m === 'adjust' && keepSku) setDirection('up');
    touch();
  };

  // The daily sheet: a line for every item used in the last 30 days, so the
  // kitchen types the day's quantities in one go.
  const fillUsualItems = async () => {
    setFilling(true);
    try {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data } = await (supabase as any).from('inventory_movements')
        .select('product_id').in('movement_type', ['usage', 'production_issue']).gte('occurred_on', since).limit(5000);
      const used = new Set<string>((data ?? []).map((r: any) => r.product_id));
      const skuByProduct = new Map([...allUnitsBySku].map(([sku, u]) => [u.productId, sku]));
      let ids = [...used].map((p) => skuByProduct.get(p)).filter((x): x is string => !!x && !!byId.get(x) && !byId.get(x)!.is_archived);
      // Nothing recorded lately: start from everything that has stock.
      if (ids.length === 0) ids = active.filter((s) => Number(s.stock_quantity) > 0).map((s) => s.id);
      const have = new Set(lines.map((l) => l.sku_id).filter(Boolean));
      const add = ids.filter((id) => !have.has(id))
        .sort((a, b) => byId.get(a)!.name.localeCompare(byId.get(b)!.name))
        .map((id) => ({ key: nextKey(), sku_id: id, quantity: '', unit: defaultUnit(id, 'usage') }));
      if (add.length === 0) { toast({ title: 'The usual items are already listed' }); return; }
      setLines((p) => [...p.filter((l) => l.sku_id), ...add]);
      setDirty(true);
    } finally {
      setFilling(false);
    }
  };

  const submit = async () => {
    if (filled.length === 0) { toast({ title: 'Choose an item and a quantity', variant: 'destructive' }); return; }
    if (mode === 'adjust' && !note.trim()) { toast({ title: 'Say why the count is being corrected', variant: 'destructive' }); return; }
    if (short.length) {
      toast({
        title: 'Not enough stock',
        description: short.map((c) => `${c.s!.name}: ${fmtQty(c.onHand)} ${c.stockUnit} on hand, ${fmtQty(c.stockQty)} ${c.stockUnit} entered`).join(' · '),
        variant: 'destructive',
      });
      return;
    }
    if (unusual.length && !confirmedUnusual) {
      toast({ title: 'Check the unit', description: 'One entry is larger than any delivery on record. Confirm it below, or change the unit.', variant: 'destructive' });
      return;
    }

    // One save per click, however fast the second click comes.
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      // Only send a unit when it is not the stock unit, so the form also works
      // before the units migration is applied.
      const base = (c: ReturnType<typeof calc>, sign: 1 | -1): StockLine => c.converted
        ? { sku_id: c.s!.id, quantity_change: sign * c.qty, unit: c.unit, ...(c.factor !== c.itemFactor ? { factor: c.factor } : {}) }
        : { sku_id: c.s!.id, quantity_change: sign * c.qty };

      if (mode === 'usage') {
        const n = await recordStockMovements({
          lines: filled.map((l) => base(calc(l), -1)),
          type: 'usage', note: note.trim() || 'Usage', occurredOn: date, transactionType: 'SALE',
        });
        toast({ title: `Usage recorded for ${n} item${n === 1 ? '' : 's'}` });
      } else if (mode === 'in') {
        const c = calc(filled[0]);
        const line: StockLine = { ...base(c, 1) };
        if (num(price) > 0) {
          // A price per purchase unit only means something to the database once
          // it knows the unit; otherwise send the price per stock unit.
          if (c.converted) { if (priceMode === 'total') line.total_price = num(price); else line.unit_price = num(price); }
          else line.unit_price = perStockUnit;
        }
        await recordStockMovements({
          lines: [line],
          type: 'purchase', note: note.trim() || 'Stock received', occurredOn: date, transactionType: 'PURCHASE',
          ...(prefill?.reference ? { referenceType: prefill.reference.type, referenceId: prefill.reference.id } : {}),
        });
        toast({
          title: c.converted
            ? `${fmtQty(c.qty)} ${c.unit} (${fmtQty(c.stockQty)} ${c.stockUnit}) of ${c.s!.name} received`
            : `${fmtQty(c.stockQty)} ${c.stockUnit} of ${c.s!.name} received`,
        });
      } else {
        const c = calc(filled[0]);
        await recordStockMovements({
          lines: [base(c, direction === 'up' ? 1 : -1)],
          type: 'adjustment', note: note.trim(), occurredOn: date, transactionType: 'ADJUSTMENT',
        });
        toast({ title: 'Correction recorded' });
      }
      // It is saved. Empty the form and close it before anything else, so a
      // saved entry can never sit on screen ready to be recorded a second time.
      setLines([{ key: nextKey(), sku_id: '', quantity: '', unit: '' }]);
      setPrice('');
      setNote('');
      setDirty(false);
      onOpenChange(false);
      refetchUnits();
      onDone();
    } catch (e) {
      toast({ title: 'Could not record that', description: (e as Error).message, variant: 'destructive' });
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const cta = mode === 'usage'
    ? (filled.length > 1 ? `Record usage (${filled.length} items)` : 'Record usage')
    : mode === 'in' ? 'Record stock in' : 'Record correction';

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      title="Record stock"
      description="Updates stock and the item’s history in one step. Every quantity is saved in the item’s stock unit."
      footer={
        <div className="flex gap-2.5 sm:justify-end">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-[2] sm:flex-none" onClick={submit} disabled={saving || short.length > 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{cta}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div role="radiogroup" aria-label="What happened" className={cn('grid gap-2', manualIn ? 'grid-cols-3' : 'grid-cols-2')}>
          {MODES.filter((m) => manualIn || m.value !== 'in').map((m) => {
            const Icon = m.icon;
            const on = mode === m.value;
            return (
              <button key={m.value} type="button" role="radio" aria-checked={on}
                onClick={() => switchMode(m.value)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition-colors',
                  on ? 'border-primary bg-primary/5 text-foreground' : 'text-muted-foreground hover:border-foreground/30',
                )}>
                <Icon className={cn('h-5 w-5', on && 'text-primary')} aria-hidden />
                <span className="text-sm font-semibold">{m.label}</span>
                <span className="hidden text-[11.5px] leading-tight sm:block">{m.hint}</span>
              </button>
            );
          })}
        </div>

        <section className="space-y-2">
          {multi && (
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Items used</div>
              <Button type="button" variant="ghost" size="sm" onClick={fillUsualItems} disabled={filling}
                title="Adds a line for every item used in the last 30 days">
                {filling ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ListChecks className="mr-1.5 h-4 w-4" />}
                Daily sheet
              </Button>
            </div>
          )}
          {lines.map((l, i) => {
            const c = calc(l);
            const isShort = !incoming && !allowNegative && !!c.s && c.stockQty > c.onHand;
            const isUnusual = mode === 'usage' && !!c.s && c.qty > 0 && unusualUsage(c.stockQty, c.u?.largestReceipt);
            return (
              <div key={l.key} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_5.25rem_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
                  <SearchableSelect options={optionsFor(i)} value={l.sku_id} title="Choose an item"
                    placeholder="Search items…" onChange={(v) => setLine(i, { sku_id: v, unit: v ? defaultUnit(v, mode) : '' })} />
                  <Input type="number" inputMode="decimal" min="0" step="any" placeholder="Qty"
                    aria-label={`Quantity${c.s ? ` of ${c.s.name} in ${c.unit}` : ''}`}
                    value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  <select aria-label="Unit" className={selectCls} disabled={!c.s}
                    value={c.unit} onChange={(e) => setLine(i, { unit: e.target.value })}>
                    {!c.s && <option value="">unit</option>}
                    {(c.u?.units ?? (c.s ? [{ name: c.stockUnit, factor: 1 }] : [])).map((u) => (
                      <option key={u.name} value={u.name}>{u.name}</option>
                    ))}
                  </select>
                  {multi && lines.length > 1 ? (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove item" className="h-11 w-11"
                      onClick={() => { setLines((p) => p.filter((_, j) => j !== i)); touch(); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  ) : <span className="w-0" />}
                </div>
                {c.s && (
                  <p className={cn('text-xs', isShort ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                    {isShort && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />}
                    {c.converted && c.qty > 0 && <><b className="font-semibold text-foreground">{fmtQty(c.qty)} {c.unit} = {fmtQty(c.stockQty)} {c.stockUnit}</b> · </>}
                    {fmtQty(c.onHand)} {c.stockUnit} on hand
                    {c.qty > 0 && c.after != null && <> → {fmtQty(c.after)} {c.stockUnit} after</>}
                  </p>
                )}
                {isShort && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                    <p>
                      More than is in stock. Stock cannot go below zero, so either a delivery was not recorded or the count is wrong.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline"
                        onClick={() => {
                          if (manualIn) { switchMode('in', c.s!.id); return; }
                          if (dirty && !window.confirm('Leave this form to record the delivery? What you have typed here will be lost.')) return;
                          onOpenChange(false);
                          onReceive?.(c.s!.id);
                        }}>
                        Record the missing delivery
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => switchMode('adjust', c.s!.id)}>Correct the count</Button>
                    </div>
                  </div>
                )}
                {isUnusual && !isShort && (
                  <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                    {fmtQty(c.stockQty)} {c.stockUnit} is more than the largest delivery on record ({fmtQty(c.u!.largestReceipt!)} {c.stockUnit}). Check the unit.
                  </p>
                )}
              </div>
            );
          })}
          {multi && (
            <Button type="button" variant="outline" size="sm"
              onClick={() => { setLines((p) => [...p, { key: nextKey(), sku_id: '', quantity: '', unit: '' }]); touch(); }}>
              <Plus className="mr-1.5 h-4 w-4" />Add another item
            </Button>
          )}
          {unusual.length > 0 && short.length === 0 && (
            <label className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={confirmedUnusual}
                onChange={(e) => setConfirmedUnusual(e.target.checked)} />
              <span>
                Yes, {unusual.map((c) => `${fmtQty(c.qty)} ${c.unit} of ${c.s!.name}`).join(' and ')} is right.
              </span>
            </label>
          )}
        </section>

        {mode === 'in' && first?.s && (
          <div className="space-y-4">
            {first.converted && (
              <Field id="stock-factor" label={`In this delivery, 1 ${first.unit} =`}
                hint={`Leave blank to use the item’s pack size (${fmtQty(first.itemFactor)} ${first.stockUnit}).`}>
                <div className="flex items-center gap-2">
                  <Input id="stock-factor" type="number" inputMode="decimal" min="0" step="any" className="w-32"
                    placeholder={String(first.itemFactor)} value={deliveryFactor}
                    onChange={(e) => { setDeliveryFactor(e.target.value); touch(); }} />
                  <span className="text-sm text-muted-foreground">{first.stockUnit}</span>
                </div>
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="stock-price" label={priceMode === 'total' ? 'Total paid (₦)' : `Price per ${first.unit} (₦)`}
                hint="From the receipt. It updates the item’s average cost.">
                <Input id="stock-price" type="number" inputMode="decimal" min="0" step="any" value={price}
                  onChange={(e) => { setPrice(e.target.value); touch(); }} />
              </Field>
              <div role="radiogroup" aria-label="Which price is on the receipt" className="grid grid-cols-2 gap-2 self-start sm:mt-[1.625rem]">
                {([['unit', `Per ${first.unit}`], ['total', 'Total paid']] as const).map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={priceMode === v}
                    onClick={() => {
                      // Carry the figure across so nothing has to be retyped.
                      if (priceMode !== v && num(price) > 0 && first.qty > 0) {
                        setPrice(String(Math.round((v === 'total' ? num(price) * first.qty : num(price) / first.qty) * 100) / 100));
                      }
                      setPriceMode(v); touch();
                    }}
                    className={cn('h-11 rounded-xl border text-sm font-semibold', priceMode === v ? 'border-primary bg-primary/5' : 'text-muted-foreground')}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl bg-muted/60 px-4 py-3 text-sm">
              {first.qty > 0 ? (
                <>
                  <b className="tabular-nums">{fmtQty(first.qty)} {first.unit}</b>
                  {first.converted && <> = <b className="tabular-nums">{fmtQty(first.stockQty)} {first.stockUnit}</b></>}
                  {totalPaid > 0 && <> · total <b className="tabular-nums">{formatNairaCompact(totalPaid)}</b> · <b className="tabular-nums">{formatNairaCompact(perStockUnit)}</b> per {first.stockUnit}</>}
                </>
              ) : 'Enter the quantity on the receipt.'}
            </div>
            <p className="text-xs text-muted-foreground">
              {prefill?.reference
                ? 'This is linked to the expense that paid for it. The cost stays in that expense and is not counted again.'
                : 'This records the quantity only. Record the payment as an expense as usual: the cost reaches the profit and loss through the expense, once.'}
            </p>
          </div>
        )}

        {mode === 'adjust' && (
          <div role="radiogroup" aria-label="Correction direction" className="grid grid-cols-2 gap-2">
            {([['down', 'Less than shown'], ['up', 'More than shown']] as const).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={direction === v}
                onClick={() => { setDirection(v); touch(); }}
                className={cn('h-11 rounded-xl border text-sm font-semibold', direction === v ? 'border-primary bg-primary/5' : 'text-muted-foreground')}>
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field id="stock-date" label="Date">
            <Input id="stock-date" type="date" max={today()} value={date} onChange={(e) => { setDate(e.target.value); touch(); }} />
          </Field>
          <Field id="stock-note" label={mode === 'adjust' ? 'Reason' : 'Note'} required={mode === 'adjust'}>
            <Textarea id="stock-note" rows={2} value={note} onChange={(e) => { setNote(e.target.value); touch(); }}
              placeholder={mode === 'usage' ? 'What it was used for' : mode === 'in' ? 'Supplier, receipt number…' : 'e.g. spillage, miscount'} />
          </Field>
        </div>

        {!unitsReady && (
          <p className="text-xs text-muted-foreground">
            Pack sizes and purchase units need the latest database update (20261123200000). Until then every quantity is in the item’s own unit.
          </p>
        )}
      </div>
    </FormSheet>
  );
}
