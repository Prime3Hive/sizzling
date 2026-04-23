import { useRef, useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Printer, FileCheck, TrendingUp, Edit, XCircle, CheckCircle2, Users, Building2,
} from "lucide-react";
import { format } from "date-fns";
import { formatNairaCompact } from "@/lib/currency";
import {
  type Invoice, type PaymentStatus,
  STATUS_LABELS, TYPE_LABELS, PAYMENT_STATUS_LABELS,
} from "@/types/invoices";
import InvoicePrintView from "./InvoicePrintView";

interface Props {
  invoice: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: (invoice: Invoice) => void;
}

const STATUS_BADGE: Record<string, string> = {
  quotation: "bg-amber-100 text-amber-700 border-amber-200",
  invoice:   "bg-green-100 text-green-700 border-green-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
};

const PAYMENT_BADGE: Record<string, string> = {
  unpaid:  "bg-red-100 text-red-700 border-red-200",
  partial: "bg-amber-100 text-amber-700 border-amber-200",
  paid:    "bg-green-100 text-green-700 border-green-200",
};

export default function InvoiceViewDialog({ invoice, open, onOpenChange, onEdit }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);
  const [auditNames, setAuditNames] = useState<Record<string, string>>({});
  const [showConvertConfirm, setShowConvertConfirm] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(
    invoice?.payment_status ?? "unpaid"
  );
  const [amountPaid, setAmountPaid] = useState(invoice?.amount_paid?.toString() ?? "0");
  const [updatingPayment, setUpdatingPayment] = useState(false);

  // Fetch full names for created_by / updated_by
  useEffect(() => {
    if (!invoice) return;
    const ids = [...new Set([invoice.created_by, invoice.updated_by].filter(Boolean))] as string[];
    if (ids.length === 0) return;
    supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", ids)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        data.forEach((p) => { if (p.user_id) map[p.user_id] = p.full_name ?? "Unknown"; });
        setAuditNames(map);
      });
  }, [invoice?.id, invoice?.created_by, invoice?.updated_by]);

  // Convert quotation → invoice
  const convertMutation = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("No invoice");
      const prefix = invoice.invoice_type === "event" ? "EVI" : "DSI";
      const { data: numData, error: numErr } = await supabase.rpc(
        "generate_invoice_number",
        { p_prefix: prefix }
      );
      if (numErr) throw numErr;

      const { error } = await supabase
        .from("invoices")
        .update({
          status: "invoice",
          invoice_number: numData as string,
          converted_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", invoice.id);
      if (error) throw error;
      return numData as string;
    },
    onSuccess: (invoiceNum) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({
        title: "Converted to Invoice",
        description: `Invoice ${invoiceNum} has been issued.`,
      });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Conversion failed", description: err.message, variant: "destructive" });
    },
  });

  // Cancel invoice/quotation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("No invoice");
      const { error } = await supabase
        .from("invoices")
        .update({ status: "cancelled", updated_by: user?.id ?? null })
        .eq("id", invoice.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Cancelled", description: "Document has been cancelled." });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Record in finance — stamps the flag AND writes to finance_ledger
  const recordFinanceMutation = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error("No invoice");

      const now = new Date().toISOString();
      const entryDate = invoice.converted_at
        ? invoice.converted_at.split("T")[0]
        : now.split("T")[0];

      const { error } = await supabase
        .from("invoices")
        .update({
          recorded_in_finance: true,
          finance_recorded_at: now,
          updated_by: user?.id ?? null,
        })
        .eq("id", invoice.id);
      if (error) throw error;

      // Revenue ledger entry
      const { error: ledgerErr } = await supabase.from("finance_ledger").insert({
        user_id: invoice.user_id,
        entry_date: entryDate,
        entry_type: "revenue",
        source_type: "invoice",
        source_id: invoice.id,
        description: `Invoice ${invoice.invoice_number ?? invoice.quotation_number} — ${invoice.customer_name}`,
        amount: invoice.total_amount,
        cost_center: invoice.invoice_type === "event" ? "Event Account" : "Daily Orders",
        invoice_type: invoice.invoice_type,
        reference_number: invoice.invoice_number ?? invoice.quotation_number,
        recorded_by: user?.id ?? null,
      });
      if (ledgerErr) throw ledgerErr;

      // If already (partially) paid, record cash received too
      if (invoice.amount_paid > 0) {
        await supabase.from("finance_ledger").insert({
          user_id: invoice.user_id,
          entry_date: now.split("T")[0],
          entry_type: "payment_received",
          source_type: "invoice",
          source_id: invoice.id,
          description: `Payment received — ${invoice.invoice_number ?? invoice.quotation_number} (${invoice.customer_name})`,
          amount: invoice.amount_paid,
          cost_center: invoice.invoice_type === "event" ? "Event Account" : "Daily Orders",
          invoice_type: invoice.invoice_type,
          reference_number: invoice.invoice_number ?? invoice.quotation_number,
          recorded_by: user?.id ?? null,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["finance-ledger"] });
      toast({
        title: "Recorded in Finance",
        description: `${invoice?.invoice_number} has been posted to the finance ledger.`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!invoice) return null;

  const isQuotation = invoice.status === "quotation";
  const isInvoice = invoice.status === "invoice";
  const isCancelled = invoice.status === "cancelled";

  // Update payment status (+ ledger entry if invoice already posted to finance)
  const updatePayment = async () => {
    setUpdatingPayment(true);
    try {
      const newAmountPaid = parseFloat(amountPaid) || 0;
      const { error } = await supabase
        .from("invoices")
        .update({
          payment_status: paymentStatus,
          amount_paid: newAmountPaid,
          updated_by: user?.id ?? null,
        })
        .eq("id", invoice.id);
      if (error) throw error;

      // If the invoice is already in the ledger and payment increased, record the delta
      if (invoice.recorded_in_finance && newAmountPaid > (invoice.amount_paid ?? 0)) {
        const delta = newAmountPaid - (invoice.amount_paid ?? 0);
        await supabase.from("finance_ledger").insert({
          user_id: invoice.user_id,
          entry_date: new Date().toISOString().split("T")[0],
          entry_type: "payment_received",
          source_type: "invoice",
          source_id: invoice.id,
          description: `Payment update — ${invoice.invoice_number ?? invoice.quotation_number} (${invoice.customer_name})`,
          amount: delta,
          cost_center: invoice.invoice_type === "event" ? "Event Account" : "Daily Orders",
          invoice_type: invoice.invoice_type,
          reference_number: invoice.invoice_number ?? invoice.quotation_number,
          recorded_by: user?.id ?? null,
        });
      }

      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["finance-ledger"] });
      toast({ title: "Payment status updated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUpdatingPayment(false);
    }
  };

  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${invoice.invoice_number ?? invoice.quotation_number}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial, sans-serif; }
            body { padding: 24px; color: #111; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 8px 10px; text-align: left; }
            th { background: #f4f4f4; font-size: 12px; }
            td { font-size: 13px; border-bottom: 1px solid #eee; }
            .text-right { text-align: right; }
            .font-bold { font-weight: 700; }
            .totals-row { border-top: 2px solid #333; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>${el.innerHTML}</body>
      </html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 400);
  };

  const displayNumber = invoice.invoice_number ?? invoice.quotation_number;
  const docType = invoice.status === "quotation" ? "QUOTATION" : "INVOICE";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <DialogTitle className="text-xl">{displayNumber}</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {TYPE_LABELS[invoice.invoice_type]} · Issued {format(new Date(invoice.issue_date), "dd MMM yyyy")}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" className={STATUS_BADGE[invoice.status]}>
                  {STATUS_LABELS[invoice.status]}
                </Badge>
                <Badge variant="outline" className={PAYMENT_BADGE[invoice.payment_status]}>
                  {PAYMENT_STATUS_LABELS[invoice.payment_status]}
                </Badge>
                {invoice.recorded_in_finance && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                    Posted to Finance
                  </Badge>
                )}
              </div>
            </div>
          </DialogHeader>

          {/* References */}
          <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
            <div className="grid grid-cols-2 gap-x-6">
              <span className="text-muted-foreground">Quotation No.</span>
              <span className="font-mono font-medium">{invoice.quotation_number}</span>
            </div>
            {invoice.invoice_number && (
              <div className="grid grid-cols-2 gap-x-6">
                <span className="text-muted-foreground">Invoice No.</span>
                <span className="font-mono font-medium">{invoice.invoice_number}</span>
              </div>
            )}
            {invoice.converted_at && (
              <div className="grid grid-cols-2 gap-x-6">
                <span className="text-muted-foreground">Converted on</span>
                <span>{format(new Date(invoice.converted_at), "dd MMM yyyy")}</span>
              </div>
            )}
            {invoice.valid_until && (
              <div className="grid grid-cols-2 gap-x-6">
                <span className="text-muted-foreground">Valid until</span>
                <span>{format(new Date(invoice.valid_until), "dd MMM yyyy")}</span>
              </div>
            )}
          </div>

          {/* Customer */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Customer
            </h3>
            <div className="text-sm space-y-0.5">
              <p className="font-semibold">{invoice.customer_name}</p>
              {invoice.customer_email && <p className="text-muted-foreground">{invoice.customer_email}</p>}
              {invoice.customer_phone && <p className="text-muted-foreground">{invoice.customer_phone}</p>}
              {invoice.customer_address && <p className="text-muted-foreground">{invoice.customer_address}</p>}
            </div>
          </section>

          {/* Event details */}
          {invoice.invoice_type === "event" && (invoice.event_name || invoice.event_date || invoice.event_venue) && (
            <>
              <Separator />
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Event Details
                </h3>
                <div className="text-sm grid grid-cols-2 gap-x-6 gap-y-1">
                  {invoice.event_name && (
                    <>
                      <span className="text-muted-foreground">Event</span>
                      <span>{invoice.event_name}</span>
                    </>
                  )}
                  {invoice.event_date && (
                    <>
                      <span className="text-muted-foreground">Date</span>
                      <span>{format(new Date(invoice.event_date), "dd MMM yyyy")}</span>
                    </>
                  )}
                  {invoice.event_venue && (
                    <>
                      <span className="text-muted-foreground">Venue</span>
                      <span>{invoice.event_venue}</span>
                    </>
                  )}
                  {invoice.number_of_guests != null && (
                    <>
                      <span className="text-muted-foreground">Guests</span>
                      <span>{invoice.number_of_guests.toLocaleString()}</span>
                    </>
                  )}
                </div>
              </section>
            </>
          )}

          {/* Line items */}
          <Separator />
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {invoice.invoice_type === "event" ? "Services & Packages" : "Items"}
            </h3>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 pl-3 font-medium">Description</th>
                    <th className="text-right p-2 font-medium">Qty</th>
                    <th className="text-left p-2 font-medium">Unit</th>
                    <th className="text-right p-2 font-medium">Unit Price</th>
                    <th className="text-right p-2 pr-3 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoice.items ?? []).map((item, idx) => (
                    <tr key={item.id ?? idx} className="border-t">
                      <td className="p-2 pl-3">
                        <p className="font-medium">{item.description}</p>
                        {item.item_details && (
                          <ul className="mt-1 space-y-0.5">
                            {item.item_details.split("\n").filter(Boolean).map((line, i) => (
                              <li key={i} className="text-xs text-muted-foreground flex gap-1.5 items-start">
                                <span className="mt-0.5 shrink-0">·</span>
                                <span>{line.replace(/^[-•·]\s*/, "")}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="p-2 text-right align-top">{item.quantity}</td>
                      <td className="p-2 align-top">{item.unit}</td>
                      <td className="p-2 text-right align-top">{formatNairaCompact(item.unit_price)}</td>
                      <td className="p-2 pr-3 text-right font-medium align-top">{formatNairaCompact(item.total_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Waiter row (event) */}
            {invoice.invoice_type === "event" && invoice.waiter_required && invoice.waiter_total > 0 && (
              <div className="mt-2 rounded-lg border border-dashed bg-muted/20 p-3 flex items-center gap-3 text-sm">
                <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 font-medium">
                  Waiter Service
                  {invoice.number_of_waiters != null && invoice.cost_per_waiter != null && (
                    <span className="font-normal text-muted-foreground ml-2">
                      ({invoice.number_of_waiters} waiters × {formatNairaCompact(invoice.cost_per_waiter)})
                    </span>
                  )}
                </span>
                <span className="font-semibold">{formatNairaCompact(invoice.waiter_total)}</span>
              </div>
            )}
          </section>

          {/* Totals */}
          <div className="rounded-lg bg-muted/40 p-4 space-y-1.5 text-sm ml-auto w-full sm:w-80">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items subtotal</span>
              <span>{formatNairaCompact(invoice.subtotal - (invoice.waiter_total ?? 0))}</span>
            </div>
            {(invoice.waiter_total ?? 0) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Waiter service</span>
                <span>{formatNairaCompact(invoice.waiter_total)}</span>
              </div>
            )}
            {invoice.discount_amount > 0 && (
              <div className="flex justify-between text-destructive">
                <span>Discount ({invoice.discount_percent}%)</span>
                <span>− {formatNairaCompact(invoice.discount_amount)}</span>
              </div>
            )}
            {invoice.service_charge_amount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Service Charge ({invoice.service_charge_percent}%)</span>
                <span>{formatNairaCompact(invoice.service_charge_amount)}</span>
              </div>
            )}
            {invoice.tax_amount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax / VAT ({invoice.tax_percent}%)</span>
                <span>{formatNairaCompact(invoice.tax_amount)}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-bold text-base">
              <span>Total</span>
              <span>{formatNairaCompact(invoice.total_amount)}</span>
            </div>
            {invoice.amount_paid > 0 && (
              <>
                <div className="flex justify-between text-green-700">
                  <span>Amount Paid</span>
                  <span>{formatNairaCompact(invoice.amount_paid)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Balance Due</span>
                  <span>{formatNairaCompact(invoice.total_amount - invoice.amount_paid)}</span>
                </div>
              </>
            )}
          </div>

          {/* Notes & Terms */}
          {(invoice.notes || invoice.terms) && (
            <>
              <Separator />
              <section className="text-sm space-y-2">
                {invoice.notes && (
                  <div>
                    <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1">Notes</p>
                    <p className="text-muted-foreground whitespace-pre-wrap">{invoice.notes}</p>
                  </div>
                )}
                {invoice.terms && (
                  <div>
                    <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-1">Terms</p>
                    <p className="text-muted-foreground whitespace-pre-wrap">{invoice.terms}</p>
                  </div>
                )}
              </section>
            </>
          )}

          {/* Account details */}
          {(invoice.bank_name || invoice.account_number || invoice.account_name) && (
            <>
              <Separator />
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment Account
                  </h3>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3 text-sm grid grid-cols-3 gap-3">
                  {invoice.bank_name && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Bank</p>
                      <p className="font-semibold">{invoice.bank_name}</p>
                    </div>
                  )}
                  {invoice.account_number && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Account No.</p>
                      <p className="font-mono font-semibold tracking-wider">{invoice.account_number}</p>
                    </div>
                  )}
                  {invoice.account_name && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">Account Name</p>
                      <p className="font-semibold">{invoice.account_name}</p>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {/* Payment update (invoice only) */}
          {isInvoice && (
            <>
              <Separator />
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  Update Payment
                </h3>
                <div className="flex gap-3 flex-wrap items-end">
                  <div className="space-y-1">
                    <Label className="text-xs">Payment Status</Label>
                    <Select
                      value={paymentStatus}
                      onValueChange={(v) => setPaymentStatus(v as PaymentStatus)}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unpaid">Unpaid</SelectItem>
                        <SelectItem value="partial">Partial</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount Paid (₦)</Label>
                    <Input
                      className="h-8 w-40 text-xs"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                    />
                  </div>
                  <Button size="sm" className="h-8" onClick={updatePayment} disabled={updatingPayment}>
                    {updatingPayment ? "Saving…" : "Update"}
                  </Button>
                </div>
              </section>
            </>
          )}

          {/* Internal audit trail — not shown on print */}
          <Separator />
          <section className="text-xs text-muted-foreground space-y-1">
            <p className="font-semibold uppercase tracking-wide text-[10px] mb-1.5">Audit Trail</p>
            <div className="flex gap-1.5">
              <span className="shrink-0">Created by:</span>
              <span className="font-medium text-foreground">
                {invoice.created_by
                  ? (auditNames[invoice.created_by] ?? "Loading…")
                  : "—"}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span>{format(new Date(invoice.created_at), "dd MMM yyyy, HH:mm")}</span>
            </div>
            {invoice.updated_by && (
              <div className="flex gap-1.5">
                <span className="shrink-0">Last edited by:</span>
                <span className="font-medium text-foreground">
                  {auditNames[invoice.updated_by] ?? "Loading…"}
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span>{format(new Date(invoice.updated_at), "dd MMM yyyy, HH:mm")}</span>
              </div>
            )}
          </section>

          {/* Hidden print template */}
          <div className="hidden">
            <div ref={printRef}>
              <InvoicePrintView invoice={invoice} />
            </div>
          </div>

          <DialogFooter className="gap-2 flex-wrap">
            {/* Always: print */}
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1.5" /> Print
            </Button>

            {/* Quotation actions */}
            {isQuotation && (
              <>
                {onEdit && (
                  <Button variant="outline" onClick={() => { onOpenChange(false); onEdit(invoice); }}>
                    <Edit className="h-4 w-4 mr-1.5" /> Edit
                  </Button>
                )}
                <Button variant="outline" onClick={() => setShowCancelConfirm(true)}>
                  <XCircle className="h-4 w-4 mr-1.5" /> Cancel
                </Button>
                <Button onClick={() => setShowConvertConfirm(true)}>
                  <FileCheck className="h-4 w-4 mr-1.5" /> Convert to Invoice
                </Button>
              </>
            )}

            {/* Invoice actions */}
            {isInvoice && !invoice.recorded_in_finance && (
              <Button
                onClick={() => recordFinanceMutation.mutate()}
                disabled={recordFinanceMutation.isPending}
              >
                <TrendingUp className="h-4 w-4 mr-1.5" />
                {recordFinanceMutation.isPending ? "Recording…" : "Record in Finance"}
              </Button>
            )}

            {isInvoice && !isCancelled && (
              <Button variant="outline" onClick={() => setShowCancelConfirm(true)}>
                <XCircle className="h-4 w-4 mr-1.5" /> Cancel Invoice
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert confirm */}
      <AlertDialog open={showConvertConfirm} onOpenChange={setShowConvertConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert to Invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will issue a formal invoice number ({invoice.invoice_type === "event" ? "EVI" : "DSI"}-…)
              and change the status to <strong>Invoice</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowConvertConfirm(false); convertMutation.mutate(); }}
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Yes, Convert
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel confirm */}
      <AlertDialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this document?</AlertDialogTitle>
            <AlertDialogDescription>
              The {invoice.status} will be marked as cancelled and can no longer be acted upon.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setShowCancelConfirm(false); cancelMutation.mutate(); }}
            >
              Yes, Cancel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
