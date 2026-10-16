import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ArrowLeft, Download, Filter, History, Package, TrendingDown, TrendingUp, AlertTriangle, Warehouse,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePagination } from "@/hooks/usePagination";
import { formatNairaCompact } from "@/lib/currency";
import { getCategoryColor, getCategoryLabel, MOVEMENT_META, movementMeta } from "@/lib/inventoryConstants";

// ── Types ──────────────────────────────────────────────────────────────────────
interface ItemSku {
  id: string;
  name: string;
  sku_code: string | null;
  category: string;
  unit_of_measure: string;
  stock_quantity: number;
  reorder_level: number;
  cost_per_unit: number;
  is_archived: boolean;
}

interface StockRow {
  quantity: number;
  reorder_level: number | null;
  warehouses: { name: string } | null;
}

interface MovementRow {
  id: string;
  movement_type: string;
  quantity_change: number;
  reference_type: string | null;
  occurred_on: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  unit_cost: number | null;
}

/** A ledger line with the stock level it left behind. */
interface HistoryRow extends MovementRow {
  balance: number;
}

const HISTORY_LIMIT = 2000;

const REFERENCE_LABEL: Record<string, string> = {
  manual: "Manual entry",
  invoice: "Invoice",
  lpo: "LPO receipt",
  request: "Inventory request",
  stock_take: "Stock take",
  lpo_receipt: "LPO receipt",
  opening: "Opening stock",
};

const fmtQty = (n: number) => Number(n.toFixed(2)).toLocaleString();

export default function InventoryItem() {
  const { skuId } = useParams<{ skuId: string }>();
  const [typeFilter, setTypeFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["inventory-item", skuId],
    enabled: !!skuId,
    queryFn: async () => {
      const { data: sku, error: skuErr } = await supabase
        .from("skus")
        .select("id, name, sku_code, category, unit_of_measure, stock_quantity, reorder_level, cost_per_unit, is_archived")
        .eq("id", skuId!)
        .maybeSingle();
      if (skuErr) throw skuErr;
      if (!sku) return null;

      const { data: product } = await (supabase as any)
        .from("products")
        .select("id, inventory(quantity, reorder_level, warehouses(name))")
        .eq("sku_id", skuId)
        .maybeSingle();

      let movements: MovementRow[] = [];
      let totalMovements = 0;
      if (product) {
        const { data: rows, count, error: mErr } = await (supabase as any)
          .from("inventory_movements")
          .select("id, movement_type, quantity_change, reference_type, occurred_on, note, created_by, created_at, unit_cost", { count: "exact" })
          .eq("product_id", product.id)
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT);
        if (mErr) throw mErr;
        movements = rows ?? [];
        totalMovements = count ?? movements.length;
      }

      return {
        sku: sku as unknown as ItemSku,
        stock: ((product?.inventory ?? []) as StockRow[]),
        movements,
        totalMovements,
      };
    },
  });

  const { data: profiles = [] } = useQuery<{ user_id: string; full_name: string | null }[]>({
    queryKey: ["profiles-directory"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, full_name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
  const nameByUserId = useMemo(() => Object.fromEntries(profiles.map(p => [p.user_id, p.full_name])), [profiles]);

  const sku = data?.sku;
  const onHand = Number(sku?.stock_quantity ?? 0);
  const uom = sku?.unit_of_measure ?? "";

  // Running balance, worked backwards from today's stock: the newest line left
  // the stock at its current level, and each older line left it at that level
  // minus everything that happened after it. This stays right even when the
  // ledger doesn't start at zero (opening stock entered on the item itself).
  const history = useMemo<HistoryRow[]>(() => {
    let balance = onHand;
    return (data?.movements ?? []).map(m => {
      const row = { ...m, balance };
      balance -= Number(m.quantity_change);
      return row;
    });
  }, [data?.movements, onHand]);

  const filtered = useMemo(() => history.filter(h =>
    (typeFilter === "all" || h.movement_type === typeFilter) &&
    (!from || h.occurred_on >= from) &&
    (!to || h.occurred_on <= to),
  ), [history, typeFilter, from, to]);

  const totals = useMemo(() => filtered.reduce(
    (acc, h) => {
      const q = Number(h.quantity_change);
      if (q > 0) acc.in += q; else acc.out += -q;
      return acc;
    },
    { in: 0, out: 0 },
  ), [filtered]);

  // Closing stock per day, oldest first, for the chart (date filter applies).
  const chartData = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const h of history) {
      if ((from && h.occurred_on < from) || (to && h.occurred_on > to)) continue;
      // history is newest first, so the first line seen for a day is its close
      if (!byDay.has(h.occurred_on)) byDay.set(h.occurred_on, h.balance);
    }
    return [...byDay]
      .map(([date, balance]) => ({ date, label: format(parseISO(date), "dd MMM"), balance }))
      .reverse();
  }, [history, from, to]);

  const pagination = usePagination(filtered, 25);

  const exportCsv = () => {
    if (!sku) return;
    const lines = [
      `Stock history — ${sku.name}`,
      `Generated,${format(new Date(), "yyyy-MM-dd HH:mm")}`,
      `On hand,${onHand} ${uom}`,
      "",
      "Date,Type,Change,Balance,Reference,Note,Recorded by,Recorded at",
      ...filtered.map(h => [
        h.occurred_on, movementMeta(h.movement_type).label, h.quantity_change, h.balance,
        REFERENCE_LABEL[h.reference_type ?? ""] ?? h.reference_type ?? "",
        h.note ?? "", h.created_by ? nameByUserId[h.created_by] ?? "" : "",
        format(parseISO(h.created_at), "yyyy-MM-dd HH:mm"),
      ].map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-history-${sku.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: ResponsiveColumn<HistoryRow>[] = [
    {
      key: "date", header: "Date", primary: true,
      cell: (h) => (
        <div>
          <span className="font-medium whitespace-nowrap">{format(parseISO(h.occurred_on), "dd MMM yyyy")}</span>
          <span className="block text-xs text-muted-foreground">recorded {format(parseISO(h.created_at), "dd MMM, HH:mm")}</span>
        </div>
      ),
    },
    {
      key: "type", header: "Type",
      cell: (h) => {
        const meta = movementMeta(h.movement_type);
        return <Badge variant="outline" className={`text-xs ${meta.cls}`}>{meta.label}</Badge>;
      },
    },
    {
      key: "change", header: "Change", align: "right",
      cell: (h) => {
        const q = Number(h.quantity_change);
        return (
          <span className={`font-medium tabular-nums ${q >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
            {q >= 0 ? "+" : ""}{fmtQty(q)} {uom}
          </span>
        );
      },
    },
    {
      key: "balance", header: "Balance", align: "right",
      cell: (h) => (
        <span className={`tabular-nums ${h.balance < 0 ? "text-destructive font-semibold" : "font-medium"}`}>
          {fmtQty(h.balance)} {uom}
        </span>
      ),
    },
    {
      key: "ref", header: "Source", hideOnMobile: true,
      cell: (h) => <span className="text-sm text-muted-foreground">{REFERENCE_LABEL[h.reference_type ?? ""] ?? h.reference_type ?? "—"}</span>,
    },
    {
      key: "note", header: "Note", hideOnMobile: true,
      cell: (h) => <span className="text-sm text-muted-foreground max-w-xs truncate block">{h.note || "—"}</span>,
    },
    {
      key: "by", header: "By", hideOnMobile: true,
      cell: (h) => <span className="text-sm text-muted-foreground whitespace-nowrap">{h.created_by ? nameByUserId[h.created_by] ?? "—" : "System"}</span>,
    },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !sku) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card>
          <CardContent className="py-14 flex flex-col items-center gap-2 text-muted-foreground">
            <Package className="h-8 w-8 opacity-40" />
            <p className="text-sm">{error ? "Could not load this item." : "This item doesn't exist or was removed."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cat = getCategoryColor(sku.category);
  const status =
    onHand < 0 ? <Badge variant="destructive">Negative stock</Badge>
      : onHand <= 0 ? <Badge variant="destructive">Out of stock</Badge>
        : onHand <= sku.reorder_level ? <Badge className="bg-orange-100 text-orange-700">Low stock</Badge>
          : <Badge variant="secondary">In stock</Badge>;
  const truncated = (data?.totalMovements ?? 0) > history.length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <BackLink />

      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold break-words">{sku.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge className={`${cat.bg} ${cat.text} text-xs`}>{getCategoryLabel(sku.category)}</Badge>
            {status}
            {sku.is_archived && <Badge variant="outline">Archived</Badge>}
            {sku.sku_code && <span className="font-mono text-xs">{sku.sku_code}</span>}
            <span>· measured in {uom}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2 self-start" disabled={filtered.length === 0}>
          <Download className="h-4 w-4" /> Export history
        </Button>
      </div>

      {onHand < 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p>
            <span className="font-medium text-destructive">Stock is below zero.</span>{" "}
            More has been used than was recorded in. Record the missing stock-in or a stock take to correct it.
          </p>
        </div>
      )}

      {/* ── KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Kpi label="On hand" value={`${fmtQty(onHand)} ${uom}`} tone={onHand < 0 ? "bad" : undefined}
          sub={`Reorder at ${fmtQty(Number(sku.reorder_level))} ${uom}`} />
        <Kpi label="Stock value" value={formatNairaCompact(Math.max(onHand, 0) * Number(sku.cost_per_unit || 0))}
          sub={`${formatNairaCompact(Number(sku.cost_per_unit || 0))} per ${uom}`} />
        <Kpi label="In (shown period)" value={`+${fmtQty(totals.in)} ${uom}`} icon={<TrendingUp className="h-4 w-4 text-green-600" />} />
        <Kpi label="Out (shown period)" value={`−${fmtQty(totals.out)} ${uom}`} icon={<TrendingDown className="h-4 w-4 text-destructive" />} />
      </div>

      {/* ── Per-warehouse split, only when there's more than one ── */}
      {(data?.stock.length ?? 0) > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Warehouse className="h-4 w-4" />By warehouse</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data!.stock.map((w, i) => (
              <div key={i} className="rounded-md border px-3 py-2 text-sm">
                <span className="text-muted-foreground">{w.warehouses?.name ?? "Warehouse"}:</span>{" "}
                <span className={`font-medium ${Number(w.quantity) < 0 ? "text-destructive" : ""}`}>{fmtQty(Number(w.quantity))} {uom}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-end">
        <div className="space-y-1.5 sm:w-48">
          <Label className="text-xs">Movement type</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <Filter className="h-4 w-4 mr-2 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All movements</SelectItem>
              {Object.entries(MOVEMENT_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <div className="space-y-1.5">
            <Label htmlFor="hist-from" className="text-xs">From</Label>
            <Input id="hist-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hist-to" className="text-xs">To</Label>
            <Input id="hist-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {(typeFilter !== "all" || from || to) && (
          <Button variant="ghost" size="sm" onClick={() => { setTypeFilter("all"); setFrom(""); setTo(""); }}>
            Clear filters
          </Button>
        )}
      </div>

      {/* ── Stock level chart ── */}
      {chartData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Stock level over time</CardTitle>
            <CardDescription>Closing balance on each day with a movement</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={{ balance: { label: `Balance (${uom})`, color: "hsl(var(--primary))" } }} className="h-[220px] w-full">
              <LineChart data={chartData} margin={{ left: 4, right: 8, top: 8 }}>
                <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={44} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {Number(sku.reorder_level) > 0 && (
                  <ReferenceLine y={Number(sku.reorder_level)} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                )}
                {chartData.some(d => d.balance < 0) && <ReferenceLine y={0} stroke="hsl(var(--destructive))" />}
                <Line type="stepAfter" dataKey="balance" stroke="var(--color-balance)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Ledger ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" />Stock history</CardTitle>
          <CardDescription>
            Every stock-in, usage, sale and adjustment for this item, newest first, with the balance after each.
            {truncated && ` Showing the latest ${history.length.toLocaleString()} of ${data!.totalMovements.toLocaleString()} movements.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            columns={columns}
            data={pagination.pageData}
            rowKey={(h) => h.id}
            mobileSubtitle={(h) => h.note || undefined}
            emptyState={
              <div className="flex flex-col items-center justify-center py-12 text-center gap-2 text-muted-foreground">
                <History className="h-8 w-8 opacity-40" />
                <p className="text-sm">{history.length === 0 ? "No stock movements recorded for this item yet." : "No movements match these filters."}</p>
              </div>
            }
          />
          {filtered.length > pagination.pageSize && (
            <TablePagination
              page={pagination.page}
              pageCount={pagination.pageCount}
              total={pagination.total}
              pageSize={pagination.pageSize}
              onPageChange={pagination.setPage}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/business/inventory" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Inventory
    </Link>
  );
}

function Kpi({ label, value, sub, icon, tone }: {
  label: string; value: string; sub?: string; icon?: React.ReactNode; tone?: "bad";
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">{icon}{label}</p>
        <p className={`text-xl sm:text-2xl font-bold mt-1 tabular-nums break-words ${tone === "bad" ? "text-destructive" : ""}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}
