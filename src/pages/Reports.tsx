import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { BarChart3, PieChart, Download, TrendingUp, Calendar, DollarSign, Package, ShoppingCart, Warehouse } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { formatNairaCompact } from '@/lib/currency';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface SalesData {
  total_revenue: number;
  total_sales: number;
  completed_sales: number;
  pending_sales: number;
  avg_sale_value: number;
}

interface InventoryData {
  total_products: number;
  total_quantity: number;
  total_value: number;
  low_stock_items: number;
}

interface CategoryData {
  category: string;
  amount: number;
  count: number;
}

const Reports = () => {
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('current-month');
  const [customStartDate, setCustomStartDate] = useState<Date>();
  const [customEndDate, setCustomEndDate] = useState<Date>();
  const [salesData, setSalesData] = useState<SalesData>({
    total_revenue: 0,
    total_sales: 0,
    completed_sales: 0,
    pending_sales: 0,
    avg_sale_value: 0
  });
  const [inventoryData, setInventoryData] = useState<InventoryData>({
    total_products: 0,
    total_quantity: 0,
    total_value: 0,
    low_stock_items: 0
  });
  const [topProductsData, setTopProductsData] = useState<CategoryData[]>([]);

  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      fetchReportData();
    }
  }, [user, timeRange]);

  const getDateRange = () => {
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (timeRange) {
      case 'current-week':
        const currentDay = now.getDay();
        const mondayOffset = currentDay === 0 ? 6 : currentDay - 1; // Monday is 1, Sunday is 0
        startDate = new Date(now);
        startDate.setDate(now.getDate() - mondayOffset);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        break;
      case 'current-month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last-month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'current-year':
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
        break;
      case 'custom':
        startDate = customStartDate || new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = customEndDate || new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    return {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0]
    };
  };

  const fetchReportData = async () => {
    try {
      setLoading(true);
      const { start, end } = getDateRange();

      // Fetch sales data
      const { data: sales, error: salesError } = await supabase
        .from('sales')
        .select('*')
        .eq('user_id', user?.id)
        .gte('sale_date', start)
        .lte('sale_date', end);

      if (salesError) throw salesError;

      // Calculate sales metrics
      const totalRevenue = sales?.reduce((sum, sale) => sum + Number(sale.total_amount), 0) || 0;
      const totalSales = sales?.length || 0;
      const completedSales = sales?.filter(sale => sale.status === 'paid' || sale.status === 'partially_paid').length || 0;
      const pendingSales = sales?.filter(sale => sale.status === 'pending').length || 0;
      const avgSaleValue = totalSales > 0 ? totalRevenue / totalSales : 0;

      setSalesData({
        total_revenue: totalRevenue,
        total_sales: totalSales,
        completed_sales: completedSales,
        pending_sales: pendingSales,
        avg_sale_value: avgSaleValue
      });

      // Fetch inventory data
      const { data: inventory, error: inventoryError } = await supabase
        .from('inventory')
        .select('*');

      if (inventoryError) throw inventoryError;

      // Fetch products data separately
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('*');

      if (productsError) throw productsError;

      // Create product lookup map for inventory
      const inventoryProductMap = new Map();
      products?.forEach(product => {
        inventoryProductMap.set(product.id, product);
      });

      // Calculate inventory metrics
      const totalProducts = inventory?.length || 0;
      const totalQuantity = inventory?.reduce((sum, item) => sum + item.quantity, 0) || 0;
      const totalValue = inventory?.reduce((sum, item) => {
        const product = inventoryProductMap.get(item.product_id);
        const price = product?.price || 0;
        return sum + (item.quantity * Number(price));
      }, 0) || 0;
      const lowStockItems = inventory?.filter(item => item.quantity <= item.reorder_level).length || 0;

      setInventoryData({
        total_products: totalProducts,
        total_quantity: totalQuantity,
        total_value: totalValue,
        low_stock_items: lowStockItems
      });

      // Fetch top products by sales
      const { data: saleItems, error: saleItemsError } = await supabase
        .from('sale_items')
        .select(`
          *,
          products(name, category),
          sales!inner(user_id, sale_date)
        `)
        .eq('sales.user_id', user?.id)
        .gte('sales.sale_date', start)
        .lte('sales.sale_date', end);

      if (saleItemsError) throw saleItemsError;

      // Process top products data
      const productMap = new Map<string, { amount: number; count: number }>();

      saleItems?.forEach(item => {
        const productName = item.products?.name || 'Unknown Product';
        const amount = Number(item.total_price);
        const quantity = item.quantity;

        if (productMap.has(productName)) {
          const existing = productMap.get(productName)!;
          productMap.set(productName, {
            amount: existing.amount + amount,
            count: existing.count + quantity
          });
        } else {
          productMap.set(productName, { amount, count: quantity });
        }
      });

      const topProducts = Array.from(productMap.entries()).map(([category, data]) => ({
        category,
        amount: data.amount,
        count: data.count
      }));

      setTopProductsData(topProducts.sort((a, b) => b.amount - a.amount));

    } catch (error: any) {
      toast({
        title: 'Error loading report data',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getTimeRangeLabel = () => {
    switch (timeRange) {
      case 'current-week': return 'This Week';
      case 'current-month': return 'This Month';
      case 'last-month': return 'Last Month';
      case 'current-year': return 'This Year';
      case 'custom': return 'Custom Range';
      default: return 'This Month';
    }
  };

  const exportToCSV = () => {
    const salesCsv = [
      ['Metric', 'Value'].join(','),
      ['Total Revenue', salesData.total_revenue.toFixed(2)],
      ['Total Sales', salesData.total_sales.toString()],
      ['Completed Sales', salesData.completed_sales.toString()],
      ['Pending Sales', salesData.pending_sales.toString()],
      ['Average Sale Value', salesData.avg_sale_value.toFixed(2)]
    ].join('\n');

    const inventoryCsv = [
      ['Metric', 'Value'].join(','),
      ['Total Products', inventoryData.total_products.toString()],
      ['Total Quantity', inventoryData.total_quantity.toString()],
      ['Total Value', inventoryData.total_value.toFixed(2)],
      ['Low Stock Items', inventoryData.low_stock_items.toString()]
    ].join('\n');

    const topProductsCsv = [
      ['Product', 'Revenue', 'Quantity Sold'].join(','),
      ...topProductsData.map(item => [
        item.category,
        item.amount.toFixed(2),
        item.count.toString()
      ].join(','))
    ].join('\n');

    const fullReport = `Sales Report\n${salesCsv}\n\nInventory Report\n${inventoryCsv}\n\nTop Products\n${topProductsCsv}`;

    const blob = new Blob([fullReport], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `business-report-${timeRange}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Report exported',
      description: 'Your business report has been downloaded as CSV.',
    });
  };

  if (loading) {
    return <div className="text-center py-12">Loading reports...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Analytics & Reports</h1>
          <p className="text-muted-foreground">Real-time business insights and performance metrics.</p>
        </div>

        <div className="flex gap-4">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current-week">This Week</SelectItem>
              <SelectItem value="current-month">This Month</SelectItem>
              <SelectItem value="last-month">Last Month</SelectItem>
              <SelectItem value="current-year">This Year</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
          
          {timeRange === 'custom' && (
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-40 justify-start text-left font-normal">
                    <Calendar className="mr-2 h-4 w-4" />
                    {customStartDate ? format(customStartDate, "MMM d, yyyy") : "Start Date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={customStartDate}
                    onSelect={setCustomStartDate}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-40 justify-start text-left font-normal">
                    <Calendar className="mr-2 h-4 w-4" />
                    {customEndDate ? format(customEndDate, "MMM d, yyyy") : "End Date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={customEndDate}
                    onSelect={setCustomEndDate}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}
          
          <Button onClick={exportToCSV} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Sales Metrics */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Sales Performance</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNairaCompact(salesData.total_revenue)}</div>
              <p className="text-xs text-muted-foreground">{getTimeRangeLabel()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{salesData.total_sales}</div>
              <p className="text-xs text-muted-foreground">
                {salesData.completed_sales} completed, {salesData.pending_sales} pending
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Average Sale Value</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNairaCompact(salesData.avg_sale_value)}</div>
              <p className="text-xs text-muted-foreground">Per transaction</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completion Rate</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {salesData.total_sales > 0 ? `${((salesData.completed_sales / salesData.total_sales) * 100).toFixed(1)}%` : '0%'}
              </div>
              <p className="text-xs text-muted-foreground">Sales completed</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Inventory Metrics */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Inventory Overview</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Products</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{inventoryData.total_products}</div>
              <p className="text-xs text-muted-foreground">Unique products</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Stock</CardTitle>
              <Warehouse className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{inventoryData.total_quantity.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">Units in stock</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Stock Value</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNairaCompact(inventoryData.total_value)}</div>
              <p className="text-xs text-muted-foreground">Total inventory value</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Stock Alert</CardTitle>
              <Package className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{inventoryData.low_stock_items}</div>
              <p className="text-xs text-muted-foreground">Items need restock</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Selling Products</CardTitle>
            <CardDescription>
              Best performing products by revenue for {getTimeRangeLabel().toLowerCase()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topProductsData.length === 0 ? (
              <div className="text-center py-6">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No sales data in selected period</p>
              </div>
            ) : (
              <div className="space-y-4">
                {topProductsData.slice(0, 6).map((item, index) => {
                  const percentage = salesData.total_revenue > 0 ? (item.amount / salesData.total_revenue) * 100 : 0;
                  return (
                    <div key={item.category} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{item.category}</span>
                        <span>{formatNairaCompact(item.amount)} ({percentage.toFixed(1)}%)</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.count} unit{item.count !== 1 ? 's' : ''} sold
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sales vs Inventory Health</CardTitle>
            <CardDescription>
              Key business metrics overview
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <ShoppingCart className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Sales Growth</p>
                    <p className="text-sm text-muted-foreground">Current period performance</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatNairaCompact(salesData.total_revenue)}</p>
                  <p className="text-sm text-green-600">Revenue generated</p>
                </div>
              </div>
              
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <Package className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Inventory Status</p>
                    <p className="text-sm text-muted-foreground">Stock levels overview</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{inventoryData.total_quantity.toLocaleString()}</p>
                  <p className={cn(
                    "text-sm",
                    inventoryData.low_stock_items > 0 ? "text-destructive" : "text-green-600"
                  )}>
                    {inventoryData.low_stock_items > 0 ? `${inventoryData.low_stock_items} low stock` : 'All stocked'}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium">Efficiency Rate</p>
                    <p className="text-sm text-muted-foreground">Sales completion rate</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">
                    {salesData.total_sales > 0 ? `${((salesData.completed_sales / salesData.total_sales) * 100).toFixed(1)}%` : '0%'}
                  </p>
                  <p className="text-sm text-green-600">Orders completed</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Reports;