import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardCheck, Save, CheckCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { getCategoryColor, getCategoryLabel } from "@/lib/inventoryConstants";
import { recordStockMovements } from "@/lib/stockMovements";
import { useRoles } from "@/hooks/useRoles";
import { fmtQty } from "@/lib/units";
import { orderForCount } from "@/lib/itemMaster";
import type { ItemUnitInfo } from "@/hooks/useItemUnits";

interface SKU {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  stock_quantity: number;
  cost_per_unit: number;
  is_archived?: boolean;
}

interface StockTake {
  id: string;
  take_date: string;
  status: string;
  notes: string | null;
  total_items_counted: number;
  total_variance_value: number;
  completed_at: string | null;
  created_at: string;
}

interface StockTakeItem {
  sku_id: string;
  system_quantity: number;
  counted_quantity: number;
  variance: number;
  variance_value: number;
  notes: string;
}

interface StockReconciliationProps {
  skus: SKU[];
  stockTakes: StockTake[];
  onComplete: () => void;
  /** Storage place and "counted weekly" per item (item master). */
  unitsBySku?: Map<string, ItemUnitInfo>;
  /** Storage places in count order. */
  storagePlaces?: string[];
}

export function StockReconciliation({ skus: allSkus, stockTakes, onComplete, unitsBySku, storagePlaces = [] }: StockReconciliationProps) {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  // What a shortfall is recorded as. A weekly count IS the usage record: what
  // is missing since the last count was used. An opening count is a fresh
  // start after the units were set up.
  const [kind, setKind] = useState<'usage' | 'correction' | 'opening'>('usage');
  const placeOf = (s: SKU) => unitsBySku?.get(s.id)?.storagePlace ?? null;
  // Archived items are not on the shelf, so they are not on the count sheet.
  // Items marked "not counted weekly" are left off too, except for an opening
  // count, which is a full count of everything. The sheet follows the storage
  // places in order, so it reads the way the store is walked.
  const active = allSkus.filter(s => !s.is_archived);
  const leftOut = active.filter(s => unitsBySku?.get(s.id)?.countedWeekly === false);
  const skus = orderForCount(
    kind === 'opening' ? active : active.filter(s => !leftOut.includes(s)),
    placeOf, storagePlaces,
  );
  const [showReconciliationDialog, setShowReconciliationDialog] = useState(false);
  const [stockCounts, setStockCounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const initializeStockCounts = () => {
    const counts: Record<string, number> = {};
    skus.forEach(sku => {
      counts[sku.id] = sku.stock_quantity;
    });
    setStockCounts(counts);
    setNotes('');
    setKind('usage');
  };

  const handleStartReconciliation = () => {
    initializeStockCounts();
    setShowReconciliationDialog(true);
  };

  const updateCount = (skuId: string, count: number) => {
    setStockCounts(prev => ({
      ...prev,
      [skuId]: count
    }));
  };

  const getVariance = (sku: SKU): number => {
    const counted = stockCounts[sku.id] ?? sku.stock_quantity;
    return counted - sku.stock_quantity;
  };

  const getVarianceValue = (sku: SKU): number => {
    return getVariance(sku) * sku.cost_per_unit;
  };

  const hasVariance = (sku: SKU): boolean => {
    return getVariance(sku) !== 0;
  };

  const totalVarianceValue = skus.reduce((sum, sku) => sum + getVarianceValue(sku), 0);
  const itemsWithVariance = skus.filter(hasVariance);

  const handleSaveReconciliation = async () => {
    if (!user) return;

    setSaving(true);
    try {
      // Create stock take record
      const { data: stockTake, error: stockTakeError } = await supabase
        .from('stock_takes')
        .insert({
          user_id: user.id,
          created_by: user.id,
          take_date: new Date().toISOString().split('T')[0],
          status: 'completed',
          notes,
          total_items_counted: skus.length,
          total_variance_value: totalVarianceValue,
          completed_at: new Date().toISOString()
        })
        .select()
        .single();

      if (stockTakeError) throw stockTakeError;

      // Create stock take items
      const stockTakeItems = skus.map(sku => ({
        stock_take_id: stockTake.id,
        sku_id: sku.id,
        system_quantity: sku.stock_quantity,
        counted_quantity: stockCounts[sku.id] ?? sku.stock_quantity,
        variance: getVariance(sku),
        variance_value: getVarianceValue(sku),
        counted_by: user.id,
        counted_at: new Date().toISOString()
      }));

      const { error: itemsError } = await supabase
        .from('stock_take_items')
        .insert(stockTakeItems);

      if (itemsError) throw itemsError;

      // Book the variances through the stock ledger in one transaction:
      // inventory moves to the counted figure, each item gets a 'stock_take'
      // movement on its history, and the gain/loss posts to 5900 against 1200.
      // (Writing skus.stock_quantity directly — the old way — changed only the
      // mirror, which the next movement silently overwrote.)
      const variances = skus
        .map(sku => ({ sku, diff: (stockCounts[sku.id] ?? sku.stock_quantity) - sku.stock_quantity }))
        .filter(v => v.diff !== 0);
      if (variances.length > 0) {
        const common = {
          referenceType: 'stock_take' as const,
          referenceId: stockTake.id,
          occurredOn: stockTake.take_date,
        };
        const label = kind === 'opening' ? 'Opening count' : kind === 'usage' ? 'Weekly count' : 'Stock take';
        const note = `${label} ${stockTake.take_date}${notes ? ` — ${notes}` : ''}`;
        // Weekly count: what is missing was used. Everything else is a count
        // difference (found more than shown, or a plain correction).
        const used = kind === 'usage' ? variances.filter(v => v.diff < 0) : [];
        const counted = variances.filter(v => !used.includes(v));
        try {
          if (used.length) {
            await recordStockMovements({
              ...common, type: 'usage', transactionType: 'SALE',
              note: `${note} (used since the last count)`,
              lines: used.map(v => ({ sku_id: v.sku.id, quantity_change: v.diff })),
            });
          }
          if (counted.length) {
            await recordStockMovements({
              ...common, type: 'stock_take', transactionType: 'ADJUSTMENT', note,
              lines: counted.map(v => ({ sku_id: v.sku.id, quantity_change: v.diff })),
            });
          }
        } catch (e) {
          // Nothing (or only part) was adjusted; don't leave a "completed" count behind.
          if (!used.length || !counted.length) await supabase.from('stock_takes').delete().eq('id', stockTake.id);
          throw e;
        }
      }

      // An opening count starts the item's history afresh: movements before it
      // are marked "before unit change" and left out of usage figures.
      if (kind === 'opening') {
        const { error: markErr } = await (supabase as any).rpc('fn_mark_opening_count', {
          p_note: notes?.trim() || `Opening count ${stockTake.take_date}`,
        });
        if (markErr) throw new Error(`The count was saved, but it could not be marked as the opening count: ${markErr.message}`);
      }

      toast({ title: kind === 'opening' ? 'Opening count posted' : kind === 'usage' ? 'Count saved and usage recorded' : 'Stock take completed' });
      setShowReconciliationDialog(false);
      onComplete();
    } catch (error) {
      console.error('Error saving reconciliation:', error);
      toast({ title: 'Failed to save stock reconciliation', description: (error as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const recentStockTakes = stockTakes.slice(0, 5);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Stock count</CardTitle>
            <CardDescription>Count what is on the shelf once a week. What is missing since the last count is recorded as the week’s usage.</CardDescription>
          </div>
          <Button onClick={handleStartReconciliation}>
            <ClipboardCheck className="h-4 w-4 mr-2" />
            Start a count
          </Button>
        </CardHeader>
        <CardContent>
          {recentStockTakes.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Recent Stock Takes
              </p>
              {recentStockTakes.map(take => (
                <div 
                  key={take.id} 
                  className="flex items-center justify-between p-2 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <div>
                      <p className="font-medium text-sm">
                        {format(new Date(take.take_date), 'MMM dd, yyyy')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {take.total_items_counted} items counted
                      </p>
                    </div>
                  </div>
                  <Badge variant={take.total_variance_value === 0 ? 'secondary' : 'outline'}>
                    {take.total_variance_value === 0 ? 'No variance' : `₦${take.total_variance_value.toLocaleString()} variance`}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No stock takes recorded yet
            </p>
          )}
        </CardContent>
      </Card>

      {/* Stock Take Dialog */}
      <Dialog open={showReconciliationDialog} onOpenChange={setShowReconciliationDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Stock Take - {format(new Date(), 'MMM dd, yyyy')}
            </DialogTitle>
            <DialogDescription>
              Enter what is on the shelf, in each item’s stock unit. Leave a line alone if it matches.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div role="radiogroup" aria-label="What this count is" className="grid gap-2 sm:grid-cols-3">
              {([
                ['usage', 'Weekly count', 'What is missing is recorded as usage'],
                ['correction', 'Correction only', 'Differences are recorded as count corrections'],
                ...(isAdmin ? [['opening', 'Opening count', 'A fresh start after units were set up']] : []),
              ] as [typeof kind, string, string][]).map(([v, label, hint]) => (
                <button key={v} type="button" role="radio" aria-checked={kind === v} onClick={() => setKind(v)}
                  className={`rounded-xl border p-3 text-left ${kind === v ? 'border-primary bg-primary/5' : 'text-muted-foreground'}`}>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs">{hint}</span>
                </button>
              ))}
            </div>
            {kind === 'opening' && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                Do this once, after every item has its correct stock unit and pack sizes. Earlier movements stay on record,
                marked “before unit change”, and are left out of balances and usage figures from now on.
              </p>
            )}
            {leftOut.length > 0 && kind !== 'opening' && (
              <p className="text-xs text-muted-foreground">
                {leftOut.length} item{leftOut.length === 1 ? ' is' : 's are'} left out of the weekly count (set under Edit item) and not on this sheet.
              </p>
            )}
            {/* Summary */}
            <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
              <div className="text-center">
                <p className="text-2xl font-bold">{skus.length}</p>
                <p className="text-xs text-muted-foreground">Items to Count</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold ${itemsWithVariance.length > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                  {itemsWithVariance.length}
                </p>
                <p className="text-xs text-muted-foreground">Items with Variance</p>
              </div>
              <div className="text-center">
                <p className={`text-2xl font-bold ${totalVarianceValue !== 0 ? 'text-orange-600' : 'text-green-600'}`}>
                  ₦{Math.abs(totalVarianceValue).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {totalVarianceValue >= 0 ? 'Overage' : 'Shortage'}
                </p>
              </div>
            </div>

            {/* Items Table */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Kept in</TableHead>
                    <TableHead className="text-right">System Qty</TableHead>
                    <TableHead className="text-right">Counted Qty</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skus.map(sku => {
                    const variance = getVariance(sku);
                    const colors = getCategoryColor(sku.category);
                    const keptIn = placeOf(sku);
                    
                    return (
                      <TableRow key={sku.id} className={variance !== 0 ? 'bg-orange-50/50' : ''}>
                        <TableCell className="font-medium">{sku.name}</TableCell>
                        <TableCell>
                          {keptIn
                            ? <span className="text-sm">{keptIn}</span>
                            : <Badge className={`${colors.bg} ${colors.text} text-xs`}>{getCategoryLabel(sku.category)}</Badge>}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {fmtQty(Number(sku.stock_quantity))} {sku.unit_of_measure}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              aria-label={`Counted ${sku.name} in ${sku.unit_of_measure}`}
                              value={stockCounts[sku.id] ?? sku.stock_quantity}
                              onChange={(e) => updateCount(sku.id, Math.max(0, Number(e.target.value)))}
                              className="w-24 text-right"
                            />
                            <span className="w-12 text-left text-xs text-muted-foreground">{sku.unit_of_measure}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {variance !== 0 && (
                            <div className="flex items-center justify-end gap-1">
                              <AlertTriangle className="h-3 w-3 text-orange-500" />
                              <span className={variance > 0 ? 'text-green-600' : 'text-destructive'}>
                                {variance > 0 ? '+' : ''}{fmtQty(variance)} {sku.unit_of_measure}
                              </span>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Notes */}
            <div>
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any observations or explanations for variances..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReconciliationDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveReconciliation} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : kind === 'opening' ? 'Post opening count' : 'Save count'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
