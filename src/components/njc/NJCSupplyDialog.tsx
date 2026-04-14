import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { formatNairaCompact } from "@/lib/currency";

interface LineItem {
  id?: string;
  item_date: string;
  description: string;
  per_head_price: string;
  number_of_persons: string;
}

interface SupplyFormData {
  supply_date: string;
  invoice_title: string;
  payment_status: string;
  supply_details: string;
  service_charge_percent: string;
  vat_percent: string;
  items: LineItem[];
}

interface NJCSupplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: SupplyFormData;
  isEditing: boolean;
  isPending: boolean;
  onSubmit: (data: SupplyFormData) => void;
}

const defaultItem = (): LineItem => ({
  item_date: new Date().toISOString().split("T")[0],
  description: "",
  per_head_price: "",
  number_of_persons: "",
});

export const defaultFormData = (): SupplyFormData => ({
  supply_date: new Date().toISOString().split("T")[0],
  invoice_title: "PROVISION OF SNACKS",
  payment_status: "pending",
  supply_details: "",
  service_charge_percent: "15",
  vat_percent: "7.5",
  items: [defaultItem()],
});

export default function NJCSupplyDialog({
  open, onOpenChange, initialData, isEditing, isPending, onSubmit,
}: NJCSupplyDialogProps) {
  const [form, setForm] = useState<SupplyFormData>(initialData || defaultFormData());

  // Reset form when dialog opens with new data
  const handleOpenChange = (val: boolean) => {
    if (val && initialData) setForm(initialData);
    if (val && !initialData) setForm(defaultFormData());
    onOpenChange(val);
  };

  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, defaultItem()] }));

  const removeItem = (idx: number) =>
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const updateItem = (idx: number, field: keyof LineItem, value: string) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    }));

  const calcLineTotal = (item: LineItem) => {
    const price = parseFloat(item.per_head_price) || 0;
    const persons = parseInt(item.number_of_persons) || 0;
    return price * persons;
  };

  const subtotal = form.items.reduce((sum, item) => sum + calcLineTotal(item), 0);
  const scPercent = parseFloat(form.service_charge_percent) || 0;
  const vatPercent = parseFloat(form.vat_percent) || 0;
  const serviceCharge = subtotal * (scPercent / 100);
  const vat = (subtotal + serviceCharge) * (vatPercent / 100);
  const grandTotal = subtotal + serviceCharge + vat;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Invoice" : "Create New Invoice"}</DialogTitle>
          <DialogDescription>Enter the NJC supply invoice details with line items</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Invoice header */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Invoice Date</Label>
                <Input type="date" value={form.supply_date} onChange={(e) => setForm({ ...form, supply_date: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Invoice Title</Label>
                <Input value={form.invoice_title} onChange={(e) => setForm({ ...form, invoice_title: e.target.value })} placeholder="PROVISION OF SNACKS" />
              </div>
              <div className="space-y-2">
                <Label>Payment Status</Label>
                <Select value={form.payment_status} onValueChange={(v) => setForm({ ...form, payment_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>SC %</Label>
                  <Input type="number" step="0.1" value={form.service_charge_percent} onChange={(e) => setForm({ ...form, service_charge_percent: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>VAT %</Label>
                  <Input type="number" step="0.1" value={form.vat_percent} onChange={(e) => setForm({ ...form, vat_percent: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Line items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Line Items</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-4 w-4 mr-1" /> Add Item
                </Button>
              </div>
              <div className="border rounded-md overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[120px]">Per Head (₦)</TableHead>
                      <TableHead className="w-[100px]">No. of Persons</TableHead>
                      <TableHead className="w-[120px] text-right">Total</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {form.items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Input type="date" value={item.item_date} onChange={(e) => updateItem(idx, "item_date", e.target.value)} required className="h-8 text-xs" />
                        </TableCell>
                        <TableCell>
                          <Input value={item.description} onChange={(e) => updateItem(idx, "description", e.target.value)} placeholder="Snacks (GROUP A)" required className="h-8 text-xs" />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min="0" step="0.01" value={item.per_head_price} onChange={(e) => updateItem(idx, "per_head_price", e.target.value)} required className="h-8 text-xs" />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min="0" value={item.number_of_persons} onChange={(e) => updateItem(idx, "number_of_persons", e.target.value)} required className="h-8 text-xs" />
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {formatNairaCompact(calcLineTotal(item))}
                        </TableCell>
                        <TableCell>
                          {form.items.length > 1 && (
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(idx)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-72 space-y-1 text-sm">
                <div className="flex justify-between"><span>Subtotal:</span><span className="font-medium">{formatNairaCompact(subtotal)}</span></div>
                <div className="flex justify-between"><span>Service Charge ({scPercent}%):</span><span>{formatNairaCompact(serviceCharge)}</span></div>
                <div className="flex justify-between"><span>VAT ({vatPercent}%):</span><span>{formatNairaCompact(vat)}</span></div>
                <div className="flex justify-between border-t pt-1 font-bold text-base"><span>Grand Total:</span><span>{formatNairaCompact(grandTotal)}</span></div>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.supply_details} onChange={(e) => setForm({ ...form, supply_details: e.target.value })} placeholder="Additional notes..." />
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isEditing ? "Update" : "Create"} Invoice</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
