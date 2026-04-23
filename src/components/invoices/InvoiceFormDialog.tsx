import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, ShoppingCart, CalendarDays, Users, Building2 } from "lucide-react";
import {
  type Invoice, type InvoiceFormData, type InvoiceFormItem, type InvoiceType,
  makeBlankItem, DEFAULT_TERMS, UNITS,
} from "@/types/invoices";
import { formatNairaCompact } from "@/lib/currency";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingInvoice?: Invoice | null;
  defaultType?: InvoiceType;
}

const TYPE_CONFIGS = {
  daily_sales: {
    label: "Daily Sales Invoice",
    icon: ShoppingCart,
    description: "Invoice for regular sales transactions with inventory items",
    accentColor: "bg-blue-50 border-blue-200 text-blue-700",
  },
  event: {
    label: "Event Invoice",
    icon: CalendarDays,
    description: "Invoice for events and catering services",
    accentColor: "bg-purple-50 border-purple-200 text-purple-700",
  },
};

function toNum(val: string) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

const blankForm = (type: InvoiceType): InvoiceFormData => ({
  invoice_type: type,
  customer_name: "",
  customer_email: "",
  customer_phone: "",
  customer_address: "",
  event_name: "",
  event_date: "",
  event_venue: "",
  number_of_guests: "",
  issue_date: new Date().toISOString().split("T")[0],
  valid_until: "",
  discount_percent: "0",
  tax_percent: "0",
  service_charge_percent: "0",
  waiter_required: false,
  number_of_waiters: "",
  cost_per_waiter: "",
  notes: "",
  terms: DEFAULT_TERMS,
  account_name: "",
  account_number: "",
  bank_name: "",
});

export default function InvoiceFormDialog({ open, onOpenChange, editingInvoice, defaultType }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<"type-select" | "form">(
    editingInvoice || defaultType ? "form" : "type-select"
  );
  const [selectedType, setSelectedType] = useState<InvoiceType>(
    editingInvoice?.invoice_type ?? defaultType ?? "daily_sales"
  );
  const [form, setForm] = useState<InvoiceFormData>(blankForm(selectedType));
  const [items, setItems] = useState<InvoiceFormItem[]>([makeBlankItem()]);
  const [saving, setSaving] = useState(false);

  // Products for daily sales inventory selection
  const { data: products = [] } = useQuery({
    queryKey: ["products-for-invoice"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price, category, sku")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  // Populate form when editing
  useEffect(() => {
    if (editingInvoice) {
      setSelectedType(editingInvoice.invoice_type);
      setStep("form");
      setForm({
        invoice_type: editingInvoice.invoice_type,
        customer_name: editingInvoice.customer_name,
        customer_email: editingInvoice.customer_email ?? "",
        customer_phone: editingInvoice.customer_phone ?? "",
        customer_address: editingInvoice.customer_address ?? "",
        event_name: editingInvoice.event_name ?? "",
        event_date: editingInvoice.event_date ?? "",
        event_venue: editingInvoice.event_venue ?? "",
        number_of_guests: editingInvoice.number_of_guests?.toString() ?? "",
        issue_date: editingInvoice.issue_date,
        valid_until: editingInvoice.valid_until ?? "",
        discount_percent: editingInvoice.discount_percent.toString(),
        tax_percent: editingInvoice.tax_percent.toString(),
        service_charge_percent: editingInvoice.service_charge_percent.toString(),
        waiter_required: editingInvoice.waiter_required ?? false,
        number_of_waiters: editingInvoice.number_of_waiters?.toString() ?? "",
        cost_per_waiter: editingInvoice.cost_per_waiter?.toString() ?? "",
        notes: editingInvoice.notes ?? "",
        terms: editingInvoice.terms ?? DEFAULT_TERMS,
        account_name: editingInvoice.account_name ?? "",
        account_number: editingInvoice.account_number ?? "",
        bank_name: editingInvoice.bank_name ?? "",
      });
      setItems(
        editingInvoice.items?.map((it) => ({
          description: it.description,
          item_details: it.item_details ?? "",
          quantity: it.quantity,
          unit: it.unit,
          unit_price: it.unit_price,
          total_price: it.total_price,
          product_id: it.product_id ?? "",
          sku_id: it.sku_id ?? "",
        })) ?? [makeBlankItem()]
      );
    } else if (defaultType && !editingInvoice) {
      setSelectedType(defaultType);
      setStep("form");
      setForm(blankForm(defaultType));
      setItems([makeBlankItem()]);
    }
  }, [editingInvoice, defaultType, open]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(defaultType || editingInvoice ? "form" : "type-select");
        setForm(blankForm(selectedType));
        setItems([makeBlankItem()]);
      }, 300);
    }
  }, [open]);

  const setField = useCallback(
    <K extends keyof InvoiceFormData>(k: K, v: InvoiceFormData[K]) =>
      setForm((f) => ({ ...f, [k]: v })),
    []
  );

  // Item management
  const setItemField = (idx: number, field: keyof InvoiceFormItem, value: string | number) => {
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      if (field === "quantity" || field === "unit_price") {
        const q = Number(updated[idx].quantity) || 0;
        const p = Number(updated[idx].unit_price) || 0;
        updated[idx].total_price = q * p;
      }
      return updated;
    });
  };

  const applyProduct = (idx: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setItems((prev) => {
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        product_id: productId,
        description: product.name,
        unit_price: product.price ?? 0,
        unit: "pcs",
        total_price: (Number(updated[idx].quantity) || 1) * (product.price ?? 0),
      };
      return updated;
    });
  };

  const addItem = () => setItems((prev) => [...prev, makeBlankItem()]);
  const removeItem = (idx: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  // Totals
  const itemsSubtotal = items.reduce((s, it) => s + (it.total_price || 0), 0);
  const waiterTotal = form.waiter_required
    ? (toNum(form.number_of_waiters) * toNum(form.cost_per_waiter))
    : 0;
  const subtotal = itemsSubtotal + waiterTotal;
  const discountAmt = (subtotal * toNum(form.discount_percent)) / 100;
  const afterDiscount = subtotal - discountAmt;
  const serviceAmt = (afterDiscount * toNum(form.service_charge_percent)) / 100;
  const taxBase = afterDiscount + serviceAmt;
  const taxAmt = (taxBase * toNum(form.tax_percent)) / 100;
  const total = taxBase + taxAmt;

  const handleTypeSelect = (type: InvoiceType) => {
    setSelectedType(type);
    setForm(blankForm(type));
    setItems([makeBlankItem()]);
    setStep("form");
  };

  const handleSubmit = async () => {
    if (!user) return;
    if (!form.customer_name.trim()) {
      toast({ title: "Customer name is required", variant: "destructive" });
      return;
    }
    if (items.every((it) => !it.description.trim())) {
      toast({ title: "Add at least one line item", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      let quotation_number: string;

      if (editingInvoice) {
        quotation_number = editingInvoice.quotation_number;
      } else {
        const { data: numData, error: numErr } = await supabase.rpc(
          "generate_invoice_number",
          { p_prefix: "QUO" }
        );
        if (numErr) throw numErr;
        quotation_number = numData as string;
      }

      const invoicePayload = {
        user_id: user.id,
        ...(editingInvoice ? {} : { created_by: user.id }),
        updated_by: user.id,
        quotation_number,
        invoice_type: selectedType,
        status: "quotation" as const,
        customer_name: form.customer_name.trim(),
        customer_email: form.customer_email.trim() || null,
        customer_phone: form.customer_phone.trim() || null,
        customer_address: form.customer_address.trim() || null,
        event_name: selectedType === "event" ? form.event_name.trim() || null : null,
        event_date: selectedType === "event" ? form.event_date || null : null,
        event_venue: selectedType === "event" ? form.event_venue.trim() || null : null,
        number_of_guests:
          selectedType === "event" && form.number_of_guests
            ? parseInt(form.number_of_guests)
            : null,
        subtotal,
        discount_percent: toNum(form.discount_percent),
        discount_amount: discountAmt,
        tax_percent: toNum(form.tax_percent),
        tax_amount: taxAmt,
        service_charge_percent: toNum(form.service_charge_percent),
        service_charge_amount: serviceAmt,
        waiter_required: form.waiter_required,
        number_of_waiters: form.waiter_required && form.number_of_waiters ? parseInt(form.number_of_waiters) : null,
        cost_per_waiter: form.waiter_required && form.cost_per_waiter ? toNum(form.cost_per_waiter) : null,
        waiter_total: waiterTotal,
        total_amount: total,
        issue_date: form.issue_date,
        valid_until: form.valid_until || null,
        notes: form.notes.trim() || null,
        terms: form.terms.trim() || null,
        account_name: form.account_name.trim() || null,
        account_number: form.account_number.trim() || null,
        bank_name: form.bank_name.trim() || null,
      };

      let invoiceId: string;

      if (editingInvoice) {
        const { error } = await supabase
          .from("invoices")
          .update(invoicePayload)
          .eq("id", editingInvoice.id);
        if (error) throw error;
        invoiceId = editingInvoice.id;
        await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
      } else {
        const { data, error } = await supabase
          .from("invoices")
          .insert(invoicePayload)
          .select("id")
          .single();
        if (error) throw error;
        invoiceId = data.id;
      }

      const itemRows = items
        .filter((it) => it.description.trim())
        .map((it, idx) => ({
          invoice_id: invoiceId,
          product_id: it.product_id || null,
          sku_id: it.sku_id || null,
          description: it.description.trim(),
          item_details: it.item_details.trim() || null,
          quantity: it.quantity,
          unit: it.unit,
          unit_price: it.unit_price,
          total_price: it.total_price,
          sort_order: idx,
        }));

      if (itemRows.length > 0) {
        const { error: itemErr } = await supabase.from("invoice_items").insert(itemRows);
        if (itemErr) throw itemErr;
      }

      await queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({
        title: editingInvoice ? "Quotation updated" : "Quotation created",
        description: `${quotation_number} saved successfully.`,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error saving quotation", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // ── Type selector ──
  if (step === "type-select") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Quotation / Invoice</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Select the type of invoice to create:</p>
          <div className="grid gap-3 mt-2">
            {(Object.entries(TYPE_CONFIGS) as [InvoiceType, typeof TYPE_CONFIGS.event][]).map(
              ([type, config]) => {
                const Icon = config.icon;
                return (
                  <button
                    key={type}
                    onClick={() => handleTypeSelect(type)}
                    className={`flex items-start gap-4 rounded-lg border-2 p-4 text-left transition-colors hover:bg-muted ${config.accentColor}`}
                  >
                    <Icon className="h-6 w-6 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">{config.label}</p>
                      <p className="text-xs mt-0.5 opacity-80">{config.description}</p>
                    </div>
                  </button>
                );
              }
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Main form ──
  const isEvent = selectedType === "event";
  const config = TYPE_CONFIGS[selectedType];
  const Icon = config.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5" />
            {editingInvoice ? "Edit Quotation" : `New ${config.label} Quotation`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">

          {/* ── Customer Info ── */}
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Customer Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="customer_name">Customer Name *</Label>
                <Input
                  id="customer_name"
                  value={form.customer_name}
                  onChange={(e) => setField("customer_name", e.target.value)}
                  placeholder="Full name or company"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="customer_email">Email</Label>
                <Input
                  id="customer_email"
                  type="email"
                  value={form.customer_email}
                  onChange={(e) => setField("customer_email", e.target.value)}
                  placeholder="email@example.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="customer_phone">Phone</Label>
                <Input
                  id="customer_phone"
                  value={form.customer_phone}
                  onChange={(e) => setField("customer_phone", e.target.value)}
                  placeholder="+234…"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="customer_address">Address</Label>
                <Input
                  id="customer_address"
                  value={form.customer_address}
                  onChange={(e) => setField("customer_address", e.target.value)}
                  placeholder="Customer address"
                />
              </div>
            </div>
          </section>

          {/* ── Event Details ── */}
          {isEvent && (
            <>
              <Separator />
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Event Details
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="event_name">Event Name</Label>
                    <Input
                      id="event_name"
                      value={form.event_name}
                      onChange={(e) => setField("event_name", e.target.value)}
                      placeholder="e.g. Wedding Reception"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="event_date">Event Date</Label>
                    <Input
                      id="event_date"
                      type="date"
                      value={form.event_date}
                      onChange={(e) => setField("event_date", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="event_venue">Venue</Label>
                    <Input
                      id="event_venue"
                      value={form.event_venue}
                      onChange={(e) => setField("event_venue", e.target.value)}
                      placeholder="Venue name / address"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="number_of_guests">Number of Guests</Label>
                    <Input
                      id="number_of_guests"
                      type="number"
                      min="0"
                      value={form.number_of_guests}
                      onChange={(e) => setField("number_of_guests", e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
              </section>
            </>
          )}

          {/* ── Dates ── */}
          <Separator />
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Dates
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="issue_date">Issue Date</Label>
                <Input
                  id="issue_date"
                  type="date"
                  value={form.issue_date}
                  onChange={(e) => setField("issue_date", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="valid_until">Valid Until</Label>
                <Input
                  id="valid_until"
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => setField("valid_until", e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* ── Line Items ── */}
          <Separator />
          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {isEvent ? "Services & Packages" : "Line Items"}
                </h3>
                {isEvent && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Each row is a cost group. List all included items in the &ldquo;Items included&rdquo; field below the description.
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
              </Button>
            </div>

            <div className="space-y-4">
              {items.map((item, idx) => (
                <div key={idx} className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
                  {/* Product picker (daily_sales only) */}
                  {!isEvent && products.length > 0 && (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Pick from inventory (optional)</Label>
                      <Select
                        value={item.product_id || ""}
                        onValueChange={(v) => applyProduct(idx, v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select a product…" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} — {formatNairaCompact(p.price ?? 0)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Description + price row */}
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-12 sm:col-span-5 space-y-1">
                      <Label className="text-xs">
                        {isEvent ? "Package / Service Name *" : "Description *"}
                      </Label>
                      <Input
                        className="h-8 text-xs"
                        value={item.description}
                        onChange={(e) => setItemField(idx, "description", e.target.value)}
                        placeholder={isEvent ? "e.g. Full Buffet Package" : "Item description"}
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2 space-y-1">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        className="h-8 text-xs"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) => setItemField(idx, "quantity", parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2 space-y-1">
                      <Label className="text-xs">Unit</Label>
                      <Select
                        value={item.unit}
                        onValueChange={(v) => setItemField(idx, "unit", v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UNITS.map((u) => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-3 sm:col-span-2 space-y-1">
                      <Label className="text-xs">Unit Price (₦)</Label>
                      <Input
                        className="h-8 text-xs"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_price}
                        onChange={(e) => setItemField(idx, "unit_price", parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div className="col-span-9 sm:col-span-1 flex items-end justify-between gap-1">
                      <div>
                        <Label className="text-xs text-muted-foreground">Total</Label>
                        <p className="text-xs font-semibold mt-1">{formatNairaCompact(item.total_price)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive shrink-0"
                        onClick={() => removeItem(idx)}
                        disabled={items.length === 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Items included (event only) — flexible variety field */}
                  {isEvent && (
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">
                        Items included in this package{" "}
                        <span className="text-muted-foreground/60">(one per line)</span>
                      </Label>
                      <Textarea
                        className="text-xs resize-none"
                        rows={3}
                        value={item.item_details}
                        onChange={(e) => setItemField(idx, "item_details", e.target.value)}
                        placeholder={"Jollof Rice\nFried Rice\nChicken (2 pieces)\nAssorted beef\nFresh fish"}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── Waiters (event only) ── */}
          {isEvent && (
            <>
              <Separator />
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      Waiter Service
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="waiter_toggle" className="text-sm cursor-pointer">
                      {form.waiter_required ? "Waiters included" : "No waiters"}
                    </Label>
                    <Switch
                      id="waiter_toggle"
                      checked={form.waiter_required}
                      onCheckedChange={(v) => setField("waiter_required", v)}
                    />
                  </div>
                </div>

                {form.waiter_required && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-dashed p-3 bg-muted/20">
                    <div className="space-y-1">
                      <Label htmlFor="number_of_waiters">Number of Waiters</Label>
                      <Input
                        id="number_of_waiters"
                        type="number"
                        min="1"
                        value={form.number_of_waiters}
                        onChange={(e) => setField("number_of_waiters", e.target.value)}
                        placeholder="e.g. 5"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="cost_per_waiter">Cost per Waiter (₦)</Label>
                      <Input
                        id="cost_per_waiter"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.cost_per_waiter}
                        onChange={(e) => setField("cost_per_waiter", e.target.value)}
                        placeholder="e.g. 5000"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Waiter Total</Label>
                      <div className="h-10 flex items-center font-semibold text-sm">
                        {formatNairaCompact(waiterTotal)}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {/* ── Charges & Adjustments ── */}
          <Separator />
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Charges &amp; Adjustments
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="discount_percent">Discount (%)</Label>
                <Input
                  id="discount_percent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.discount_percent}
                  onChange={(e) => setField("discount_percent", e.target.value)}
                />
              </div>
              {isEvent && (
                <div className="space-y-1">
                  <Label htmlFor="service_charge_percent">Service Charge (%)</Label>
                  <Input
                    id="service_charge_percent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.service_charge_percent}
                    onChange={(e) => setField("service_charge_percent", e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="tax_percent">Tax / VAT (%)</Label>
                <Input
                  id="tax_percent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.tax_percent}
                  onChange={(e) => setField("tax_percent", e.target.value)}
                />
              </div>
            </div>

            {/* Live summary */}
            <div className="mt-4 rounded-lg bg-muted p-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items subtotal</span>
                <span>{formatNairaCompact(itemsSubtotal)}</span>
              </div>
              {waiterTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Waiters ({form.number_of_waiters} × {formatNairaCompact(toNum(form.cost_per_waiter))})
                  </span>
                  <span>{formatNairaCompact(waiterTotal)}</span>
                </div>
              )}
              {discountAmt > 0 && (
                <div className="flex justify-between text-destructive">
                  <span>Discount ({form.discount_percent}%)</span>
                  <span>− {formatNairaCompact(discountAmt)}</span>
                </div>
              )}
              {serviceAmt > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service Charge ({form.service_charge_percent}%)</span>
                  <span>{formatNairaCompact(serviceAmt)}</span>
                </div>
              )}
              {taxAmt > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax / VAT ({form.tax_percent}%)</span>
                  <span>{formatNairaCompact(taxAmt)}</span>
                </div>
              )}
              <Separator className="my-1" />
              <div className="flex justify-between font-bold text-base">
                <span>Total</span>
                <span>{formatNairaCompact(total)}</span>
              </div>
            </div>
          </section>

          {/* ── Account Details ── */}
          <Separator />
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Payment Account Details
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Bank account for client to remit payment. This will appear on the printed invoice.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label htmlFor="bank_name">Bank Name</Label>
                <Input
                  id="bank_name"
                  value={form.bank_name}
                  onChange={(e) => setField("bank_name", e.target.value)}
                  placeholder="e.g. GTBank"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="account_number">Account Number</Label>
                <Input
                  id="account_number"
                  value={form.account_number}
                  onChange={(e) => setField("account_number", e.target.value)}
                  placeholder="0123456789"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="account_name">Account Name</Label>
                <Input
                  id="account_name"
                  value={form.account_name}
                  onChange={(e) => setField("account_name", e.target.value)}
                  placeholder="Sizzling Spices Ltd"
                />
              </div>
            </div>
          </section>

          {/* ── Notes & Terms ── */}
          <Separator />
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Notes &amp; Terms
            </h3>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={form.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                  placeholder="Any additional notes for the customer…"
                  rows={2}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="terms">Terms &amp; Conditions</Label>
                <Textarea
                  id="terms"
                  value={form.terms}
                  onChange={(e) => setField("terms", e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          </section>
        </div>

        <DialogFooter className="mt-4 gap-2">
          {!defaultType && !editingInvoice && (
            <Button variant="ghost" onClick={() => setStep("type-select")}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving…" : editingInvoice ? "Update Quotation" : "Save as Quotation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
