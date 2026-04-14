import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatNairaCompact } from '@/lib/currency';

interface Expense {
  id: string;
  amount: number;
  category: string;
  receipt_path: string | null;
}

const getCategoryColor = (category: string) => {
  const colors: Record<string, string> = {
    'Proteins': 'bg-red-500/10 text-red-500 border-red-500/20',
    'Snacks': 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    'Chefs Payment': 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    'Waiters Payment': 'bg-green-500/10 text-green-500 border-green-500/20',
    'Miscellaneous': 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  };
  return colors[category] || 'bg-muted text-muted-foreground';
};

const ExpenseSummary = ({ expenses }: { expenses: Expense[] }) => {
  if (expenses.length === 0) return null;

  const totalAmount = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const categoryMap = expenses.reduce((acc, e) => {
    const cat = e.category || 'Uncategorized';
    if (!acc[cat]) acc[cat] = { count: 0, amount: 0 };
    acc[cat].count += 1;
    acc[cat].amount += Number(e.amount);
    return acc;
  }, {} as Record<string, { count: number; amount: number }>);
  const sorted = Object.entries(categoryMap).sort((a, b) => b[1].amount - a[1].amount);

  return (
    <>
      <Card>
        <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Total Expenses</p>
              <p className="text-2xl font-bold">{expenses.length}</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Total Amount</p>
              <p className="text-2xl font-bold">{formatNairaCompact(totalAmount)}</p>
            </div>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">With Receipts</p>
              <p className="text-2xl font-bold">{expenses.filter(e => e.receipt_path).length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expense by Category</CardTitle>
          <CardDescription>Breakdown of spending across categories</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sorted.map(([category, data]) => {
              const percentage = totalAmount > 0 ? (data.amount / totalAmount) * 100 : 0;
              return (
                <div key={category} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={getCategoryColor(category)}>{category}</Badge>
                      <span className="text-sm text-muted-foreground">({data.count} expense{data.count !== 1 ? 's' : ''})</span>
                    </div>
                    <div className="text-right">
                      <span className="font-semibold">{formatNairaCompact(data.amount)}</span>
                      <span className="text-sm text-muted-foreground ml-2">({percentage.toFixed(1)}%)</span>
                    </div>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className="bg-primary h-2 rounded-full transition-all duration-300" style={{ width: `${percentage}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="border-t pt-4 mt-4 flex items-center justify-between font-semibold">
              <span>Grand Total</span>
              <span className="text-lg">{formatNairaCompact(totalAmount)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
};

export default ExpenseSummary;
