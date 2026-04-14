import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { TrendingDown, DollarSign, Package, Calendar } from "lucide-react";
import { Tables } from "@/integrations/supabase/types";
import { formatNairaCompact } from "@/lib/currency";
import { format, subDays, startOfDay, eachDayOfInterval } from "date-fns";

interface Transaction {
  id: string;
  transaction_type: string;
  sku_id: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  notes: string | null;
  created_at: string;
  skus?: { name: string; category: string | null; unit_of_measure: string } | null;
}

interface SKU {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  stock_quantity: number;
  reorder_level: number;
  cost_per_unit: number;
  notes?: string;
}

interface UsageAnalyticsProps {
  transactions: Transaction[];
  skus: SKU[];
}

export function UsageAnalytics({ transactions, skus }: UsageAnalyticsProps) {
  // Filter only usage/consumption transactions (negative quantities or specific types)
  const usageTransactions = transactions.filter(
    (t) => t.transaction_type === "usage" || t.transaction_type === "sale" || t.quantity < 0
  );

  // Get last 30 days of data
  const last30Days = eachDayOfInterval({
    start: subDays(new Date(), 29),
    end: new Date(),
  });

  // Daily usage trend
  const dailyUsage = last30Days.map((day) => {
    const dayStart = startOfDay(day);
    const dayTransactions = usageTransactions.filter((t) => {
      const txDate = startOfDay(new Date(t.created_at));
      return txDate.getTime() === dayStart.getTime();
    });

    const totalQuantity = dayTransactions.reduce((sum, t) => sum + Math.abs(Number(t.quantity)), 0);
    const totalCost = dayTransactions.reduce((sum, t) => sum + Math.abs(Number(t.total_amount || 0)), 0);

    return {
      date: format(day, "MMM dd"),
      quantity: totalQuantity,
      cost: totalCost,
    };
  });

  // Top consumed items
  const itemUsage = usageTransactions.reduce((acc, t) => {
    const skuName = t.skus?.name || "Unknown";
    if (!acc[skuName]) {
      acc[skuName] = { name: skuName, quantity: 0, cost: 0, category: t.skus?.category || "general" };
    }
    acc[skuName].quantity += Math.abs(Number(t.quantity));
    acc[skuName].cost += Math.abs(Number(t.total_amount || 0));
    return acc;
  }, {} as Record<string, { name: string; quantity: number; cost: number; category: string }>);

  const topItems = Object.values(itemUsage)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  // Usage by category
  const categoryUsage = usageTransactions.reduce((acc, t) => {
    const category = t.skus?.category || "general";
    if (!acc[category]) {
      acc[category] = { category, quantity: 0, cost: 0 };
    }
    acc[category].quantity += Math.abs(Number(t.quantity));
    acc[category].cost += Math.abs(Number(t.total_amount || 0));
    return acc;
  }, {} as Record<string, { category: string; quantity: number; cost: number }>);

  const categoryData = Object.values(categoryUsage).sort((a, b) => b.cost - a.cost);

  // Summary stats
  const totalUsageQuantity = usageTransactions.reduce((sum, t) => sum + Math.abs(Number(t.quantity)), 0);
  const totalUsageCost = usageTransactions.reduce((sum, t) => sum + Math.abs(Number(t.total_amount || 0)), 0);
  const avgDailyUsage = totalUsageQuantity / 30;
  const avgDailyCost = totalUsageCost / 30;

  const chartConfig = {
    quantity: { label: "Quantity", color: "hsl(var(--primary))" },
    cost: { label: "Cost", color: "hsl(var(--chart-2))" },
  };

  const pieColors = [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
  ];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <TrendingDown className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Usage (30d)</p>
                <p className="text-2xl font-bold">{totalUsageQuantity.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <DollarSign className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Cost (30d)</p>
                <p className="text-2xl font-bold">{formatNairaCompact(totalUsageCost)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary/50">
                <Package className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Daily Usage</p>
                <p className="text-2xl font-bold">{avgDailyUsage.toFixed(1)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent">
                <Calendar className="h-5 w-5 text-accent-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Daily Cost</p>
                <p className="text-2xl font-bold">{formatNairaCompact(avgDailyCost)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Usage Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Daily Usage Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <LineChart data={dailyUsage}>
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 12 }} 
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="quantity"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Cost by Category */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Cost by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <PieChart>
                <Pie
                  data={categoryData}
                  dataKey="cost"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ category, percent }) => 
                    `${category} (${(percent * 100).toFixed(0)}%)`
                  }
                  labelLine={false}
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={entry.category} fill={pieColors[index % pieColors.length]} />
                  ))}
                </Pie>
                <ChartTooltip 
                  content={({ payload }) => {
                    if (payload && payload[0]) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-background border rounded-lg p-2 shadow-lg">
                          <p className="font-medium capitalize">{data.category}</p>
                          <p className="text-sm text-muted-foreground">
                            Cost: {formatNairaCompact(data.cost)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Quantity: {data.quantity.toLocaleString()}
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Consumed Items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Consumed Items (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[300px]">
            <BarChart data={topItems} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis 
                type="category" 
                dataKey="name" 
                tick={{ fontSize: 12 }} 
                tickLine={false} 
                axisLine={false}
                width={120}
              />
              <ChartTooltip 
                content={({ payload }) => {
                  if (payload && payload[0]) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-background border rounded-lg p-2 shadow-lg">
                        <p className="font-medium">{data.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Quantity: {data.quantity.toLocaleString()}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Total Cost: {formatNairaCompact(data.cost)}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="quantity" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Category Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Category Usage Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Category</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total Quantity</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Total Cost</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Avg per Day</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {categoryData.map((cat) => (
                  <tr key={cat.category} className="border-b last:border-0">
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-sm font-medium capitalize bg-secondary text-secondary-foreground">
                        {cat.category}
                      </span>
                    </td>
                    <td className="text-right py-3 px-4 font-medium">
                      {cat.quantity.toLocaleString()}
                    </td>
                    <td className="text-right py-3 px-4 font-medium">
                      {formatNairaCompact(cat.cost)}
                    </td>
                    <td className="text-right py-3 px-4 text-muted-foreground">
                      {(cat.quantity / 30).toFixed(1)}
                    </td>
                    <td className="text-right py-3 px-4 text-muted-foreground">
                      {totalUsageCost > 0 ? ((cat.cost / totalUsageCost) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
