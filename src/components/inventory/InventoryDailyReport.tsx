import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarDays, Download, Loader2 } from "lucide-react";

interface Row {
  product_id: string;
  name: string;
  uom: string;
  item_type: string;
  sold: number;
  used: number;
  received: number;
  available: number;
}

export default function InventoryDailyReport() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const { data, isLoading } = useQuery({
    queryKey: ["inventory-daily-report", date],
    enabled: open,
    queryFn: async () => {
      const [prodRes, moveRes, invRes] = await Promise.all([
        supabase.from("products").select("id, name, uom, item_type"),
        (supabase as any).from("inventory_movements")
          .select("product_id, movement_type, quantity_change")
          .eq("occurred_on", date),
        supabase.from("inventory").select("product_id, quantity"),
      ]);
      if (prodRes.error) throw prodRes.error;
      return {
        products: prodRes.data ?? [],
        moves: (moveRes as any).data ?? [],
        inv: invRes.data ?? [],
      };
    },
  });

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const onHand: Record<string, number> = {};
    (data.inv as any[]).forEach((i) => { onHand[i.product_id] = (onHand[i.product_id] ?? 0) + Number(i.quantity); });

    const agg: Record<string, { sold: number; used: number; received: number }> = {};
    (data.moves as any[]).forEach((m) => {
      if (!agg[m.product_id]) agg[m.product_id] = { sold: 0, used: 0, received: 0 };
      const q = Number(m.quantity_change);
      if (m.movement_type === "sale") agg[m.product_id].sold += -q;
      else if (m.movement_type === "usage") agg[m.product_id].used += -q;
      else if (q > 0) agg[m.product_id].received += q;
    });

    return (data.products as any[])
      .map((p) => ({
        product_id: p.id,
        name: p.name,
        uom: p.uom || "pcs",
        item_type: p.item_type || "sellable",
        sold: agg[p.id]?.sold ?? 0,
        used: agg[p.id]?.used ?? 0,
        received: agg[p.id]?.received ?? 0,
        available: onHand[p.id] ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const totals = useMemo(() => ({
    sold: rows.reduce((s, r) => s + r.sold, 0),
    used: rows.reduce((s, r) => s + r.used, 0),
    received: rows.reduce((s, r) => s + r.received, 0),
  }), [rows]);

  const exportCSV = () => {
    const lines = [
      `Daily Inventory Report,${date}`,
      "",
      "Item,Type,UoM,Received,Sold,Used,Available Stock",
      ...rows.map((r) => [
        r.name, r.item_type === "non_sellable" ? "Non-sellable" : "Sellable", r.uom,
        r.received, r.sold, r.used, r.available,
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([lines], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `inventory-daily-report-${date}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Daily report exported", description: date });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <CalendarDays className="h-4 w-4 mr-2" /> Daily Report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Daily Inventory Report</DialogTitle>
          <DialogDescription>Usage, sales and available stock for a selected day.</DialogDescription>
        </DialogHeader>

        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input type="date" className="h-9 w-44" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={rows.length === 0}>
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>UoM</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Sold</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.product_id}>
                    <TableCell className="font-medium">
                      {r.name}
                      {r.item_type === "non_sellable" && (
                        <Badge variant="outline" className="ml-2 text-[10px] bg-slate-50 text-slate-600 border-slate-200">Non-sellable</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.uom}</TableCell>
                    <TableCell className="text-right text-green-700">{r.received || "—"}</TableCell>
                    <TableCell className="text-right">{r.sold || "—"}</TableCell>
                    <TableCell className="text-right">{r.used || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{r.available}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold">
                  <TableCell colSpan={2}>Total</TableCell>
                  <TableCell className="text-right">{totals.received}</TableCell>
                  <TableCell className="text-right">{totals.sold}</TableCell>
                  <TableCell className="text-right">{totals.used}</TableCell>
                  <TableCell className="text-right">—</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
