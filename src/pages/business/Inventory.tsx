import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Package, Search, Edit2, Archive, ArchiveRestore, ShoppingCart, ArrowRightLeft, ClipboardCheck,
  History, LineChart, MoreHorizontal, ClipboardList, Settings2, AlertTriangle, CalendarDays, Download, Ruler,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { toast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/usePagination";
import { formatNairaCompact } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { INVENTORY_CATEGORIES, UNITS_OF_MEASURE, getCategoryLabel, MOVEMENT_META, movementMeta } from "@/lib/inventoryConstants";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { TablePagination } from "@/components/ui/table-pagination";
import { EmptyState, FilterChips, PageHeader, StatusPill } from "@/components/shell/ui";
import { InventoryKPICards, type KPIMovement } from "@/components/inventory/InventoryKPICards";
import { CategoryBreakdown } from "@/components/inventory/CategoryBreakdown";
import { StockReconciliation } from "@/components/inventory/StockReconciliation";
import { UsageAnalytics } from "@/components/inventory/UsageAnalytics";
import InventoryDailyReport from "@/components/inventory/InventoryDailyReport";
import RecordStockSheet, { type StockPrefill } from "@/components/inventory/RecordStockSheet";
import { Switch } from "@/components/ui/switch";
import { useInventorySettings } from "@/hooks/useInventorySettings";
import { recordStockMovements, setProductCost } from "@/lib/stockMovements";

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

interface UnitConversion {
  id: string;
  from_unit: string;
  to_unit: string;
  conversion_factor: number;
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
  products: { name: string; uom: string | null; category: string | null; sku_id: string | null } | null;
}

// Stable empty-array fallbacks so derived values below don't get a fresh []
// reference on every render while the query is loading (would otherwise
// retrigger every useMemo that depends on them).
const EMPTY_SKUS: SKU[] = [];
const EMPTY_TRANSACTIONS: Transaction[] = [];
const EMPTY_STOCK_TAKES: StockTake[] = [];
const EMPTY_UNIT_CONVERSIONS: UnitConversion[] = [];
const EMPTY_MOVEMENTS: Movement[] = [];

const todayISO = () => new Date().toISOString().slice(0, 10);

type StockStatus = "all" | "low" | "out" | "archived";

/** Quantities are stored to 4 places; show them without trailing zeros. */
const qty = (n: number) => Number(Number(n).toFixed(4)).toLocaleString("en-NG", { maximumFractionDigits: 4 });

const stockState = (s: SKU): "negative" | "out" | "low" | "ok" =>
  s.stock_quantity < 0 ? "negative" : s.stock_quantity <= 0 ? "out" : s.stock_quantity <= s.reorder_level ? "low" : "ok";

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

export default function Inventory() {
  const { user } = useAuth();
  const { isAdmin, isManager, hasPermission } = useRoles();
  const navigate = useNavigate();
  // Same rules the database applies (see 20261027120000_inventory_access.sql).
  const canRecord = hasPermission("inventory", "create") || isManager;
  const canManage = hasPermission("inventory", "update");
  const canOrder = isAdmin || isManager;

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showConversionDialog, setShowConversionDialog] = useState(false);
  const [showDaily, setShowDaily] = useState(false);
  const [editingSKU, setEditingSKU] = useState<SKU | null>(null);
  const [record, setRecord] = useState<StockPrefill | null>(null);

  const [activeTab, setActiveTab] = useState("items");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [status, setStatus] = useState<StockStatus>("all");
  const [movementFilter, setMovementFilter] = useState("all");

  const [newSKU, setNewSKU] = useState({
    name: "", category: "proteins", unit_of_measure: "kg",
    stock_quantity: 0, reorder_level: 0, cost_per_unit: 0, notes: "",
  });

  const { settings: invSettings, update: updateInvSettings } = useInventorySettings();
  const [showSetup, setShowSetup] = useState(false);
  const [newConversion, setNewConversion] = useState({ from_unit: "", to_unit: "", conversion_factor: 1 });

  interface InventoryData {
    skus: SKU[];
    transactions: Transaction[];
    stockTakes: StockTake[];
    unitConversions: UnitConversion[];
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
      const [skusRes, txRes, takesRes, convRes, moveRes, reqRes, move30Res] = await Promise.all([
        supabase.from("skus").select("*").order("name"),
        supabase.from("transactions").select("*, skus(name, unit_of_measure, category)")
          .order("created_at", { ascending: false }).limit(150),
        supabase.from("stock_takes").select("*").order("created_at", { ascending: false }).limit(10),
        supabase.from("unit_conversions").select("*"),
        (supabase as any).from("inventory_movements")
          .select("*, products(name, uom, category, sku_id)")
          .order("occurred_on", { ascending: false }).order("created_at", { ascending: false })
          .limit(150),
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
        unitConversions: (convRes.data || []) as UnitConversion[],
        movements: ((moveRes as any).data || []) as Movement[],
        movements30d: ((move30Res as any).data || []) as KPIMovement[],
        pendingRequests: reqRes.count ?? 0,
      };
    },
  });

  const skus = inventoryData?.skus ?? EMPTY_SKUS;
  const transactions = inventoryData?.transactions ?? EMPTY_TRANSACTIONS;
  const stockTakes = inventoryData?.stockTakes ?? EMPTY_STOCK_TAKES;
  const unitConversions = inventoryData?.unitConversions ?? EMPTY_UNIT_CONVERSIONS;
  const movements = inventoryData?.movements ?? EMPTY_MOVEMENTS;
  const pendingRequests = inventoryData?.pendingRequests ?? 0;

  const fetchData = async () => {
    const { error } = await refetch();
    if (error) {
      console.error("Error fetching data:", error);
      toast({ title: "Failed to fetch inventory data", variant: "destructive" });
    }
  };

  // Apply a stock change to the single source (products + inventory + movements)
  // in one database transaction. The SKU is a mirror; the DB trigger syncs its
  // stock_quantity automatically.
  const applyStockMovement = (
    skuId: string, delta: number, type: "purchase" | "usage" | "stock_take", note: string,
  ) => recordStockMovements({ lines: [{ sku_id: skuId, quantity_change: delta }], type, note });

  const handleAddSKU = async () => {
    if (!newSKU.name.trim()) { toast({ title: "Please enter an item name", variant: "destructive" }); return; }
    try {
      const { data: product, error } = await (supabase as any)
        .from("products")
        .insert({
          name: newSKU.name.trim(), category: newSKU.category, item_type: "non_sellable",
          uom: newSKU.unit_of_measure, price: newSKU.cost_per_unit,
          // cost_price is the value used for inventory/COGS journals (IAS 2)
          cost_price: newSKU.cost_per_unit,
          user_id: user!.id, created_by: user!.id,
        })
        .select("id").single();
      if (error) throw error;

      // Opening stock goes through the ledger like every other movement:
      // Dr 1200 Inventory / Cr 3000 Owner's Equity at the item's cost.
      if (product && newSKU.stock_quantity > 0) {
        await recordStockMovements({
          lines: [{ product_id: product.id, quantity_change: newSKU.stock_quantity, unit_price: newSKU.cost_per_unit || undefined }],
          type: "adjustment", referenceType: "opening", note: `Opening stock — ${newSKU.name.trim()}`,
        });
        await supabase.from("inventory")
          .update({ reorder_level: newSKU.reorder_level || 10 })
          .eq("product_id", product.id);
      }
      toast({ title: "Item added successfully" });
      setShowAddDialog(false);
      resetForm();
      fetchData();
    } catch (error) {
      console.error("Error adding item:", error);
      toast({ title: "Failed to add item", description: (error as Error).message, variant: "destructive" });
    }
  };

  const handleUpdateSKU = async () => {
    if (!editingSKU) return;
    try {
      const { error } = await (supabase as any)
        .from("products")
        // Never `price`: that is the SELLING price invoices use, and this form
        // only edits cost. Cost goes through setProductCost so stock on hand is
        // revalued in the ledger rather than silently re-priced.
        .update({
          name: editingSKU.name, category: editingSKU.category,
          uom: editingSKU.unit_of_measure,
        })
        .eq("sku_id", editingSKU.id);
      if (error) throw error;

      const before = skus.find(s => s.id === editingSKU.id);
      let revalued = 0;
      if (before && Number(editingSKU.cost_per_unit) !== Number(before.cost_per_unit)) {
        revalued = await setProductCost(editingSKU.id, Number(editingSKU.cost_per_unit), "item edit");
      }

      const original = before?.stock_quantity ?? 0;
      const delta = Number(editingSKU.stock_quantity) - Number(original);
      if (delta !== 0) {
        await applyStockMovement(editingSKU.id, delta, "stock_take", "Adjustment from item edit");
      }
      toast({
        title: "Item updated successfully",
        description: revalued !== 0
          ? `Stock on hand revalued by ${revalued > 0 ? "+" : "−"}${formatNairaCompact(Math.abs(revalued))} in the books.`
          : undefined,
      });
      setEditingSKU(null);
      fetchData();
    } catch (error) {
      console.error("Error updating item:", error);
      toast({ title: "Failed to update item", description: (error as Error).message, variant: "destructive" });
    }
  };

  const handleArchive = async (id: string, archive: boolean) => {
    try {
      const { error } = await supabase.from("skus").update({ is_archived: archive }).eq("id", id);
      if (error) throw error;
      toast({ title: archive ? "Item archived" : "Item restored" });
      fetchData();
    } catch (error) {
      console.error("Error archiving SKU:", error);
      toast({ title: "Failed to update item", variant: "destructive" });
    }
  };

  const handleAddConversion = async () => {
    if (!newConversion.from_unit || !newConversion.to_unit || newConversion.conversion_factor <= 0) {
      toast({ title: "Please fill all fields with valid values", variant: "destructive" });
      return;
    }
    try {
      const { error } = await supabase.from("unit_conversions").insert({ ...newConversion, user_id: user!.id });
      if (error) throw error;
      toast({ title: "Unit conversion added successfully" });
      setNewConversion({ from_unit: "", to_unit: "", conversion_factor: 1 });
      fetchData();
    } catch (error) {
      console.error("Error adding conversion:", error);
      toast({ title: "Failed to add unit conversion", variant: "destructive" });
    }
  };

  // Restock: open Record stock on "Received", prefilled to bring the item back
  // comfortably above its reorder level.
  const handleReorder = (sku: SKU) => setRecord({
    mode: "in",
    sku_id: sku.id,
    quantity: Math.max(sku.reorder_level * 2 - sku.stock_quantity, sku.reorder_level, 1),
    unit_price: sku.cost_per_unit,
    note: `Restock of ${sku.name}`,
  });

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

  const resetForm = () => setNewSKU({
    name: "", category: "proteins", unit_of_measure: "kg",
    stock_quantity: 0, reorder_level: 0, cost_per_unit: 0, notes: "",
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeSkus = useMemo(() => skus.filter(s => !s.is_archived), [skus]);
  const counts = useMemo(() => ({
    low: activeSkus.filter(s => stockState(s) === "low").length,
    out: activeSkus.filter(s => ["out", "negative"].includes(stockState(s))).length,
    negative: activeSkus.filter(s => stockState(s) === "negative").length,
    archived: skus.length - activeSkus.length,
    value: activeSkus.reduce((t, s) => t + Math.max(0, Number(s.stock_quantity)) * Number(s.cost_per_unit || 0), 0),
  }), [skus, activeSkus]);

  const filteredSKUs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return skus.filter(sku => {
      const st = stockState(sku);
      const matchesStatus = status === "archived" ? sku.is_archived
        : !sku.is_archived && (status === "all" || (status === "low" ? st === "low" : st === "out" || st === "negative"));
      return matchesStatus
        && (categoryFilter === "all" || sku.category === categoryFilter)
        && (!q || sku.name.toLowerCase().includes(q) || getCategoryLabel(sku.category).toLowerCase().includes(q));
    });
  }, [skus, searchTerm, categoryFilter, status]);

  const negativeSkus = useMemo(() => activeSkus.filter(s => Number(s.stock_quantity) < 0), [activeSkus]);

  const filteredMovements = useMemo(() =>
    movementFilter === "all" ? movements : movements.filter(m => m.movement_type === movementFilter),
    [movements, movementFilter]);

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
          <div className="truncate text-xs text-muted-foreground">{getCategoryLabel(sku.category)}</div>
        </div>
      ),
    },
    {
      key: "qty", header: "On hand", align: "right",
      cell: (sku) => (
        <span className={cn("tabular-nums font-semibold", sku.stock_quantity < 0 && "text-destructive")}>
          {qty(sku.stock_quantity)} <span className="font-normal text-muted-foreground">{sku.unit_of_measure}</span>
        </span>
      ),
    },
    { key: "status", header: "Status", cell: statusPill },
    {
      key: "reorder", header: "Reorder at", align: "right", hideOnMobile: true,
      cell: (sku) => <span className="tabular-nums text-muted-foreground">{qty(sku.reorder_level)}</span>,
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
                {!sku.is_archived && canRecord && (
                  <DropdownMenuItem onClick={() => setRecord({ mode: "usage", sku_id: sku.id })}>
                    <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />Record stock
                  </DropdownMenuItem>
                )}
                {!sku.is_archived && canOrder && (
                  <DropdownMenuItem onClick={() => handleOrderViaLPO(sku)}>
                    <ClipboardList className="mr-2 h-3.5 w-3.5" />Order via LPO
                  </DropdownMenuItem>
                )}
                {canManage && <DropdownMenuSeparator />}
                {canManage && !sku.is_archived && (
                  <DropdownMenuItem onClick={() => setEditingSKU(sku)}>
                    <Edit2 className="mr-2 h-3.5 w-3.5" />Edit item
                  </DropdownMenuItem>
                )}
                {canManage && (sku.is_archived ? (
                  <DropdownMenuItem onClick={() => handleArchive(sku.id, false)} className="text-green-700 focus:text-green-700">
                    <ArchiveRestore className="mr-2 h-3.5 w-3.5" />Restore
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => handleArchive(sku.id, true)} className="text-amber-700 focus:text-amber-700">
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
      cell: (m) => <span className="font-semibold">{m.products?.name ?? "—"}</span>,
    },
    {
      key: "change", header: "Change", align: "right",
      cell: (m) => (
        <span className={cn("tabular-nums font-semibold", Number(m.quantity_change) >= 0 ? "text-green-700 dark:text-green-400" : "text-destructive")}>
          {Number(m.quantity_change) >= 0 ? "+" : "−"}{qty(Math.abs(Number(m.quantity_change)))} {m.products?.uom ?? ""}
        </span>
      ),
    },
    {
      key: "type", header: "Type",
      cell: (m) => {
        const meta = movementMeta(m.movement_type);
        return <span className={cn("inline-flex h-6 items-center rounded-md border px-2 text-xs font-semibold", meta.cls)}>{meta.label}</span>;
      },
    },
    {
      key: "date", header: "Date",
      cell: (m) => <span className="text-sm text-muted-foreground">{format(new Date(m.occurred_on), "d MMM yyyy")}</span>,
    },
    {
      key: "note", header: "Note", hideOnMobile: true,
      cell: (m) => <span className="block max-w-xs truncate text-sm text-muted-foreground">{m.note || "—"}</span>,
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
          {canRecord && (
            <Button className="flex-1 sm:flex-none" onClick={() => setRecord({ mode: "usage" })}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />Record stock
            </Button>
          )}
          {canManage && (
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setShowAddDialog(true)}>
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
              <DropdownMenuItem onClick={() => setShowDaily(true)}>
                <CalendarDays className="mr-2 h-4 w-4" />Daily report
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportInventoryReport}>
                <Download className="mr-2 h-4 w-4" />Export stock list (CSV)
              </DropdownMenuItem>
              {(canManage || isAdmin) && <DropdownMenuSeparator />}
              {(canManage || isAdmin) && <DropdownMenuLabel className="text-xs text-muted-foreground">Setup</DropdownMenuLabel>}
              {canManage && (
                <DropdownMenuItem onClick={() => setShowConversionDialog(true)}>
                  <Ruler className="mr-2 h-4 w-4" />Unit conversions
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
          <TabsTrigger value="movements" className="gap-1.5"><History className="h-4 w-4" />Movements</TabsTrigger>
          {canManage && <TabsTrigger value="reconciliation" className="gap-1.5"><ClipboardCheck className="h-4 w-4" />Stock take</TabsTrigger>}
          <TabsTrigger value="analytics" className="gap-1.5"><LineChart className="h-4 w-4" />Analytics</TabsTrigger>
        </TabsList>

        {/* ── Items ── */}
        <TabsContent value="items" className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <FilterChips<StockStatus> label="Filter by stock" value={status} onChange={setStatus} options={[
              { value: "all", label: "All items", count: activeSkus.length },
              { value: "low", label: "Running low", count: counts.low },
              { value: "out", label: "Out of stock", count: counts.out },
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
                title={searchTerm || categoryFilter !== "all" ? "No items match" : status === "low" ? "Nothing running low" : status === "out" ? "Nothing out of stock" : status === "archived" ? "No archived items" : "No items yet"}
                body={!skus.length && canManage ? "Add the things you keep in stock to start tracking them." : undefined}
                action={!skus.length && canManage ? <Button onClick={() => setShowAddDialog(true)}><Plus className="mr-2 h-4 w-4" />Add item</Button> : undefined} />
            }
          />
          <TablePagination page={itemPages.page} pageCount={itemPages.pageCount} total={itemPages.total}
            pageSize={itemPages.pageSize} onPageChange={itemPages.setPage} />
        </TabsContent>

        {/* ── Movements ── */}
        <TabsContent value="movements" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Every stock-in, use, sale and correction, newest first. Tap one to open the item.</p>
            <Select value={movementFilter} onValueChange={setMovementFilter}>
              <SelectTrigger aria-label="Movement type" className="w-full sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All movements</SelectItem>
                {Object.entries(MOVEMENT_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ResponsiveTable
            columns={movementColumns}
            data={movementPages.pageData}
            rowKey={(m) => m.id}
            onRowClick={(m) => m.products?.sku_id && navigate(`/business/inventory/item/${m.products.sku_id}`)}
            mobileSubtitle={(m) => m.note || undefined}
            emptyState={<EmptyState icon={History} tone="neutral" title="No movements yet" body="Recorded stock will appear here." />}
          />
          <TablePagination page={movementPages.page} pageCount={movementPages.pageCount} total={movementPages.total}
            pageSize={movementPages.pageSize} onPageChange={movementPages.setPage} />
        </TabsContent>

        {/* ── Stock take ── */}
        {canManage && (
          <TabsContent value="reconciliation">
            <StockReconciliation skus={skus} stockTakes={stockTakes} onComplete={fetchData} />
          </TabsContent>
        )}

        {/* ── Analytics ── */}
        <TabsContent value="analytics" className="space-y-6">
          <InventoryKPICards skus={activeSkus} transactions={transactions} movements30d={inventoryData?.movements30d} />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2"><UsageAnalytics transactions={transactions} skus={skus} /></div>
            <CategoryBreakdown skus={activeSkus} />
          </div>
        </TabsContent>
      </Tabs>

      <RecordStockSheet
        open={!!record} onOpenChange={(o) => { if (!o) setRecord(null); }}
        skus={skus} allowNegative={invSettings.allow_negative_stock} prefill={record} onDone={fetchData}
      />
      <InventoryDailyReport open={showDaily} onOpenChange={setShowDaily} />

      {/* ── Add Item Dialog ── */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Item</DialogTitle>
            <DialogDescription>Create a new inventory item</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Item Name</Label>
              <Input id="name" value={newSKU.name} onChange={(e) => setNewSKU({ ...newSKU, name: e.target.value })} placeholder="Enter item name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select value={newSKU.category} onValueChange={(v) => setNewSKU({ ...newSKU, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVENTORY_CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <div className="flex flex-col">
                        <span>{cat.label}</span>
                        <span className="text-xs text-muted-foreground">{cat.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="uom">Unit</Label>
                <Select value={newSKU.unit_of_measure} onValueChange={(v) => setNewSKU({ ...newSKU, unit_of_measure: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS_OF_MEASURE.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="opening">Opening Stock</Label>
                <Input id="opening" type="number" value={newSKU.stock_quantity}
                  onChange={(e) => setNewSKU({ ...newSKU, stock_quantity: Number(e.target.value) })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="reorder_level">Reorder Level</Label>
                <Input id="reorder_level" type="number" value={newSKU.reorder_level}
                  onChange={(e) => setNewSKU({ ...newSKU, reorder_level: Number(e.target.value) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cost_per_unit">Cost per Unit (₦)</Label>
                <Input id="cost_per_unit" type="number" step="0.01" value={newSKU.cost_per_unit}
                  onChange={(e) => setNewSKU({ ...newSKU, cost_per_unit: Number(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Input id="notes" value={newSKU.notes} onChange={(e) => setNewSKU({ ...newSKU, notes: e.target.value })} placeholder="Additional notes" />
            </div>
            <Button onClick={handleAddSKU} className="w-full">Add Item</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Item Dialog ── */}
      {editingSKU && (
        <Dialog open={!!editingSKU} onOpenChange={() => setEditingSKU(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Item</DialogTitle>
              <DialogDescription>Update item details</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit_name">Item Name</Label>
                <Input id="edit_name" value={editingSKU.name} onChange={(e) => setEditingSKU({ ...editingSKU, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit_category">Category</Label>
                  <Select value={editingSKU.category} onValueChange={(v) => setEditingSKU({ ...editingSKU, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INVENTORY_CATEGORIES.map(cat => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit_uom">Unit</Label>
                  <Select value={editingSKU.unit_of_measure} onValueChange={(v) => setEditingSKU({ ...editingSKU, unit_of_measure: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS_OF_MEASURE.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit_stock">Current Stock</Label>
                  <Input id="edit_stock" type="number" value={editingSKU.stock_quantity}
                    onChange={(e) => setEditingSKU({ ...editingSKU, stock_quantity: Number(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit_reorder">Reorder Level</Label>
                  <Input id="edit_reorder" type="number" value={editingSKU.reorder_level}
                    onChange={(e) => setEditingSKU({ ...editingSKU, reorder_level: Number(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit_cost">Cost per Unit (₦)</Label>
                <Input id="edit_cost" type="number" step="0.01" value={editingSKU.cost_per_unit}
                  onChange={(e) => setEditingSKU({ ...editingSKU, cost_per_unit: Number(e.target.value) })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingSKU(null)}>Cancel</Button>
              <Button onClick={handleUpdateSKU}>Update Item</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

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

      {/* ── Unit Conversions Dialog ── */}
      <Dialog open={showConversionDialog} onOpenChange={setShowConversionDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Unit Conversions</DialogTitle>
            <DialogDescription>Set up conversion rates between different units</DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
              <div className="space-y-1.5">
                <Label>From Unit</Label>
                <Select value={newConversion.from_unit} onValueChange={(v) => setNewConversion({ ...newConversion, from_unit: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{UNITS_OF_MEASURE.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>To Unit</Label>
                <Select value={newConversion.to_unit} onValueChange={(v) => setNewConversion({ ...newConversion, to_unit: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{UNITS_OF_MEASURE.map(unit => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Factor</Label>
                <Input type="number" step="0.01" value={newConversion.conversion_factor}
                  onChange={(e) => setNewConversion({ ...newConversion, conversion_factor: Number(e.target.value) })} />
              </div>
              <Button onClick={handleAddConversion}>Add</Button>
            </div>
            <div className="space-y-2">
              <h4 className="font-medium text-sm">Existing Conversions</h4>
              {unitConversions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No conversions set up yet</p>
              ) : (
                <div className="space-y-2">
                  {unitConversions.map(conversion => (
                    <div key={conversion.id} className="flex items-center justify-between p-2 border rounded">
                      <span className="text-sm">1 {conversion.from_unit} = {conversion.conversion_factor} {conversion.to_unit}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
