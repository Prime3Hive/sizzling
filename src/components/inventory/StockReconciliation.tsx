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
import { toast } from "sonner";
import { format } from "date-fns";
import { getCategoryColor, getCategoryLabel } from "@/lib/inventoryConstants";

interface SKU {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  stock_quantity: number;
  cost_per_unit: number;
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
}

export function StockReconciliation({ skus, stockTakes, onComplete }: StockReconciliationProps) {
  const { user } = useAuth();
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

      // Update SKU quantities if there are variances
      for (const sku of skus) {
        const countedQty = stockCounts[sku.id] ?? sku.stock_quantity;
        if (countedQty !== sku.stock_quantity) {
          const { error: updateError } = await supabase
            .from('skus')
            .update({ stock_quantity: countedQty })
            .eq('id', sku.id);

          if (updateError) throw updateError;

          // Record adjustment transaction
          await supabase
            .from('transactions')
            .insert({
              transaction_type: 'ADJUSTMENT',
              sku_id: sku.id,
              quantity: countedQty - sku.stock_quantity,
              notes: `Stock reconciliation adjustment. Original: ${sku.stock_quantity}, Counted: ${countedQty}`,
              user_id: user.id,
              created_by: user.id,
              reference_id: stockTake.id
            });
        }
      }

      toast.success('Stock reconciliation completed successfully');
      setShowReconciliationDialog(false);
      onComplete();
    } catch (error) {
      console.error('Error saving reconciliation:', error);
      toast.error('Failed to save stock reconciliation');
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
            <CardTitle className="text-base">Stock Reconciliation</CardTitle>
            <CardDescription>Verify physical stock against system records</CardDescription>
          </div>
          <Button onClick={handleStartReconciliation}>
            <ClipboardCheck className="h-4 w-4 mr-2" />
            New Stock Take
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
              Count physical inventory and record any variances
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
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
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">System Qty</TableHead>
                    <TableHead className="text-right">Counted Qty</TableHead>
                    <TableHead className="text-right">Variance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {skus.map(sku => {
                    const variance = getVariance(sku);
                    const colors = getCategoryColor(sku.category);
                    
                    return (
                      <TableRow key={sku.id} className={variance !== 0 ? 'bg-orange-50/50' : ''}>
                        <TableCell className="font-medium">{sku.name}</TableCell>
                        <TableCell>
                          <Badge className={`${colors.bg} ${colors.text} text-xs`}>
                            {getCategoryLabel(sku.category)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {sku.stock_quantity} {sku.unit_of_measure}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            value={stockCounts[sku.id] ?? sku.stock_quantity}
                            onChange={(e) => updateCount(sku.id, Number(e.target.value))}
                            className="w-24 text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {variance !== 0 && (
                            <div className="flex items-center justify-end gap-1">
                              <AlertTriangle className="h-3 w-3 text-orange-500" />
                              <span className={variance > 0 ? 'text-green-600' : 'text-destructive'}>
                                {variance > 0 ? '+' : ''}{variance}
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
              {saving ? 'Saving...' : 'Complete Stock Take'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
