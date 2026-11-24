import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Package, Search, Edit2, Archive, ArchiveRestore, ShoppingCart, ArrowRightLeft, ClipboardCheck,
  History, LineChart, MoreHorizontal, ClipboardList, Settings2, AlertTriangle, CalendarDays, Download, Ruler, MapPin, PackagePlus, Receipt, PackageMinus, SlidersHorizontal,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { toast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/usePagination";
import { formatNairaCompact } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { INVENTORY_CATEGORIES, getCategoryLabel } from "@/lib/inventoryConstants";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { TablePagination } from "@/components/ui/table-pagination";
import { EmptyState, FilterChips, PageHeader, StatusPill } from "@/components/shell/ui";
import ReorderLevelsDialog from "@/components/inventory/ReorderLevelsDialog";
import { InventoryKPICards, type KPIMovement } from "@/components/inventory/InventoryKPICards";
import { CategoryBreakdown } from "@/components/inventory/CategoryBreakdown";
import { StockReconciliation } from "@/components/inventory/StockReconciliation";
import { UsageAnalytics } from "@/components/inventory/UsageAnalytics";
import InventoryDailyReport from "@/components/inventory/InventoryDailyReport";
import RecordStockSheet, { type StockPrefill } from "@/components/inventory/RecordStockSheet";
import { Switch } from "@/components/ui/switch";
import { useInventorySettings } from "@/hooks/useInventorySettings";
import { stockStatus, stockValue } from "@/lib/stockStatus";
import { useItemUnits } from "@/hooks/useItemUnits";
import { allUnits, beforeUnitChange, movementQuantity, normaliseUnit, withPurchaseEquivalent } from "@/lib/units";
import { itemKindLabel, nameKey } from "@/lib/itemMaster";
import { ChangeStockUnitDialog, UnitListDialog } from "@/components/inventory/ItemUnits";
import ItemFormSheet, { ArchiveItemDialog, StoragePlacesDialog } from "@/components/inventory/ItemForm";
import ReceiveSheet, { type ReceivePrefill } from "@/components/inventory/ReceiveSheet";
import ReceiptsList from "@/components/inventory/ReceiptsList";
import { useReceiveReady } from "@/hooks/useStockReceipts";
import StockOutSheet, { type StockOutPrefill } from "@/components/inventory/StockOutSheet";
import StockCount from "@/components/inventory/StockCount";
import { useStockOutReady } from "@/hooks/useStockOut";
import { ROUTE_FILTERS, ROUTE_META, routeMeta, routeOf } from "@/lib/stockRoutes";
import { SearchableSelect } from "@/components/ui/searchable-select";

// ── Types ──────────────────────────────────────────────────────────────────────
interface SKU {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  stock_quantity: number;
  reorder_level: number;
  cost_per_unit: number;
  notes?: string;
  is_archived: boolean;
}

interface Transaction {
  id: string;
  transaction_type: string;
  sku_id: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  notes: string | null;
  created_at: string;
  skus: { name: string; unit_of_measure: string; category: string };
}

interface StockTake {
  id: string;
  take_date: string;
  status: string;
  notes: string | null;
  total_items_counted: number;
  total_variance_value: number;
  completed_at: string | null;
  created_at: string;
}

interface Movement {
  id: string;
  product_id: string;
  movement_type: string;
  quantity_change: number;
  reference_type: string | null;
  occurred_on: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  entered_qty?: number | null;
  entered_unit?: string | null;
  stock_unit?: string | null;
  route?: string | null;
  reason?: string | null;
  event_name?: string | null;
  products: { name: string; uom: string | null; category: string | null; sku_id: string | null } | null;
}

// Stable empty-array fallbacks so derived values below don't get a fresh []
// reference on every render while the query is loading (would otherwise
// retrigger every useMemo that depends on them).
const EMPTY_SKUS: SKU[] = [];
const EMPTY_TRANSACTIONS: Transaction[] = [];
const EMPTY_STOCK_TAKES: StockTake[] = [];
const EMPTY_MOVEMENTS: Movement[] = [];

const todayISO = () => new Date().toISOString().slice(0, 10);

type StockStatus = "all" | "low" | "out" | "setup" | "archived";

/** Quantities are stored to 4 places; show them without trailing zeros. */
const qty = (n: number) => Number(Number(n).toFixed(4)).toLocaleString("en-NG", { maximumFractionDigits: 4 });

// One rule for every screen (see src/lib/stockStatus.ts).
const stockState = (s: SKU) => stockStatus(s);

/** A headline figure that also works as a shortcut to the list behind it. */
function Tile({ label, value, sub, tone = "neutral", onClick }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  tone?: "neutral" | "warn" | "bad"; onClick?: () => void;
}) {
  const hot = tone !== "neutral";
  const body = (
    <>
      <span className="text-[13px] font-semibold text-muted-foreground">{label}</span>
      <span className={cn(
        "font-display text-2xl font-bold tabular-nums sm:text-[1.75rem]",
        tone === "warn" && "text-amber-700 dark:text-amber-400",
        tone === "bad" && "text-destructive",
      )}>{value}</span>
      {sub && <span className="truncate text-xs text-muted-foreground">{sub}</span>}
    </>
  );
  const cls = cn(
    "flex min-w-0 flex-col gap-1 rounded-2xl border bg-card p-4 text-left sm:p-5",
    hot && tone === "warn" && "border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/5",
    hot && tone === "bad" && "border-destructive/40 bg-destructive/5",
  );
  return onClick
    ? <button type="button" onClick={onClick} className={cn(cls, "transition-colors hover:border-foreground/30")}>{body}</button>
    : <div className={cls}>{body}</div>;
}

/** A number in Inventory setup that saves when the field is left. */
function SettingNumber({ id, label, hint, value, allowBlank, disabled, onSave }: {
  id: string; label: string; hint?: string; value: number | null; allowBlank?: boolean; disabled?: boolean;
  onSave: (value: number | null) => Promise<unknown>;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type="number" inputMode="decimal" min="0" step="any" className="w-40"
        key={String(value)} defaultValue={value ?? ""} disabled={disabled}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === "" && !allowBlank) { e.target.value = String(value ?? ""); return; }
          const next = raw === "" ? null : Math.max(Number(raw) || 0, 0);
          if (next === value) return;
          onSave(next)
            .then(() => toast({ title: "Saved" }))
            .catch((err) => toast({ title: "Could not save", description: (err as Error).message, variant: "destructive" }));
        }} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function Inventory() {
  const { user } = useAuth();
  const { isAdmin, isManager, hasPermission } = useRoles();
  const navigate = useNavigate();
  // Same rules the database applies (see 20261027120000_inventory_access.sql).
  const canRecord = hasPermission("inventory", "create") || isManager;
  const canManage = hasPermission("inventory", "update");
  const canOrder = isAdmin || isManager;

  // The item form: { item: null } adds, { item } edits. One form, with its own
  // state and a key per item, so it cannot show the item that was open before.
  const [itemForm, setItemForm] = useState<{ item: SKU | null } | null>(null);
  const [archiving, setArchiving] = useState<SKU | null>(null);
  // Receive: one step for a purchase (stock and expense together). Live once
  // migration 20261124200000 is applied; until then the older "Received"
  // entry under Record stock stays.
  const receiveReady = useReceiveReady();
  const [receive, setReceive] = useState<ReceivePrefill | null>(null);
  const canReverse = isAdmin || isManager;
  // Stock out by route and approved counts: live once migration 20261124300000
  // is applied. Until then Record stock and the old stock take stay.
  const stockOutReady = useStockOutReady();
  const [stockOut, setStockOut] = useState<StockOutPrefill | null>(null);
  // From then a correction outside a count is a manager's or the owner's.
  const canCorrect = stockOutReady ? isAdmin || isManager : canRecord;
  const [movementUser, setMovementUser] = useState("");
  const [showUnits, setShowUnits] = useState(false);
  const [showPlaces, setShowPlaces] = useState(false);
  const [showDaily, setShowDaily] = useState(false);
  const [record, setRecord] = useState<StockPrefill | null>(null);

  const [activeTab, setActiveTab] = useState("items");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [status, setStatus] = useState<StockStatus>("all");
  const [movementFilter, setMovementFilter] = useState("all");
  const [movementItem, setMovementItem] = useState("");
  const [movementFrom, setMovementFrom] = useState("");
  const [movementTo, setMovementTo] = useState("");

  // Units and the item master (type, storage place, supplier) for every item.
  const { bySku: unitsBySku, masterReady, refetch: refetchUnits } = useItemUnits();
  const [changeUnitFor, setChangeUnitFor] = useState<SKU | null>(null);

  const { settings: invSettings, update: updateInvSettings } = useInventorySettings();
  const [showSetup, setShowSetup] = useState(false);

  interface InventoryData {
    skus: SKU[];
    transactions: Transaction[];
    stockTakes: StockTake[];
    movements: Movement[];
    movements30d: KPIMovement[];
    pendingRequests: number;
  }

  const {
    data: inventoryData,
    isLoading: loading,
    refetch,
  } = useQuery<InventoryData>({
    queryKey: ["inventory-data", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const [skusRes, txRes, takesRes, moveRes, reqRes, move30Res] = await Promise.all([
        supabase.from("skus").select("*").order("name"),
        supabase.from("transactions").select("*, skus(name, unit_of_measure, category)")
          .order("created_at", { ascending: false }).limit(150),
        supabase.from("stock_takes").select("*").order("created_at", { ascending: false }).limit(10),
        (supabase as any).from("inventory_movements")
          .select("*, products(name, uom, category, sku_id)")
          .order("occurred_on", { ascending: false }).order("created_at", { ascending: false })
          .limit(1000),
        supabase.from("inventory_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
        (supabase as any).from("inventory_movements")
          .select("movement_type, quantity_change, unit_cost")
          .gte("occurred_on", since)
          .limit(10000),
      ]);

      if (skusRes.error) throw skusRes.error;
      return {
        skus: (skusRes.data || []) as SKU[],
        transactions: (txRes.data || []) as Transaction[],
        stockTakes: (takesRes.data || []) as StockTake[],
        movements: ((moveRes as any).data || []) as Movement[],
        movements30d: ((move30Res as any).data || []) as KPIMovement[],
        pendingRequests: reqRes.count ?? 0,
      };
    },
  });

  const skus = inventoryData?.skus ?? EMPTY_SKUS;
  const transactions = inventoryData?.transactions ?? EMPTY_TRANSACTIONS;
  const stockTakes = inventoryData?.stockTakes ?? EMPTY_STOCK_TAKES;
  const movements = inventoryData?.movements ?? EMPTY_MOVEMENTS;
  const pendingRequests = inventoryData?.pendingRequests ?? 0;

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

  const unitChoices = useMemo(
    () => allUnits(invSettings.custom_units, skus.map(s => s.unit_of_measure)),
    [invSettings.custom_units, skus],
  );

  const fetchData = async () => {
    refetchUnits();
    const { error } = await refetch();
    if (error) {
      console.error("Error fetching data:", error);
      toast({ title: "Failed to fetch inventory data", variant: "destructive" });
    }
  };

  // An item with stock on hand cannot be archived: it is first corrected to
  // zero with a reason (ArchiveItemDialog). The database refuses it otherwise.
  const handleArchive = async (sku: SKU, archive: boolean) => {
    if (archive && Number(sku.stock_quantity) !== 0) { setArchiving(sku); return; }
    try {
      const { error } = await supabase.from("skus").update({ is_archived: archive }).eq("id", sku.id);
      if (error) throw error;
      toast({ title: archive ? "Item archived" : "Item restored" });
      fetchData();
    } catch (error) {
      console.error("Error archiving SKU:", error);
      toast({ title: "Failed to update item", description: (error as Error).message, variant: "destructive" });
    }
  };

  // Restock: open Record stock on "Received", prefilled to bring the item back
  // comfortably above its reorder level.
  const handleReorder = (sku: SKU) => {
    const quantity = Math.max(sku.reorder_level * 2 - sku.stock_quantity, sku.reorder_level, 1);
    if (receiveReady) { setReceive({ skuId: sku.id, quantity }); return; }
    setRecord({ mode: "in", sku_id: sku.id, quantity, unit_price: sku.cost_per_unit, note: `Restock of ${sku.name}` });
  };

  // Reorder via formal procurement (LPO) — hands off to the Procurement module.
  const handleOrderViaLPO = (sku: SKU) => {
    navigate("/procurement", {
      state: {
        reorder: {
          id: `reorder-${sku.id}`,
          item_name: sku.name,
          sku_id: sku.id,
          quantity: Math.max(sku.reorder_level * 2 - sku.stock_quantity, sku.reorder_level, 1),
          unit_of_measure: sku.unit_of_measure || "unit",
          unit_price: sku.cost_per_unit || 0,
        },
      },
    });
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeSkus = useMemo(() => skus.filter(s => !s.is_archived), [skus]);
  const [showReorder, setShowReorder] = useState(false);
  const counts = useMemo(() => ({
    low: activeSkus.filter(s => stockState(s) === "low").length,
    out: activeSkus.filter(s => ["out", "negative"].includes(stockState(s))).length,
    negative: activeSkus.filter(s => stockState(s) === "negative").length,
    archived: skus.length - activeSkus.length,
    // Items the owner has not finished setting up: no type yet.
    setup: masterReady ? activeSkus.filter(s => !unitsBySku.get(s.id)?.kind).length : 0,
    // Same definition as ledger 1200 in Books Check (fn_inventory_ledger_check).
    value: stockValue(activeSkus),
  }), [skus, activeSkus, masterReady, unitsBySku]);

  const storagePlacesInUse = useMemo(
    () => new Set([...unitsBySku.values()].map(u => nameKey(u.storagePlace)).filter(Boolean)),
    [unitsBySku],
  );

  const filteredSKUs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return skus.filter(sku => {
      const st = stockState(sku);
      const matchesStatus = status === "archived" ? sku.is_archived
        : status === "setup" ? !sku.is_archived && !unitsBySku.get(sku.id)?.kind
        : !sku.is_archived && (status === "all" || (status === "low" ? st === "low" : st === "out" || st === "negative"));
      return matchesStatus
        && (categoryFilter === "all" || sku.category === categoryFilter)
        && (!q || sku.name.toLowerCase().includes(q) || getCategoryLabel(sku.category).toLowerCase().includes(q));
    });
  }, [skus, searchTerm, categoryFilter, status, unitsBySku]);

  const negativeSkus = useMemo(() => activeSkus.filter(s => Number(s.stock_quantity) < 0), [activeSkus]);

  const filteredMovements = useMemo(() => movements.filter(m =>
    (movementFilter === "all" || routeOf(m) === movementFilter)
    && (!movementUser || m.created_by === movementUser)
    && (!movementItem || m.products?.sku_id === movementItem)
    && (!movementFrom || m.occurred_on >= movementFrom)
    && (!movementTo || m.occurred_on <= movementTo)),
    [movements, movementFilter, movementUser, movementItem, movementFrom, movementTo]);
  const movementFiltersOn = movementFilter !== "all" || !!movementUser || !!movementItem || !!movementFrom || !!movementTo;
  const userOptions = useMemo(() => {
    const ids = [...new Set(movements.map(m => m.created_by).filter(Boolean) as string[])];
    return ids.map(id => ({ value: id, label: nameByUserId[id] || "Unknown" })).sort((a, b) => a.label.localeCompare(b.label));
  }, [movements, nameByUserId]);
  const itemOptions = useMemo(() => skus.map(s => ({ value: s.id, label: s.name })), [skus]);

  const itemPages = usePagination(filteredSKUs, 25);
  const movementPages = usePagination(filteredMovements, 25);

  const showList = (s: StockStatus) => { setActiveTab("items"); setStatus(s); };

  const exportInventoryReport = () => {
    const totalUnits = skus.reduce((s, it) => s + Number(it.stock_quantity), 0);
    const totalValue = skus.reduce((s, it) => s + Number(it.stock_quantity) * Number(it.cost_per_unit || 0), 0);
    const lowStock = skus.filter(s => s.stock_quantity <= s.reorder_level);
    const lines: string[] = [
      "Inventory Report",
      `Generated,${format(new Date(), "yyyy-MM-dd HH:mm")}`,
      "",
      "Summary,Value",
      `Distinct Items,${skus.length}`,
      `Total Units,${totalUnits}`,
      `Total Stock Value (NGN),${totalValue.toFixed(2)}`,
      `Low Stock Items,${lowStock.length}`,
      "",
      "Item,Category,UoM,Quantity,Reorder Level,Cost/Unit,Stock Value,Status",
    ];
    skus.forEach((it) => {
      const value = Number(it.stock_quantity) * Number(it.cost_per_unit || 0);
      const status = it.stock_quantity <= 0 ? "OUT OF STOCK" : it.stock_quantity <= it.reorder_level ? "LOW STOCK" : "OK";
      lines.push([
        it.name, getCategoryLabel(it.category), it.unit_of_measure,
        String(it.stock_quantity), String(it.reorder_level),
        Number(it.cost_per_unit || 0).toFixed(2), value.toFixed(2), status,
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast({ title: `Inventory report exported · ${skus.length} items · ${formatNairaCompact(totalValue)}` });
  };

  // ── Items table columns ──────────────────────────────────────────────────────
  const statusPill = (sku: SKU) => {
    if (sku.is_archived) return <StatusPill tone="neutral" label="Archived" />;
    const st = stockState(sku);
    return st === "negative" ? <StatusPill tone="bad" label="Below zero" />
      : st === "out" ? <StatusPill tone="bad" label="Out of stock" />
      : st === "low" ? <StatusPill tone="pending" label="Running low" />
      : <StatusPill tone="good" label="In stock" />;
  };

  const itemColumns: ResponsiveColumn<SKU>[] = [
    {
      key: "name", header: "Item", primary: true,
      cell: (sku) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{sku.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {[getCategoryLabel(sku.category),
              masterReady && unitsBySku.get(sku.id)?.kind ? itemKindLabel(unitsBySku.get(sku.id)?.kind) : null,
              unitsBySku.get(sku.id)?.storagePlace].filter(Boolean).join(" · ")}
            {masterReady && !sku.is_archived && !unitsBySku.get(sku.id)?.kind && (
              <span className="ml-1.5 rounded border border-amber-300 px-1 text-[11px] text-amber-800 dark:border-amber-500/40 dark:text-amber-300">needs setup</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "qty", header: "On hand", align: "right",
      cell: (sku) => (
        <div className={cn("tabular-nums font-semibold", sku.stock_quantity < 0 && "text-destructive")}>
          {qty(sku.stock_quantity)} <span className="font-normal text-muted-foreground">{sku.unit_of_measure}</span>
          {(() => {
            // "28 kg, about 2.8 bag" when the item is bought in a pack size.
            const full = withPurchaseEquivalent(Number(sku.stock_quantity), unitsBySku.get(sku.id));
            const about = full.split(", ")[1];
            return about ? <div className="text-xs font-normal text-muted-foreground">{about}</div> : null;
          })()}
        </div>
      ),
    },
    { key: "status", header: "Status", cell: statusPill },
    {
      key: "reorder", header: "Minimum", align: "right", hideOnMobile: true,
      cell: (sku) => <span className="tabular-nums text-muted-foreground">{qty(sku.reorder_level)} {sku.unit_of_measure}</span>,
    },
    {
      key: "value", header: "Value", align: "right", hideOnMobile: true,
      cell: (sku) => (
        <div className="tabular-nums">
          <div>{formatNairaCompact(Math.max(0, sku.stock_quantity) * sku.cost_per_unit)}</div>
          <div className="text-xs text-muted-foreground">{formatNairaCompact(sku.cost_per_unit)}/{sku.unit_of_measure}</div>
        </div>
      ),
    },
    {
      key: "actions", header: "", align: "right", mobileFooter: true,
      cell: (sku: SKU) => {
        const needs = !sku.is_archived && stockState(sku) !== "ok";
        return (
          // The row opens the item page; these must not.
          <div className="flex gap-2 md:justify-end" onClick={(e) => e.stopPropagation()}>
            {needs && canRecord && (
              <Button size="sm" variant="outline" className="flex-1 md:flex-none" onClick={() => handleReorder(sku)}>
                <ShoppingCart className="mr-1.5 h-3.5 w-3.5" />Restock
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" aria-label={`More for ${sku.name}`} className="h-9 w-9 p-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => navigate(`/business/inventory/item/${sku.id}`)}>
                  <History className="mr-2 h-3.5 w-3.5" />Stock history
                </DropdownMenuItem>
                {!sku.is_archived && canRecord && (stockOutReady ? (
                  <DropdownMenuItem onClick={() => setStockOut({ skuId: sku.id })}>
                    <PackageMinus className="mr-2 h-3.5 w-3.5" />Use stock
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => setRecord({ mode: "usage", sku_id: sku.id })}>
                    <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />Record stock
                  </DropdownMenuItem>
                ))}
                {!sku.is_archived && canOrder && (
                  <DropdownMenuItem onClick={() => handleOrderViaLPO(sku)}>
                    <ClipboardList className="mr-2 h-3.5 w-3.5" />Order via LPO
                  </DropdownMenuItem>
                )}
                {canManage && <DropdownMenuSeparator />}
                {canManage && !sku.is_archived && (
                  <DropdownMenuItem onClick={() => setItemForm({ item: sku })}>
                    <Edit2 className="mr-2 h-3.5 w-3.5" />Edit item
                  </DropdownMenuItem>
                )}
                {canManage && (sku.is_archived ? (
                  <DropdownMenuItem onClick={() => handleArchive(sku, false)} className="text-green-700 focus:text-green-700">
                    <ArchiveRestore className="mr-2 h-3.5 w-3.5" />Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => handleArchive(sku, true)} className="text-amber-700 focus:text-amber-700">
                    <Archive className="mr-2 h-3.5 w-3.5" />Archive
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  // ── Movements table columns ──────────────────────────────────────────────────
  const movementColumns: ResponsiveColumn<Movement>[] = [
    {
      key: "item", header: "Item", primary: true,
      cell: (m) => {
        const old = m.products?.sku_id ? beforeUnitChange(m.created_at, unitsBySku.get(m.products.sku_id)?.resetAt) : false;
        return (
          <div className="min-w-0">
            <span className="font-semibold">{m.products?.name ?? "—"}</span>
            {old && <span className="ml-2 rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground">before unit change</span>}
          </div>
        );
      },
    },
    {
      key: "change", header: "Change", align: "right",
      cell: (m) => (
        <span className={cn("tabular-nums font-semibold", Number(m.quantity_change) >= 0 ? "text-green-700 dark:text-green-400" : "text-destructive")}>
          {movementQuantity(m, m.stock_unit ?? m.products?.uom ?? "")}
        </span>
      ),
    },
    {
      key: "type", header: "Route",
      cell: (m) => {
        const meta = routeMeta(m);
        return <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-md border px-2 text-xs font-semibold", meta.cls)}>{meta.label}</span>;
      },
    },
    {
      key: "date", header: "Date",
      cell: (m) => <span className="text-sm text-muted-foreground">{format(new Date(m.occurred_on), "d MMM yyyy")}</span>,
    },
    {
      key: "note", header: "Note", hideOnMobile: true,
      cell: (m) => (
        <span className="block max-w-xs truncate text-sm text-muted-foreground">
          {[m.event_name, m.reason && m.reason !== m.note ? m.reason : null, m.note].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      key: "by", header: "Recorded by", hideOnMobile: true,
      cell: (m) => <span className="whitespace-nowrap text-sm text-muted-foreground">{m.created_by ? nameByUserId[m.created_by] ?? "—" : "System"}</span>,
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-9 w-48" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-[104px] rounded-2xl" />)}
        </div>
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="What’s in stock, what’s running low, and every movement in and out."
        actions={<>
          {canRecord && receiveReady && (
            <Button className="flex-1 sm:flex-none" onClick={() => setReceive({})}>
              <PackagePlus className="mr-2 h-4 w-4" />Receive
            </Button>
          )}
          {canRecord && stockOutReady && (
            <Button variant={receiveReady ? "outline" : "default"} className="flex-1 sm:flex-none" onClick={() => setStockOut({})}>
              <PackageMinus className="mr-2 h-4 w-4" />Use stock
            </Button>
          )}
          {canRecord && !stockOutReady && (
            <Button variant={receiveReady ? "outline" : "default"} className="flex-1 sm:flex-none" onClick={() => setRecord({ mode: "usage" })}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />Record stock
            </Button>
          )}
          {canManage && (
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setItemForm({ item: null })}>
              <Plus className="mr-2 h-4 w-4" />Add item
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" aria-label="More inventory actions">
                <MoreHorizontal className="h-4 w-4 sm:mr-2" /><span className="max-sm:sr-only">More</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => navigate("/business/inventory-requests")}>
                <ClipboardList className="mr-2 h-4 w-4" />Stock requests
                {pendingRequests > 0 && <span className="ml-auto rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">{pendingRequests}</span>}
              </DropdownMenuItem>
              {stockOutReady && canCorrect && (
                <DropdownMenuItem onClick={() => setRecord({ mode: "adjust" })}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />Correct stock
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setShowDaily(true)}>
                <CalendarDays className="mr-2 h-4 w-4" />Daily report
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportInventoryReport}>
                <Download className="mr-2 h-4 w-4" />Export stock list (CSV)
              </DropdownMenuItem>
              {(canManage || isAdmin) && <DropdownMenuSeparator />}
              {(canManage || isAdmin) && <DropdownMenuLabel className="text-xs text-muted-foreground">Setup</DropdownMenuLabel>}
              {canManage && (
                <DropdownMenuItem onClick={() => setShowReorder(true)}>
                  <Settings2 className="mr-2 h-4 w-4" />Minimum levels
                </DropdownMenuItem>
              )}
              {canManage && (
                <DropdownMenuItem onClick={() => setShowUnits(true)}>
                  <Ruler className="mr-2 h-4 w-4" />Units
                </DropdownMenuItem>
              )}
              {canManage && masterReady && (
                <DropdownMenuItem onClick={() => setShowPlaces(true)}>
                  <MapPin className="mr-2 h-4 w-4" />Storage places
                </DropdownMenuItem>
              )}
              {isAdmin && (
                <DropdownMenuItem onClick={() => setShowSetup(true)}>
                  <Settings2 className="mr-2 h-4 w-4" />Stock rules
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
      />

      <ReorderLevelsDialog open={showReorder} onOpenChange={setShowReorder} items={activeSkus} onDone={fetchData} />

      {/* ── What needs attention ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Stock value" value={formatNairaCompact(counts.value)} sub={`${activeSkus.length} items in stock list`} />
        <Tile label="Running low" value={counts.low} tone={counts.low ? "warn" : "neutral"}
          sub={counts.low ? "Tap to see them" : "Nothing at its reorder level"}
          onClick={counts.low ? () => showList("low") : undefined} />
        <Tile label="Out of stock" value={counts.out} tone={counts.out ? "bad" : "neutral"}
          sub={counts.negative ? `${counts.negative} below zero` : counts.out ? "Tap to see them" : "Everything has stock"}
          onClick={counts.out ? () => showList("out") : undefined} />
        <Tile label="Stock requests" value={pendingRequests} tone={pendingRequests ? "warn" : "neutral"}
          sub={pendingRequests ? "Waiting for approval" : "None waiting"}
          onClick={() => navigate("/business/inventory-requests")} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
        <TabsList>
          <TabsTrigger value="items" className="gap-1.5"><Package className="h-4 w-4" />Items</TabsTrigger>
          {receiveReady && <TabsTrigger value="receipts" className="gap-1.5"><Receipt className="h-4 w-4" />Receipts</TabsTrigger>}
          <TabsTrigger value="movements" className="gap-1.5"><History className="h-4 w-4" />Movements</TabsTrigger>
          {(stockOutReady ? canRecord || canManage : canManage) && (
            <TabsTrigger value="reconciliation" className="gap-1.5"><ClipboardCheck className="h-4 w-4" />{stockOutReady ? "Count" : "Stock take"}</TabsTrigger>
          )}
          <TabsTrigger value="analytics" className="gap-1.5"><LineChart className="h-4 w-4" />Analytics</TabsTrigger>
        </TabsList>

        {/* ── Items ── */}
        <TabsContent value="items" className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <FilterChips<StockStatus> label="Filter by stock" value={status} onChange={setStatus} options={[
              { value: "all", label: "All items", count: activeSkus.length },
              { value: "low", label: "Running low", count: counts.low },
              { value: "out", label: "Out of stock", count: counts.out },
              ...(counts.setup > 0 || status === "setup" ? [{ value: "setup" as const, label: "Needs setup", count: counts.setup }] : []),
              { value: "archived", label: "Archived", count: counts.archived },
            ]} />
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1 xl:w-64 xl:flex-none">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input aria-label="Search items" placeholder="Search items" value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger aria-label="Category" className="w-36 shrink-0 sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {INVENTORY_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ResponsiveTable
            columns={itemColumns}
            data={itemPages.pageData}
            rowKey={(s) => s.id}
            onRowClick={(s) => navigate(`/business/inventory/item/${s.id}`)}
            rowClassName={(s) => (stockState(s) === "negative" ? "bg-destructive/5" : undefined)}
            emptyState={
              <EmptyState icon={Package} tone="neutral"
                title={searchTerm || categoryFilter !== "all" ? "No items match" : status === "low" ? "Nothing running low" : status === "out" ? "Nothing out of stock" : status === "archived" ? "No archived items" : status === "setup" ? "Every item is set up" : "No items yet"}
                body={!skus.length && canManage ? "Add the things you keep in stock to start tracking them." : undefined}
                action={!skus.length && canManage ? <Button onClick={() => setItemForm({ item: null })}><Plus className="mr-2 h-4 w-4" />Add item</Button> : undefined} />
            }
          />
          <TablePagination page={itemPages.page} pageCount={itemPages.pageCount} total={itemPages.total}
            pageSize={itemPages.pageSize} onPageChange={itemPages.setPage} />
        </TabsContent>

        {/* ── Receipts ── */}
        {receiveReady && (
          <TabsContent value="receipts">
            <ReceiptsList canReceive={canRecord} canReverse={canReverse} onReceive={() => setReceive({})} />
          </TabsContent>
        )}

        {/* ── Movements ── */}
        <TabsContent value="movements" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Every movement, newest first, with the route it took and the unit it was typed in. Tap one to open the item.
            {movements.length >= 1000 && " Showing the latest 1,000; open an item for its full history."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[12rem_minmax(0,1fr)_12rem_auto_auto_auto] xl:items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Route</Label>
              <Select value={movementFilter} onValueChange={setMovementFilter}>
                <SelectTrigger aria-label="Route"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All routes</SelectItem>
                  {ROUTE_FILTERS.map((r) => <SelectItem key={r} value={r}>{ROUTE_META[r].label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Item</Label>
              <SearchableSelect options={itemOptions} value={movementItem} onChange={setMovementItem}
                title="Choose an item" placeholder="All items" emptyOptionLabel="All items" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Recorded by</Label>
              <SearchableSelect options={userOptions} value={movementUser} onChange={setMovementUser}
                title="Recorded by" placeholder="Anyone" emptyOptionLabel="Anyone" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-from" className="text-xs">From</Label>
              <Input id="mv-from" type="date" value={movementFrom} max={movementTo || undefined} onChange={(e) => setMovementFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mv-to" className="text-xs">To</Label>
              <Input id="mv-to" type="date" value={movementTo} min={movementFrom || undefined} onChange={(e) => setMovementTo(e.target.value)} />
            </div>
            {movementFiltersOn && (
              <Button variant="ghost" size="sm" className="justify-self-start"
                onClick={() => { setMovementFilter("all"); setMovementUser(""); setMovementItem(""); setMovementFrom(""); setMovementTo(""); }}>
                Clear filters
              </Button>
            )}
          </div>
          <ResponsiveTable
            columns={movementColumns}
            data={movementPages.pageData}
            rowKey={(m) => m.id}
            onRowClick={(m) => m.products?.sku_id && navigate(`/business/inventory/item/${m.products.sku_id}`)}
            mobileSubtitle={(m) => m.note || undefined}
            emptyState={<EmptyState icon={History} tone="neutral" title={movementFiltersOn ? "No movements match these filters" : "No movements yet"} body={movementFiltersOn ? undefined : "Recorded stock will appear here."} />}
          />
          <TablePagination page={movementPages.page} pageCount={movementPages.pageCount} total={movementPages.total}
            pageSize={movementPages.pageSize} onPageChange={movementPages.setPage} />
        </TabsContent>

        {/* ── Stock take ── */}
        {stockOutReady ? (canRecord || canManage) && (
          <TabsContent value="reconciliation">
            <StockCount skus={skus} unitsBySku={unitsBySku} storagePlaces={invSettings.storage_places}
              canCount={canRecord} canApprove={isAdmin || isManager} isAdmin={isAdmin} onChanged={fetchData} />
          </TabsContent>
        ) : canManage && (
          <TabsContent value="reconciliation">
            <StockReconciliation skus={skus} stockTakes={stockTakes} onComplete={fetchData}
              unitsBySku={unitsBySku} storagePlaces={invSettings.storage_places} />
          </TabsContent>
        )}

        {/* ── Analytics ── */}
        <TabsContent value="analytics" className="space-y-6">
          <InventoryKPICards skus={activeSkus} transactions={transactions} movements30d={inventoryData?.movements30d} />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2"><UsageAnalytics
              // Entries from before an item's unit change or opening count
              // were in mixed units; they stay out of usage figures.
              transactions={transactions.filter(t => !beforeUnitChange(t.created_at, unitsBySku.get(t.sku_id)?.resetAt))}
              skus={skus} /></div>
            <CategoryBreakdown skus={activeSkus} />
          </div>
        </TabsContent>
      </Tabs>

      <RecordStockSheet
        open={!!record} onOpenChange={(o) => { if (!o) setRecord(null); }}
        skus={skus} allowNegative={invSettings.allow_negative_stock} prefill={record} onDone={fetchData}
        onReceive={receiveReady ? (skuId) => setReceive(skuId ? { skuId } : {}) : undefined}
        lockMode={stockOutReady ? "adjust" : undefined}
      />
      <StockOutSheet
        open={!!stockOut} onOpenChange={(o) => { if (!o) setStockOut(null); }}
        skus={skus} allowNegative={invSettings.allow_negative_stock} prefill={stockOut} onDone={fetchData}
        onReceive={receiveReady ? (skuId) => setReceive({ skuId }) : undefined}
        onCount={() => setActiveTab("reconciliation")}
      />
      <ReceiveSheet open={!!receive} onOpenChange={(o) => { if (!o) setReceive(null); }} prefill={receive} onDone={fetchData} />
      <InventoryDailyReport open={showDaily} onOpenChange={setShowDaily} />

      {/* ── Add or edit an item ── */}
      <ItemFormSheet
        key={itemForm?.item?.id ?? "new"}
        open={!!itemForm} onOpenChange={(o) => { if (!o) setItemForm(null); }}
        item={itemForm?.item ?? null}
        skus={skus} unitsBySku={unitsBySku} masterReady={masterReady}
        unitChoices={unitChoices} storagePlaces={invSettings.storage_places}
        isAdmin={isAdmin} canRecord={canCorrect}
        onSaved={fetchData}
        onChangeUnit={(it) => setChangeUnitFor(it as SKU)}
        onCorrectCount={(it) => setRecord({ mode: "adjust", sku_id: it.id })}
        onOpenItem={(id) => navigate(`/business/inventory/item/${id}`)}
      />

      <ArchiveItemDialog item={archiving} onOpenChange={(o) => { if (!o) setArchiving(null); }} onDone={fetchData} />

      <ChangeStockUnitDialog
        open={!!changeUnitFor} onOpenChange={(o) => { if (!o) setChangeUnitFor(null); }}
        item={changeUnitFor ? {
          id: changeUnitFor.id, name: changeUnitFor.name, unit: normaliseUnit(changeUnitFor.unit_of_measure),
          onHand: Number(changeUnitFor.stock_quantity), cost: Number(changeUnitFor.cost_per_unit || 0),
          reorder: Number(changeUnitFor.reorder_level || 0),
        } : null}
        unitChoices={unitChoices} onDone={fetchData}
      />

      <StoragePlacesDialog open={showPlaces} onOpenChange={setShowPlaces} places={invSettings.storage_places}
        canEdit={isAdmin} inUse={storagePlacesInUse}
        onSave={(places) => updateInvSettings.mutateAsync({ storage_places: places }).then(() => { toast({ title: "Storage places saved" }); })} />

      <UnitListDialog open={showUnits} onOpenChange={setShowUnits} custom={invSettings.custom_units} canEdit={isAdmin}
        onSave={(units) => updateInvSettings.mutateAsync({ custom_units: units }).then(() => { toast({ title: "Units saved" }); })} />

      {/* ── Inventory Setup Dialog ── */}
      <Dialog open={showSetup} onOpenChange={setShowSetup}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Inventory setup</DialogTitle>
            <DialogDescription>Rules that apply to every stock movement, wherever it is recorded.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="allow-negative" className="text-sm font-medium">Allow negative stock</Label>
                <p className="text-xs text-muted-foreground">
                  On: usage can be recorded even when the system shows too little stock (e.g. a delivery not logged
                  yet). Off: any stock-out that would go below zero is refused.
                </p>
              </div>
              <Switch id="allow-negative" checked={invSettings.allow_negative_stock}
                disabled={updateInvSettings.isPending}
                onCheckedChange={(v) => updateInvSettings.mutate({ allow_negative_stock: v }, {
                  onSuccess: () => toast({ title: v ? "Negative stock allowed" : "Negative stock blocked" }),
                  onError: (e) => toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }),
                })} />
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="notify-negative" className="text-sm font-medium">Notify when stock goes negative</Label>
                <p className="text-xs text-muted-foreground">
                  Admins and managers get a notification the moment an item drops below zero, linking to its stock history.
                </p>
              </div>
              <Switch id="notify-negative" checked={invSettings.notify_on_negative}
                disabled={updateInvSettings.isPending}
                onCheckedChange={(v) => updateInvSettings.mutate({ notify_on_negative: v }, {
                  onError: (e) => toast({ title: "Could not save", description: (e as Error).message, variant: "destructive" }),
                })} />
            </div>
            {receiveReady && (
              <div className="space-y-1.5">
                <Label htmlFor="photo-above" className="text-sm font-medium">Ask for a receipt photo above (₦)</Label>
                <p className="text-xs text-muted-foreground">
                  A purchase received above this total needs a photo of the supplier’s receipt, or a typed reason there is
                  none. Leave blank to never ask.
                </p>
                <Input id="photo-above" type="number" inputMode="decimal" min="0" step="any" className="w-40"
                  key={String(invSettings.receipt_photo_above_minor)}
                  defaultValue={invSettings.receipt_photo_above_minor != null ? invSettings.receipt_photo_above_minor / 100 : ""}
                  disabled={updateInvSettings.isPending}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const next = raw === "" ? null : Math.round(Math.max(Number(raw) || 0, 0) * 100);
                    if (next === invSettings.receipt_photo_above_minor) return;
                    updateInvSettings.mutate({ receipt_photo_above_minor: next }, {
                      onSuccess: () => toast({ title: next == null ? "Receipt photos are not asked for" : "Receipt photo limit saved" }),
                      onError: (err) => toast({ title: "Could not save", description: (err as Error).message, variant: "destructive" }),
                    });
                  }} />
              </div>
            )}
            {stockOutReady && (
              <div className="space-y-3 border-t pt-4">
                <div>
                  <div className="text-sm font-medium">Count differences that need a reason</div>
                  <p className="text-xs text-muted-foreground">Before a count is approved, a difference above either figure has to be explained.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SettingNumber id="count-pct" label="Above this % of expected" value={invSettings.count_reason_pct} disabled={updateInvSettings.isPending}
                    onSave={(v) => updateInvSettings.mutateAsync({ count_reason_pct: v ?? 10 })} />
                  <SettingNumber id="count-value" label="Or worth more than (₦)" value={invSettings.count_reason_value_minor / 100} disabled={updateInvSettings.isPending}
                    onSave={(v) => updateInvSettings.mutateAsync({ count_reason_value_minor: Math.round((v ?? 20000) * 100) })} />
                </div>
                <SettingNumber id="correction-owner" label="A correction outside a count above this (₦) is the owner’s to make"
                  hint="Blank: a manager can correct any amount." allowBlank
                  value={invSettings.correction_owner_above_minor != null ? invSettings.correction_owner_above_minor / 100 : null}
                  disabled={updateInvSettings.isPending}
                  onSave={(v) => updateInvSettings.mutateAsync({ correction_owner_above_minor: v == null ? null : Math.round(v * 100) })} />
              </div>
            )}
            {negativeSkus.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
                <p className="font-medium text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> Items currently below zero
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {negativeSkus.map(s => (
                    <li key={s.id}>
                      <button type="button" className="text-left underline-offset-2 hover:underline"
                        onClick={() => { setShowSetup(false); navigate(`/business/inventory/item/${s.id}`); }}>
                        {s.name} — {s.stock_quantity} {s.unit_of_measure}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
