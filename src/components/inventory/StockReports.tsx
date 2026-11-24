import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FilterChips } from '@/components/shell/ui';
import type { ItemUnitInfo } from '@/hooks/useItemUnits';
import {
  useCostReport, useCountDifferenceReport, useEventCostReport, usePriceChanges, useSupplierReport,
  useUsageReport, useWasteReport,
} from '@/hooks/useStockReports';
import { formatNaira, formatNairaCompact } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { getCategoryLabel } from '@/lib/inventoryConstants';
import { itemKindLabel } from '@/lib/itemMaster';
import { ROUTE_META, type StockRoute } from '@/lib/stockRoutes';
import {
  COGS_LABEL, OTHER_LABEL, costStatement, foodCostPct, monthRange, pivotUsage, recentMonths, toCsv,
} from '@/lib/stockReports';
import { fmtQty, withPurchaseEquivalent } from '@/lib/units';

// The stock reports. Every figure is worked out from the stock movements at
// the cost each one carried, so they agree with the item histories. Nothing
// here changes the books.

type ReportKey = 'food' | 'on-hand' | 'usage' | 'counts' | 'waste' | 'suppliers' | 'prices';

interface StockItem {
  id: string; name: string; category: string; unit_of_measure: string;
  stock_quantity: number; reorder_level: number; cost_per_unit: number; is_archived: boolean;
}

const selectCls = 'h-10 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const day = (d: string | null | undefined) => (d ? format(parseISO(d), 'd MMM yyyy') : '—');
const money = (v: number) => formatNaira(v);
const signedMoney = (v: number) => `${v < 0 ? '−' : ''}${formatNaira(Math.abs(v))}`;
const routeLabel = (r: string) => ROUTE_META[r as StockRoute]?.label ?? r;

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function Shell({ title, answers, loading, error, empty, onExport, children }: {
  title: string; answers: string; loading?: boolean; error?: Error | null; empty?: string | false;
  onExport?: () => void; children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{answers}</p>
        </div>
        {onExport && !loading && !error && !empty && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={onExport}><Download className="mr-1.5 h-4 w-4" />CSV</Button>
        )}
      </div>
      {loading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">{error.message}</p>
        : empty ? <p className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">{empty}</p>
        : children}
    </section>
  );
}

const th = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const td = 'px-3 py-2 align-top';
const numCls = 'text-right tabular-nums whitespace-nowrap';
function Table({ head, children, foot }: { head: { label: string; right?: boolean }[]; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>{head.map((h) => <th key={h.label} scope="col" className={cn(th, h.right && 'text-right')}>{h.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
        {foot && <tfoot className="border-t bg-muted/30 font-semibold">{foot}</tfoot>}
      </table>
    </div>
  );
}

export default function StockReports({ skus, unitsBySku, canSeeSuppliers }: {
  skus: StockItem[];
  unitsBySku: Map<string, ItemUnitInfo>;
  /** Purchases by supplier shows money owed: managers and those who see the books. */
  canSeeSuppliers: boolean;
}) {
  const months = useMemo(() => recentMonths(new Date(), 12), []);
  const [report, setReport] = useState<ReportKey>('food');
  const [month, setMonth] = useState(months[0]);
  const [from, setFrom] = useState(() => monthRange(months[0]).from);
  const [to, setTo] = useState(() => monthRange(months[0]).to);
  const pickMonth = (m: string) => { setMonth(m); if (m) { const r = monthRange(m); setFrom(r.from); setTo(r.to); } };
  const period = `${day(from)} to ${day(to)}`;
  const tag = `${from}_${to}`;

  const cost = useCostReport(from, to, report === 'food');
  const events = useEventCostReport(from, to, report === 'food');
  const usage = useUsageReport(from, to, report === 'usage');
  const counts = useCountDifferenceReport(from, to, report === 'counts');
  const waste = useWasteReport(from, to, report === 'waste');
  const suppliers = useSupplierReport(from, to, report === 'suppliers' && canSeeSuppliers);
  const prices = usePriceChanges(from.slice(0, 7) + '-01', report === 'prices');

  const chips: { value: ReportKey; label: string }[] = [
    { value: 'food', label: 'Food cost' },
    { value: 'on-hand', label: 'Stock on hand' },
    { value: 'usage', label: 'Usage by item' },
    { value: 'counts', label: 'Count differences' },
    { value: 'waste', label: 'Waste' },
    ...(canSeeSuppliers ? [{ value: 'suppliers' as const, label: 'Purchases by supplier' }] : []),
    { value: 'prices', label: 'Price changes' },
  ];

  return (
    <div className="space-y-5">
      <FilterChips<ReportKey> label="Report" value={report} onChange={setReport} options={chips} />

      {report !== 'on-hand' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rep-month" className="text-xs">Month</Label>
            <select id="rep-month" className={selectCls} value={month} onChange={(e) => pickMonth(e.target.value)}>
              {!month && <option value="">Other dates</option>}
              {months.map((m) => <option key={m} value={m}>{format(parseISO(`${m}-01`), 'MMMM yyyy')}</option>)}
            </select>
          </div>
          {report !== 'prices' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="rep-from" className="text-xs">From</Label>
                <Input id="rep-from" type="date" className="h-10" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setMonth(''); }} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rep-to" className="text-xs">To</Label>
                <Input id="rep-to" type="date" className="h-10" value={to} min={from} onChange={(e) => { setTo(e.target.value); setMonth(''); }} />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Food cost ── */}
      {report === 'food' && (() => {
        const r = cost.data;
        const s = r ? costStatement(r) : null;
        const line = (label: string, value: number, opts: { sign?: '+' | '−' | '='; strong?: boolean; indent?: boolean; muted?: boolean } = {}) => (
          <tr key={label} className={cn(opts.strong && 'font-semibold', opts.strong && opts.sign === '=' && 'border-t-2')}>
            <td className={cn(td, opts.indent && 'pl-8', opts.muted && 'text-muted-foreground')}>
              {opts.sign && <span className="mr-2 inline-block w-3 text-muted-foreground">{opts.sign}</span>}{label}
            </td>
            <td className={cn(td, numCls, opts.muted && 'text-muted-foreground')}>{signedMoney(value)}</td>
          </tr>
        );
        return (
          <div className="space-y-6">
            <Shell title="Food cost" answers={`Cost of goods as a share of revenue, ${period}.`}
              loading={cost.isLoading} error={cost.error as Error | null}
              onExport={r && s ? () => download(`food-cost-${tag}.csv`, toCsv(['Line', 'Amount (NGN)'], [
                ['Opening stock value', r.opening_value], ['Purchases of stock', r.purchases],
                ...Object.entries(r.cogs).map(([k, v]) => [`Cost of goods: ${COGS_LABEL[k as keyof typeof COGS_LABEL]}`, v] as [string, number]),
                ['Cost of goods', s.cogsTotal],
                ...Object.entries(r.other).filter(([, v]) => v !== 0).map(([k, v]) => [`Other: ${OTHER_LABEL[k as keyof typeof OTHER_LABEL]}`, v] as [string, number]),
                ['Closing stock value', r.closing_value],
                ['Food revenue', s.foodRevenue ?? ''], ['Food cost %', s.foodCostPct ?? ''],
              ])) : undefined}>
              {r && s && (
                <div className="space-y-4">
                  {(r.reliable_from == null || from < r.reliable_from) && (
                    <p className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                      <span>
                        {r.reliable_from == null
                          ? 'No opening count has been posted yet. Until one is, older movements carry costs in mixed units and these figures cannot be relied on.'
                          : `This period starts before the opening count of ${day(r.reliable_from)}. Movements before it carry costs in mixed units, so the figures for those days cannot be relied on.`}
                      </span>
                    </p>
                  )}
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <tbody className="divide-y">
                        {line('Opening stock value', r.opening_value, { strong: true })}
                        {line('Purchases of stock', r.purchases, { sign: '+' })}
                        {line('Cost of goods', s.cogsTotal, { sign: '−', strong: true })}
                        {(Object.keys(r.cogs) as (keyof typeof r.cogs)[])
                          .filter((k) => r.cogs[k] !== 0 || ['kitchen', 'event', 'waste', 'count_difference'].includes(k))
                          .map((k) => line(COGS_LABEL[k], r.cogs[k], { indent: true, muted: true }))}
                        {s.otherTotal !== 0 && line('Other movements', s.otherTotal, { sign: '+' })}
                        {(Object.keys(r.other) as (keyof typeof r.other)[]).filter((k) => r.other[k] !== 0)
                          .map((k) => line(OTHER_LABEL[k], r.other[k], { indent: true, muted: true }))}
                        {line('Closing stock value', r.closing_value, { sign: '=', strong: true })}
                      </tbody>
                    </table>
                  </div>
                  {Math.abs(s.unexplained) >= 0.01 && (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                      These do not add up by {money(Math.abs(s.unexplained))}. That should never happen; tell the developer.
                    </p>
                  )}

                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <tbody className="divide-y">
                        <tr><td className={td}>Cost of goods</td><td className={cn(td, numCls)}>{money(s.cogsTotal)}</td></tr>
                        {r.revenue ? (
                          <>
                            <tr><td className={td}>Food revenue <span className="text-xs text-muted-foreground">(daily {formatNairaCompact(r.revenue.daily)}, events {formatNairaCompact(r.revenue.event)})</span></td><td className={cn(td, numCls)}>{money(s.foodRevenue!)}</td></tr>
                            <tr className="font-semibold"><td className={td}>Food cost</td><td className={cn(td, numCls)}>{s.foodCostPct == null ? 'No revenue in this period' : `${s.foodCostPct}%`}</td></tr>
                          </>
                        ) : (
                          <tr><td className={cn(td, 'text-muted-foreground')} colSpan={2}>Revenue, and so the food cost percentage, is shown to those who can see the profit and loss.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {r.ledger_cogs != null && (
                    <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      The profit and loss shows cost of sales of <b className="text-foreground">{money(r.ledger_cogs)}</b> for this period,
                      {' '}{money(Math.abs(s.ledgerGap!))} {s.ledgerGap! >= 0 ? 'more' : 'less'} than the cost of goods above. The books count a
                      purchase as a cost on the day it is bought; this report counts it when the stock is used, wasted or found missing.
                      The difference is mostly stock bought and still on the shelf (stock value {r.closing_value >= r.opening_value ? 'rose' : 'fell'} by {money(Math.abs(r.closing_value - r.opening_value))}),
                      plus purchases that were expensed without being received into stock.
                    </p>
                  )}
                  {r.movements_without_cost > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {r.movements_without_cost} movement{r.movements_without_cost === 1 ? '' : 's'} in this period {r.movements_without_cost === 1 ? 'has' : 'have'} no cost (the item had none when it moved), so {r.movements_without_cost === 1 ? 'it counts' : 'they count'} as ₦0 here.
                    </p>
                  )}
                </div>
              )}
            </Shell>

            <Shell title="Food cost per event" answers="What each event took from stock in this period, less what came back."
              loading={events.isLoading} error={events.error as Error | null}
              empty={!events.data?.length && 'No stock was issued to an event in this period.'}
              onExport={() => download(`event-food-cost-${tag}.csv`, toCsv(['Event', 'Invoice', 'Event date', 'Food cost', 'Invoiced', 'Food cost %'],
                (events.data ?? []).map((e) => [e.event_name, e.invoice_number, e.event_date, e.food_cost, e.invoiced, foodCostPct(e.food_cost, e.invoiced)])))}>
              <Table head={[{ label: 'Event' }, { label: 'Food cost', right: true }, { label: 'Invoiced', right: true }, { label: 'Food cost %', right: true }]}>
                {(events.data ?? []).map((e, i) => {
                  const pct = foodCostPct(e.food_cost, e.invoiced);
                  return (
                    <tr key={e.event_invoice_id ?? `${e.event_name}-${i}`}>
                      <td className={td}>
                        <span className="block font-medium">{e.event_name || 'Event'}</span>
                        <span className="block text-xs text-muted-foreground">{[e.invoice_number ?? 'No invoice', e.event_date ? day(e.event_date) : null].filter(Boolean).join(' · ')}</span>
                      </td>
                      <td className={cn(td, numCls)}>{money(e.food_cost)}</td>
                      <td className={cn(td, numCls)}>{e.invoiced == null ? '—' : money(e.invoiced)}</td>
                      <td className={cn(td, numCls, 'font-semibold')}>{pct == null ? '—' : `${pct}%`}</td>
                    </tr>
                  );
                })}
              </Table>
            </Shell>
          </div>
        );
      })()}

      {/* ── Stock on hand ── */}
      {report === 'on-hand' && (() => {
        const rows = skus.filter((s) => !s.is_archived)
          .map((s) => ({ s, u: unitsBySku.get(s.id), value: Math.max(Number(s.stock_quantity), 0) * Number(s.cost_per_unit || 0) }))
          .sort((a, b) => getCategoryLabel(a.s.category).localeCompare(getCategoryLabel(b.s.category)) || a.s.name.localeCompare(b.s.name));
        const total = rows.reduce((t, r) => t + r.value, 0);
        const packs = (r: typeof rows[number]) => withPurchaseEquivalent(Number(r.s.stock_quantity), r.u).split(', ')[1]?.replace(/^about /, '') ?? '';
        return (
          <Shell title="Stock on hand" answers="What we have now, in stock units and packs, and what it is worth at average cost."
            empty={!rows.length && 'No items yet.'}
            onExport={() => download(`stock-on-hand-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
              ['Item', 'Category', 'Type', 'Kept in', 'On hand', 'Unit', 'In packs', 'Minimum', 'Cost per unit', 'Value'],
              rows.map((r) => [r.s.name, getCategoryLabel(r.s.category), itemKindLabel(r.u?.kind), r.u?.storagePlace, Number(r.s.stock_quantity), r.u?.stockUnit ?? r.s.unit_of_measure, packs(r), Number(r.s.reorder_level), Number(r.s.cost_per_unit || 0), Math.round(r.value * 100) / 100])))}>
            <Table head={[{ label: 'Item' }, { label: 'On hand', right: true }, { label: 'In packs', right: true }, { label: 'Cost per unit', right: true }, { label: 'Value', right: true }]}
              foot={<tr><td className={td} colSpan={4}>{rows.length} items</td><td className={cn(td, numCls)}>{money(total)}</td></tr>}>
              {rows.map((r) => {
                const unit = r.u?.stockUnit ?? r.s.unit_of_measure;
                const q = Number(r.s.stock_quantity);
                return (
                  <tr key={r.s.id}>
                    <td className={td}>
                      <span className="block font-medium">{r.s.name}</span>
                      <span className="block text-xs text-muted-foreground">{[getCategoryLabel(r.s.category), r.u?.storagePlace].filter(Boolean).join(' · ')}</span>
                    </td>
                    <td className={cn(td, numCls, q < 0 && 'text-destructive', q > 0 && q <= Number(r.s.reorder_level) && 'text-amber-700 dark:text-amber-400')}>{fmtQty(q)} {unit}</td>
                    <td className={cn(td, numCls, 'text-muted-foreground')}>{packs(r) || '—'}</td>
                    <td className={cn(td, numCls, 'text-muted-foreground')}>{money(Number(r.s.cost_per_unit || 0))}</td>
                    <td className={cn(td, numCls)}>{money(r.value)}</td>
                  </tr>
                );
              })}
            </Table>
          </Shell>
        );
      })()}

      {/* ── Usage by item ── */}
      {report === 'usage' && (() => {
        const p = pivotUsage(usage.data ?? []);
        const routes = ['kitchen', 'event', 'event_return', 'waste', 'count_difference', 'production', 'sale', 'correction', 'usage'].filter((r) => p.routes.includes(r));
        return (
          <Shell title="Usage by item" answers={`How much of each item left stock, by route and by week, ${period}.`}
            loading={usage.isLoading} error={usage.error as Error | null} empty={!p.items.length && 'Nothing left stock in this period.'}
            onExport={() => download(`usage-by-item-${tag}.csv`, toCsv(['Week starting', 'Item', 'Unit', 'Route', 'Quantity', 'Value'],
              (usage.data ?? []).map((r) => [r.week_start, r.item_name, r.stock_unit, routeLabel(r.route), r.quantity, r.value])))}>
            <Table head={[{ label: 'Item' }, ...routes.map((r) => ({ label: routeLabel(r), right: true })), ...p.weeks.map((w) => ({ label: `Wk ${format(parseISO(w), 'd MMM')}`, right: true })), { label: 'Value', right: true }]}
              foot={<tr><td className={td} colSpan={1 + routes.length + p.weeks.length}>{p.items.length} items</td><td className={cn(td, numCls)}>{money(p.items.reduce((t, i) => t + i.value, 0))}</td></tr>}>
              {p.items.map((i) => (
                <tr key={i.product_id}>
                  <td className={td}><span className="font-medium">{i.item_name}</span> <span className="text-xs text-muted-foreground">{i.stock_unit}</span></td>
                  {routes.map((r) => <td key={r} className={cn(td, numCls)}>{i.byRoute[r] ? fmtQty(i.byRoute[r]) : <span className="text-muted-foreground">—</span>}</td>)}
                  {p.weeks.map((w) => <td key={w} className={cn(td, numCls, 'text-muted-foreground')}>{i.byWeek[w] ? fmtQty(i.byWeek[w]) : '—'}</td>)}
                  <td className={cn(td, numCls)}>{money(i.value)}</td>
                </tr>
              ))}
            </Table>
          </Shell>
        );
      })()}

      {/* ── Count differences ── */}
      {report === 'counts' && (() => {
        const rows = counts.data ?? [];
        const short = rows.filter((r) => r.value < 0).reduce((t, r) => t - r.value, 0);
        const over = rows.filter((r) => r.value > 0).reduce((t, r) => t + r.value, 0);
        return (
          <Shell title="Count differences" answers={`What went missing or was found at each approved count, ${period}. Reported on their own, never as usage.`}
            loading={counts.isLoading} error={counts.error as Error | null} empty={!rows.length && 'No approved count found a difference in this period.'}
            onExport={() => download(`count-differences-${tag}.csv`, toCsv(['Count', 'Date', 'Item', 'Unit', 'Expected', 'Counted', 'Difference', 'Value', 'Reason'],
              rows.map((r) => [r.count_number, r.count_date, r.item_name, r.stock_unit, r.expected, r.counted, r.difference, r.value, r.reason])))}>
            <Table head={[{ label: 'Item' }, { label: 'Expected', right: true }, { label: 'Counted', right: true }, { label: 'Difference', right: true }, { label: 'Value', right: true }, { label: 'Reason' }]}
              foot={<tr><td className={td} colSpan={4}>Short {money(short)} · over {money(over)}</td><td className={cn(td, numCls)}>{signedMoney(over - short)}</td><td /></tr>}>
              {rows.map((r) => (
                <tr key={`${r.count_id}-${r.item_name}`}>
                  <td className={td}><span className="block font-medium">{r.item_name}</span><span className="block text-xs text-muted-foreground">{r.count_number} · {day(r.count_date)}</span></td>
                  <td className={cn(td, numCls, 'text-muted-foreground')}>{fmtQty(r.expected)}</td>
                  <td className={cn(td, numCls, 'text-muted-foreground')}>{fmtQty(r.counted)}</td>
                  <td className={cn(td, numCls, r.difference < 0 ? 'text-destructive' : 'text-green-700 dark:text-green-400')}>{r.difference > 0 ? '+' : '−'}{fmtQty(Math.abs(r.difference))} {r.stock_unit}</td>
                  <td className={cn(td, numCls)}>{signedMoney(r.value)}</td>
                  <td className={cn(td, 'text-muted-foreground')}>{r.reason || '—'}</td>
                </tr>
              ))}
            </Table>
          </Shell>
        );
      })()}

      {/* ── Waste ── */}
      {report === 'waste' && (() => {
        const rows = waste.data ?? [];
        const byReason = new Map<string, number>();
        for (const r of rows) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + r.value);
        return (
          <Shell title="Waste" answers={`What was thrown away, why, and what it cost, ${period}.`}
            loading={waste.isLoading} error={waste.error as Error | null} empty={!rows.length && 'No waste was recorded in this period.'}
            onExport={() => download(`waste-${tag}.csv`, toCsv(['Item', 'Unit', 'Reason', 'Entries', 'Quantity', 'Value'],
              rows.map((r) => [r.item_name, r.stock_unit, r.reason, r.entries, r.quantity, r.value])))}>
            <p className="text-sm">{[...byReason].sort((a, b) => b[1] - a[1]).map(([reason, v]) => `${reason} ${formatNairaCompact(v)}`).join(' · ')}</p>
            <Table head={[{ label: 'Item' }, { label: 'Reason' }, { label: 'Entries', right: true }, { label: 'Quantity', right: true }, { label: 'Value', right: true }]}
              foot={<tr><td className={td} colSpan={4}>Total waste</td><td className={cn(td, numCls)}>{money(rows.reduce((t, r) => t + r.value, 0))}</td></tr>}>
              {rows.map((r) => (
                <tr key={`${r.product_id}-${r.reason}`}>
                  <td className={cn(td, 'font-medium')}>{r.item_name}</td>
                  <td className={td}>{r.reason}</td>
                  <td className={cn(td, numCls, 'text-muted-foreground')}>{r.entries}</td>
                  <td className={cn(td, numCls)}>{fmtQty(r.quantity)} {r.stock_unit}</td>
                  <td className={cn(td, numCls)}>{money(r.value)}</td>
                </tr>
              ))}
            </Table>
          </Shell>
        );
      })()}

      {/* ── Purchases by supplier ── */}
      {report === 'suppliers' && canSeeSuppliers && (() => {
        const rows = suppliers.data ?? [];
        return (
          <Shell title="Purchases by supplier" answers={`Stock bought from each supplier, ${period}, and everything still owed to them today.`}
            loading={suppliers.isLoading} error={suppliers.error as Error | null} empty={!rows.length && 'No stock purchases in this period, and nothing owed.'}
            onExport={() => download(`purchases-by-supplier-${tag}.csv`, toCsv(['Supplier', 'Bought in period', 'Entries', 'Last purchase', 'Still owed'],
              rows.map((r) => [r.supplier, r.purchases, r.entries, r.last_purchase, r.owed])))}>
            <Table head={[{ label: 'Supplier' }, { label: 'Bought', right: true }, { label: 'Entries', right: true }, { label: 'Last purchase', right: true }, { label: 'Still owed', right: true }]}
              foot={<tr><td className={td}>Total</td><td className={cn(td, numCls)}>{money(rows.reduce((t, r) => t + r.purchases, 0))}</td><td colSpan={2} /><td className={cn(td, numCls)}>{money(rows.reduce((t, r) => t + r.owed, 0))}</td></tr>}>
              {rows.map((r) => (
                <tr key={r.supplier}>
                  <td className={cn(td, 'font-medium')}>{r.supplier}</td>
                  <td className={cn(td, numCls)}>{money(r.purchases)}</td>
                  <td className={cn(td, numCls, 'text-muted-foreground')}>{r.entries}</td>
                  <td className={cn(td, numCls, 'text-muted-foreground')}>{day(r.last_purchase)}</td>
                  <td className={cn(td, numCls, r.owed > 0 && 'font-semibold text-amber-700 dark:text-amber-400')}>{r.owed > 0 ? money(r.owed) : '—'}</td>
                </tr>
              ))}
            </Table>
            <p className="text-xs text-muted-foreground">
              Includes purchases received, goods received notes, and expenses typed straight into a stock category. “Still owed” is every unpaid amount, whenever it was bought.
            </p>
          </Shell>
        );
      })()}

      {/* ── Price changes ── */}
      {report === 'prices' && (() => {
        const rows = prices.data ?? [];
        const thisM = format(parseISO(from.slice(0, 7) + '-01'), 'MMMM');
        const rose = rows.filter((r) => r.change_pct > 0).length;
        return (
          <Shell title="Price changes" answers={`Cost per stock unit paid in ${thisM} against the month before, for items bought in both.`}
            loading={prices.isLoading} error={prices.error as Error | null} empty={!rows.length && 'No item was bought in both months.'}
            onExport={() => download(`price-changes-${from.slice(0, 7)}.csv`, toCsv(['Item', 'Unit', 'Last month', 'This month', 'Change %', 'Bought this month'],
              rows.map((r) => [r.item_name, r.stock_unit, r.last_cost, r.this_cost, r.change_pct, r.this_qty])))}>
            <p className="text-sm">{rose} of {rows.length} item{rows.length === 1 ? '' : 's'} rose in cost.</p>
            <Table head={[{ label: 'Item' }, { label: 'Last month', right: true }, { label: 'This month', right: true }, { label: 'Change', right: true }, { label: 'Bought this month', right: true }]}>
              {rows.map((r) => (
                <tr key={r.product_id}>
                  <td className={cn(td, 'font-medium')}>{r.item_name}</td>
                  <td className={cn(td, numCls, 'text-muted-foreground')}>{money(r.last_cost)} / {r.stock_unit}</td>
                  <td className={cn(td, numCls)}>{money(r.this_cost)} / {r.stock_unit}</td>
                  <td className={cn(td, numCls, 'font-semibold', r.change_pct > 0 ? 'text-destructive' : r.change_pct < 0 ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>
                    {r.change_pct > 0 ? '▲ +' : r.change_pct < 0 ? '▼ −' : ''}{Math.abs(r.change_pct)}%
                  </td>
                  <td className={cn(td, numCls, 'text-muted-foreground')}>{fmtQty(r.this_qty)} {r.stock_unit}</td>
                </tr>
              ))}
            </Table>
          </Shell>
        );
      })()}
    </div>
  );
}
