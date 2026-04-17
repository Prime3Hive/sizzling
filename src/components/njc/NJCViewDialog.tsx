import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Edit } from "lucide-react";
import { formatNairaCompact } from "@/lib/currency";
import { format } from "date-fns";
import type { NJCSupplyWithItems } from "@/lib/njcExport";

interface NJCViewDialogProps {
  supply: NJCSupplyWithItems | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (supply: NJCSupplyWithItems) => void;
}

const statusStyles: Record<string, { badge: string; label: string }> = {
  paid:    { badge: "bg-green-100 text-green-800 border-green-200",   label: "Paid" },
  pending: { badge: "bg-yellow-100 text-yellow-800 border-yellow-200", label: "Pending" },
  partial: { badge: "bg-orange-100 text-orange-800 border-orange-200", label: "Partial" },
  failed:  { badge: "bg-red-100 text-red-800 border-red-200",         label: "Failed" },
};

export default function NJCViewDialog({ supply, open, onOpenChange, onEdit }: NJCViewDialogProps) {
  if (!supply) return null;

  const scPct  = supply.service_charge_percent ?? 0;
  const vatPct = supply.vat_percent ?? 0;
  const sc     = supply.service_charge_amount ?? 0;
  const vat    = supply.vat_amount ?? 0;
  const status = statusStyles[supply.payment_status] ?? statusStyles.pending;

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>${supply.invoice_title || "NJC Invoice"}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 32px; color: #111; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .meta { font-size: 13px; color: #555; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #f3f4f6; text-align: left; padding: 8px; border: 1px solid #e5e7eb; }
        td { padding: 8px; border: 1px solid #e5e7eb; }
        .totals { width: 280px; margin-left: auto; margin-top: 16px; font-size: 13px; }
        .totals td { border: none; padding: 3px 0; }
        .totals .grand { font-weight: bold; font-size: 15px; border-top: 2px solid #111; padding-top: 6px; }
        .notes { margin-top: 20px; font-size: 13px; color: #444; }
      </style></head><body>
      <h1>${supply.invoice_title || "PROVISION OF SNACKS"}</h1>
      <div class="meta">
        Date: ${format(new Date(supply.supply_date), "dd MMMM yyyy")} &nbsp;|&nbsp;
        Status: ${status.label} &nbsp;|&nbsp;
        SC: ${scPct}% &nbsp;|&nbsp; VAT: ${vatPct}%
      </div>
      <table>
        <thead><tr><th>Date</th><th>Description</th><th>Per Head (₦)</th><th>Persons</th><th>Total (₦)</th></tr></thead>
        <tbody>
          ${supply.items.map(i => `
            <tr>
              <td>${format(new Date(i.item_date), "dd/MM/yyyy")}</td>
              <td>${i.description}</td>
              <td>${i.per_head_price.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
              <td>${i.number_of_persons}</td>
              <td>${i.line_total.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <table class="totals">
        <tr><td>Subtotal:</td><td align="right">₦${(supply.subtotal ?? 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td></tr>
        <tr><td>Service Charge (${scPct}%):</td><td align="right">₦${sc.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td></tr>
        <tr><td>VAT (${vatPct}%):</td><td align="right">₦${vat.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td></tr>
        <tr class="grand"><td>Grand Total:</td><td align="right">₦${supply.total_amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td></tr>
      </table>
      ${supply.supply_details ? `<div class="notes"><strong>Notes:</strong><br>${supply.supply_details}</div>` : ""}
    </body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <DialogTitle className="text-xl">{supply.invoice_title || "PROVISION OF SNACKS"}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {format(new Date(supply.supply_date), "dd MMMM yyyy")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${status.badge}`}>
                {status.label}
              </span>
            </div>
          </div>
        </DialogHeader>

        {/* Invoice meta */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-muted/40 rounded-lg p-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Invoice Date</p>
            <p className="font-medium mt-0.5">{format(new Date(supply.supply_date), "dd MMM yyyy")}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Line Items</p>
            <p className="font-medium mt-0.5">{supply.items.length} item{supply.items.length !== 1 ? "s" : ""}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Service Charge</p>
            <p className="font-medium mt-0.5">{scPct}%</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">VAT</p>
            <p className="font-medium mt-0.5">{vatPct}%</p>
          </div>
        </div>

        {/* Line items table */}
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Line Items</h3>
          {supply.items.length > 0 ? (
            <div className="border rounded-md overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-[120px]">Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right w-[130px]">Per Head (₦)</TableHead>
                    <TableHead className="text-right w-[100px]">Persons</TableHead>
                    <TableHead className="text-right w-[130px]">Total (₦)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supply.items.map((item, idx) => (
                    <TableRow key={item.id ?? idx}>
                      <TableCell className="text-sm">{format(new Date(item.item_date), "dd/MM/yyyy")}</TableCell>
                      <TableCell className="font-medium">{item.description}</TableCell>
                      <TableCell className="text-right text-sm">{formatNairaCompact(item.per_head_price)}</TableCell>
                      <TableCell className="text-right text-sm">{item.number_of_persons.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-semibold">{formatNairaCompact(item.line_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No line items recorded.</p>
          )}
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-72 space-y-1.5 text-sm bg-muted/30 rounded-lg p-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">{formatNairaCompact(supply.subtotal ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Service Charge ({scPct}%)</span>
              <span>{formatNairaCompact(sc)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">VAT ({vatPct}%)</span>
              <span>{formatNairaCompact(vat)}</span>
            </div>
            <Separator className="my-1" />
            <div className="flex justify-between font-bold text-base">
              <span>Grand Total</span>
              <span className="text-primary">{formatNairaCompact(supply.total_amount)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {supply.supply_details && (
          <div className="bg-muted/30 rounded-lg p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm whitespace-pre-wrap">{supply.supply_details}</p>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex justify-between gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1.5" /> Print Invoice
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            <Button onClick={() => { onOpenChange(false); onEdit(supply); }}>
              <Edit className="h-4 w-4 mr-1.5" /> Edit Invoice
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
