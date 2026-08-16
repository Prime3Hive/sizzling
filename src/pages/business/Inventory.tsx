import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Package, Search, Filter, Edit2, Archive, ArchiveRestore, ShoppingCart,
  TrendingDown, ArrowRightLeft, ClipboardCheck, History, LineChart, MoreHorizontal,
  ClipboardList, Boxes,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { toast } from "@/hooks/use-toast";
import { formatNairaCompact } from "@/lib/currency";
import { INVENTORY_CATEGORIES, UNITS_OF_MEASURE, getCategoryColor, getCategoryLabel } from "@/lib/inventoryConstants";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { InventoryKPICards } from "@/components/inventory/InventoryKPICards";
import { LowStockAlerts } from "@/components/inventory/LowStockAlerts";
import { CategoryBreakdown } from "@/components/inventory/CategoryBreakdown";
import { StockReconciliation } from "@/components/inventory/StockReconciliation";
import { TransactionHistory } from "@/components/inventory/TransactionHistory";
import { UsageAnalytics } from "@/components/inventory/UsageAnalytics";
import InventoryDailyReport from "@/components/inventory/InventoryDailyReport";
import RecordMovementDialog from "@/components/inventory/RecordMovementDialog";

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
  products: { name: string; uom: string | null; category: string | null } | null;
}

// ── Movement type presentation ──────────────────────────────────────────────────
const MOVEMENT_META: Record<string, { label: string; cls: string }> = {
  purchase:   { label: "Stock In",    cls: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800" },
  usage:      { label: "Usage",       cls: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800" },
  sale:       { label: "Sale",        cls: "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800" },
  adjustment: { label: "Adjustment",  cls: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800" },
  stock_take: { label: "Stock Take",  cls: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800" },
};
const movementMeta = (t: string) =>
  MOVEMENT_META[t] ?? { label: t, cls: "bg-muted text-muted-foreground border-border" };

// Stable empty-array fallbacks so derived values below don't get a fresh []
// reference on every render while the query is loading (would otherwise
// retrigger every useMemo that depends on them).
const EMPTY_SKUS: SKU[] = [];
const EMPTY_TRANSACTIONS: Transaction[] = [];
const EMPTY_STOCK_TAKES: StockTake[] = [];
const EMPTY_UNIT_CONVERSIONS: UnitConversion[] = [];
const EMPTY_MOVEMENTS: Movement[] = [];

export default function Inventory() {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const navigate = useNavigate();

  const [operationLoading, setOperationLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showConversionDialog, setShowConversionDialog] = useState(false);
  const [editingSKU, setEditingSKU] = useState<SKU | null>(null);

  const [activeTab, setActiveTab] = useState("items");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showArchived, setShowArchived] = useState(false);
  const [movementFilter, setMovementFilter] = useState("all");

  const [newSKU, setNewSKU] = useState({
    name: "", category: "proteins", unit_of_measure: "kg",
    stock_quantity: 0, reorder_level: 0, cost_per_unit: 0, notes: "",
  });
  const [purchaseForm, setPurchaseForm] = useState({ sku_id: "", quantity: 0, unit_price: 0, notes: "" });
  const [usageForm, setUsageForm] = useState({ sku_id: "", quantity: 0, notes: "" });
  const [newConversion, setNewConversion] = useState({ from_unit: "", to_unit: "", conversion_factor: 1 });

  interface InventoryData {
    skus: SKU[];
    transactions: Transaction[];
    stockTakes: StockTake[];
    unitConversions: UnitConversion[];
    movements: Movement[];
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
      const [skusRes, txRes, takesRes, convRes, moveRes, reqRes] = await Promise.all([
        supabase.from("skus").select("*").order("name"),
        supabase.from("transactions").select("*, skus(name, unit_of_measure, category)")
          .order("created_at", { ascending: false }).limit(150),
        supabase.from("stock_takes").select("*").order("created_at", { ascending: false }).limit(10),
        supabase.from("unit_conversions").select("*"),
        (supabase as any).from("inventory_movements")
          .select("*, products(name, uom, category)")
          .order("occurred_on", { ascending: false }).order("created_at", { ascending: false })
          .limit(150),
        supabase.from("inventory_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);

      if (skusRes.error) throw skusRes.error;
      return {
        skus: (skusRes.data || []) as SKU[],
        transactions: (txRes.data || []) as Transaction[],
        stockTakes: (takesRes.data || []) as StockTake[],
        unitConversions: (convRes.data || []) as UnitConversion[],
        movements: ((moveRes as any).data || []) as Movement[],
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

  // Apply a stock change to the single source (products + inventory + movements).
  // The SKU is a mirror, so we resolve its product and adjust inventory; the DB
  // trigger then syncs the sku's stock_quantity automatically.
  const applyStockMovement = async (
    skuId: string, delta: number, type: "purchase" | "usage" | "stock_take", note: string,
  ) => {
    const { data: prod } = await supabase.from("products").select("id").eq("sku_id", skuId).maybeSingle();
    if (!prod) return;
    const { data: invRow } = await supabase.from("inventory")
      .select("id, warehouse_id, quantity").eq("product_id", prod.id)
      .order("quantity", { ascending: false }).limit(1).maybeSingle();
    let warehouseId = invRow?.warehouse_id ?? null;
    if (invRow) {
      await supabase.from("inventory").update({ quantity: Number(invRow.quantity) + delta }).eq("id", invRow.id);
    } else {
      const { data: wh } = await supabase.from("warehouses").select("id").limit(1).maybeSingle();
      if (wh) {
        warehouseId = wh.id;
        await supabase.from("inventory").insert({ product_id: prod.id, warehouse_id: wh.id, quantity: Math.max(delta, 0), reorder_level: 10 });
      }
    }
    await (supabase as any).from("inventory_movements").insert({
      product_id: prod.id, warehouse_id: warehouseId, movement_type: type,
      quantity_change: delta, reference_type: "manual",
      occurred_on: new Date().toISOString().split("T")[0], note, created_by: user!.id,
    });
  };

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

      if (product && newSKU.stock_quantity > 0) {
        const { data: wh } = await supabase.from("warehouses").select("id").limit(1).maybeSingle();
        if (wh) {
          await supabase.from("inventory").insert({
            product_id: product.id, warehouse_id: wh.id,
            quantity: newSKU.stock_quantity, reorder_level: newSKU.reorder_level || 10,
          });
        }
      }
      toast({ title: "Item added successfully" });
      setShowAddDialog(false);
      resetForm();
      fetchData();
    } catch (error) {
      console.error("Error adding item:", error);
      toast({ title: "Failed to add item", variant: "destructive" });
    }
  };

  const handleUpdateSKU = async () => {
    if (!editingSKU) return;
    try {
      const { error } = await (supabase as any)
        .from("products")
        .update({
          name: editingSKU.name, category: editingSKU.category,
          uom: editingSKU.unit_of_measure, price: editingSKU.cost_per_unit,
          cost_price: editingSKU.cost_per_unit,
        })
        .eq("sku_id", editingSKU.id);
      if (error) throw error;

      const original = skus.find(s => s.id === editingSKU.id)?.stock_quantity ?? 0;
      const delta = Number(editingSKU.stock_quantity) - Number(original);
      if (delta !== 0) {
        await applyStockMovement(editingSKU.id, delta, "stock_take", "Adjustment from item edit");
      }
      toast({ title: "Item updated successfully" });
      setEditingSKU(null);
      fetchData();
    } catch (error) {
      console.error("Error updating item:", error);
      toast({ title: "Failed to update item", variant: "destructive" });
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

  const handlePurchase = async () => {
    if (!purchaseForm.sku_id || purchaseForm.quantity <= 0) {
      toast({ title: "Please select an item and enter a valid quantity", variant: "destructive" });
      return;
    }
    try {
      setOperationLoading(true);
      await applyStockMovement(purchaseForm.sku_id, purchaseForm.quantity, "purchase", purchaseForm.notes || "Purchase");
      const { error } = await supabase.from("transactions").insert({
        transaction_type: "PURCHASE", sku_id: purchaseForm.sku_id,
        quantity: purchaseForm.quantity, unit_price: purchaseForm.unit_price || 0,
        total_amount: purchaseForm.quantity * (purchaseForm.unit_price || 0),
        notes: purchaseForm.notes || "", user_id: user!.id, created_by: user!.id,
      });
      if (error) throw error;
      toast({ title: "Purchase recorded successfully" });
      setPurchaseForm({ sku_id: "", quantity: 0, unit_price: 0, notes: "" });
      fetchData();
    } catch (error) {
      console.error("Purchase operation failed:", error);
      toast({ title: "Failed to record purchase", variant: "destructive" });
    } finally {
      setOperationLoading(false);
    }
  };

  const handleUsage = async () => {
    if (!usageForm.sku_id || usageForm.quantity <= 0) {
      toast({ title: "Please select an item and enter a valid quantity", variant: "destructive" });
      return;
    }
    try {
      setOperationLoading(true);
      const selectedSKU = skus.find(s => s.id === usageForm.sku_id);
      if (!selectedSKU) { toast({ title: "Item not found", variant: "destructive" }); return; }
      if (usageForm.quantity > selectedSKU.stock_quantity) { toast({ title: "Insufficient stock for this usage", variant: "destructive" }); return; }

      await applyStockMovement(usageForm.sku_id, -usageForm.quantity, "usage", usageForm.notes || "Usage/Consumption");
      const { error } = await supabase.from("transactions").insert({
        transaction_type: "SALE", sku_id: usageForm.sku_id,
        quantity: -usageForm.quantity, unit_price: selectedSKU.cost_per_unit,
        total_amount: usageForm.quantity * selectedSKU.cost_per_unit,
        notes: usageForm.notes || "Usage/Consumption", user_id: user!.id, created_by: user!.id,
      });
      if (error) throw error;
      toast({ title: "Usage recorded successfully" });
      setUsageForm({ sku_id: "", quantity: 0, notes: "" });
      fetchData();
    } catch (error) {
      console.error("Usage operation failed:", error);
      toast({ title: "Failed to record usage", variant: "destructive" });
    } finally {
      setOperationLoading(false);
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

  // Reorder: prefill the in-page purchase form and jump to the Purchase tab.
  const handleReorder = (sku: SKU) => {
    setPurchaseForm({
      sku_id: sku.id,
      quantity: Math.max(sku.reorder_level * 2 - sku.stock_quantity, sku.reorder_level, 1),
      unit_price: sku.cost_per_unit,
      notes: `Reorder for ${sku.name}`,
    });
    setActiveTab("purchase");
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

  const resetForm = () => setNewSKU({
    name: "", category: "proteins", unit_of_measure: "kg",
    stock_quantity: 0, reorder_level: 0, cost_per_unit: 0, notes: "",
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const filteredSKUs = useMemo(() => skus.filter(sku => {
    const matchesSearch = sku.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sku.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || sku.category === categoryFilter;
    const matchesArchive = showArchived ? sku.is_archived : !sku.is_archived;
    return matchesSearch && matchesCategory && matchesArchive;
  }), [skus, searchTerm, categoryFilter, showArchived]);

  const filteredMovements = useMemo(() =>
    movementFilter === "all" ? movements : movements.filter(m => m.movement_type === movementFilter),
    [movements, movementFilter]);

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
  const itemColumns: ResponsiveColumn<SKU>[] = [
    {
      key: "name", header: "Item", primary: true,
      cell: (sku) => <span className="font-medium">{sku.name}</span>,
    },
    {
      key: "category", header: "Category",
      cell: (sku) => {
        const c = getCategoryColor(sku.category);
        return <Badge className={`${c.bg} ${c.text} text-xs`}>{getCategoryLabel(sku.category)}</Badge>;
      },
    },
    { key: "uom", header: "UOM", cell: (sku) => <span className="text-muted-foreground">{sku.unit_of_measure}</span> },
    { key: "qty", header: "Qty", align: "right", cell: (sku) => <span className="font-medium">{sku.stock_quantity}</span> },
    { key: "reorder", header: "Reorder", align: "right", cell: (sku) => sku.reorder_level },
    { key: "cost", header: "Cost/Unit", align: "right", cell: (sku) => formatNairaCompact(sku.cost_per_unit) },
    { key: "value", header: "Value", align: "right", cell: (sku) => formatNairaCompact(sku.stock_quantity * sku.cost_per_unit) },
    {
      key: "status", header: "Status",
      cell: (sku) =>
        sku.stock_quantity <= 0 ? <Badge variant="destructive">Out of Stock</Badge>
          : sku.stock_quantity <= sku.reorder_level ? <Badge className="bg-orange-100 text-orange-700">Low Stock</Badge>
            : <Badge variant="secondary">In Stock</Badge>,
    },
    ...(isAdmin ? [{
      key: "actions", header: "", align: "right" as const, mobileFooter: true,
      cell: (sku: SKU) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="w-full md:w-auto justify-center">
              <MoreHorizontal className="h-4 w-4" />
              <span className="md:hidden ml-2">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {!sku.is_archived && (
              <DropdownMenuItem onClick={() => setEditingSKU(sku)}>
                <Edit2 className="h-3.5 w-3.5 mr-2" />Edit
              </DropdownMenuItem>
            )}
            {!sku.is_archived && (
              <>
                <DropdownMenuItem onClick={() => handleReorder(sku)}>
                  <ShoppingCart className="h-3.5 w-3.5 mr-2" />Quick Restock
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleOrderViaLPO(sku)}>
                  <ClipboardList className="h-3.5 w-3.5 mr-2" />Order via LPO
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {sku.is_archived ? (
              <DropdownMenuItem onClick={() => handleArchive(sku.id, false)} className="text-green-700 focus:text-green-700">
                <ArchiveRestore className="h-3.5 w-3.5 mr-2" />Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => handleArchive(sku.id, true)} className="text-amber-700 focus:text-amber-700">
                <Archive className="h-3.5 w-3.5 mr-2" />Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }] : []),
  ];

  // ── Movements table columns ──────────────────────────────────────────────────
  const movementColumns: ResponsiveColumn<Movement>[] = [
    {
      key: "item", header: "Item", primary: true,
      cell: (m) => <span className="font-medium">{m.products?.name ?? "—"}</span>,
    },
    {
      key: "type", header: "Type",
      cell: (m) => {
        const meta = movementMeta(m.movement_type);
        return <Badge variant="outline" className={`text-xs ${meta.cls}`}>{meta.label}</Badge>;
      },
    },
    {
      key: "change", header: "Change", align: "right",
      cell: (m) => (
        <span className={`font-medium ${Number(m.quantity_change) >= 0 ? "text-green-600" : "text-destructive"}`}>
          {Number(m.quantity_change) >= 0 ? "+" : ""}{m.quantity_change} {m.products?.uom ?? ""}
        </span>
      ),
    },
    {
      key: "date", header: "Date", align: "right",
      cell: (m) => <span className="text-sm text-muted-foreground">{format(new Date(m.occurred_on), "dd MMM yyyy")}</span>,
    },
    {
      key: "note", header: "Note", hideOnMobile: true,
      cell: (m) => <span className="text-sm text-muted-foreground max-w-xs truncate block">{m.note || "—"}</span>,
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Boxes className="h-7 w-7 text-primary" /> Inventory
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track stock levels, record movements, manage purchases and monitor usage
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && <RecordMovementDialog onDone={fetchData} />}
          <InventoryDailyReport />
          <Button variant="outline" size="sm" onClick={() => navigate("/business/inventory-requests")} className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Requests
            {pendingRequests > 0 && <Badge className="ml-0.5 px-1.5">{pendingRequests}</Badge>}
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowAddDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Add Item
            </Button>
          )}
        </div>
      </div>

      {/* ── KPI dashboard ── */}
      <InventoryKPICards skus={skus} transactions={transactions} />

      {/* ── Alerts + category breakdown ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2">
          <LowStockAlerts skus={skus} onReorder={isAdmin ? handleReorder : undefined} />
        </div>
        <div>
          <CategoryBreakdown skus={skus} />
        </div>
      </div>

      {/* ── Main tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
        <div>
          <TabsList>
            <TabsTrigger value="items" className="gap-1.5"><Package className="h-4 w-4" />Items</TabsTrigger>
            {isAdmin && <TabsTrigger value="purchase" className="gap-1.5"><ShoppingCart className="h-4 w-4" />Purchase</TabsTrigger>}
            {isAdmin && <TabsTrigger value="usage" className="gap-1.5"><TrendingDown className="h-4 w-4" />Usage</TabsTrigger>}
            {isAdmin && <TabsTrigger value="reconciliation" className="gap-1.5"><ClipboardCheck className="h-4 w-4" />Stock Take</TabsTrigger>}
            <TabsTrigger value="movements" className="gap-1.5"><ArrowRightLeft className="h-4 w-4" />Movements</TabsTrigger>
            <TabsTrigger value="analytics" className="gap-1.5"><LineChart className="h-4 w-4" />Analytics</TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5"><History className="h-4 w-4" />History</TabsTrigger>
          </TabsList>
        </div>

        {/* ── Items ── */}
        <TabsContent value="items" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center">
            <div className="relative flex-1 min-w-0 sm:min-w-48 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search items..." value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
            </div>
            <div className="flex items-center gap-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="flex-1 sm:w-44">
                  <Filter className="h-4 w-4 mr-2 shrink-0" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {INVENTORY_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant={showArchived ? "default" : "outline"} size="sm"
                onClick={() => setShowArchived(v => !v)} className="gap-2 shrink-0">
                <Archive className="h-4 w-4" />
                <span className="hidden sm:inline">{showArchived ? "Archived" : "Archived"}</span>
              </Button>
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setShowConversionDialog(true)} className="gap-2 shrink-0">
                  <ArrowRightLeft className="h-4 w-4" /><span className="hidden sm:inline">Units</span>
                </Button>
              )}
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {showArchived ? "Archived Items" : "Active Items"} ({filteredSKUs.length})
              </CardTitle>
              <CardDescription>
                {showArchived
                  ? "Archived items are excluded from requests and stock calculations."
                  : "All active inventory items available for requests and usage."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveTable
                columns={itemColumns}
                data={filteredSKUs}
                rowKey={(s) => s.id}
                emptyState={
                  <div className="flex flex-col items-center justify-center py-12 text-center gap-2 text-muted-foreground">
                    <Package className="h-8 w-8 opacity-40" />
                    <p className="text-sm">No items found.</p>
                  </div>
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Purchase ── */}
        {isAdmin && (
          <TabsContent value="purchase">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><ShoppingCart className="h-5 w-5" />Record Purchase</CardTitle>
                <CardDescription>Add items to inventory from suppliers</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Item</Label>
                    <Select value={purchaseForm.sku_id} onValueChange={(v) => setPurchaseForm({ ...purchaseForm, sku_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>
                        {skus.filter(s => !s.is_archived).map(sku => (
                          <SelectItem key={sku.id} value={sku.id}>{sku.name} — {sku.stock_quantity} {sku.unit_of_measure}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Quantity</Label>
                    <Input type="number" step="0.01" value={purchaseForm.quantity}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Unit Price (₦)</Label>
                    <Input type="number" step="0.01" value={purchaseForm.unit_price}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, unit_price: Number(e.target.value) })} />
                  </div>
                  <div className="flex items-end">
                    <div className="text-lg font-semibold">Total: {formatNairaCompact(purchaseForm.quantity * purchaseForm.unit_price)}</div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Notes (Supplier, Invoice #, etc.)</Label>
                  <Textarea value={purchaseForm.notes}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })} placeholder="Optional notes..." />
                </div>
                <Button onClick={handlePurchase} disabled={operationLoading} className="w-full sm:w-auto">
                  {operationLoading ? "Processing..." : "Record Purchase"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── Usage ── */}
        {isAdmin && (
          <TabsContent value="usage">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><TrendingDown className="h-5 w-5" />Record Usage / Consumption</CardTitle>
                <CardDescription>Track items used in production or events</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Item</Label>
                    <Select value={usageForm.sku_id} onValueChange={(v) => setUsageForm({ ...usageForm, sku_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>
                        {skus.filter(sku => sku.stock_quantity > 0 && !sku.is_archived).map(sku => (
                          <SelectItem key={sku.id} value={sku.id}>{sku.name} — {sku.stock_quantity} {sku.unit_of_measure} available</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Quantity Used</Label>
                    <Input type="number" step="0.01" value={usageForm.quantity}
                      onChange={(e) => setUsageForm({ ...usageForm, quantity: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Notes (Event, reason, etc.)</Label>
                  <Textarea value={usageForm.notes}
                    onChange={(e) => setUsageForm({ ...usageForm, notes: e.target.value })} placeholder="What was this used for..." />
                </div>
                <Button onClick={handleUsage} disabled={operationLoading} className="w-full sm:w-auto">
                  {operationLoading ? "Processing..." : "Record Usage"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── Stock Take ── */}
        {isAdmin && (
          <TabsContent value="reconciliation">
            <StockReconciliation skus={skus} stockTakes={stockTakes} onComplete={fetchData} />
          </TabsContent>
        )}

        {/* ── Movements ── */}
        <TabsContent value="movements" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Stock Movements</CardTitle>
                  <CardDescription>Every stock-in, usage and adjustment, newest first</CardDescription>
                </div>
                <Select value={movementFilter} onValueChange={setMovementFilter}>
                  <SelectTrigger className="w-full sm:w-44">
                    <Filter className="h-4 w-4 mr-2 shrink-0" />
                    <SelectValue placeholder="All movements" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Movements</SelectItem>
                    {Object.entries(MOVEMENT_META).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveTable
                columns={movementColumns}
                data={filteredMovements}
                rowKey={(m) => m.id}
                mobileSubtitle={(m) => m.note || undefined}
                emptyState={
                  <div className="flex flex-col items-center justify-center py-12 text-center gap-2 text-muted-foreground">
                    <ArrowRightLeft className="h-8 w-8 opacity-40" />
                    <p className="text-sm">No stock movements recorded yet.</p>
                  </div>
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Analytics ── */}
        <TabsContent value="analytics">
          <UsageAnalytics transactions={transactions} skus={skus} />
        </TabsContent>

        {/* ── History ── */}
        <TabsContent value="history" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportInventoryReport} className="gap-2">
              <ClipboardList className="h-4 w-4" /> Export Inventory CSV
            </Button>
          </div>
          <TransactionHistory transactions={transactions} />
        </TabsContent>
      </Tabs>

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
