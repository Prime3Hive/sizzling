import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeftRight, Loader2 } from "lucide-react";

interface Props {
  onDone?: () => void;
}

const TYPES: Record<string, { label: string; movement: string; sign: number }> = {
  in:         { label: "Stock In (received / purchase)", movement: "purchase",   sign:  1 },
  out:        { label: "Stock Out (usage / consumption)", movement: "usage",      sign: -1 },
  adjust_in:  { label: "Adjustment — increase",           movement: "adjustment", sign:  1 },
  adjust_out: { label: "Adjustment — decrease",           movement: "adjustment", sign: -1 },
};

export default function RecordMovementDialog({ onDone }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [type, setType] = useState<keyof typeof TYPES>("in");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["products-for-movement"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("products")
        .select("id, name, uom, item_type, inventory(quantity)")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        id: p.id, name: p.name, uom: p.uom || "unit", item_type: p.item_type,
        stock: (p.inventory || []).reduce((s: number, r: any) => s + Number(r.quantity || 0), 0),
      }));
    },
  });

  const reset = () => { setProductId(""); setType("in"); setQty(""); setNote(""); };

  const submit = async () => {
    const product = products.find((p: any) => p.id === productId);
    const amount = parseFloat(qty) || 0;
    if (!product) { toast({ title: "Select an item", variant: "destructive" }); return; }
    if (amount <= 0) { toast({ title: "Enter a quantity greater than zero", variant: "destructive" }); return; }
    const cfg = TYPES[type];
    const delta = amount * cfg.sign;

    setSaving(true);
    try {
      // resolve the warehouse holding the most stock for this product, else the first
      const { data: invRow } = await supabase.from("inventory")
        .select("id, warehouse_id, quantity").eq("product_id", product.id)
        .order("quantity", { ascending: false }).limit(1).maybeSingle();
      let warehouseId = invRow?.warehouse_id ?? null;
      if (invRow) {
        await supabase.from("inventory").update({ quantity: Number(invRow.quantity) + delta }).eq("id", invRow.id);
      } else {
        const { data: wh } = await supabase.from("warehouses").select("id").limit(1).maybeSingle();
        if (wh) {
          warehouseId = wh.id;
          await supabase.from("inventory").insert({ product_id: product.id, warehouse_id: wh.id, quantity: Math.max(delta, 0), reorder_level: 10 });
        }
      }
      const { error } = await (supabase as any).from("inventory_movements").insert({
        product_id: product.id, warehouse_id: warehouseId, movement_type: cfg.movement,
        quantity_change: delta, reference_type: "manual",
        occurred_on: new Date().toISOString().split("T")[0],
        note: note.trim() || cfg.label, created_by: user?.id,
      });
      if (error) throw error;

      toast({ title: "Stock movement recorded", description: `${product.name}: ${delta > 0 ? "+" : ""}${delta} ${product.uom}` });
      setOpen(false); reset(); onDone?.();
    } catch (e: any) {
      toast({ title: "Could not record movement", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const selected = products.find((p: any) => p.id === productId);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ArrowLeftRight className="h-4 w-4 mr-2" /> Record Movement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Stock Movement</DialogTitle>
          <DialogDescription>Stock in (purchase), stock out (usage) or an adjustment. Updates inventory and the movement ledger.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Item</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Select an item…" /></SelectTrigger>
              <SelectContent>
                {products.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.stock} {p.uom}{p.item_type === "non_sellable" ? " · non-sellable" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Movement type</Label>
            <Select value={type} onValueChange={(v) => setType(v as keyof typeof TYPES)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TYPES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Quantity {selected ? `(${selected.uom})` : ""}</Label>
            <Input type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
            {selected && <p className="text-xs text-muted-foreground">Current stock at hand: {selected.stock} {selected.uom}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Reason / note</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. event prep, supplier delivery, count correction…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
