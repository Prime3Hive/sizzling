import React, { useState, useMemo } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import ExpenseFormDialog from '@/components/expenses/ExpenseFormDialog';
import ExpenseFilters from '@/components/expenses/ExpenseFilters';
import ExpenseTable from '@/components/expenses/ExpenseTable';
import ExpenseSummary from '@/components/expenses/ExpenseSummary';

const Expenses = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [filterStartDate, setFilterStartDate] = useState<Date | undefined>();
  const [filterEndDate, setFilterEndDate] = useState<Date | undefined>();
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterBudget, setFilterBudget] = useState('all');

  const { data: budgets = [] } = useQuery({
    queryKey: ['expense-budgets', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('budgets')
        .select('id, title')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*, budgets(title)')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const filteredExpenses = useMemo(() => {
    return expenses.filter((expense: any) => {
      if (filterStartDate && new Date(expense.date) < filterStartDate) return false;
      if (filterEndDate && new Date(expense.date) > filterEndDate) return false;
      if (filterCategory !== 'all' && expense.category !== filterCategory) return false;
      if (filterBudget !== 'all' && expense.budget_id !== filterBudget) return false;
      return true;
    });
  }, [expenses, filterStartDate, filterEndDate, filterCategory, filterBudget]);

  const hasActiveFilters = !!(filterStartDate || filterEndDate || filterCategory !== 'all' || filterBudget !== 'all');

  const clearFilters = () => {
    setFilterStartDate(undefined);
    setFilterEndDate(undefined);
    setFilterCategory('all');
    setFilterBudget('all');
  };

  const handleExpenseAdded = () => {
    queryClient.invalidateQueries({ queryKey: ['expenses'] });
    queryClient.invalidateQueries({ queryKey: ['pl-expenses'] });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div><Skeleton className="h-8 w-48 mb-2" /><Skeleton className="h-4 w-96" /></div>
          <Skeleton className="h-10 w-32" />
        </div>
        <Card><CardHeader><Skeleton className="h-6 w-32" /></CardHeader><CardContent><div className="space-y-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Expenses</h1>
          <p className="text-muted-foreground">View and manage all registered expenses</p>
        </div>
        <ExpenseFormDialog budgets={budgets} onExpenseAdded={handleExpenseAdded} />
      </div>

      <ExpenseFilters
        filterStartDate={filterStartDate}
        filterEndDate={filterEndDate}
        filterCategory={filterCategory}
        filterBudget={filterBudget}
        budgets={budgets}
        onStartDateChange={setFilterStartDate}
        onEndDateChange={setFilterEndDate}
        onCategoryChange={setFilterCategory}
        onBudgetChange={setFilterBudget}
        onClear={clearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      <ExpenseTable
        expenses={filteredExpenses}
        totalCount={expenses.length}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        onAddExpense={() => {}}
      />

      <ExpenseSummary expenses={filteredExpenses} />
    </div>
  );
};

export default Expenses;
