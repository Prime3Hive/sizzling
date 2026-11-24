import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, PackagePlus, Printer, ShoppingBasket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/shell/ui';
import { toast } from '@/hooks/use-toast';
import { usePayees } from '@/hooks/useExpenseReference';
import type { ItemUnitInfo } from '@/hooks/useItemUnits';
import type { ReceivePrefill } from '@/components/inventory/ReceiveSheet';
import { formatNairaCompact } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { groupBySupplier, toBuyList, type ToBuyRow } from '@/lib/reorder';
import { fmtQty } from '@/lib/units';

// The "To buy" list: every item at or below its minimum level, with how much
// to buy to bring it back to its target, in whole purchase units. From here
// it becomes a purchase order (items with a usual supplier) or a printed
// market list, and what comes back is recorded on the Receive screen.

const MARKET_KEY = 'market-list';

interface BuyItem {
  id: string; name: string; category: string; unit_of_measure: string;
  stock_quantity: number; reorder_level: number; cost_per_unit: number; is_archived: boolean;
}

/** One line handed to a purchase order. */
export interface OrderLine { item_name: string; sku_id: string; quantity: number; unit_of_measure: string; unit_price: number }

interface SavedList { date: string; lines: { skuId: string; name: string; quantity: number; unit: string }[] }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export default function ToBuyList({ skus, unitsBySku, canOrder, canReceive, onCreateOrder, onReceive }: {
  skus: BuyItem[];
  unitsBySku: Map<string, ItemUnitInfo>;
  /** May raise a purchase order (managers and admins). */
  canOrder: boolean;
  /** Receive is live and this person may record stock. */
  canReceive: boolean;
  onCreateOrder: (supplier: { id: string | null; name: string }, lines: OrderLine[]) => void;
  onReceive: (prefill: ReceivePrefill) => void;
}) {
  const { data: payees = [] } = usePayees();
  const payeeName = useMemo(() => new Map(payees.map((p) => [p.id, p.name])), [payees]);

  const rows = useMemo(
    () => toBuyList(skus, (s) => { const u = unitsBySku.get(s.id); return { units: u, target: u?.targetLevel, stockUnit: s.unit_of_measure }; }),
    [skus, unitsBySku],
  );
  const groups = useMemo(
    () => groupBySupplier(rows, (r) => {
      const id = unitsBySku.get(r.item.id)?.payeeId;
      return id ? { id, name: payeeName.get(id) ?? 'Supplier' } : null;
    }),
    [rows, unitsBySku, payeeName],
  );

  // Quantities start at the suggestion and can be changed; unticked rows are left off.
  const [qty, setQty] = useState<Record<string, string>>({});
  const [off, setOff] = useState<Record<string, boolean>>({});
  const packsOf = (r: ToBuyRow<BuyItem>) => {
    const typed = qty[r.item.id];
    const n = typed === undefined ? r.suggestion.packs : parseFloat(typed);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const chosen = (list: ToBuyRow<BuyItem>[]) => list.filter((r) => !off[r.item.id] && packsOf(r) > 0);
  const costOf = (r: ToBuyRow<BuyItem>) => packsOf(r) * r.suggestion.factor * Number(r.item.cost_per_unit || 0);
  const total = chosen(rows).reduce((t, r) => t + costOf(r), 0);

  // A market list printed earlier, waiting to be received.
  const [saved, setSaved] = useState<SavedList | null>(null);
  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(MARKET_KEY) ?? 'null'); if (s?.lines?.length) setSaved(s); } catch { /* none */ }
  }, []);
  const clearSaved = () => { try { localStorage.removeItem(MARKET_KEY); } catch { /* ignore */ } setSaved(null); };

  const printMarketList = (list: ToBuyRow<BuyItem>[]) => {
    const picked = chosen(list);
    if (picked.length === 0) { toast({ title: 'Tick at least one item with a quantity', variant: 'destructive' }); return; }
    const date = new Date().toISOString().slice(0, 10);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Market list ${date}</title>
<style>body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 16px;color:#555}
table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:8px 6px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#555}
td.n,th.n{text-align:right;white-space:nowrap}td.box{width:90px;border:1px solid #999}</style></head><body>
<h1>Market list</h1><p>${esc(date)} · ${picked.length} item${picked.length === 1 ? '' : 's'} · about ${esc(formatNairaCompact(picked.reduce((t, r) => t + costOf(r), 0)))} at the last cost</p>
<table><thead><tr><th>Item</th><th class="n">To buy</th><th class="n">In stock now</th><th class="n">Last cost</th><th>Bought</th><th>Paid</th></tr></thead><tbody>
${picked.map((r) => `<tr><td>${esc(r.item.name)}</td><td class="n"><b>${esc(fmtQty(packsOf(r)))} ${esc(r.suggestion.unit)}</b></td><td class="n">${esc(fmtQty(Number(r.item.stock_quantity)))} ${esc(r.item.unit_of_measure)}</td><td class="n">${esc(formatNairaCompact(r.suggestion.factor * Number(r.item.cost_per_unit || 0)))} / ${esc(r.suggestion.unit)}</td><td class="box"></td><td class="box"></td></tr>`).join('')}
</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`;
    const list2: SavedList = { date, lines: picked.map((r) => ({ skuId: r.item.id, name: r.item.name, quantity: packsOf(r), unit: r.suggestion.unit })) };
    try { localStorage.setItem(MARKET_KEY, JSON.stringify(list2)); } catch { /* storage blocked: the list still prints */ }
    setSaved(list2);
    const w = window.open('', '_blank');
    if (!w) { toast({ title: 'The browser blocked the print window', description: 'Allow pop-ups for this site, then try again. The list is saved here.', variant: 'destructive' }); return; }
    w.document.write(html);
    w.document.close();
  };

  const receive = (lines: SavedList['lines'], payeeId?: string | null) =>
    onReceive({ items: lines.map((l) => ({ skuId: l.skuId, quantity: l.quantity, unit: l.unit })), payeeId: payeeId ?? undefined, supplierName: payeeId ? undefined : 'Market' });

  const order = (g: typeof groups[number]) => {
    const picked = chosen(g.rows);
    if (picked.length === 0) { toast({ title: 'Tick at least one item with a quantity', variant: 'destructive' }); return; }
    onCreateOrder({ id: g.id, name: g.id ? g.name : '' }, picked.map((r) => ({
      item_name: r.item.name, sku_id: r.item.id, quantity: packsOf(r), unit_of_measure: r.suggestion.unit,
      // The order is priced per purchase unit: the last cost of what one holds.
      unit_price: Math.round(r.suggestion.factor * Number(r.item.cost_per_unit || 0) * 100) / 100,
    })));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Items at or below their minimum level, with enough to bring each back to its target, in whole purchase units.
          {rows.some((r) => r.suggestion.targetAssumed) && ' Where no target is set, twice the minimum is used.'}
        </p>
        {rows.length > 0 && <span className="shrink-0 text-sm">About <b className="tabular-nums">{formatNairaCompact(total)}</b> at the last cost</span>}
      </div>

      {saved && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <b>Market list of {saved.date}</b>: {saved.lines.length} item{saved.lines.length === 1 ? '' : 's'}.
            {' '}When the shopping is back, receive it here and correct any quantity or price that differs.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={clearSaved}>Discard</Button>
            {canReceive && <Button size="sm" onClick={() => receive(saved.lines)}><PackagePlus className="mr-1.5 h-4 w-4" />Receive this list</Button>}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={ShoppingBasket} title="Nothing to buy" body="Every item is above its minimum level." />
      ) : groups.map((g) => (
        <section key={g.id ?? 'market'} className="overflow-hidden rounded-2xl border">
          <div className="flex flex-col gap-2 border-b bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold">{g.name}</h2>
              <p className="text-xs text-muted-foreground">
                {chosen(g.rows).length} of {g.rows.length} item{g.rows.length === 1 ? '' : 's'} · about {formatNairaCompact(chosen(g.rows).reduce((t, r) => t + costOf(r), 0))}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => printMarketList(g.rows)}><Printer className="mr-1.5 h-4 w-4" />Market list</Button>
              {canOrder && <Button variant="outline" size="sm" onClick={() => order(g)}><ClipboardList className="mr-1.5 h-4 w-4" />Purchase order</Button>}
              {canReceive && (
                <Button size="sm" onClick={() => {
                  const picked = chosen(g.rows);
                  if (picked.length === 0) { toast({ title: 'Tick at least one item with a quantity', variant: 'destructive' }); return; }
                  receive(picked.map((r) => ({ skuId: r.item.id, name: r.item.name, quantity: packsOf(r), unit: r.suggestion.unit })), g.id);
                }}>
                  <PackagePlus className="mr-1.5 h-4 w-4" />Receive now
                </Button>
              )}
            </div>
          </div>
          <ul className="divide-y">
            {g.rows.map((r) => {
              const s = r.suggestion;
              const unit = unitsBySku.get(r.item.id)?.stockUnit ?? r.item.unit_of_measure;
              const on = !off[r.item.id];
              return (
                <li key={r.item.id} className={cn('flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center', !on && 'opacity-50')}>
                  <label className="flex min-w-0 flex-1 items-start gap-3">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={on} aria-label={`Buy ${r.item.name}`}
                      onChange={(e) => setOff((p) => ({ ...p, [r.item.id]: !e.target.checked }))} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.item.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        <span className={r.out ? 'font-semibold text-destructive' : 'font-semibold text-amber-700 dark:text-amber-400'}>
                          {r.out ? 'Out of stock' : `${fmtQty(Number(r.item.stock_quantity))} ${unit} left`}
                        </span>
                        {' '}· minimum {fmtQty(Number(r.item.reorder_level))} {unit} · target {fmtQty(s.target)} {unit}{s.targetAssumed ? ' (twice the minimum)' : ''}
                      </span>
                    </span>
                  </label>
                  <div className="flex items-center gap-2 pl-7 sm:pl-0">
                    <Input type="number" inputMode="decimal" min="0" step="any" className="h-10 w-20 text-right tabular-nums" disabled={!on}
                      aria-label={`${r.item.name}: ${s.unit} to buy`} value={qty[r.item.id] ?? String(s.packs)}
                      onChange={(e) => setQty((p) => ({ ...p, [r.item.id]: e.target.value }))} />
                    <span className="w-28 text-xs text-muted-foreground">
                      {s.unit}{s.factor !== 1 ? ` = ${fmtQty(packsOf(r) * s.factor)} ${unit}` : ''}
                      <span className="block tabular-nums">{formatNairaCompact(costOf(r))}</span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
