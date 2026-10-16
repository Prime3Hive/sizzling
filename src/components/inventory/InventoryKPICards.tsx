import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, AlertTriangle, TrendingUp, TrendingDown, DollarSign, BarChart3 } from "lucide-react";
import { formatNairaCompact } from "@/lib/currency";

interface SKU {
  id: string;
  name: string;
  category: string;
  stock_quantity: number;
  reorder_level: number;
  cost_per_unit: number;
}

interface Transaction {
  id: string;
  transaction_type: string;
  quantity: number;
  total_amount: number;
  created_at: string;
}

/** A stock movement from the ledger, valued at its own unit cost. */
export interface KPIMovement {
  movement_type: string;
  quantity_change: number;
  unit_cost: number | null;
}

interface InventoryKPICardsProps {
  skus: SKU[];
  transactions: Transaction[];
  /** Last 30 days of stock movements. When given, Purchases/Usage come from
   *  here — the only record that includes LPO receipts and invoiced sales. */
  movements30d?: KPIMovement[];
}

export function InventoryKPICards({ skus, transactions, movements30d }: InventoryKPICardsProps) {
  const totalItems = skus.length;
  const lowStockItems = skus.filter(sku => sku.stock_quantity <= sku.reorder_level);
  const outOfStockItems = skus.filter(sku => sku.stock_quantity <= 0);
  // An item below zero is worth nothing, not a negative amount that quietly
  // shrinks everything else's value.
  const totalStockValue = skus.reduce((total, sku) => total + (Math.max(Number(sku.stock_quantity), 0) * Number(sku.cost_per_unit || 0)), 0);
  
  // Calculate transaction trends (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentTransactions = transactions.filter(t => 
    new Date(t.created_at) >= thirtyDaysAgo
  );
  
  const purchases = recentTransactions.filter(t => t.transaction_type === 'PURCHASE');
  const sales = recentTransactions.filter(t => t.transaction_type === 'SALE');
  
  const valueOf = (m: KPIMovement) => Number(m.quantity_change) * Number(m.unit_cost || 0);
  const stockIns = movements30d?.filter(m => m.movement_type === 'purchase' && Number(m.quantity_change) > 0);
  // Kitchen usage and invoiced sales, net of invoice cancellations (reversals).
  const stockOuts = movements30d?.filter(m => ['usage', 'sale', 'reversal'].includes(m.movement_type));

  const totalPurchaseValue = stockIns
    ? stockIns.reduce((sum, m) => sum + valueOf(m), 0)
    : purchases.reduce((sum, t) => sum + (t.total_amount || 0), 0);
  const totalSalesValue = stockOuts
    ? -stockOuts.reduce((sum, m) => sum + valueOf(m), 0)
    : sales.reduce((sum, t) => sum + Math.abs(t.total_amount || 0), 0);
  const purchaseCount = stockIns ? stockIns.length : purchases.length;
  const usageCount = stockOuts ? stockOuts.filter(m => Number(m.quantity_change) < 0).length : sales.length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Total Items</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalItems}</div>
          <p className="text-xs text-muted-foreground">SKUs tracked</p>
        </CardContent>
      </Card>

      <Card className={lowStockItems.length > 0 ? 'border-orange-300 bg-orange-50/50' : ''}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Low Stock</CardTitle>
          <AlertTriangle className={`h-4 w-4 ${lowStockItems.length > 0 ? 'text-orange-500' : 'text-muted-foreground'}`} />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${lowStockItems.length > 0 ? 'text-orange-600' : ''}`}>
            {lowStockItems.length}
          </div>
          <p className="text-xs text-muted-foreground">Need reorder</p>
        </CardContent>
      </Card>

      <Card className={outOfStockItems.length > 0 ? 'border-destructive bg-destructive/5' : ''}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Out of Stock</CardTitle>
          <AlertTriangle className={`h-4 w-4 ${outOfStockItems.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${outOfStockItems.length > 0 ? 'text-destructive' : ''}`}>
            {outOfStockItems.length}
          </div>
          <p className="text-xs text-muted-foreground">Critical</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Stock Value</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatNairaCompact(totalStockValue)}</div>
          <p className="text-xs text-muted-foreground">Total inventory</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Purchases (30d)</CardTitle>
          <TrendingUp className="h-4 w-4 text-green-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{formatNairaCompact(totalPurchaseValue)}</div>
          <p className="text-xs text-muted-foreground">{purchaseCount} stock-ins</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Usage (30d)</CardTitle>
          <TrendingDown className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">{formatNairaCompact(totalSalesValue)}</div>
          <p className="text-xs text-muted-foreground">{usageCount} issues &amp; sales</p>
        </CardContent>
      </Card>
    </div>
  );
}
