import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';
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
  const [search, setSearch] = useState('');
  const monthIndex = parseInt(selectedMonth);

  const monthExpenses = useMemo(
    () => expenses.filter(e => new Date(e.date).getMonth() === monthIndex),
    [expenses, monthIndex],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return monthExpenses;
    const q = search.toLowerCase();
    return monthExpenses.filter(e =>
      (e.description || '').toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q) ||
      (e.cost_center || '').toLowerCase().includes(q) ||
      (e.payment_method || '').toLowerCase().includes(q),
    );
  }, [monthExpenses, search]);

  const cogsExpenses = filtered.filter(e => (e.account_type || 'COGS') === 'COGS');
  const opexExpenses = filtered.filter(e => e.account_type === 'OpEX');

  const totalCOGS = cogsExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalOpEX = opexExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const grandTotal = totalCOGS + totalOpEX;

  const renderExpenseTable = (items: Expense[], title: string, total: number, variant: 'cogs' | 'opex') => (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant={variant === 'cogs' ? 'destructive' : 'secondary'} className="text-sm">
            {formatNairaCompact(total)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {search ? 'No matching entries' : `No ${title.toLowerCase()} entries for ${MONTHS[monthIndex]}`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[80px]">Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Cost Centre</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map(expense => (
                  <TableRow key={expense.id} className="hover:bg-muted/20">
                    <TableCell className="text-sm">{format(new Date(expense.date), 'dd MMM')}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">
                      {expense.description || <span className="text-muted-foreground italic">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{expense.category}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {expense.cost_center || 'Daily Orders'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {expense.payment_method || '—'}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatNairaCompact(Number(expense.amount))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={5} className="text-sm">Subtotal ({items.length} {items.length === 1 ? 'entry' : 'entries'})</TableCell>
                  <TableCell className="text-right">{formatNairaCompact(total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h3 className="text-lg font-semibold">Expense Ledger</h3>
          <p className="text-sm text-muted-foreground">{MONTHS[monthIndex]} {selectedYear}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search expenses..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-9 w-48 text-sm"
            />
          </div>
          {search && (
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSearch('')}>
              <X className="h-4 w-4" />
            </Button>
          )}
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={i.toString()}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {search && (
        <p className="text-sm text-muted-foreground">
          Showing {filtered.length} of {monthExpenses.length} entries matching <span className="font-medium">"{search}"</span>
        </p>
      )}

      {renderExpenseTable(cogsExpenses, 'Cost of Goods Sold (COGS)', totalCOGS, 'cogs')}
      {renderExpenseTable(opexExpenses, 'Operating Expenses (OpEX)', totalOpEX, 'opex')}

      {/* Grand total */}
      <Card className="bg-muted/30 border-border/50">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-base">Grand Total — {MONTHS[monthIndex]}</p>
              {search && (
                <p className="text-xs text-muted-foreground mt-0.5">Filtered ({filtered.length} of {monthExpenses.length} entries)</p>
              )}
            </div>
            <p className="font-bold text-lg">{formatNairaCompact(grandTotal)}</p>
          </div>
          <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
            <span>COGS: <span className="font-medium text-foreground">{formatNairaCompact(totalCOGS)}</span></span>
            <span>OpEX: <span className="font-medium text-foreground">{formatNairaCompact(totalOpEX)}</span></span>
            <span>Entries: <span className="font-medium text-foreground">{filtered.length}</span></span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default MonthlyExpenseLedger;
