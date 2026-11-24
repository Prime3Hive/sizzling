import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarHeart, ChefHat, Loader2, Plus, ShoppingBag, Trash2, Undo2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import ReceiptUpload from '@/components/expenses/ReceiptUpload';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { useItemUnits } from '@/hooks/useItemUnits';
import { useInventorySettings } from '@/hooks/useInventorySettings';
import { useEventInvoices, useStockLots } from '@/hooks/useStockOut';
import { formatNairaCompact } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { factorOf, fmtQty, normaliseUnit, toStock, unusualUsage } from '@/lib/units';
import { DEFAULT_WASTE_REASONS, drawFromLots, orderDailySheet } from '@/lib/stockRoutes';

// Stock out, by route. Stock leaves as an issue to the kitchen, an issue to a
// named event, or waste; unused event stock comes back as a return. (The
// fourth route, production, is recorded on the Production page.) Each save
// goes through fn_issue_stock, which stamps the route on every movement.

const db = supabase as any;

export type OutRoute = 'kitchen' | 'event' | 'waste' | 'event_return' | 'sale';

export interface StockOutPrefill {
  route?: OutRoute;
  skuId?: string;
}

export interface OutItem {
  id: string;
  name: string;
  unit_of_measure: string;
  stock_quantity: number;
  cost_per_unit: number;
  is_archived: boolean;
}

interface Line { key: number; sku_id: string; quantity: string; unit: string }

const ROUTES: { value: OutRoute; label: string; hint: string; icon: React.ElementType }[] = [
  { value: 'kitchen', label: 'Kitchen', hint: 'Daily cooking for normal orders', icon: ChefHat },
  { value: 'event', label: 'Event', hint: 'Taken for a named event', icon: CalendarHeart },
  { value: 'waste', label: 'Waste', hint: 'Spoiled, spilled, burnt or expired', icon: Trash2 },
  { value: 'event_return', label: 'Return', hint: 'Unused stock back from an event', icon: Undo2 },
  { value: 'sale', label: 'Sold', hint: 'Finished goods sold in the day’s sales', icon: ShoppingBag },
];

const TYPE_NAME = '__type_name__';
let seq = 0;
const nextKey = () => ++seq;
const today = () => new Date().toISOString().slice(0, 10);
const num = (s: string) => parseFloat(s) || 0;
const selectCls = 'h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export default function StockOutSheet({ open, onOpenChange, skus, allowNegative, prefill, onDone, onReceive, onCount, canSellGoods }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skus: OutItem[];
  allowNegative: boolean;
  prefill?: StockOutPrefill | null;
  onDone: () => void;
  /** Record a delivery that was missed (opens Receive). */
  onReceive?: (skuId: string) => void;
  /** Go to the count, when the records and the shelf disagree. */
  onCount?: () => void;
  /** Finished goods can be recorded as sold (migration 20261124600000). */
  canSellGoods?: boolean;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { bySku: unitsBySku } = useItemUnits();
  const { settings } = useInventorySettings();
  const { data: events = [] } = useEventInvoices(open);
  const { data: allLots = [] } = useStockLots(open && !!canSellGoods);

  const [route, setRoute] = useState<OutRoute>('kitchen');
  const [lines, setLines] = useState<Line[]>([]);
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [eventId, setEventId] = useState('');
  const [eventName, setEventName] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmedUnusual, setConfirmedUnusual] = useState(false);
  const submitting = useRef(false);

  const wasteReasons = settings.waste_reasons?.length ? settings.waste_reasons : DEFAULT_WASTE_REASONS;
  const byId = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);
  const active = useMemo(() => skus.filter((s) => !s.is_archived), [skus]);
  const stockUnitOf = (id: string) => unitsBySku.get(id)?.stockUnit ?? normaliseUnit(byId.get(id)?.unit_of_measure) ?? '';

  // How often each item was issued to the kitchen in the last 30 days: the
  // daily sheet puts those first.
  const { data: timesUsed = new Map<string, number>() } = useQuery<Map<string, number>>({
    queryKey: ['stock-out-usage-30d'],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data } = await db.from('inventory_movements')
        .select('product_id').in('movement_type', ['usage', 'production_issue']).gte('occurred_on', since).limit(5000);
      const out = new Map<string, number>();
      for (const r of data ?? []) out.set(r.product_id, (out.get(r.product_id) ?? 0) + 1);
      return out;
    },
  });
  const usedBySku = useMemo(() => {
    const out = new Map<string, number>();
    for (const [skuId, u] of unitsBySku) {
      const n = timesUsed.get(u.productId);
      if (n) out.set(skuId, n);
    }
    return out;
  }, [timesUsed, unitsBySku]);

  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setRoute(prefill?.route ?? 'kitchen');
    setLines([{ key: nextKey(), sku_id: prefill?.skuId ?? '', quantity: '', unit: prefill?.skuId ? stockUnitOf(prefill.skuId) : '' }]);
    setDate(today()); setNote(''); setReason(''); setEventId(''); setEventName(''); setPhoto(null);
    setDirty(false); setTried(false); setConfirmedUnusual(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const touch = () => { setDirty(true); setConfirmedUnusual(false); };
  const setLine = (key: number, patch: Partial<Line>) => { setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l))); touch(); };
  const incoming = route === 'event_return';

  const calc = (l: Line) => {
    const s = byId.get(l.sku_id);
    const u = unitsBySku.get(l.sku_id);
    const stockUnit = s ? stockUnitOf(s.id) : '';
    const unit = l.unit || stockUnit;
    const factor = factorOf(u, unit) ?? 1;
    const qty = num(l.quantity);
    const stockQty = toStock(qty, factor);
    const onHand = Number(s?.stock_quantity ?? 0);
    return { s, u, stockUnit, unit, factor, qty, stockQty, onHand, converted: unit !== stockUnit, value: stockQty * Number(s?.cost_per_unit ?? 0) };
  };
  const filled = lines.filter((l) => l.sku_id && num(l.quantity) > 0).map(calc);
  const short = !incoming && !allowNegative ? filled.filter((c) => c.s && c.stockQty > c.onHand) : [];
  const unusual = route === 'kitchen' || route === 'event' ? filled.filter((c) => c.s && unusualUsage(c.stockQty, c.u?.largestReceipt)) : [];
  const totalValue = filled.reduce((t, c) => t + c.value, 0);

  // Only finished goods are sold from here; ingredients leave by the other routes.
  const sellable = (id: string) => !!unitsBySku.get(id)?.produced;
  const lotsOf = (id: string) => { const pid = unitsBySku.get(id)?.productId; return pid ? allLots.filter((l) => l.product_id === pid) : []; };
  const optionsFor = (key: number): SelectOption[] => {
    const taken = new Set(lines.filter((l) => l.key !== key).map((l) => l.sku_id).filter(Boolean));
    return active.filter((s) => !taken.has(s.id) && (route !== 'sale' || sellable(s.id))).map((s) => ({
      value: s.id, label: s.name, hint: `${fmtQty(Number(s.stock_quantity))} ${stockUnitOf(s.id)} on hand`,
    }));
  };

  // The daily sheet: every item with stock, by storage place, most used first.
  const fillDailySheet = () => {
    const have = new Set(lines.map((l) => l.sku_id).filter(Boolean));
    const pool = active.filter((s) => Number(s.stock_quantity) > 0 && !have.has(s.id));
    if (pool.length === 0) { toast({ title: 'Every item with stock is already listed' }); return; }
    const sheet = orderDailySheet(pool, (s) => unitsBySku.get(s.id)?.storagePlace, settings.storage_places, usedBySku);
    const add = sheet.flatMap((g) => g.items).map((s) => ({ key: nextKey(), sku_id: s.id, quantity: '', unit: stockUnitOf(s.id) }));
    setLines((p) => [...p.filter((l) => l.sku_id), ...add]);
    setDirty(true);
  };
  const placeOf = (skuId: string) => unitsBySku.get(skuId)?.storagePlace?.trim() || '';

  const typedEvent = eventId === TYPE_NAME || (events.length === 0 && !eventId);
  const eventOptions = useMemo<SelectOption[]>(() => [
    { value: TYPE_NAME, label: 'Not on the list: type the event’s name' },
    ...events.map((e) => ({ value: e.id, label: e.label, hint: e.hint })),
  ], [events]);
  const needsEvent = route === 'event' || route === 'event_return';

  const problems: string[] = [];
  if (filled.length === 0) problems.push('Choose an item and a quantity.');
  if (needsEvent && (typedEvent ? !eventName.trim() : !eventId)) problems.push('Say which event it is for.');
  if (route === 'waste' && !reason) problems.push('Choose why it was thrown away.');
  if (route === 'waste' && reason.toLowerCase() === 'other' && !note.trim()) problems.push('Say what happened in the note.');
  // Sold: nothing from an expired lot, and no more than is in date.
  const soldShort = route === 'sale'
    ? filled.map((c) => ({ c, lots: lotsOf(c.s!.id) })).filter((x) => x.lots.length > 0)
        .map((x) => ({ c: x.c, d: drawFromLots(x.lots, x.c.stockQty, date) })).filter((x) => x.d.short > 0 && x.d.expired > 0)
    : [];
  if (soldShort.length) problems.push(`${soldShort[0].c.s!.name}: part of the stock has expired and cannot be sold. Record it as waste.`);
  if (route === 'sale' && filled.some((c) => !sellable(c.s!.id))) problems.push('Only finished goods can be recorded as sold.');

  const submit = async () => {
    setTried(true);
    if (problems.length) { toast({ title: problems[0], variant: 'destructive' }); return; }
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
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      let photoPath: string | null = null;
      if (route === 'waste' && photo && user) {
        const ext = photo.name.split('.').pop() || 'jpg';
        photoPath = `${user.id}/waste-${Date.now()}.${ext}`;
        const up = await supabase.storage.from('receipts').upload(photoPath, photo);
        if (up.error) throw up.error;
      }
      const { data, error } = route === 'sale' ? await db.rpc('fn_record_goods_sold', {
        p_lines: filled.map((c) => (c.converted
          ? { sku_id: c.s!.id, quantity: c.qty, unit: c.unit }
          : { sku_id: c.s!.id, quantity: c.qty })),
        p_occurred_on: date,
        p_note: note.trim() || null,
      }) : await db.rpc('fn_issue_stock', {
        p_route: route,
        p_lines: filled.map((c) => (c.converted
          ? { sku_id: c.s!.id, quantity: c.qty, unit: c.unit }
          : { sku_id: c.s!.id, quantity: c.qty })),
        p_occurred_on: date,
        p_note: note.trim() || null,
        p_reason: route === 'waste' ? reason : null,
        p_event_invoice_id: needsEvent && !typedEvent ? eventId : null,
        p_event_name: needsEvent && typedEvent ? eventName.trim() : null,
        p_photo_path: photoPath,
      });
      if (error) throw new Error(error.message);

      setLines([{ key: nextKey(), sku_id: '', quantity: '', unit: '' }]);
      setDirty(false);
      onOpenChange(false);

      const n = Number(data?.lines ?? filled.length);
      const items = `${n} item${n === 1 ? '' : 's'}`;
      toast({
        title: route === 'kitchen' ? `Issued to kitchen: ${items}`
          : route === 'event' ? `Issued to the event: ${items}`
          : route === 'waste' ? `Waste recorded: ${items}`
          : route === 'sale' ? `Recorded as sold: ${items}`
          : `Returned from the event: ${items}`,
        description: needsEvent && data?.event_food_cost != null
          ? `This event’s food cost is now ${formatNairaCompact(Number(data.event_food_cost))}.`
          : route === 'sale' && Array.isArray(data?.lots) && data.lots.some((l: any) => l.lot_number)
            ? `Taken from ${data.lots.filter((l: any) => l.lot_number).map((l: any) => `${l.lot_number} (${fmtQty(Number(l.quantity))})`).join(', ')}.`
            : `${formatNairaCompact(Math.abs(Number(data?.value ?? 0)))} at average cost.`,
      });
      for (const key of [['inventory-data'], ['inventory-item'], ['item-units'], ['stock-out-usage-30d'], ['ops-low-stock'], ['skus-for-stock-in'], ['stock-lots-in-stock'], ['production'], ['stock-reports']]) {
        qc.invalidateQueries({ queryKey: key });
      }
      onDone();
    } catch (e) {
      toast({ title: 'Could not record that', description: (e as Error).message, variant: 'destructive' });
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const cta = route === 'kitchen' ? 'Issue to kitchen' : route === 'event' ? 'Issue to event' : route === 'waste' ? 'Record waste' : route === 'sale' ? 'Record as sold' : 'Record return';
  const shownRoutes = ROUTES.filter((r) => r.value !== 'sale' || canSellGoods);
  let lastPlace: string | null = null;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      title="Use stock"
      description="Say where it went. Every quantity is saved in the item’s stock unit, with what you typed kept beside it."
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-sm sm:mr-auto" role="status">
            {filled.length} item{filled.length === 1 ? '' : 's'}{totalValue > 0 && <> · <b className="tabular-nums">{formatNairaCompact(totalValue)}</b> at average cost</>}
          </span>
          <div className="flex gap-2.5">
            <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="h-11 flex-[2] sm:flex-none" onClick={submit} disabled={saving || short.length > 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{cta}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <div role="radiogroup" aria-label="Where the stock went" className={cn('grid gap-2', shownRoutes.length > 4 ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-4')}>
          {shownRoutes.map((r) => {
            const Icon = r.icon;
            const on = route === r.value;
            return (
              <button key={r.value} type="button" role="radio" aria-checked={on}
                onClick={() => {
                  setRoute(r.value);
                  // Ingredients cannot be sold from here: drop any that were listed.
                  if (r.value === 'sale') setLines((p) => { const keep = p.filter((l) => !l.sku_id || sellable(l.sku_id)); return keep.length ? keep : [{ key: nextKey(), sku_id: '', quantity: '', unit: '' }]; });
                  touch();
                }}
                className={cn('flex flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition-colors',
                  on ? 'border-primary bg-primary/5 text-foreground' : 'text-muted-foreground hover:border-foreground/30')}>
                <Icon className={cn('h-5 w-5', on && 'text-primary')} aria-hidden />
                <span className="text-sm font-semibold">{r.label}</span>
                <span className="hidden text-[11.5px] leading-tight sm:block">{r.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="-mt-3 text-xs text-muted-foreground">
          A batch made from a recipe is recorded under <Link to="/business/production" className="underline underline-offset-2">Production</Link>.
          {route === 'sale' && ' Sold here is for finished goods sold in the day’s takings; anything on an invoice with an item line is taken off by the invoice.'}
        </p>

        {needsEvent && (
          <div className="grid gap-4 sm:grid-cols-2">
            {events.length > 0 && (
              <Field id="out-event" label="Event" required error={tried && !typedEvent && !eventId ? 'Choose the event.' : null}>
                <SearchableSelect id="out-event" options={eventOptions} value={eventId} title="Choose the event"
                  placeholder="Choose the event’s invoice" onChange={(v) => { setEventId(v); touch(); }} />
              </Field>
            )}
            {typedEvent && (
              <Field id="out-event-name" label="Event name" required error={tried && !eventName.trim() ? 'Type the event’s name.' : null}
                hint="Use the same name each time, so the event’s food cost adds up.">
                <Input id="out-event-name" value={eventName} placeholder="e.g. Adaeze wedding, 6 Dec"
                  onChange={(e) => { setEventName(e.target.value); touch(); }} />
              </Field>
            )}
          </div>
        )}

        {route === 'waste' && (
          <Field id="out-reason" label="Why it was thrown away" required error={tried && !reason ? 'Choose a reason.' : null}>
            <select id="out-reason" className={selectCls} value={reason} onChange={(e) => { setReason(e.target.value); touch(); }}>
              <option value="">Choose a reason</option>
              {wasteReasons.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">{incoming ? 'Items coming back' : 'Items'}</div>
            {route === 'kitchen' && (
              <Button type="button" variant="ghost" size="sm" onClick={fillDailySheet}
                title="Lists every item with stock, by storage place, the most used first">
                <Plus className="mr-1.5 h-4 w-4" />Daily sheet
              </Button>
            )}
          </div>
          {lines.map((l) => {
            const c = calc(l);
            const isShort = !incoming && !allowNegative && !!c.s && c.stockQty > c.onHand;
            const isUnusual = unusual.some((u) => u.s?.id === c.s?.id) && c.qty > 0;
            // On a long sheet, a heading where the storage place changes.
            const place = lines.length > 3 && l.sku_id ? placeOf(l.sku_id) || 'No storage place set' : null;
            const heading = place && place !== lastPlace ? place : null;
            if (place) lastPlace = place;
            return (
              <div key={l.key} className="space-y-1">
                {heading && <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</div>}
                <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_5.25rem_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
                  <SearchableSelect options={optionsFor(l.key)} value={l.sku_id} title="Choose an item" placeholder="Search items…"
                    onChange={(v) => setLine(l.key, { sku_id: v, unit: v ? stockUnitOf(v) : '' })} />
                  <Input type="number" inputMode="decimal" min="0" step="any" placeholder="Qty"
                    aria-label={`Quantity${c.s ? ` of ${c.s.name} in ${c.unit}` : ''}`}
                    value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                  <select aria-label="Unit" className={selectCls} disabled={!c.s} value={c.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })}>
                    {!c.s && <option value="">unit</option>}
                    {(c.u?.units ?? (c.s ? [{ name: c.stockUnit, factor: 1 }] : [])).map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                  </select>
                  {lines.length > 1 ? (
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove item" className="h-11 w-11"
                      onClick={() => { setLines((p) => p.filter((x) => x.key !== l.key)); touch(); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  ) : <span className="w-0" />}
                </div>
                {c.s && (c.qty > 0 || lines.length <= 3) && (
                  <p className={cn('text-xs', isShort ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                    {isShort && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />}
                    {c.converted && c.qty > 0 && <><b className="font-semibold text-foreground">{fmtQty(c.qty)} {c.unit} = {fmtQty(c.stockQty)} {c.stockUnit}</b> · </>}
                    {fmtQty(c.onHand)} {c.stockUnit} on hand
                    {c.qty > 0 && <> → {fmtQty(c.onHand + (incoming ? c.stockQty : -c.stockQty))} {c.stockUnit} after</>}
                  </p>
                )}
                {route === 'sale' && c.s && c.qty > 0 && (() => {
                  const lots = lotsOf(c.s.id);
                  if (lots.length === 0) return null;
                  const d = drawFromLots(lots, c.stockQty, date);
                  return (
                    <p className={cn('text-xs', d.short > 0 && d.expired > 0 ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                      {d.draws.length > 0 && <>Oldest lot first: {d.draws.map((x) => `${x.lot.lot_number} ${fmtQty(x.qty)}${x.lot.expires_on ? ` (expires ${x.lot.expires_on})` : ''}`).join(', ')}. </>}
                      {d.expired > 0 && <>{fmtQty(d.expired)} {c.stockUnit} has expired and cannot be sold: record it as waste.</>}
                    </p>
                  );
                })()}
                {isShort && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                    <p>More than is in stock. Stock cannot go below zero, so either a delivery was not recorded or the count is wrong.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {onReceive && (
                        <Button type="button" size="sm" variant="outline"
                          onClick={() => { if (dirty && !window.confirm('Leave this form to record the delivery? What you have typed here will be lost.')) return; onOpenChange(false); onReceive(c.s!.id); }}>
                          Record the missing delivery
                        </Button>
                      )}
                      {onCount && (
                        <Button type="button" size="sm" variant="outline"
                          onClick={() => { if (dirty && !window.confirm('Leave this form to count the stock? What you have typed here will be lost.')) return; onOpenChange(false); onCount(); }}>
                          Correct the count
                        </Button>
                      )}
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
          <Button type="button" variant="outline" size="sm"
            onClick={() => { setLines((p) => [...p, { key: nextKey(), sku_id: '', quantity: '', unit: '' }]); touch(); }}>
            <Plus className="mr-1.5 h-4 w-4" />Add another item
          </Button>
          {unusual.length > 0 && short.length === 0 && (
            <label className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={confirmedUnusual} onChange={(e) => setConfirmedUnusual(e.target.checked)} />
              <span>Yes, {unusual.map((c) => `${fmtQty(c.qty)} ${c.unit} of ${c.s!.name}`).join(' and ')} is right.</span>
            </label>
          )}
        </section>

        {route === 'waste' && (
          <ReceiptUpload id="out-photo" file={photo} onChange={(f) => { setPhoto(f); touch(); }} />
        )}

        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field id="out-date" label="Date">
            <Input id="out-date" type="date" max={today()} value={date} onChange={(e) => { setDate(e.target.value); touch(); }} />
          </Field>
          <Field id="out-note" label="Note" required={route === 'waste' && reason.toLowerCase() === 'other'}>
            <Textarea id="out-note" rows={2} value={note} onChange={(e) => { setNote(e.target.value); touch(); }}
              placeholder={route === 'waste' ? 'What happened' : route === 'kitchen' ? 'Optional' : 'Optional, e.g. who collected it'} />
          </Field>
        </div>
      </div>
    </FormSheet>
  );
}
