import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { formatNairaCompact } from '@/lib/currency';
import { format } from 'date-fns';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PackageCheck, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';
import type { LPO, LPOItem } from './LPOSheet';

interface ReceiveGoodsDialogProps {
  lpo: LPO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface ReceiveLine {
  lpo_item_id: string;
  item_name: string;
  sku_id: string | null;
  ordered_qty: number;
  already_received: number;
  unit_of_measure: string;
  lpo_unit_price: number;   // original LPO price (read-only reference)
  unit_price: number;       // actual received price (editable)
  qty_receiving: number;
  max_receivable: number;
}

export default function ReceiveGoodsDialog({ lpo, open, onOpenChange, onSuccess }: ReceiveGoodsDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [receivedDate, setReceivedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [budgetId, setBudgetId] = useState('');
  const [lines, setLines] = useState<ReceiveLine[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: budgets = [] } = useQuery({
    queryKey: ['budgets-for-receive'],
    queryFn: async () => {
      const { data } = await supabase.from('budgets').select('id, title').order('title');
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!lpo || !open) return;
    setBudgetId(lpo.budget_id ?? '');
    setReceivedDate(format(new Date(), 'yyyy-MM-dd'));
    setNotes('');

    const items: LPOItem[] = lpo.lpo_items ?? [];
    setLines(
      items.map(item => {
        const maxReceivable = Math.max(0, item.quantity - item.quantity_received);
        return {
          lpo_item_id: item.id,
          item_name: item.item_name,
          sku_id: item.sku_id,
          ordered_qty: item.quantity,
          already_received: item.quantity_received,
          unit_of_measure: item.unit_of_measure,
          lpo_unit_price: item.unit_price,
          unit_price: item.unit_price,
          qty_receiving: maxReceivable,
          max_receivable: maxReceivable,
        };
      }),
    );
  }, [lpo, open]);

  const totalReceiving = lines.reduce((s, l) => s + l.qty_receiving * l.unit_price, 0);

  const patchLine = (id: string, patch: Partial<ReceiveLine>) =>
    setLines(prev => prev.map(l => l.lpo_item_id === id ? { ...l, ...patch } : l));

  const setQty = (id: string, raw: string) => {
    const max = lines.find(l => l.lpo_item_id === id)?.max_receivable ?? 0;
    patchLine(id, { qty_receiving: Math.min(Math.max(0, parseFloat(raw) || 0), max) });
  };

  const setUnitPrice = (id: string, raw: string) =>
    patchLine(id, { unit_price: Math.max(0, parseFloat(raw) || 0) });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lpo) return;

    const activeLines = lines.filter(l => l.qty_receiving > 0);
    if (activeLines.length === 0) {
      toast({ title: 'No quantities entered', variant: 'destructive' });
      return;
    }
    if (!budgetId) {
      toast({ title: 'Please select a budget for the expense record', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // 1. Create GRN header
      const receiptNumber = `GRN-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
      const { data: receipt, error: rErr } = await (supabase as any)
        .from('lpo_receipts')
        .insert({
          lpo_id: lpo.id,
          receipt_number: receiptNumber,
          received_date: receivedDate,
          received_by: user?.id,
          notes: notes || null,
          total_received_amount: totalReceiving,
        })
        .select()
        .single();
      if (rErr) throw rErr;

      // 2. Create GRN line items (using actual received prices)
      const receiptItems = activeLines.map(l => ({
        receipt_id: receipt.id,
        lpo_item_id: l.lpo_item_id,
        item_name: l.item_name,
        quantity_received: l.qty_receiving,
        unit_price: l.unit_price,
        total_price: l.qty_receiving * l.unit_price,
      }));
      const { error: riErr } = await (supabase as any).from('lpo_receipt_items').insert(receiptItems);
      if (riErr) throw riErr;

      // 3. Update lpo_items.quantity_received
      for (const line of activeLines) {
        await (supabase as any)
          .from('lpo_items')
          .update({ quantity_received: line.already_received + line.qty_receiving })
          .eq('id', line.lpo_item_id);
      }

      // 4. Determine new LPO status
      const fullyReceived = lines.every(l => {
        const nowReceived = l.already_received + (activeLines.find(a => a.lpo_item_id === l.lpo_item_id)?.qty_receiving ?? 0);
        return nowReceived >= l.ordered_qty;
      });

      const { error: lpoErr } = await (supabase as any)
        .from('lpos')
        .update({ status: fullyReceived ? 'received' : 'partially_received' })
        .eq('id', lpo.id);
      if (lpoErr) throw lpoErr;

      // 5. Create expense record at actual received value
      const expenseDescription = `Purchase receipt ${receiptNumber} — ${lpo.supplier_name} (${lpo.lpo_number})`;
      const { data: expense, error: expErr } = await supabase.from('expenses').insert({
        amount: totalReceiving,
        description: expenseDescription,
        category: lpo.expense_category ?? 'Raw Materials',
        date: receivedDate,
        budget_id: budgetId,
        account_type: lpo.account_type ?? 'COGS',
        cost_center: lpo.cost_center ?? 'Daily Orders',
        payment_method: lpo.payment_method ?? null,
      }).select('id').single();
      if (expErr) throw expErr;

      // 6. Link expense to GRN
      await (supabase as any)
        .from('lpo_receipts')
        .update({ expense_id: expense.id })
        .eq('id', receipt.id);

      // 7. Update SKU stock quantities and record transactions for every received line
      for (const line of activeLines) {
        if (!line.sku_id) continue;

        const { data: skuRow } = await supabase
          .from('skus')
          .select('stock_quantity')
          .eq('id', line.sku_id)
          .single();

        if (skuRow) {
          await supabase
            .from('skus')
            .update({ stock_quantity: skuRow.stock_quantity + line.qty_receiving })
            .eq('id', line.sku_id);
        }

        await supabase.from('transactions').insert({
          sku_id:           line.sku_id,
          transaction_type: 'PURCHASE',
          quantity:         line.qty_receiving,
          unit_price:       line.unit_price,
          total_amount:     line.qty_receiving * line.unit_price,
          notes:            `GRN ${receiptNumber} — ${lpo.lpo_number}`,
          user_id:          user?.id,
        });
      }

      // 8. If this LPO was raised from an inventory request and is now fully received,
      //    automatically mark that request as fulfilled.
      if (lpo.inventory_request_id && fullyReceived) {
        const totalQtyReceived = activeLines.reduce((s, l) => s + l.qty_receiving, 0);
        await supabase
          .from('inventory_requests')
          .update({
            status:             'fulfilled',
            fulfilled_quantity: totalQtyReceived,
            fulfilled_date:     receivedDate,
            purchase_cost:      totalReceiving,
          })
          .eq('id', lpo.inventory_request_id);

        qc.invalidateQueries({ queryKey: ['inventory-requests'] });
      }

      toast({
        title: 'Goods received',
        description: `${receiptNumber} · ₦${totalReceiving.toLocaleString('en-NG', { minimumFractionDigits: 2 })} added to expenses`,
      });

      qc.invalidateQueries({ queryKey: ['lpos'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['pl-expenses'] });
      qc.invalidateQueries({ queryKey: ['inv-req-skus'] });
      qc.invalidateQueries({ queryKey: ['skus'] });

      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!lpo) return null;

  const hasPriceVariance = lines.some(l => l.unit_price !== l.lpo_unit_price && l.qty_receiving > 0);
  const lpoTotal = lines.reduce((s, l) => s + l.qty_receiving * l.lpo_unit_price, 0);
  const variance = totalReceiving - lpoTotal;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 p-5 shrink-0 rounded-t-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-xl flex items-center gap-2">
              <PackageCheck className="h-5 w-5" />
              Receive Goods
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-white/80 text-sm">
            <span className="font-mono font-semibold text-white">{lpo.lpo_number}</span>
            <span>·</span>
            <span>{lpo.supplier_name}</span>
            <span className="ml-auto font-semibold text-white">LPO: {formatNairaCompact(lpo.total_amount)}</span>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <form id="receive-form" onSubmit={handleSubmit}>
            <div className="p-5 space-y-5">

              {/* Receipt Details */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Received Date <span className="text-destructive">*</span></Label>
                  <Input
                    type="date"
                    value={receivedDate}
                    onChange={e => setReceivedDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Charge to Budget <span className="text-destructive">*</span></Label>
                  <Select value={budgetId || '__none'} onValueChange={v => setBudgetId(v === '__none' ? '' : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select budget…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— Select —</SelectItem>
                      {budgets.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {/* Line Items */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    Items to Receive
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Actual unit prices may differ from the LPO — edit as needed
                  </p>
                </div>

                <div className="rounded-lg border border-border/50 overflow-hidden">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_56px_56px_100px_88px_88px] gap-2 bg-muted/60 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    <span>Item</span>
                    <span className="text-right">Ordered</span>
                    <span className="text-right">Prev.</span>
                    <span className="text-right">Unit Price (₦)</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Value</span>
                  </div>

                  {lines.map((line, idx) => {
                    const priceUp   = line.unit_price > line.lpo_unit_price;
                    const priceDown = line.unit_price < line.lpo_unit_price;
                    const disabled  = line.max_receivable === 0;

                    return (
                      <div
                        key={line.lpo_item_id}
                        className={`grid grid-cols-[1fr_56px_56px_100px_88px_88px] gap-2 px-3 py-2.5 items-center text-sm border-t border-border/30 ${idx % 2 === 1 ? 'bg-muted/20' : ''} ${disabled ? 'opacity-50' : ''}`}
                      >
                        {/* Item name */}
                        <div>
                          <p className="font-medium leading-tight">{line.item_name}</p>
                          <p className="text-xs text-muted-foreground">{line.unit_of_measure}</p>
                        </div>

                        {/* Ordered */}
                        <div className="text-right text-muted-foreground text-xs">
                          {line.ordered_qty.toLocaleString()}
                        </div>

                        {/* Already received */}
                        <div className="text-right">
                          {line.already_received > 0 ? (
                            <Badge variant="outline" className="text-xs text-amber-700 border-amber-200 bg-amber-50 px-1">
                              {line.already_received.toLocaleString()}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </div>

                        {/* Actual unit price — editable */}
                        <div className="space-y-0.5">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8 text-sm text-right"
                            value={line.unit_price}
                            onChange={e => setUnitPrice(line.lpo_item_id, e.target.value)}
                            disabled={disabled}
                          />
                          {/* Show variance from LPO price */}
                          {(priceUp || priceDown) && (
                            <p className={`flex items-center justify-end gap-0.5 text-[10px] font-medium ${priceUp ? 'text-red-500' : 'text-emerald-600'}`}>
                              {priceUp
                                ? <TrendingUp className="h-2.5 w-2.5" />
                                : <TrendingDown className="h-2.5 w-2.5" />}
                              LPO: ₦{line.lpo_unit_price.toLocaleString('en-NG', { minimumFractionDigits: 2 })}
                            </p>
                          )}
                        </div>

                        {/* Qty receiving */}
                        <div>
                          <Input
                            type="number"
                            min="0"
                            max={line.max_receivable}
                            step="any"
                            className="h-8 text-sm text-right"
                            value={line.qty_receiving}
                            onChange={e => setQty(line.lpo_item_id, e.target.value)}
                            disabled={disabled}
                          />
                        </div>

                        {/* Line value */}
                        <div className="text-right font-semibold text-emerald-700">
                          {formatNairaCompact(line.qty_receiving * line.unit_price)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {lines.some(l => l.max_receivable === 0) && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Greyed items are fully received.
                  </p>
                )}
              </section>

              {/* Totals */}
              <div className="flex justify-end gap-3">
                {hasPriceVariance && (
                  <div className={`rounded-lg px-4 py-2 text-right border ${variance > 0 ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
                    <p className="text-xs text-muted-foreground">Price Variance</p>
                    <p className={`text-base font-bold ${variance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {variance > 0 ? '+' : ''}{formatNairaCompact(variance)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">vs LPO prices</p>
                  </div>
                )}
                <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2 dark:bg-emerald-950/20 dark:border-emerald-900/30 text-right">
                  <p className="text-xs text-muted-foreground">Total Receiving</p>
                  <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                    {formatNairaCompact(totalReceiving)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Expense of this amount will be created</p>
                </div>
              </div>

              <Separator />

              {/* Notes */}
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Condition of goods, delivery notes, price change reason…"
                  rows={3}
                />
              </div>

            </div>
          </form>
        </ScrollArea>

        <DialogFooter className="p-4 border-t border-border shrink-0 flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            form="receive-form"
            type="submit"
            disabled={saving || totalReceiving === 0}
            className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1"
          >
            <PackageCheck className="h-4 w-4 mr-2" />
            {saving ? 'Recording…' : 'Confirm Receipt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
