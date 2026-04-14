import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Package, FileSpreadsheet, FileText, Filter, X } from "lucide-react";
import { formatNairaCompact } from "@/lib/currency";
import NJCSupplyDialog, { defaultFormData } from "@/components/njc/NJCSupplyDialog";
import { exportToExcel, exportToWord, type NJCSupplyWithItems, type NJCSupplyItem } from "@/lib/njcExport";

const NJCSupplies = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<ReturnType<typeof defaultFormData> | undefined>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Fetch supplies with their items
  const { data: supplies, isLoading } = useQuery({
    queryKey: ["njc-supplies-full"],
    queryFn: async () => {
      const { data: supplyData, error } = await supabase
        .from("njc_supplies")
        .select("*")
        .order("supply_date", { ascending: false });
      if (error) throw error;

      const suppliesList = (supplyData || []) as unknown as NJCSupplyWithItems[];
      const supplyIds = suppliesList.map((s) => s.id);
      let itemsData: NJCSupplyItem[] = [];
      if (supplyIds.length > 0) {
        const { data, error: itemsError } = await supabase
          .from("njc_supply_items")
          .select("*")
          .in("supply_id", supplyIds)
          .order("item_date", { ascending: true });
        if (itemsError) throw itemsError;
        itemsData = data || [];
      }

      return suppliesList.map((s) => ({
        ...s,
        items: itemsData.filter((i) => i.supply_id === s.id),
      }));
    },
  });

  // Filtered supplies
  const filteredSupplies = useMemo(() => {
    if (!supplies) return [];
    return supplies.filter((s) => {
      if (dateFrom && s.supply_date < dateFrom) return false;
      if (dateTo && s.supply_date > dateTo) return false;
      if (statusFilter !== "all" && s.payment_status !== statusFilter) return false;
      return true;
    });
  }, [supplies, dateFrom, dateTo, statusFilter]);

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setStatusFilter("all");
  };

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (formData: ReturnType<typeof defaultFormData>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be logged in");

      const items = formData.items.map((i) => ({
        per_head_price: parseFloat(i.per_head_price) || 0,
        number_of_persons: parseInt(i.number_of_persons) || 0,
      }));
      const subtotal = items.reduce((s, i) => s + i.per_head_price * i.number_of_persons, 0);
      const scPct = parseFloat(formData.service_charge_percent) || 0;
      const vatPct = parseFloat(formData.vat_percent) || 0;
      const scAmt = subtotal * (scPct / 100);
      const vatAmt = (subtotal + scAmt) * (vatPct / 100);
      const total = subtotal + scAmt + vatAmt;

      const { data: supply, error } = await supabase.from("njc_supplies").insert({
        supply_date: formData.supply_date,
        invoice_title: formData.invoice_title,
        payment_status: formData.payment_status,
        supply_details: formData.supply_details,
        number_of_supplies: formData.items.length,
        subtotal,
        service_charge_percent: scPct,
        service_charge_amount: scAmt,
        vat_percent: vatPct,
        vat_amount: vatAmt,
        total_amount: total,
        user_id: user.id,
      }).select().single();
      if (error) throw error;

      if (formData.items.length > 0) {
        const { error: itemsError } = await supabase.from("njc_supply_items").insert(
          formData.items.map((i) => ({
            supply_id: (supply as { id: string }).id,
            item_date: i.item_date,
            description: i.description,
            per_head_price: parseFloat(i.per_head_price) || 0,
            number_of_persons: parseInt(i.number_of_persons) || 0,
            line_total: (parseFloat(i.per_head_price) || 0) * (parseInt(i.number_of_persons) || 0),
          }))
        );
        if (itemsError) throw itemsError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["njc-supplies-full"] });
      toast({ title: "Success", description: "Invoice created successfully" });
      setIsDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, formData }: { id: string; formData: ReturnType<typeof defaultFormData> }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be logged in");

      const items = formData.items.map((i) => ({
        per_head_price: parseFloat(i.per_head_price) || 0,
        number_of_persons: parseInt(i.number_of_persons) || 0,
      }));
      const subtotal = items.reduce((s, i) => s + i.per_head_price * i.number_of_persons, 0);
      const scPct = parseFloat(formData.service_charge_percent) || 0;
      const vatPct = parseFloat(formData.vat_percent) || 0;
      const scAmt = subtotal * (scPct / 100);
      const vatAmt = (subtotal + scAmt) * (vatPct / 100);
      const total = subtotal + scAmt + vatAmt;

      const { error } = await supabase.from("njc_supplies").update({
        supply_date: formData.supply_date,
        invoice_title: formData.invoice_title,
        payment_status: formData.payment_status,
        supply_details: formData.supply_details,
        number_of_supplies: formData.items.length,
        subtotal,
        service_charge_percent: scPct,
        service_charge_amount: scAmt,
        vat_percent: vatPct,
        vat_amount: vatAmt,
        total_amount: total,
      }).eq("id", id);
      if (error) throw error;

      // Delete old items and re-insert
      await supabase.from("njc_supply_items").delete().eq("supply_id", id);
      if (formData.items.length > 0) {
        const { error: itemsError } = await supabase.from("njc_supply_items").insert(
          formData.items.map((i) => ({
            supply_id: id,
            item_date: i.item_date,
            description: i.description,
            per_head_price: parseFloat(i.per_head_price) || 0,
            number_of_persons: parseInt(i.number_of_persons) || 0,
            line_total: (parseFloat(i.per_head_price) || 0) * (parseInt(i.number_of_persons) || 0),
          }))
        );
        if (itemsError) throw itemsError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["njc-supplies-full"] });
      toast({ title: "Success", description: "Invoice updated successfully" });
      setIsDialogOpen(false);
      setEditingId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("njc_supplies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["njc-supplies-full"] });
      toast({ title: "Success", description: "Invoice deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleEdit = (supply: NJCSupplyWithItems) => {
    setEditingId(supply.id);
    setEditFormData({
      supply_date: supply.supply_date,
      invoice_title: supply.invoice_title || "PROVISION OF SNACKS",
      payment_status: supply.payment_status,
      supply_details: supply.supply_details,
      service_charge_percent: supply.service_charge_percent?.toString() || "15",
      vat_percent: supply.vat_percent?.toString() || "7.5",
      items: supply.items.length > 0
        ? supply.items.map((i) => ({
            id: i.id,
            item_date: i.item_date,
            description: i.description,
            per_head_price: i.per_head_price.toString(),
            number_of_persons: i.number_of_persons.toString(),
          }))
        : [{ item_date: supply.supply_date, description: "", per_head_price: "", number_of_persons: "" }],
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (formData: ReturnType<typeof defaultFormData>) => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this invoice?")) {
      deleteMutation.mutate(id);
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  // Selection
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredSupplies.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredSupplies.map((s) => s.id)));
    }
  };

  const getExportData = (): NJCSupplyWithItems[] => {
    const ids = selectedIds.size > 0 ? selectedIds : new Set(filteredSupplies.map((s) => s.id));
    return filteredSupplies.filter((s) => ids.has(s.id));
  };

  const getPaymentBadge = (status: string) => {
    const styles: Record<string, string> = {
      paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      partial: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
      failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    };
    return styles[status] || styles.pending;
  };

  const hasActiveFilters = dateFrom || dateTo || statusFilter !== "all";

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Package className="h-8 w-8" /> NJC Supplies
          </h1>
          <p className="text-muted-foreground mt-1">Manage NJC supply invoices with line items</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" disabled={filteredSupplies.length === 0} onClick={() => exportToExcel(getExportData())}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </Button>
          <Button variant="outline" size="sm" disabled={filteredSupplies.length === 0} onClick={() => exportToWord(getExportData())}>
            <FileText className="h-4 w-4 mr-1" /> Word {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </Button>
          <Button onClick={() => { setEditingId(null); setEditFormData(undefined); setIsDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" /> New Invoice
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Filter className="h-4 w-4" /> Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" className="w-40 h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" className="w-40 h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}><X className="h-4 w-4 mr-1" /> Clear</Button>
            )}
            {selectedIds.size > 0 && (
              <span className="text-sm text-muted-foreground ml-auto">{selectedIds.size} selected</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Supply records */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>
            {filteredSupplies.length} invoice{filteredSupplies.length !== 1 ? "s" : ""}
            {hasActiveFilters ? " (filtered)" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading...</div>
          ) : filteredSupplies.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.size === filteredSupplies.length && filteredSupplies.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead>Subtotal</TableHead>
                  <TableHead>Grand Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSupplies.map((supply) => (
                  <TableRow key={supply.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(supply.id)}
                        onCheckedChange={() => toggleSelect(supply.id)}
                      />
                    </TableCell>
                    <TableCell>{new Date(supply.supply_date).toLocaleDateString()}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{supply.invoice_title || "PROVISION OF SNACKS"}</TableCell>
                    <TableCell className="text-center">{supply.items.length || supply.number_of_supplies}</TableCell>
                    <TableCell>{formatNairaCompact(supply.subtotal || 0)}</TableCell>
                    <TableCell className="font-semibold">{formatNairaCompact(supply.total_amount)}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getPaymentBadge(supply.payment_status)}`}>
                        {supply.payment_status.charAt(0).toUpperCase() + supply.payment_status.slice(1)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleEdit(supply)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(supply.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {hasActiveFilters ? "No invoices match the current filters." : "No invoices found. Create your first invoice to get started."}
            </div>
          )}
        </CardContent>
      </Card>

      <NJCSupplyDialog
        open={isDialogOpen}
        onOpenChange={(v) => { setIsDialogOpen(v); if (!v) setEditingId(null); }}
        initialData={editFormData}
        isEditing={!!editingId}
        isPending={createMutation.isPending || updateMutation.isPending}
        onSubmit={handleSubmit}
      />
    </div>
  );
};

export default NJCSupplies;
