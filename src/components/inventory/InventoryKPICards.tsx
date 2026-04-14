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

interface InventoryKPICardsProps {
  skus: SKU[];
  transactions: Transaction[];
}

export function InventoryKPICards({ skus, transactions }: InventoryKPICardsProps) {
  const totalItems = skus.length;
  const lowStockItems = skus.filter(sku => sku.stock_quantity <= sku.reorder_level);
  const outOfStockItems = skus.filter(sku => sku.stock_quantity <= 0);
  const totalStockValue = skus.reduce((total, sku) => total + (sku.stock_quantity * sku.cost_per_unit), 0);
  
  // Calculate transaction trends (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentTransactions = transactions.filter(t => 
    new Date(t.created_at) >= thirtyDaysAgo
  );
  
  const purchases = recentTransactions.filter(t => t.transaction_type === 'PURCHASE');
  const sales = recentTransactions.filter(t => t.transaction_type === 'SALE');
  
  const totalPurchaseValue = purchases.reduce((sum, t) => sum + (t.total_amount || 0), 0);
  const totalSalesValue = sales.reduce((sum, t) => sum + Math.abs(t.total_amount || 0), 0);
  
  // Stock turnover rate (simplified)
  const avgInventoryValue = totalStockValue > 0 ? totalStockValue : 1;
  const turnoverRate = totalSalesValue / avgInventoryValue;

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
          <p className="text-xs text-muted-foreground">{purchases.length} transactions</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Usage (30d)</CardTitle>
          <TrendingDown className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">{formatNairaCompact(totalSalesValue)}</div>
          <p className="text-xs text-muted-foreground">{sales.length} transactions</p>
        </CardContent>
      </Card>
    </div>
  );
}
