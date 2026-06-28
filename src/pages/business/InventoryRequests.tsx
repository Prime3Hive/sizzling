import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus, Clock, CheckCircle2, XCircle, ShoppingCart,
  Search, ClipboardList, FileText, PackageCheck, Pencil,
} from "lucide-react";
import LPOSheet, { type SourceRequest } from "@/components/procurement/LPOSheet";
import { formatNairaCompact } from "@/lib/currency";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SKU {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  stock_quantity: number;
  cost_per_unit: number;
  is_archived: boolean;
}

interface RequestItem {
  id: string;
  sku_id: string | null;
  requested_quantity: number;
  fulfilled_quantity: number;
  note: string | null;
  kind: string | null;          // 'sku' | 'misc'
  item_name: string | null;     // description for misc lines
  amount: number | null;        // cost (₦) for misc lines
  skus: { name: string; unit_of_measure: string; category: string } | null;
}

interface InventoryRequest {
  id: string;
  user_id: string;
  sku_id: string | null;
  requested_quantity: number;
  fulfilled_quantity: number;
  status: string;
  request_date: string;
  fulfilled_date: string | null;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  purchase_cost: number | null;
  created_at: string;
  skus: { name: string; unit_of_measure: string; category: string } | null;
  profiles: { full_name: string } | null;
  inventory_request_items: RequestItem[] | null;
}

// A request always renders as a list of line items. For legacy rows with no
// child items yet, fall back to the single header item.
function itemsOf(r: InventoryRequest): RequestItem[] {
  if (r.inventory_request_items && r.inventory_request_items.length > 0) return r.inventory_request_items;
  return [{
    id: `${r.id}-legacy`,
    sku_id: r.sku_id,
    requested_quantity: r.requested_quantity,
    fulfilled_quantity: r.fulfilled_quantity,
    note: null,
    kind: 'sku',
    item_name: null,
    amount: null,
    skus: r.skus,
  }];
}

// A request line is a stock (SKU) line unless it is explicitly marked 'misc'.
const isMisc = (it: RequestItem) => it.kind === 'misc';

interface LinkedLPO {
  id: string;
  lpo_number: string;
  status: string;
  inventory_request_id: string;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending:   { label: "Pending",   color: "bg-amber-100  text-amber-700  border-amber-200",  icon: Clock },
  approved:  { label: "Approved",  color: "bg-blue-100   text-blue-700   border-blue-200",   icon: CheckCircle2 },
  rejected:  { label: "Rejected",  color: "bg-red-100    text-red-700    border-red-200",    icon: XCircle },
  fulfilled: { label: "Fulfilled", color: "bg-green-100  text-green-700  border-green-200",  icon: CheckCircle2 },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-muted text-muted-foreground border-border", icon: Clock };
  return <Badge className={`text-xs border ${cfg.color}`}>{cfg.label}</Badge>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InventoryRequests() {
  const { user } = useAuth();
  const { isAdmin, isManager, hasPermission } = useRoles();
  const { toast } = useToast();
  const qc = useQueryClient();

  const canManage         = isAdmin || isManager;
  const canRecordPurchase = isAdmin || isManager || hasPermission("inventory", "create");

  const [search, setSearch] = useState("");

  // New / edit request — one request can hold many item lines
  const [showNew, setShowNew] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<{ sku_id: string; quantity: string }[]>([{ sku_id: "", quantity: "" }]);
  const [miscItems, setMiscItems] = useState<{ description: string; quantity: string; amount: string }[]>([{ description: "", quantity: "", amount: "" }]);
  const [reqNotes, setReqNotes] = useState("");

  const setLine = (i: number, patch: Partial<{ sku_id: string; quantity: string }>) =>
    setLineItems(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLineItems(prev => [...prev, { sku_id: "", quantity: "" }]);
  const removeLine = (i: number) => setLineItems(prev => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const setMisc = (i: number, patch: Partial<{ description: string; quantity: string; amount: string }>) =>
    setMiscItems(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addMisc = () => setMiscItems(prev => [...prev, { description: "", quantity: "", amount: "" }]);
  const removeMisc = (i: number) => setMiscItems(prev => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  // Reject dialog
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Direct purchase (unchanged legacy path)
  const [purchaseTarget, setPurchaseTarget] = useState<InventoryRequest | null>(null);
  const [purchaseForm, setPurchaseForm] = useState({ fulfilled_quantity: "", purchase_cost: "", notes: "" });

  // LPO Sheet (new procurement path)
  const [lpoSheetOpen, setLpoSheetOpen] = useState(false);
  const [lpoSource, setLpoSource] = useState<SourceRequest | undefined>(undefined);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: skus = [] } = useQuery<SKU[]>({
    queryKey: ["inv-req-skus"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("skus")
        .select("id, name, category, unit_of_measure, stock_quantity, cost_per_unit, is_archived")
        .eq("is_archived", false)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: requests = [], isLoading } = useQuery<InventoryRequest[]>({
    queryKey: ["inventory-requests", user?.id, canManage],
    queryFn: async () => {
      let q = supabase
        .from("inventory_requests")
        .select(`
          id, user_id, sku_id, requested_quantity, fulfilled_quantity,
          status, request_date, fulfilled_date, notes,
          approved_by, approved_at, rejected_reason, purchase_cost, created_at,
          skus(name, unit_of_measure, category),
          inventory_request_items(id, sku_id, requested_quantity, fulfilled_quantity, note, kind, item_name, amount, skus(name, unit_of_measure, category))
        `)
        .order("created_at", { ascending: false });

      if (!canManage) q = q.eq("user_id", user!.id);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InventoryRequest[];
    },
    enabled: !!user,
  });

  // Fetch LPOs that were raised from inventory requests
  const { data: linkedLPOs = [] } = useQuery<LinkedLPO[]>({
    queryKey: ["inventory-request-lpos"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("lpos")
        .select("id, lpo_number, status, inventory_request_id")
        .not("inventory_request_id", "is", null);
      return (data ?? []) as LinkedLPO[];
    },
    staleTime: 2 * 60_000,
  });

  // Map: inventory_request_id → LinkedLPO
  const lpoByRequest = useMemo(
    () => Object.fromEntries(linkedLPOs.map(l => [l.inventory_request_id, l])),
    [linkedLPOs],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const submitRequest = useMutation({
    mutationFn: async () => {
      const validSku = lineItems
        .map(l => ({ sku_id: l.sku_id, quantity: parseInt(l.quantity) }))
        .filter(l => l.sku_id && l.quantity > 0);
      const validMisc = miscItems
        .map(m => ({ description: m.description.trim(), quantity: parseInt(m.quantity) || 1, amount: parseFloat(m.amount) || 0 }))
        .filter(m => m.description && m.amount > 0);
      if (validSku.length === 0 && validMisc.length === 0)
        throw new Error("Add at least one stock item or a miscellaneous item");

      // The header mirrors the first stock line for back-compat with legacy views/LPO.
      // A misc-only request keeps a null SKU header.
      const head = validSku[0] ?? null;
      const headQty = head?.quantity ?? validMisc.reduce((s, m) => s + m.quantity, 0);

      const itemRows = (requestId: string) => [
        ...validSku.map(l => ({ request_id: requestId, sku_id: l.sku_id, requested_quantity: l.quantity, kind: "sku" })),
        ...validMisc.map(m => ({ request_id: requestId, sku_id: null, requested_quantity: m.quantity, kind: "misc", item_name: m.description, amount: m.amount })),
      ];

      if (editId) {
        // Editing is only allowed while the request is still pending
        const { error: upErr } = await supabase.from("inventory_requests").update({
          sku_id:             head?.sku_id ?? null,
          requested_quantity: headQty,
          notes:              reqNotes || null,
        }).eq("id", editId).eq("status", "pending");
        if (upErr) throw upErr;
        // Replace the line items
        await supabase.from("inventory_request_items").delete().eq("request_id", editId);
        const { error: itErr } = await supabase.from("inventory_request_items").insert(itemRows(editId));
        if (itErr) throw itErr;
        return;
      }

      const { data: created, error } = await supabase.from("inventory_requests").insert({
        user_id:            user!.id,
        sku_id:             head?.sku_id ?? null,
        requested_quantity: headQty,
        current_quantity:   0,
        notes:              reqNotes || null,
        status:             "pending",
        request_date:       new Date().toISOString().slice(0, 10),
      }).select("id").single();
      if (error) throw error;
      const { error: itErr } = await supabase.from("inventory_request_items").insert(itemRows(created!.id));
      if (itErr) throw itErr;
    },
    onSuccess: () => {
      toast({ title: editId ? "Request updated" : "Request submitted", description: editId ? "Your changes have been saved." : "Your request has been sent to admin for approval." });
      setShowNew(false);
      setEditId(null);
      setLineItems([{ sku_id: "", quantity: "" }]);
      setMiscItems([{ description: "", quantity: "", amount: "" }]);
      setReqNotes("");
      qc.invalidateQueries({ queryKey: ["inventory-requests"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const openNew = () => {
    setEditId(null);
    setLineItems([{ sku_id: "", quantity: "" }]);
    setMiscItems([{ description: "", quantity: "", amount: "" }]);
    setReqNotes("");
    setShowNew(true);
  };
  const openEdit = (row: InventoryRequest) => {
    if (row.status !== "pending") return; // locked after approval
    setEditId(row.id);
    const items = itemsOf(row);
    const sku = items.filter(it => !isMisc(it) && it.sku_id);
    const misc = items.filter(isMisc);
    setLineItems(sku.length ? sku.map(it => ({ sku_id: it.sku_id ?? "", quantity: String(it.requested_quantity) })) : [{ sku_id: "", quantity: "" }]);
    setMiscItems(misc.length ? misc.map(it => ({ description: it.item_name ?? "", quantity: String(it.requested_quantity), amount: it.amount != null ? String(it.amount) : "" })) : [{ description: "", quantity: "", amount: "" }]);
    setReqNotes(row.notes ?? "");
    setShowNew(true);
  };

  const approveRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("inventory_requests").update({
        status:      "approved",
        approved_by: user!.id,
        approved_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Approved", description: "Request approved. You can now raise an LPO or record a direct purchase." });
      qc.invalidateQueries({ queryKey: ["inventory-requests"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const rejectRequest = useMutation({
    mutationFn: async () => {
      if (!rejectTarget) return;
      const { error } = await supabase.from("inventory_requests").update({
        status:          "rejected",
        approved_by:     user!.id,
        approved_at:     new Date().toISOString(),
        rejected_reason: rejectReason || null,
      }).eq("id", rejectTarget);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Rejected" });
      setRejectTarget(null);
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["inventory-requests"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // Direct (informal) purchase — unchanged legacy path
  const recordPurchase = useMutation({
    mutationFn: async () => {
      if (!purchaseTarget) return;
      const cost     = parseFloat(purchaseForm.purchase_cost) || null;
      const allLines = itemsOf(purchaseTarget);
      const skuItems = allLines.filter(it => !isMisc(it) && it.sku_id);
      const miscLines = allLines.filter(isMisc);
      if (skuItems.length === 0 && miscLines.length === 0)
        throw new Error("This request has nothing to fulfill");
      const today = new Date().toISOString().slice(0, 10);
      const skuQty = skuItems.reduce((s, it) => s + it.requested_quantity, 0);

      // Stock lines: restock and record a purchase transaction per item.
      for (const it of skuItems) {
        const sku = skus.find(s => s.id === it.sku_id);
        if (sku) {
          const { error: skuErr } = await supabase.from("skus").update({
            stock_quantity: sku.stock_quantity + it.requested_quantity,
          }).eq("id", it.sku_id!);
          if (skuErr) throw skuErr;
        }
        const lineCost = cost != null && skuQty > 0 ? (cost * it.requested_quantity) / skuQty : 0;
        await supabase.from("transactions").insert({
          sku_id:           it.sku_id,
          transaction_type: "PURCHASE",
          quantity:         it.requested_quantity,
          unit_price:       it.requested_quantity > 0 ? lineCost / it.requested_quantity : 0,
          total_amount:     lineCost,
          notes:            purchaseForm.notes || `Direct purchase from request #${purchaseTarget.id.slice(0, 8)}`,
          user_id:          user!.id,
        });
      }

      // Miscellaneous lines: capture as expenses (no restock).
      for (const it of miscLines) {
        const { error: expErr } = await supabase.from("expenses").insert({
          amount:       Number(it.amount ?? 0),
          description:  it.item_name || `Misc item from request #${purchaseTarget.id.slice(0, 8)}`,
          category:     "Inventory (misc)",
          date:         today,
          budget_id:    null,
          account_type: "COGS",
          cost_center:  "Daily Orders",
          created_by:   user!.id,
        });
        if (expErr) throw expErr;
      }

      // Mark each child line fulfilled (only when child rows exist)
      if (purchaseTarget.inventory_request_items?.length) {
        for (const it of [...skuItems, ...miscLines]) {
          await supabase.from("inventory_request_items").update({
            fulfilled_quantity: it.requested_quantity,
          }).eq("id", it.id);
        }
      }

      const { error: reqErr } = await supabase.from("inventory_requests").update({
        status:             "fulfilled",
        fulfilled_quantity: skuQty,
        fulfilled_date:     today,
        purchase_cost:      cost,
      }).eq("id", purchaseTarget.id);
      if (reqErr) throw reqErr;
    },
    onSuccess: () => {
      toast({ title: "Purchase recorded", description: "Stock updated and any miscellaneous items recorded as expenses." });
      setPurchaseTarget(null);
      setPurchaseForm({ fulfilled_quantity: "", purchase_cost: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["inventory-requests"] });
      qc.invalidateQueries({ queryKey: ["inv-req-skus"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  const openRaiseLPO = (row: InventoryRequest) => {
    const items = itemsOf(row).filter(it => !isMisc(it) && it.sku_id).map(it => {
      const sku = skus.find(s => s.id === it.sku_id);
      return {
        item_name:       it.skus?.name ?? sku?.name ?? "",
        sku_id:          it.sku_id,
        quantity:        it.requested_quantity,
        unit_of_measure: it.skus?.unit_of_measure ?? sku?.unit_of_measure ?? "unit",
        unit_price:      sku?.cost_per_unit ?? 0,
      };
    });
    const head = items[0];
    setLpoSource({
      id:              row.id,
      item_name:       head?.item_name ?? "",
      sku_id:          head?.sku_id ?? null,
      quantity:        head?.quantity ?? 0,
      unit_of_measure: head?.unit_of_measure ?? "unit",
      unit_price:      head?.unit_price ?? 0,
      items,
    });
    setLpoSheetOpen(true);
  };

  const openDirectPurchase = (row: InventoryRequest) => {
    setPurchaseTarget(row);
    setPurchaseForm({ fulfilled_quantity: String(row.requested_quantity), purchase_cost: "", notes: "" });
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered  = requests.filter(r => {
    const q = search.toLowerCase();
    return itemsOf(r).some(it => (it.skus?.name ?? "").toLowerCase().includes(q));
  });
  const pending   = requests.filter(r => r.status === "pending").length;
  const approved  = requests.filter(r => r.status === "approved").length;
  const fulfilled = requests.filter(r => r.status === "fulfilled").length;
  const byStatus  = (s: string) => filtered.filter(r => r.status === s);

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>
  );

  // ── Action buttons for approved rows ─────────────────────────────────────

  const ApprovedActions = ({ row }: { row: InventoryRequest }) => {
    const linked = lpoByRequest[row.id];
    if (!canRecordPurchase) return null;
    const hasSku = itemsOf(row).some(it => !isMisc(it) && it.sku_id);

    if (linked) {
      // LPO already raised — show its reference; block direct purchase
      const lpoStatusColors: Record<string, string> = {
        draft:              "text-slate-600 border-slate-200 bg-slate-50",
        sent:               "text-blue-700 border-blue-200 bg-blue-50",
        received:           "text-emerald-700 border-emerald-200 bg-emerald-50",
        partially_received: "text-amber-700 border-amber-200 bg-amber-50",
        cancelled:          "text-red-700 border-red-200 bg-red-50",
      };
      return (
        <div className="flex items-center gap-2 justify-end">
          <Badge
            variant="outline"
            className={`text-xs font-mono gap-1 ${lpoStatusColors[linked.status] ?? ""}`}
          >
            <FileText className="h-3 w-3" />
            {linked.lpo_number}
          </Badge>
          <span className="text-xs text-muted-foreground capitalize">
            {linked.status.replace(/_/g, " ")}
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 justify-end">
        {/* Primary: formal procurement via LPO — only when there are stock items */}
        {hasSku && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => openRaiseLPO(row)}
          >
            <FileText className="h-3.5 w-3.5" />
            Raise LPO
          </Button>
        )}

        {/* Secondary: direct informal purchase */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-muted-foreground"
              onClick={() => openDirectPurchase(row)}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              Direct
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            Record a direct purchase without creating an LPO. Use for informal or cash purchases.
          </TooltipContent>
        </Tooltip>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Inventory Requests</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {canManage
              ? "Review and approve staff requests, then raise an LPO or record a direct purchase."
              : "Submit requests for inventory items. Admin will review and approve."}
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />New Request
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total",     value: requests.length, color: "text-foreground" },
          { label: "Pending",   value: pending,          color: "text-amber-600" },
          { label: "Approved",  value: approved,         color: "text-blue-600" },
          { label: "Fulfilled", value: fulfilled,        color: "text-green-600" },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{k.label}</p>
              <p className={`text-3xl font-bold mt-1 ${k.color}`}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-10"
          placeholder="Search by item name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue={canManage ? "pending" : "mine"}>
        <TabsList>
          {canManage && (
            <TabsTrigger value="pending">
              Pending Approval
              {pending > 0 && <Badge className="ml-2 text-xs">{pending}</Badge>}
            </TabsTrigger>
          )}
          {canManage && (
            <TabsTrigger value="approved">
              Approved
              {approved > 0 && <Badge className="ml-2 text-xs">{approved}</Badge>}
            </TabsTrigger>
          )}
          <TabsTrigger value="mine">{canManage ? "All Requests" : "My Requests"}</TabsTrigger>
        </TabsList>

        {/* Pending tab — approve / reject */}
        {canManage && (
          <TabsContent value="pending" className="mt-4">
            <RequestsTable
              rows={byStatus("pending")}
              emptyMsg="No pending requests."
              actions={(row) => (
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                  </Button>
                  <Button size="sm" variant="outline"
                    className="text-green-700 border-green-300 hover:bg-green-50"
                    onClick={() => approveRequest.mutate(row.id)}
                    disabled={approveRequest.isPending}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve
                  </Button>
                  <Button size="sm" variant="outline"
                    className="text-red-700 border-red-300 hover:bg-red-50"
                    onClick={() => { setRejectTarget(row.id); setRejectReason(""); }}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />Reject
                  </Button>
                </div>
              )}
            />
          </TabsContent>
        )}

        {/* Approved tab — Raise LPO or direct purchase */}
        {canManage && (
          <TabsContent value="approved" className="mt-4">
            <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-2.5">
              <PackageCheck className="h-4 w-4 text-blue-600 shrink-0" />
              <span>
                <strong className="text-blue-700">Raise LPO</strong> to handle procurement formally through the LPO workflow, or use{" "}
                <strong>Direct</strong> for informal cash purchases. Once an LPO is raised, it must be completed through Procurement.
              </span>
            </div>
            <RequestsTable
              rows={byStatus("approved")}
              emptyMsg="No approved requests awaiting purchase."
              showRequester
              actions={(row) => <ApprovedActions row={row} />}
            />
          </TabsContent>
        )}

        {/* All / My requests */}
        <TabsContent value="mine" className="mt-4">
          <RequestsTable
            rows={filtered}
            emptyMsg={canManage ? "No requests found." : "You have not submitted any requests yet."}
            showRequester={canManage}
            lpoByRequest={lpoByRequest}
            actions={(row) => {
              if (row.status === "approved" && canRecordPurchase && canManage)
                return <ApprovedActions row={row} />;
              // Editable only while pending — locked once approved/rejected/fulfilled
              if (row.status === "pending" && (row.user_id === user!.id || canManage))
                return (
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                    </Button>
                  </div>
                );
              return null;
            }}
          />
        </TabsContent>
      </Tabs>

      {/* ── New / Edit Request Dialog ── */}
      <Dialog open={showNew} onOpenChange={(open) => { setShowNew(open); if (!open) setEditId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit Inventory Request" : "New Inventory Request"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <Tabs defaultValue="stock">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="stock">Stock items</TabsTrigger>
                <TabsTrigger value="misc">Miscellaneous</TabsTrigger>
              </TabsList>

              <TabsContent value="stock" className="mt-3 space-y-2">
                {lineItems.map((line, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <div className="flex-1">
                      <Select value={line.sku_id || undefined} onValueChange={v => setLine(i, { sku_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Select an item" /></SelectTrigger>
                        <SelectContent>
                          {skus.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name} — {s.stock_quantity} {s.unit_of_measure} in stock
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input className="w-24" type="number" min="1" placeholder="Qty" value={line.quantity}
                      onChange={e => setLine(i, { quantity: e.target.value })} />
                    <Button type="button" variant="ghost" size="icon" className="text-destructive shrink-0"
                      onClick={() => removeLine(i)} disabled={lineItems.length <= 1}>
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addLine}>
                  <Plus className="h-3.5 w-3.5" /> Add stock item
                </Button>
              </TabsContent>

              <TabsContent value="misc" className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">Items not in the stock list. These don't restock inventory — they're recorded as expenses when the request is purchased.</p>
                {miscItems.map((line, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <Input className="flex-1" placeholder="Item description" value={line.description}
                      onChange={e => setMisc(i, { description: e.target.value })} />
                    <Input className="w-20" type="number" min="1" placeholder="Qty" value={line.quantity}
                      onChange={e => setMisc(i, { quantity: e.target.value })} />
                    <Input className="w-28" type="number" min="0" step="0.01" placeholder="Amount ₦" value={line.amount}
                      onChange={e => setMisc(i, { amount: e.target.value })} />
                    <Button type="button" variant="ghost" size="icon" className="text-destructive shrink-0"
                      onClick={() => removeMisc(i)} disabled={miscItems.length <= 1}>
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addMisc}>
                  <Plus className="h-3.5 w-3.5" /> Add miscellaneous item
                </Button>
              </TabsContent>
            </Tabs>

            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={reqNotes}
                onChange={e => setReqNotes(e.target.value)}
                placeholder="Reason for request or additional details" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowNew(false); setEditId(null); }}>Cancel</Button>
            <Button onClick={() => submitRequest.mutate()} disabled={submitRequest.isPending}>
              {submitRequest.isPending ? "Saving…" : editId ? "Save Changes" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject Dialog ── */}
      <Dialog open={!!rejectTarget} onOpenChange={open => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reject Request</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Reason (optional)</Label>
            <Textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Provide a reason for rejection…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => rejectRequest.mutate()} disabled={rejectRequest.isPending}>
              {rejectRequest.isPending ? "Rejecting…" : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Direct Purchase Dialog (unchanged legacy path) ── */}
      <Dialog open={!!purchaseTarget} onOpenChange={open => !open && setPurchaseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Direct Purchase</DialogTitle>
          </DialogHeader>
          {purchaseTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 text-sm space-y-2">
                <p className="font-medium text-amber-800">
                  Direct purchase — no LPO will be created
                </p>
                <p className="text-muted-foreground">Stock items are received in full and restocked; miscellaneous items are recorded as expenses.</p>
                <ul className="space-y-1">
                  {itemsOf(purchaseTarget).map(it => (
                    <li key={it.id} className="text-foreground">
                      • {isMisc(it) ? (
                        <>
                          <span className="font-medium">{it.item_name ?? "—"}</span>
                          {" — "}{formatNairaCompact(Number(it.amount ?? 0))}
                          <span className="text-xs text-muted-foreground"> (expense)</span>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{it.skus?.name ?? "—"}</span>
                          {" — "}{it.requested_quantity} {it.skus?.unit_of_measure}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2">
                <Label>Total Purchase Cost (₦)</Label>
                <Input type="number" min="0" step="0.01" value={purchaseForm.purchase_cost}
                  onChange={e => setPurchaseForm(f => ({ ...f, purchase_cost: e.target.value }))}
                  placeholder="Optional — for cost tracking" />
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea rows={2} value={purchaseForm.notes}
                  onChange={e => setPurchaseForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurchaseTarget(null)}>Cancel</Button>
            <Button onClick={() => recordPurchase.mutate()} disabled={recordPurchase.isPending}>
              {recordPurchase.isPending ? "Recording…" : "Record & Update Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── LPO Sheet (procurement path) ── */}
      <LPOSheet
        mode="create"
        sourceRequest={lpoSource}
        open={lpoSheetOpen}
        onOpenChange={open => {
          setLpoSheetOpen(open);
          if (!open) setLpoSource(undefined);
        }}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ["inventory-requests"] });
          qc.invalidateQueries({ queryKey: ["inventory-request-lpos"] });
          qc.invalidateQueries({ queryKey: ["lpos"] });
          toast({
            title: "LPO created",
            description: "Continue the procurement process in the Procurement module.",
          });
        }}
      />
    </div>
  );
}

// ── RequestsTable ─────────────────────────────────────────────────────────────

function RequestsTable({
  rows,
  emptyMsg,
  showRequester = false,
  lpoByRequest = {},
  actions,
}: {
  rows: InventoryRequest[];
  emptyMsg: string;
  showRequester?: boolean;
  lpoByRequest?: Record<string, LinkedLPO>;
  actions?: (row: InventoryRequest) => React.ReactNode;
}) {
  const columns: ResponsiveColumn<InventoryRequest>[] = [
    {
      key: "item", header: "Item", primary: true,
      cell: (row) => (
        <div className="space-y-1">
          {itemsOf(row).map(it => (
            <div key={it.id}>
              {isMisc(it) ? (
                <>
                  <span className="font-medium">{it.item_name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground"> · misc{it.amount != null ? ` · ${formatNairaCompact(it.amount)}` : ""}</span>
                </>
              ) : (
                <>
                  <span className="font-medium">{it.skus?.name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground capitalize"> · {it.skus?.category}</span>
                </>
              )}
            </div>
          ))}
        </div>
      ),
    },
    ...(showRequester ? [{
      key: "requester", header: "Requester",
      cell: (row: InventoryRequest) => (
        <span className="text-sm text-muted-foreground">{row.profiles?.full_name ?? `${row.user_id.slice(0, 8)}…`}</span>
      ),
    } as ResponsiveColumn<InventoryRequest>] : []),
    {
      key: "qty", header: "Qty",
      cell: (row) => (
        <div className="space-y-1">
          {itemsOf(row).map(it => (
            <div key={it.id} className="whitespace-nowrap">
              {it.fulfilled_quantity > 0
                ? <><span className="font-semibold">{it.fulfilled_quantity}</span><span className="text-muted-foreground">/{it.requested_quantity}</span></>
                : it.requested_quantity}{" "}
              <span className="text-xs text-muted-foreground">{it.skus?.unit_of_measure}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      key: "date", header: "Date",
      cell: (row) => <span className="text-sm text-muted-foreground whitespace-nowrap">{format(parseISO(row.created_at), "dd MMM yyyy")}</span>,
    },
    {
      key: "status", header: "Status",
      cell: (row) => {
        const linked = lpoByRequest[row.id];
        return (
          <div className="flex flex-col gap-1">
            <StatusBadge status={row.status} />
            {linked && row.status !== "fulfilled" && (
              <Badge variant="outline" className="text-[10px] font-mono gap-1 text-indigo-700 border-indigo-200 bg-indigo-50 w-fit">
                <FileText className="h-2.5 w-2.5" />{linked.lpo_number}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "notes", header: "Notes", hideOnMobile: true,
      cell: (row) => (
        <span className="max-w-xs truncate text-sm text-muted-foreground block">
          {row.rejected_reason
            ? <span className="text-red-600 text-xs">Rejected: {row.rejected_reason}</span>
            : (row.notes || "—")}
        </span>
      ),
    },
    ...(actions ? [{
      key: "action", header: "Action", align: "right" as const, mobileFooter: true,
      cell: (row: InventoryRequest) => actions(row),
    } as ResponsiveColumn<InventoryRequest>] : []),
  ];

  return (
    <Card>
      <CardContent className="p-0 md:p-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2">
            <ClipboardList className="h-8 w-8 opacity-30" />
            <p className="text-sm">{emptyMsg}</p>
          </div>
        ) : (
          <div className="px-3 md:px-0">
            <ResponsiveTable columns={columns} data={rows} rowKey={(r) => r.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
