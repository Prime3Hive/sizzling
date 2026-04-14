import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getCategoryColor, getCategoryLabel, INVENTORY_CATEGORIES } from "@/lib/inventoryConstants";
import { formatNairaCompact } from "@/lib/currency";

interface SKU {
  id: string;
  name: string;
  category: string;
  stock_quantity: number;
  reorder_level: number;
  cost_per_unit: number;
}

interface CategoryBreakdownProps {
  skus: SKU[];
}

export function CategoryBreakdown({ skus }: CategoryBreakdownProps) {
  const categoryStats = INVENTORY_CATEGORIES.map(cat => {
    const items = skus.filter(sku => sku.category === cat.value);
    const totalValue = items.reduce((sum, sku) => sum + (sku.stock_quantity * sku.cost_per_unit), 0);
    const lowStock = items.filter(sku => sku.stock_quantity <= sku.reorder_level).length;
    
    return {
      ...cat,
      itemCount: items.length,
      totalValue,
      lowStockCount: lowStock,
    };
  }).filter(cat => cat.itemCount > 0);

  const totalValue = categoryStats.reduce((sum, cat) => sum + cat.totalValue, 0);

  if (categoryStats.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Inventory by Category</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {categoryStats.map(cat => {
          const colors = getCategoryColor(cat.value);
          const percentage = totalValue > 0 ? (cat.totalValue / totalValue) * 100 : 0;
          
          return (
            <div key={cat.value} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge className={`${colors.bg} ${colors.text} ${colors.border}`}>
                    {cat.label}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {cat.itemCount} items
                  </span>
                  {cat.lowStockCount > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {cat.lowStockCount} low
                    </Badge>
                  )}
                </div>
                <span className="font-medium text-sm">
                  {formatNairaCompact(cat.totalValue)}
                </span>
              </div>
              <Progress value={percentage} className="h-2" />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
