import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Loader2, Plus, SlidersHorizontal, X } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { formatNairaCompact } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { mergeLines, recordStockMovements } from '@/lib/stockMovements';

// One place to record stock: what was used, what came in, and corrections.
// Every mode goes through record_stock_movements, so the ledger, the movement
// history and the negative-stock rule apply the same way to all three.

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
  unit_price?: number;
  note?: string;
}

interface Line { key: number; sku_id: string; quantity: string }

const MODES: { value: StockMode; label: string; hint: string; icon: React.ElementType }[] = [
  { value: 'usage', label: 'Used', hint: 'Taken out for cooking, events or sale', icon: ArrowUpFromLine },
  { value: 'in', label: 'Received', hint: 'Bought or delivered, outside an LPO', icon: ArrowDownToLine },
  { value: 'adjust', label: 'Correction', hint: 'Fix a count that is wrong', icon: SlidersHorizontal },
];

let seq = 0;
const nextKey = () => ++seq;
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n: number) => Number(n.toFixed(4)).toLocaleString('en-NG', { maximumFractionDigits: 4 });

export default function RecordStockSheet({ open, onOpenChange, skus, allowNegative, prefill, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skus: StockItem[];
  allowNegative: boolean;
  prefill?: StockPrefill | null;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<StockMode>('usage');
  const [lines, setLines] = useState<Line[]>([]);
  const [price, setPrice] = useState('');
  const [direction, setDirection] = useState<'up' | 'down'>('down');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    const m = prefill?.mode ?? 'usage';
    setMode(m);
    setLines([{ key: nextKey(), sku_id: prefill?.sku_id ?? '', quantity: prefill?.quantity ? String(prefill.quantity) : '' }]);
    setPrice(prefill?.unit_price ? String(prefill.unit_price) : '');
    setDirection('down');
    setDate(today());
    setNote(prefill?.note ?? '');
    setDirty(false);
  }, [open, prefill]);

  const active = useMemo(() => skus.filter((s) => !s.is_archived), [skus]);
  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const options = useMemo<SelectOption[]>(() => active
    // With negative stock off, an empty item can't be used, so it isn't offered.
    .filter((s) => mode !== 'usage' || allowNegative || Number(s.stock_quantity) > 0)
    .map((s) => ({ value: s.id, label: s.name, hint: `${fmt(Number(s.stock_quantity))} ${s.unit_of_measure} on hand` })),
  [active, mode, allowNegative]);
  // An item already on another line is left out: raise that line instead.
  const optionsFor = (i: number) => {
    const taken = new Set(lines.filter((_, j) => j !== i).map((l) => l.sku_id).filter(Boolean));
    return options.filter((o) => !taken.has(o.value));
  };

  const touch = () => setDirty(true);
  const setLine = (i: number, patch: Partial<Line>) => { setLines((p) => p.map((l, j) => (j === i ? { ...l, ...patch } : l))); touch(); };
  const multi = mode === 'usage';
  const first = byId.get(lines[0]?.sku_id ?? '');
  const firstQty = parseFloat(lines[0]?.quantity ?? '') || 0;
  const filled = lines.filter((l) => l.sku_id && (parseFloat(l.quantity) || 0) > 0);

  const submit = async () => {
    if (filled.length === 0) { toast({ title: 'Choose an item and a quantity', variant: 'destructive' }); return; }
    if (mode === 'adjust' && !note.trim()) { toast({ title: 'Say why the count is being corrected', variant: 'destructive' }); return; }

    // Stock-outs: refuse up front what the database would refuse anyway.
    const outgoing = mode === 'usage' || (mode === 'adjust' && direction === 'down');
    if (outgoing && !allowNegative) {
      const totals = mergeLines(filled.map((l) => ({ sku_id: l.sku_id, quantity: parseFloat(l.quantity) })));
      const short = [...totals].map(([id, q]) => ({ s: byId.get(id)!, q })).filter((x) => x.s && x.q > Number(x.s.stock_quantity));
      if (short.length) {
        toast({
          title: 'Not enough stock',
          description: short.map((x) => `${x.s.name}: ${fmt(Number(x.s.stock_quantity))} on hand, ${fmt(x.q)} entered`).join(' · '),
          variant: 'destructive',
        });
        return;
      }
    }

    setSaving(true);
    try {
      if (mode === 'usage') {
        const totals = mergeLines(filled.map((l) => ({ sku_id: l.sku_id, quantity: parseFloat(l.quantity) })));
        const n = await recordStockMovements({
          lines: [...totals].map(([sku_id, q]) => ({ sku_id, quantity_change: -q })),
          type: 'usage', note: note.trim() || 'Usage', occurredOn: date, transactionType: 'SALE',
        });
        toast({ title: `Usage recorded for ${n} item${n === 1 ? '' : 's'}` });
      } else if (mode === 'in') {
        await recordStockMovements({
          lines: [{ sku_id: filled[0].sku_id, quantity_change: firstQty, unit_price: parseFloat(price) || 0 }],
          type: 'purchase', note: note.trim() || 'Stock received', occurredOn: date, transactionType: 'PURCHASE',
        });
        toast({ title: `${fmt(firstQty)} ${first?.unit_of_measure ?? ''} of ${first?.name ?? 'item'} received` });
      } else {
        const delta = direction === 'up' ? firstQty : -firstQty;
        await recordStockMovements({
          lines: [{ sku_id: filled[0].sku_id, quantity_change: delta }],
          type: 'adjustment', note: note.trim(), occurredOn: date, transactionType: 'ADJUSTMENT',
        });
        toast({ title: 'Correction recorded' });
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Could not record that', description: (e as Error).message, variant: 'destructive' });
    } finally {
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
      description="Updates stock, the item’s history and the books in one step."
      footer={
        <div className="flex gap-2.5 sm:justify-end">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-[2] sm:flex-none" onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{cta}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <div role="radiogroup" aria-label="What happened" className="grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const Icon = m.icon;
            const on = mode === m.value;
            return (
              <button key={m.value} type="button" role="radio" aria-checked={on}
                onClick={() => {
                  setMode(m.value);
                  // Only Used takes several items at once.
                  if (m.value !== 'usage') setLines((p) => p.slice(0, 1));
                  touch();
                }}
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
          {multi && <div className="text-sm font-medium">Items used</div>}
          {lines.map((l, i) => {
            const s = byId.get(l.sku_id);
            const qty = parseFloat(l.quantity) || 0;
            const after = s ? Number(s.stock_quantity) + ((mode === 'in' || (mode === 'adjust' && direction === 'up')) ? qty : -qty) : null;
            return (
              <div key={l.key} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
                  <SearchableSelect options={optionsFor(i)} value={l.sku_id} title="Choose an item"
                    placeholder="Search items…" onChange={(v) => setLine(i, { sku_id: v })} />
                  <Input type="number" inputMode="decimal" min="0" step="any" placeholder="Qty"
                    aria-label={`Quantity${s ? ` in ${s.unit_of_measure}` : ''}`}
                    value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  {multi && lines.length > 1 ? (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove item" className="h-11 w-11"
                      onClick={() => { setLines((p) => p.filter((_, j) => j !== i)); touch(); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  ) : <span className="w-0" />}
                </div>
                {s && (
                  <p className={cn('text-xs', after != null && after < 0 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                    {after != null && after < 0 && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />}
                    {fmt(Number(s.stock_quantity))} {s.unit_of_measure} on hand
                    {qty > 0 && after != null && <> → {fmt(after)} {s.unit_of_measure} after</>}
                  </p>
                )}
              </div>
            );
          })}
          {multi && (
            <Button type="button" variant="outline" size="sm" onClick={() => { setLines((p) => [...p, { key: nextKey(), sku_id: '', quantity: '' }]); touch(); }}>
              <Plus className="mr-1.5 h-4 w-4" />Add another item
            </Button>
          )}
        </section>

        {mode === 'in' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="stock-price" label={`Cost per ${first?.unit_of_measure ?? 'unit'} (₦)`}
              hint="What was paid. It updates the item’s average cost.">
              <Input id="stock-price" type="number" inputMode="decimal" min="0" step="any" value={price}
                onChange={(e) => { setPrice(e.target.value); touch(); }} />
            </Field>
            <div className="self-end rounded-xl bg-muted/60 px-4 py-3 text-sm">
              Total <b className="tabular-nums">{formatNairaCompact(firstQty * (parseFloat(price) || 0))}</b>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Record the payment as an expense as usual; this moves its cost into stock until it is used, so it’s counted once.
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
      </div>
    </FormSheet>
  );
}
