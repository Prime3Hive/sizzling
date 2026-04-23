import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { useToast } from "@/hooks/use-toast";
import { formatNairaCompact } from "@/lib/currency";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Package, Clock, CheckCircle2, XCircle, ShoppingCart,
  Search, ClipboardList,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────

interface SKU {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  stock_quantity: number;
  cost_per_unit: number;
  is_archived: boolean;
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
}

// ── Helpers ────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending:   { label: "Pending",   color: "bg-amber-100  text-amber-700  border-amber-200",  icon: Clock },
  approved:  { label: "Approved",  color: "bg-blue-100   text-blue-700   border-blue-200",   icon: CheckCircle2 },
  rejected:  { label: "Rejected",  color: "bg-red-100    text-red-700    border-red-200",    icon: XCircle },
  fulfilled: { label: "Fulfilled", color: "bg-green-100  text-green-700  border-green-200",  icon: CheckCircle2 },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-muted text-muted-foreground", icon: Clock };
  return (
    <Badge className={`text-xs border ${cfg.color}`}>{cfg.label}</Badge>
  );
}

// ── Component ──────────────────────────────────────────────────────

export default function InventoryRequests() {
  const { user } = useAuth();
  const { isAdmin, isManager, hasPermission } = useRoles();
  const { toast } = useToast();
  const qc = useQueryClient();

  const canManage = isAdmin || isManager;
  const canRecordPurchase = isAdmin || isManager || hasPermission("inventory", "create");

  const [search, setSearch] = useState("");

  // New request dialog
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ sku_id: "", quantity: "", notes: "" });

  // Reject dialog
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // Record purchase dialog
  const [purchaseTarget, setPurchaseTarget] = useState<InventoryRequest | null>(null);
  const [purchaseForm, setPurchaseForm] = useState({ fulfilled_quantity: "", purchase_cost: "", notes: "" });

  // ── Queries ───────────────────────────────────────────────────────

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
          skus(name, unit_of_measure, category)
        `)
        .order("created_at", { ascending: false });

      if (!canManage) q = q.eq("user_id", user!.id);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InventoryRequest[];
    },
    enabled: !!user,
  });

  // ── Mutations ─────────────────────────────────────────────────────

  const submitRequest = useMutation({
    mutationFn: async () => {
      if (!newForm.sku_id || !newForm.quantity) throw new Error("Select an item and quantity");
      const { error } = await supabase.from("inventory_requests").insert({
        user_id:            user!.id,
        sku_id:             newForm.sku_id,
        requested_quantity: parseInt(newForm.quantity),
        current_quantity:   0,
        notes:              newForm.notes || null,
        status:             "pending",
        request_date:       new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Request submitted", description: "Your request has been sent to admin for approval." });
      setShowNew(false);
      setNewForm({ sku_id: "", quantity: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["inventory-requests"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

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
      toast({ title: "Approved", description: "Request has been approved." });
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
      toast({ title: "Rejected", description: "Request has been rejected." });
      setRejectTarget(null);
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["inventory-requests"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const recordPurchase = useMutation({
    mutationFn: async () => {
      if (!purchaseTarget) return;
      const qty = parseInt(purchaseForm.fulfilled_quantity);
      const cost = parseFloat(purchaseForm.purchase_cost) || null;
      if (!qty || qty <= 0) throw new Error("Enter a valid quantity");

      // 1. Mark request fulfilled
      const { error: reqErr } = await supabase.from("inventory_requests").update({
        status:             "fulfilled",
        fulfilled_quantity: qty,
        fulfilled_date:     new Date().toISOString().slice(0, 10),
        purchase_cost:      cost,
      }).eq("id", purchaseTarget.id);
      if (reqErr) throw reqErr;

      // 2. Update SKU stock
      if (purchaseTarget.sku_id) {
        const sku = skus.find(s => s.id === purchaseTarget.sku_id);
        if (sku) {
          const { error: skuErr } = await supabase.from("skus").update({
            stock_quantity: sku.stock_quantity + qty,
          }).eq("id", purchaseTarget.sku_id);
          if (skuErr) throw skuErr;
        }

        // 3. Record transaction
        await supabase.from("transactions").insert({
          sku_id:           purchaseTarget.sku_id,
          transaction_type: "PURCHASE",
          quantity:         qty,
          unit_price:       cost ? cost / qty : 0,
          total_amount:     cost ?? 0,
          notes:            purchaseForm.notes || `Purchase from request #${purchaseTarget.id.slice(0, 8)}`,
          user_id:          user!.id,
        });
      }
    },
    onSuccess: () => {
      toast({ title: "Purchase recorded", description: "Stock has been updated." });
      setPurchaseTarget(null);
      setPurchaseForm({ fulfilled_quantity: "", purchase_cost: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["inventory-requests"] });
      qc.invalidateQueries({ queryKey: ["inv-req-skus"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  // ── Derived data ──────────────────────────────────────────────────

  const filtered = requests.filter(r => {
    const name = r.skus?.name ?? "";
    return name.toLowerCase().includes(search.toLowerCase());
  });

  const pending   = requests.filter(r => r.status === "pending").length;
  const approved  = requests.filter(r => r.status === "approved").length;
  const fulfilled = requests.filter(r => r.status === "fulfilled").length;

  const byStatus = (s: string) => filtered.filter(r => r.status === s);

  // ── Render ─────────────────────────────────────────────────────────

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Inventory Requests</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {canManage
              ? "Review and approve staff inventory requests, then record purchases."
              : "Submit requests for inventory items. Admin will review and approve."}
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>
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
        <Input className="pl-10" placeholder="Search by item name…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue={canManage ? "pending" : "mine"}>
        <TabsList>
          {canManage && <TabsTrigger value="pending">Pending Approval <Badge className="ml-2 text-xs">{pending}</Badge></TabsTrigger>}
          {canManage && <TabsTrigger value="approved">Approved <Badge className="ml-2 text-xs">{approved}</Badge></TabsTrigger>}
          <TabsTrigger value="mine">{canManage ? "All Requests" : "My Requests"}</TabsTrigger>
        </TabsList>

        {/* Pending approval — admin/manager only */}
        {canManage && (
          <TabsContent value="pending" className="mt-4">
            <RequestsTable
              rows={byStatus("pending")}
              emptyMsg="No pending requests."
              actions={(row) => (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50"
                    onClick={() => approveRequest.mutate(row.id)} disabled={approveRequest.isPending}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve
                  </Button>
                  <Button size="sm" variant="outline" className="text-red-700 border-red-300 hover:bg-red-50"
                    onClick={() => { setRejectTarget(row.id); setRejectReason(""); }}>
                    <XCircle className="h-3.5 w-3.5 mr-1" />Reject
                  </Button>
                </div>
              )}
            />
          </TabsContent>
        )}

        {/* Approved — ready to record purchase */}
        {canManage && (
          <TabsContent value="approved" className="mt-4">
            <RequestsTable
              rows={byStatus("approved")}
              emptyMsg="No approved requests awaiting purchase."
              actions={(row) => canRecordPurchase ? (
                <Button size="sm" onClick={() => {
                  setPurchaseTarget(row);
                  setPurchaseForm({ fulfilled_quantity: String(row.requested_quantity), purchase_cost: "", notes: "" });
                }}>
                  <ShoppingCart className="h-3.5 w-3.5 mr-1" />Record Purchase
                </Button>
              ) : null}
            />
          </TabsContent>
        )}

        {/* All / My requests */}
        <TabsContent value="mine" className="mt-4">
          <RequestsTable
            rows={filtered}
            emptyMsg={canManage ? "No requests found." : "You have not submitted any requests yet."}
            showRequester={canManage}
            actions={(row) =>
              row.status === "approved" && canRecordPurchase ? (
                <Button size="sm" variant="outline" onClick={() => {
                  setPurchaseTarget(row);
                  setPurchaseForm({ fulfilled_quantity: String(row.requested_quantity), purchase_cost: "", notes: "" });
                }}>
                  <ShoppingCart className="h-3.5 w-3.5 mr-1" />Record Purchase
                </Button>
              ) : null
            }
          />
        </TabsContent>
      </Tabs>

      {/* ── New Request Dialog ── */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Inventory Request</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Item</Label>
              <Select value={newForm.sku_id} onValueChange={v => setNewForm(f => ({ ...f, sku_id: v }))}>
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
            <div className="space-y-2">
              <Label>Quantity Requested</Label>
              <Input type="number" min="1" value={newForm.quantity}
                onChange={e => setNewForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={newForm.notes}
                onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Reason for request or additional details" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
            <Button onClick={() => submitRequest.mutate()} disabled={submitRequest.isPending}>
              {submitRequest.isPending ? "Submitting…" : "Submit Request"}
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

      {/* ── Record Purchase Dialog ── */}
      <Dialog open={!!purchaseTarget} onOpenChange={open => !open && setPurchaseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Purchase</DialogTitle>
          </DialogHeader>
          {purchaseTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted/40 border px-4 py-3 text-sm space-y-1">
                <p><span className="text-muted-foreground">Item:</span> <span className="font-medium">{purchaseTarget.skus?.name}</span></p>
                <p><span className="text-muted-foreground">Requested:</span> {purchaseTarget.requested_quantity} {purchaseTarget.skus?.unit_of_measure}</p>
              </div>
              <div className="space-y-2">
                <Label>Quantity Purchased</Label>
                <Input type="number" min="1" value={purchaseForm.fulfilled_quantity}
                  onChange={e => setPurchaseForm(f => ({ ...f, fulfilled_quantity: e.target.value }))} />
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
    </div>
  );
}

// ── RequestsTable sub-component ────────────────────────────────────

function RequestsTable({
  rows,
  emptyMsg,
  showRequester = false,
  actions,
}: {
  rows: InventoryRequest[];
  emptyMsg: string;
  showRequester?: boolean;
  actions?: (row: InventoryRequest) => React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-muted-foreground gap-2">
            <ClipboardList className="h-8 w-8 opacity-30" />
            <p className="text-sm">{emptyMsg}</p>
          </div>
        ) : (
          <div className="rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  {showRequester && <TableHead>Requester</TableHead>}
                  <TableHead>Qty</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                  {actions && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.skus?.name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground capitalize">{row.skus?.category}</div>
                    </TableCell>
                    {showRequester && (
                      <TableCell className="text-sm text-muted-foreground">
                        {row.user_id.slice(0, 8)}…
                      </TableCell>
                    )}
                    <TableCell>
                      {row.fulfilled_quantity > 0
                        ? <><span className="font-semibold">{row.fulfilled_quantity}</span><span className="text-muted-foreground">/{row.requested_quantity}</span></>
                        : row.requested_quantity
                      } <span className="text-xs text-muted-foreground">{row.skus?.unit_of_measure}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(parseISO(row.created_at), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {row.rejected_reason
                        ? <span className="text-red-600 text-xs">Rejected: {row.rejected_reason}</span>
                        : (row.notes || "—")}
                    </TableCell>
                    {actions && (
                      <TableCell className="text-right">{actions(row)}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
