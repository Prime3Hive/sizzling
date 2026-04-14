import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCategoryColor, getCategoryLabel } from "@/lib/inventoryConstants";

interface SKU {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  stock_quantity: number;
  reorder_level: number;
  cost_per_unit: number;
}

interface LowStockAlertsProps {
  skus: SKU[];
  onReorder?: (sku: SKU) => void;
}

export function LowStockAlerts({ skus, onReorder }: LowStockAlertsProps) {
  const lowStockItems = skus.filter(sku => sku.stock_quantity <= sku.reorder_level);
  const criticalItems = lowStockItems.filter(sku => sku.stock_quantity <= 0);
  const warningItems = lowStockItems.filter(sku => sku.stock_quantity > 0);

  if (lowStockItems.length === 0) {
    return null;
  }

  return (
    <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-red-50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-orange-800">
          <AlertTriangle className="h-5 w-5" />
          Stock Alerts ({lowStockItems.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Critical - Out of Stock */}
        {criticalItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-destructive uppercase tracking-wide">
              Out of Stock ({criticalItems.length})
            </p>
            <div className="grid gap-2">
              {criticalItems.slice(0, 5).map(sku => {
                const colors = getCategoryColor(sku.category);
                return (
                  <div 
                    key={sku.id} 
                    className="flex items-center justify-between p-2 bg-destructive/10 border border-destructive/20 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive" className="text-xs">URGENT</Badge>
                      <span className="font-medium text-sm">{sku.name}</span>
                      <Badge className={`${colors.bg} ${colors.text} text-xs`}>
                        {getCategoryLabel(sku.category)}
                      </Badge>
                    </div>
                    {onReorder && (
                      <Button size="sm" variant="outline" onClick={() => onReorder(sku)}>
                        <ShoppingCart className="h-3 w-3 mr-1" />
                        Reorder
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Warning - Low Stock */}
        {warningItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
              Running Low ({warningItems.length})
            </p>
            <div className="grid gap-2">
              {warningItems.slice(0, 5).map(sku => {
                const colors = getCategoryColor(sku.category);
                return (
                  <div 
                    key={sku.id} 
                    className="flex items-center justify-between p-2 bg-orange-100/50 border border-orange-200 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{sku.name}</span>
                      <Badge className={`${colors.bg} ${colors.text} text-xs`}>
                        {getCategoryLabel(sku.category)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-orange-600 border-orange-300">
                        {sku.stock_quantity} / {sku.reorder_level} {sku.unit_of_measure}
                      </Badge>
                      {onReorder && (
                        <Button size="sm" variant="ghost" onClick={() => onReorder(sku)}>
                          <ShoppingCart className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {lowStockItems.length > 10 && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            +{lowStockItems.length - 10} more items need attention
          </p>
        )}
      </CardContent>
    </Card>
  );
}
