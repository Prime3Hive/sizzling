import { useDeferredValue, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Boxes, ChefHat, Factory, Layers, Loader2, Pencil, Plus, Search, Settings2, Undo2,
} from 'lucide-react';
import { useRoles } from '@/hooks/useRoles';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useNewParam } from '@/hooks/useNewParam';
import { useProductionData, type Lot, type ProdItem, type Run } from '@/hooks/useProductionData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ui/responsive-table';
import { TablePagination } from '@/components/ui/table-pagination';
import { usePagination } from '@/hooks/usePagination';
import {
  EmptyState, FieldGrid, FilterChips, PageHeader, SidePanel, StatTile, StatusPill, type Tone,
} from '@/components/shell/ui';
import { formatNairaCompact } from '@/lib/currency';
import { recordStockMovements } from '@/lib/stockMovements';
import {
  ITEM_CLASS_LABEL, RUN_STATUS_LABEL, VARIANCE_FLAG_PCT, batchCost, daysToExpiry, describeInPacks, fmtQty, fromBase,
  isProduced, packCosts, approveProductionRun, cancelProductionRun, rejectProductionRun, reverseProductionRun,
  variance, type RunStatus,
} from '@/lib/production';
import RecordProductionSheet from '@/components/production/RecordProductionSheet';
import RecipeSheet from '@/components/production/RecipeSheet';
import ItemSetupSheet from '@/components/production/ItemSetupSheet';

const RUN_TONE: Record<RunStatus, Tone> = {
  submitted: 'pending', approved: 'good', rejected: 'bad', cancelled: 'neutral', reversed: 'neutral',
};

const fmtDate = (d: string | null | undefined) => (d ? format(parseISO(d), 'd MMM yyyy') : '—');

function ExpiryPill({ lot }: { lot: Lot }) {
  const days = daysToExpiry(lot.expires_on);
  if (days === null) return <span className="text-muted-foreground">No expiry</span>;
  const tone: Tone = days < 0 ? 'bad' : days <= 3 ? 'pending' : 'neutral';
  const label = days < 0 ? `Expired ${-days}d ago` : days === 0 ? 'Expires today' : `${days}d left`;
  return <StatusPill tone={tone} label={label} className="normal-case" />;
}

export default function Production() {
  const { hasPermission, isAdmin } = useRoles();
  const { user } = useAuth();
  const { toast } = useToast();
  const canRecord = hasPermission('production', 'create');
  const canApprove = hasPermission('production', 'update');
  const canEditItems = canApprove || hasPermission('inventory', 'update');
  const canMoveStock = hasPermission('inventory', 'create');

  const data = useProductionData();
  const { items, recipes, runs, lots, warehouses, itemById, lotById, nameOf, refresh, isLoading } = data;

  const wantsNew = useNewParam();
  const [tab, setTab] = useState('runs');
  const [recordOpen, setRecordOpen] = useState(wantsNew === '1' && canRecord);
  const [recordRecipe, setRecordRecipe] = useState<string | null>(null);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<string | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ProdItem | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [lotAction, setLotAction] = useState<Lot | null>(null);

  const [runFilter, setRunFilter] = useState<'submitted' | 'approved' | 'other' | 'all'>('all');
  const [itemFilter, setItemFilter] = useState<'produced' | 'raw' | 'all'>('produced');
  const [itemSearch, setItemSearch] = useState('');

  // Derived lists are memoised so typing in a form or opening a panel doesn't
  // re-filter a few hundred runs and items on every keystroke.
  const summary = useMemo(() => {
    const monthStart = format(new Date(), 'yyyy-MM-01');
    const activeLots = lots.filter((l) => l.status === 'active' && l.qty_remaining > 0);
    const closed = ['rejected', 'cancelled', 'reversed'];
    return {
      pending: runs.filter((r) => r.status === 'submitted'),
      approvedThisMonth: runs.filter((r) => r.status === 'approved' && r.production_date >= monthStart),
      approvedCount: runs.filter((r) => r.status === 'approved').length,
      closedCount: runs.filter((r) => closed.includes(r.status)).length,
      activeLots,
      expiringSoon: activeLots.filter((l) => { const d = daysToExpiry(l.expires_on); return d !== null && d <= 3; }),
      lotsShown: lots.filter((l) => l.status === 'pending' || l.qty_remaining > 0),
      producedCount: items.filter((i) => isProduced(i.item_class)).length,
    };
  }, [runs, lots, items]);
  const { pending, approvedThisMonth, activeLots, expiringSoon } = summary;

  const shownRuns = useMemo(() => runs.filter((r) =>
    runFilter === 'all' ? true
      : runFilter === 'other' ? ['rejected', 'cancelled', 'reversed'].includes(r.status)
        : r.status === runFilter), [runs, runFilter]);

  const search = useDeferredValue(itemSearch.trim().toLowerCase());
  const shownItems = useMemo(() => items.filter((i) =>
    (itemFilter === 'all' || (itemFilter === 'produced') === isProduced(i.item_class))
    && (!search || i.name.toLowerCase().includes(search))), [items, itemFilter, search]);

  const runPages = usePagination(shownRuns, 25);
  const lotPages = usePagination(summary.lotsShown, 25);
  const itemPages = usePagination(shownItems, 25);

  const run = runs.find((r) => r.id === runId) ?? null;

  const openRecord = (recipeId: string | null) => { setRecordRecipe(recipeId); setRecordOpen(true); };

  // ── Columns ──────────────────────────────────────────────────────────────

  const runColumns: ResponsiveColumn<Run>[] = [
    {
      key: 'what', header: 'Production', primary: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{itemById.get(r.output_product_id)?.name ?? 'Item'}</div>
          <div className="text-xs text-muted-foreground">{r.run_number} · {nameOf(r.recorded_by)}</div>
        </div>
      ),
    },
    { key: 'date', header: 'Date', cell: (r) => fmtDate(r.production_date) },
    {
      key: 'qty', header: 'Quantity', align: 'right',
      cell: (r) => {
        const it = itemById.get(r.output_product_id);
        return it ? describeInPacks(r.output_qty, it.units) : fmtQty(r.output_qty);
      },
    },
    { key: 'lot', header: 'Lot', cell: (r) => <span className="font-mono text-xs">{r.lot_id ? lotById.get(r.lot_id)?.lot_number ?? '—' : '—'}</span>, hideOnMobile: true },
    {
      key: 'cost', header: 'Cost / unit', align: 'right', hideOnMobile: true,
      cell: (r) => {
        const it = itemById.get(r.output_product_id);
        return r.unit_cost != null ? `${formatNairaCompact(Number(r.unit_cost))}/${it?.uom ?? 'unit'}` : '—';
      },
    },
    {
      key: 'status', header: 'Status', mobileFooter: true,
      cell: (r) => <StatusPill tone={RUN_TONE[r.status]} label={RUN_STATUS_LABEL[r.status]} />,
    },
  ];

  const lotColumns: ResponsiveColumn<Lot>[] = [
    {
      key: 'lot', header: 'Lot', primary: true,
      cell: (l) => (
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold">{l.lot_number}</div>
          <div className="truncate text-xs text-muted-foreground">{itemById.get(l.product_id)?.name ?? 'Item'}</div>
        </div>
      ),
    },
    { key: 'made', header: 'Made', cell: (l) => fmtDate(l.produced_on) },
    { key: 'exp', header: 'Expiry', cell: (l) => <ExpiryPill lot={l} /> },
    {
      key: 'left', header: 'Remaining', align: 'right',
      cell: (l) => {
        const it = itemById.get(l.product_id);
        return (
          <span className="tabular-nums">
            {it ? describeInPacks(l.qty_remaining, it.units) : fmtQty(l.qty_remaining)}
            <span className="text-muted-foreground"> of {fmtQty(l.qty_produced)}</span>
          </span>
        );
      },
    },
    {
      key: 'value', header: 'Value', align: 'right', hideOnMobile: true,
      cell: (l) => formatNairaCompact(l.qty_remaining * Number(l.unit_cost ?? 0)),
    },
    {
      key: 'act', header: '', align: 'right', mobileFooter: true,
      cell: (l) => canMoveStock && l.status === 'active' && l.qty_remaining > 0 ? (
        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setLotAction(l); }}>Use / write off</Button>
      ) : l.status === 'pending' ? <StatusPill tone="pending" label="Awaiting approval" /> : null,
    },
  ];

  const itemColumns: ResponsiveColumn<ProdItem>[] = [
    {
      key: 'name', header: 'Item', primary: true,
      cell: (i) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{i.name}</div>
          <div className="text-xs text-muted-foreground">{ITEM_CLASS_LABEL[i.item_class]}</div>
        </div>
      ),
    },
    {
      key: 'units', header: 'Units',
      cell: (i) => i.units.map((u) => (u.factor === 1 ? u.name : `${u.name} = ${fmtQty(u.factor)} ${i.uom}`)).join(' · '),
    },
    { key: 'stock', header: 'On hand', align: 'right', cell: (i) => describeInPacks(i.stock, i.units) },
    {
      key: 'cost', header: 'Cost', align: 'right', hideOnMobile: true,
      cell: (i) => (i.cost > 0
        ? packCosts(i.cost, i.units).map((p) => `${formatNairaCompact(p.cost)}/${p.name}`).join(' · ')
        : '—'),
    },
    {
      key: 'lot', header: 'Lots', hideOnMobile: true,
      cell: (i) => (isProduced(i.item_class)
        ? `${i.lot_code ?? 'auto'}${i.shelf_life_days ? ` · ${i.shelf_life_days}d shelf life` : ''}`
        : '—'),
    },
    {
      key: 'act', header: '', align: 'right', mobileFooter: true,
      cell: (i) => canEditItems ? (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditingItem(i); setItemOpen(true); }}>
          <Settings2 className="mr-1.5 h-4 w-4" />Set up
        </Button>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production"
        description="Batches made in-house: what went in, what came out, and what each unit cost."
        actions={<>
          {canApprove && (
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => { setEditingRecipe(null); setRecipeOpen(true); }}>
              <ChefHat className="mr-2 h-4 w-4" />New recipe
            </Button>
          )}
          {canRecord && (
            <Button className="flex-1 sm:flex-none" onClick={() => openRecord(null)}>
              <Plus className="mr-2 h-4 w-4" />Record production
            </Button>
          )}
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Waiting for approval" value={pending.length}
          sub={canApprove ? 'Open one to approve it' : 'Stock moves once approved'} />
        <StatTile label="Produced this month" value={formatNairaCompact(approvedThisMonth.reduce((s, r) => s + Number(r.total_cost ?? 0), 0))}
          sub={`${approvedThisMonth.length} batch${approvedThisMonth.length === 1 ? '' : 'es'} approved`} />
        <StatTile label="Lots in stock" value={activeLots.length}
          sub={formatNairaCompact(activeLots.reduce((s, l) => s + l.qty_remaining * Number(l.unit_cost ?? 0), 0))} />
        <StatTile label="Expiring within 3 days" value={expiringSoon.length}
          sub={<span className="block truncate">{expiringSoon.length ? expiringSoon.slice(0, 2).map((l) => l.lot_number).join(', ') : 'Nothing close to expiry'}</span>} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="runs" className="gap-1.5"><Factory className="h-4 w-4" />Runs</TabsTrigger>
          <TabsTrigger value="recipes" className="gap-1.5"><ChefHat className="h-4 w-4" />Recipes</TabsTrigger>
          <TabsTrigger value="lots" className="gap-1.5"><Layers className="h-4 w-4" />Lots</TabsTrigger>
          <TabsTrigger value="items" className="gap-1.5"><Boxes className="h-4 w-4" />Items</TabsTrigger>
        </TabsList>

        {/* ── Runs ── */}
        <TabsContent value="runs" className="space-y-4">
          <FilterChips<typeof runFilter> label="Filter runs" value={runFilter} onChange={setRunFilter} options={[
            { value: 'all', label: 'All', count: runs.length },
            { value: 'submitted', label: 'Pending', count: pending.length },
            { value: 'approved', label: 'Approved', count: summary.approvedCount },
            { value: 'other', label: 'Rejected / reversed', count: summary.closedCount },
          ]} />
          {isLoading ? <Skeleton className="h-64 w-full" /> : (
            <ResponsiveTable
              columns={runColumns} data={runPages.pageData} rowKey={(r) => r.id} onRowClick={(r) => setRunId(r.id)}
              emptyState={
                <EmptyState icon={Factory} tone="neutral" title="No production recorded"
                  body={canRecord ? 'Record a batch and it will appear here for approval.' : 'Batches appear here once someone records them.'}
                  action={canRecord ? <Button onClick={() => openRecord(null)}><Plus className="mr-2 h-4 w-4" />Record production</Button> : undefined} />
              }
            />
          )}
          <TablePagination page={runPages.page} pageCount={runPages.pageCount} total={runPages.total} pageSize={runPages.pageSize} onPageChange={runPages.setPage} />
        </TabsContent>

        {/* ── Recipes ── */}
        <TabsContent value="recipes">
          {recipes.length === 0 ? (
            <EmptyState icon={ChefHat} tone="neutral" title="No recipes yet"
              body="A recipe lists what goes into one batch, so recording production is a matter of entering the batches made."
              action={canApprove ? <Button onClick={() => { setEditingRecipe(null); setRecipeOpen(true); }}><Plus className="mr-2 h-4 w-4" />New recipe</Button> : undefined} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {recipes.map((r) => {
                const out = itemById.get(r.output_product_id);
                const cost = batchCost(
                  r.recipe_lines.map((l) => ({ actual: l.quantity * l.factor, unitCost: itemById.get(l.product_id)?.cost ?? 0 })),
                  r.recipe_costs.map((c) => c.amount),
                  r.batch_yield,
                );
                return (
                  <div key={r.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Makes {fmtQty(r.batch_yield / r.yield_factor)} {r.yield_unit || out?.uom} of {out?.name ?? 'item'}
                        </div>
                      </div>
                      {!r.is_active && <StatusPill tone="neutral" label="Not in use" />}
                    </div>
                    <ul className="space-y-0.5 text-sm">
                      {r.recipe_lines.slice(0, 5).map((l) => (
                        <li key={l.id} className="flex justify-between gap-2">
                          <span className="truncate">{itemById.get(l.product_id)?.name ?? 'Item'}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">{fmtQty(l.quantity)} {l.unit_name}</span>
                        </li>
                      ))}
                      {r.recipe_lines.length > 5 && <li className="text-xs text-muted-foreground">+ {r.recipe_lines.length - 5} more</li>}
                    </ul>
                    <div className="mt-auto rounded-xl bg-muted/60 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Today: </span>
                      <b className="tabular-nums">{formatNairaCompact(cost.total)}</b>
                      <span className="text-muted-foreground"> a batch</span>
                      {out && cost.perUnit > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {packCosts(cost.perUnit, out.units).map((p) => `${formatNairaCompact(p.cost)}/${p.name}`).join(' · ')}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {canRecord && r.is_active && (
                        <Button size="sm" className="flex-1" onClick={() => openRecord(r.id)}>
                          <Factory className="mr-1.5 h-4 w-4" />Produce
                        </Button>
                      )}
                      {canApprove && (
                        <Button size="sm" variant="outline" className="flex-1" onClick={() => { setEditingRecipe(r.id); setRecipeOpen(true); }}>
                          <Pencil className="mr-1.5 h-4 w-4" />Edit
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Lots ── */}
        <TabsContent value="lots" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Usage, sales and write-offs take from the lot that expires first, unless you pick a lot here.
          </p>
          <ResponsiveTable
            columns={lotColumns}
            data={lotPages.pageData}
            rowKey={(l) => l.id}
            onRowClick={(l) => l.production_run_id && setRunId(l.production_run_id)}
            rowClassName={(l) => {
              const d = daysToExpiry(l.expires_on);
              return d !== null && d < 0 ? 'bg-red-50/60 dark:bg-red-500/5' : undefined;
            }}
            emptyState={<EmptyState icon={Layers} tone="neutral" title="No lots in stock" body="Each approved batch becomes a lot with its own number and expiry." />}
          />
          <TablePagination page={lotPages.page} pageCount={lotPages.pageCount} total={lotPages.total} pageSize={lotPages.pageSize} onPageChange={lotPages.setPage} />
        </TabsContent>

        {/* ── Items ── */}
        <TabsContent value="items" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <FilterChips<typeof itemFilter> label="Filter items" value={itemFilter} onChange={setItemFilter} options={[
              { value: 'produced', label: 'Finished & semi-finished', count: summary.producedCount },
              { value: 'raw', label: 'Raw materials', count: items.length - summary.producedCount },
              { value: 'all', label: 'All', count: items.length },
            ]} />
            <div className="relative sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input aria-label="Search items" placeholder="Search items" className="pl-9" value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Mark what you make as a finished good, and give items their pack sizes (bag, carton, gram) so recipes and runs can use them.
          </p>
          <ResponsiveTable
            columns={itemColumns} data={itemPages.pageData} rowKey={(i) => i.id}
            onRowClick={canEditItems ? (i) => { setEditingItem(i); setItemOpen(true); } : undefined}
            emptyState={<EmptyState icon={Boxes} tone="neutral" title="Nothing here"
              body={itemFilter === 'produced' ? 'No finished goods yet. Switch to Raw materials or All and set one up.' : 'No items match.'} />}
          />
          <TablePagination page={itemPages.page} pageCount={itemPages.pageCount} total={itemPages.total} pageSize={itemPages.pageSize} onPageChange={itemPages.setPage} />
        </TabsContent>
      </Tabs>

      <RecordProductionSheet
        open={recordOpen} onOpenChange={setRecordOpen}
        items={items} recipes={recipes} warehouses={warehouses} initialRecipeId={recordRecipe}
        onSaved={(id) => { refresh(); setTab('runs'); setRunId(id); }}
      />
      <RecipeSheet
        open={recipeOpen} onOpenChange={setRecipeOpen}
        recipe={recipes.find((r) => r.id === editingRecipe) ?? null} items={items}
        onSaved={refresh}
      />
      <ItemSetupSheet item={editingItem} open={itemOpen} onOpenChange={setItemOpen} onSaved={refresh} />

      <RunPanel
        run={run} onClose={() => setRunId(null)}
        data={data} canApprove={canApprove} isAdmin={isAdmin} userId={user?.id ?? null}
        onDone={(msg) => { toast({ title: msg }); refresh(); }}
        onError={(e) => toast({ title: 'Could not complete that', description: e.message, variant: 'destructive' })}
      />

      <LotActionDialog
        lot={lotAction} item={lotAction ? itemById.get(lotAction.product_id) ?? null : null}
        onClose={() => setLotAction(null)}
        onDone={(msg) => { toast({ title: msg }); refresh(); }}
        onError={(e) => toast({ title: 'Could not record that', description: e.message, variant: 'destructive' })}
      />
    </div>
  );
}

// ── Run detail ───────────────────────────────────────────────────────────────

function RunPanel({ run, onClose, data, canApprove, isAdmin, userId, onDone, onError }: {
  run: Run | null;
  onClose: () => void;
  data: ReturnType<typeof useProductionData>;
  canApprove: boolean;
  isAdmin: boolean;
  userId: string | null;
  onDone: (msg: string) => void;
  onError: (e: Error) => void;
}) {
  const { itemById, lotById, nameOf, warehouses } = data;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [reversing, setReversing] = useState(false);

  const out = run ? itemById.get(run.output_product_id) : undefined;
  const lot = run?.lot_id ? lotById.get(run.lot_id) : undefined;
  const pendingRun = run?.status === 'submitted';
  const own = !!run && run.recorded_by === userId;
  const mayDecide = canApprove && pendingRun && (!own || isAdmin);

  // Before approval, show what approving would post at today's costs.
  const estimate = useMemo(() => {
    if (!run) return null;
    return batchCost(
      run.production_run_inputs.map((i) => ({ actual: i.actual_qty, unitCost: itemById.get(i.product_id)?.cost ?? 0 })),
      run.production_run_costs.map((c) => c.amount),
      run.output_qty,
    );
  }, [run, itemById]);

  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); onDone(msg); setNote(''); setReversing(false); onClose(); } catch (e) { onError(e as Error); } finally { setBusy(null); }
  };

  const cost = run?.status === 'approved' || run?.status === 'reversed'
    ? { material: Number(run.material_cost ?? 0), other: Number(run.other_cost ?? 0), total: Number(run.total_cost ?? 0), perUnit: Number(run.unit_cost ?? 0) }
    : estimate;

  return (
    <SidePanel
      open={!!run} onOpenChange={(o) => { if (!o) { onClose(); setReversing(false); setNote(''); } }}
      title={run ? `${run.run_number} · ${out?.name ?? 'Production'}` : 'Production'}
      description="Production run details"
      footer={run && (<>
        {pendingRun && own && (
          <Button variant="outline" className="flex-1 sm:flex-none" disabled={!!busy}
            onClick={() => act('cancel', () => cancelProductionRun(run.id), 'Production withdrawn')}>
            {busy === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Withdraw
          </Button>
        )}
        {mayDecide && (<>
          <Button variant="outline" className="flex-1 sm:flex-none" disabled={!!busy}
            onClick={() => act('reject', () => rejectProductionRun(run.id, note), 'Production rejected')}>
            {busy === 'reject' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reject
          </Button>
          <Button className="flex-[2] sm:flex-none" disabled={!!busy}
            onClick={() => act('approve', () => approveProductionRun(run.id, note), 'Approved — the batch is now in stock')}>
            {busy === 'approve' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve into stock
          </Button>
        </>)}
        {canApprove && run.status === 'approved' && !reversing && (
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setReversing(true)}><Undo2 className="mr-2 h-4 w-4" />Reverse</Button>
        )}
        {reversing && (
          <Button variant="destructive" className="flex-1 sm:flex-none" disabled={!!busy || !note.trim()}
            onClick={() => act('reverse', () => reverseProductionRun(run.id, note), 'Production reversed')}>
            {busy === 'reverse' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm reversal
          </Button>
        )}
      </>)}
    >
      {run && out && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={RUN_TONE[run.status]} label={RUN_STATUS_LABEL[run.status]} />
            {lot && <span className="font-mono text-sm font-semibold">Lot {lot.lot_number}</span>}
          </div>

          <FieldGrid fields={[
            { label: 'Produced', value: describeInPacks(run.output_qty, out.units) },
            { label: 'Date', value: fmtDate(run.production_date) },
            { label: 'Batches', value: run.batches != null ? fmtQty(run.batches) : '—' },
            { label: 'Expires', value: lot?.expires_on ? fmtDate(lot.expires_on) : 'No expiry' },
            { label: 'Recorded by', value: nameOf(run.recorded_by) },
            { label: 'Stored in', value: warehouses.find((w) => w.id === run.warehouse_id)?.name ?? 'Usual store' },
          ]} />

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Materials used</h3>
            <div className="divide-y rounded-xl border">
              {run.production_run_inputs.map((i) => {
                const it = itemById.get(i.product_id);
                const v = variance(i.standard_qty, i.actual_qty);
                const flag = v.pct != null && Math.abs(v.pct) > VARIANCE_FLAG_PCT;
                return (
                  <div key={i.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{it?.name ?? 'Item'}</div>
                      {i.standard_qty != null && (
                        <div className={flag ? 'text-xs text-amber-700 dark:text-amber-400' : 'text-xs text-muted-foreground'}>
                          Recipe {fmtQty(fromBase(i.standard_qty, i.factor))} {i.unit_name}
                          {v.pct != null && v.diff !== 0 && ` · ${v.diff > 0 ? '+' : ''}${v.pct}%`}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tabular-nums font-semibold">{fmtQty(fromBase(i.actual_qty, i.factor))} {i.unit_name}</div>
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {i.line_cost != null ? formatNairaCompact(Number(i.line_cost)) : `≈ ${formatNairaCompact(i.actual_qty * (it?.cost ?? 0))}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {run.production_run_costs.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Production expenses</h3>
              <div className="divide-y rounded-xl border">
                {run.production_run_costs.map((c) => (
                  <div key={c.id} className="flex justify-between gap-3 px-3 py-2.5 text-sm">
                    <span>{c.description}</span><span className="tabular-nums">{formatNairaCompact(c.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {cost && (
            <section className="rounded-xl bg-muted/60 p-4 text-sm">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">
                {run.status === 'approved' || run.status === 'reversed' ? 'Cost posted at approval' : 'Estimate at today’s costs'}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                <span>Materials <b className="tabular-nums">{formatNairaCompact(cost.material)}</b></span>
                <span>Expenses <b className="tabular-nums">{formatNairaCompact(cost.other)}</b></span>
                <span>Total <b className="tabular-nums">{formatNairaCompact(cost.total)}</b></span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
                {packCosts(cost.perUnit, out.units).map((p) => (
                  <span key={p.name}><b className="tabular-nums">{formatNairaCompact(p.cost)}</b> per {p.name}</span>
                ))}
              </div>
            </section>
          )}

          {run.notes && <p className="text-sm"><span className="font-semibold">Notes: </span>{run.notes}</p>}
          {run.decision_note && (
            <p className="text-sm">
              <span className="font-semibold">{run.status === 'rejected' ? 'Reason' : 'Approver’s note'}: </span>{run.decision_note}
            </p>
          )}
          {run.decided_by && run.status !== 'submitted' && (
            <p className="text-xs text-muted-foreground">
              {RUN_STATUS_LABEL[run.status === 'reversed' ? 'approved' : run.status]} by {nameOf(run.decided_by)}
              {run.decided_at && ` on ${format(parseISO(run.decided_at), 'd MMM yyyy, HH:mm')}`}
            </p>
          )}
          {run.status === 'reversed' && (
            <p className="text-sm text-muted-foreground">Reversed{run.reversal_reason ? `: ${run.reversal_reason}` : ''}</p>
          )}

          {pendingRun && own && !isAdmin && canApprove && (
            <p className="text-sm text-muted-foreground">You recorded this run, so someone else has to approve it.</p>
          )}
          {(mayDecide || reversing) && (
            <div className="space-y-1.5">
              <Label htmlFor="run-note">{reversing ? 'Reason for reversing (required)' : 'Note to the person who recorded it'}</Label>
              <Textarea id="run-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              {reversing && (
                <p className="text-xs text-muted-foreground">
                  Materials go back into stock, the batch comes out, and the journal is reversed. Only possible while none of the lot has been used.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </SidePanel>
  );
}

// ── Use or write off part of a lot ───────────────────────────────────────────

function LotActionDialog({ lot, item, onClose, onDone, onError }: {
  lot: Lot | null;
  item: ProdItem | null;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (e: Error) => void;
}) {
  const [kind, setKind] = useState<'usage' | 'adjustment'>('usage');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const units = item?.units ?? [];
  const factor = units.find((u) => u.name === unit)?.factor ?? 1;
  const base = (Number(qty) || 0) * factor;
  const tooMuch = !!lot && base > lot.qty_remaining + 1e-9;

  const reset = () => { setKind('usage'); setQty(''); setUnit(''); setNote(''); };

  const save = async () => {
    if (!lot || !item || !(base > 0) || tooMuch) return;
    setSaving(true);
    try {
      await recordStockMovements({
        lines: [{ product_id: lot.product_id, quantity_change: -base, lot_id: lot.id }],
        type: kind,
        note: `${kind === 'usage' ? 'Used' : 'Written off'} from lot ${lot.lot_number}${note.trim() ? ` — ${note.trim()}` : ''}`,
      });
      onDone(kind === 'usage' ? 'Usage recorded' : 'Written off');
      reset(); onClose();
    } catch (e) { onError(e as Error); } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!lot} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Lot {lot?.lot_number}</DialogTitle>
          <DialogDescription>
            {item?.name} · {lot && item ? describeInPacks(lot.qty_remaining, item.units) : ''} left
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>What happened</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="usage">Used / sold (cost of sales)</SelectItem>
                <SelectItem value="adjustment">Spoiled, expired or lost (write-off)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lot-qty">Quantity</Label>
            <div className="flex gap-2">
              <Input id="lot-qty" type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
              <Select value={unit || units[0]?.name} onValueChange={setUnit}>
                <SelectTrigger className="w-40" aria-label="Unit"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {units.map((u) => <SelectItem key={u.name} value={u.name}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {tooMuch && <p className="text-xs text-destructive">More than is left in this lot.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lot-note">Note</Label>
            <Textarea id="lot-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={save} disabled={saving || !(base > 0) || tooMuch}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
