import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye, Download, Plus, Pencil, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { formatNairaCompact } from '@/lib/currency';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Expense {
  id: string;
  amount: number;
  description: string;
  category: string;
  date: string;
  budget_id: string;
  receipt_path: string | null;
  created_at: string;
  account_type: string | null;
  cost_center: string | null;
  bank_account: string | null;
  payment_method: string | null;
  budgets: { title: string } | null;
}

interface ExpenseTableProps {
  expenses: Expense[];
  totalCount: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onAddExpense: () => void;
  onEdit?: (expense: Expense) => void;
  onDelete?: (id: string) => void;
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

const ExpenseTable = ({ expenses, totalCount, hasActiveFilters, onClearFilters, onAddExpense, onEdit, onDelete }: ExpenseTableProps) => {
  const { toast } = useToast();

  const viewReceipt = async (receiptPath: string) => {
    try {
      const { data, error } = await supabase.storage.from('receipts').createSignedUrl(receiptPath, 60);
      if (error) throw error;
      window.open(data.signedUrl, '_blank');
    } catch (error: any) {
      toast({ title: 'Error viewing receipt', description: error.message, variant: 'destructive' });
    }
  };

  const downloadReceipt = async (receiptPath: string, expenseId: string) => {
    try {
      const { data, error } = await supabase.storage.from('receipts').download(receiptPath);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${expenseId}.${receiptPath.split('.').pop()}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      toast({ title: 'Error downloading receipt', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>All Expenses</CardTitle>
        <CardDescription>
          {hasActiveFilters ? `Showing ${expenses.length} of ${totalCount} expenses` : 'A detailed list of all expenses recorded'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {expenses.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              {totalCount === 0 ? 'No expenses recorded yet' : 'No expenses match your filters'}
            </p>
            {totalCount === 0 ? (
              <Button onClick={onAddExpense}><Plus className="mr-2 h-4 w-4" />Add Your First Expense</Button>
            ) : (
              <Button variant="outline" onClick={onClearFilters}>Clear Filters</Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px] min-w-[110px]">Date</TableHead>
                  <TableHead className="min-w-[180px]">Description</TableHead>
                  <TableHead className="w-[130px] min-w-[130px]">Category</TableHead>
                  <TableHead className="w-[120px] min-w-[120px]">Budget</TableHead>
                  <TableHead className="w-[110px] min-w-[110px] text-right">Amount</TableHead>
                  <TableHead className="w-[100px] min-w-[100px] text-center">Receipt</TableHead>
                  <TableHead className="w-[90px] min-w-[90px] text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="font-medium whitespace-nowrap">{format(new Date(expense.date), 'MMM dd, yyyy')}</TableCell>
                    <TableCell>
                      <div className="max-w-[250px]">
                        <p className="font-medium truncate">{expense.description}</p>
                        <p className="text-xs text-muted-foreground">Added {format(new Date(expense.created_at), 'MMM dd, yyyy')}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={getCategoryColor(expense.category)}>{expense.category}</Badge>
                    </TableCell>
                    <TableCell><span className="text-sm truncate block max-w-[120px]">{expense.budgets?.title || 'N/A'}</span></TableCell>
                    <TableCell className="text-right font-semibold whitespace-nowrap">{formatNairaCompact(expense.amount)}</TableCell>
                    <TableCell>
                      {expense.receipt_path ? (
                        <div className="flex gap-1 justify-center">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => viewReceipt(expense.receipt_path!)}><Eye className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => downloadReceipt(expense.receipt_path!, expense.id)}><Download className="h-4 w-4" /></Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground text-center block">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-center">
                        {onEdit && <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => onEdit(expense)}><Pencil className="h-3.5 w-3.5" /></Button>}
                        {onDelete && <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => onDelete(expense.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ExpenseTable;
