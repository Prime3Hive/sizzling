import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatNairaCompact } from '@/lib/currency';
import { format } from 'date-fns';
import { MONTHS } from '@/lib/expenseConstants';

interface Expense {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  account_type: string | null;
  cost_center: string | null;
  payment_method: string | null;
  bank_account: string | null;
}

interface MonthlyExpenseLedgerProps {
  expenses: Expense[];
  selectedYear: string;
}

const MonthlyExpenseLedger = ({ expenses, selectedYear }: MonthlyExpenseLedgerProps) => {
  const currentMonth = new Date().getMonth();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth.toString());
  const monthIndex = parseInt(selectedMonth);

  const monthExpenses = expenses.filter(e => new Date(e.date).getMonth() === monthIndex);

  const cogsExpenses = monthExpenses.filter(e => (e.account_type || 'COGS') === 'COGS');
  const opexExpenses = monthExpenses.filter(e => e.account_type === 'OpEX');

  const totalCOGS = cogsExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalOpEX = opexExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const grandTotal = totalCOGS + totalOpEX;

  const renderExpenseTable = (items: Expense[], title: string, total: number, variant: 'cogs' | 'opex') => (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant={variant === 'cogs' ? 'destructive' : 'secondary'} className="text-sm">
            Total: {formatNairaCompact(total)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No {title.toLowerCase()} entries for {MONTHS[monthIndex]}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[90px]">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Cost Center</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(expense => (
                <TableRow key={expense.id}>
                  <TableCell className="text-sm">{format(new Date(expense.date), 'dd MMM')}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">{expense.description}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{expense.category}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{expense.cost_center || 'Daily Orders'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{expense.payment_method || '-'}</TableCell>
                  <TableCell className="text-right font-medium">{formatNairaCompact(Number(expense.amount))}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-bold bg-muted/50">
                <TableCell colSpan={5}>Subtotal</TableCell>
                <TableCell className="text-right">{formatNairaCompact(total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Expense Ledger — {MONTHS[monthIndex]} {selectedYear}</h3>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => (
              <SelectItem key={i} value={i.toString()}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {renderExpenseTable(cogsExpenses, 'Cost of Goods Sold (COGS)', totalCOGS, 'cogs')}
      {renderExpenseTable(opexExpenses, 'Operating Expenses (OpEX)', totalOpEX, 'opex')}

      <Card className="bg-muted/30">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-lg">Grand Total — {MONTHS[monthIndex]}</span>
            <span className="font-bold text-lg">{formatNairaCompact(grandTotal)}</span>
          </div>
          <div className="flex gap-6 mt-2 text-sm text-muted-foreground">
            <span>COGS: {formatNairaCompact(totalCOGS)}</span>
            <span>OpEX: {formatNairaCompact(totalOpEX)}</span>
            <span>Entries: {monthExpenses.length}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MonthlyExpenseLedger;
