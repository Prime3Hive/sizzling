import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import ExpenseFormDialog, { type EditingExpense } from '@/components/expenses/ExpenseFormDialog';
import BulkExpenseDialog from '@/components/expenses/BulkExpenseDialog';
import ExpenseFilters from '@/components/expenses/ExpenseFilters';
import ExpenseTable, { type ExpenseRow } from '@/components/expenses/ExpenseTable';
import ExpenseSummary from '@/components/expenses/ExpenseSummary';
import { useExpenseCategories } from '@/hooks/useExpenseReference';

const db = supabase as any;

const Expenses = () => {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editingExpense, setEditingExpense] = useState<EditingExpense | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [filterStartDate, setFilterStartDate] = useState<Date | undefined>();
  const [filterEndDate, setFilterEndDate] = useState<Date | undefined>();
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterBudget, setFilterBudget] = useState('all');

  const { data: categories = [] } = useExpenseCategories();

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

  const { data: expenses = [], isLoading } = useQuery<ExpenseRow[]>({
    queryKey: ['expenses', user?.id],
    queryFn: async () => {
      const { data, error } = await db
        .from('expenses')
        .select('*, budgets(title), payees(name)')
        .is('cancelled_at', null)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Names for the approver column.
  const { data: profiles = [] } = useQuery<{ user_id: string; full_name: string }[]>({
    queryKey: ['profiles-min'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('user_id, full_name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const nameOf = useMemo(() => {
    const map = Object.fromEntries(profiles.map((p) => [p.user_id, p.full_name]));
    return (id: string | null | undefined) => (id ? (map[id] ?? '—') : '—');
  }, [profiles]);

  const filteredExpenses = useMemo(
    () =>
      expenses.filter((e) => {
        if (filterStartDate && new Date(e.date) < filterStartDate) return false;
        if (filterEndDate && new Date(e.date) > filterEndDate) return false;
        if (filterCategory !== 'all' && e.category !== filterCategory) return false;
        if (filterBudget !== 'all' && e.budget_id !== filterBudget) return false;
        return true;
      }),
    [expenses, filterStartDate, filterEndDate, filterCategory, filterBudget],
  );

  const activeCount =
    (filterStartDate ? 1 : 0) + (filterEndDate ? 1 : 0) +
    (filterCategory !== 'all' ? 1 : 0) + (filterBudget !== 'all' ? 1 : 0);
  const hasActiveFilters = activeCount > 0;

  const clearFilters = () => {
    setFilterStartDate(undefined);
    setFilterEndDate(undefined);
    setFilterCategory('all');
    setFilterBudget('all');
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['expenses'] });
    queryClient.invalidateQueries({ queryKey: ['pl-expenses'] });
    queryClient.invalidateQueries({ queryKey: ['budgets-with-spend'] });
  };

  // Maker-checker: an admin approves or rejects. A DB trigger posts the
  // journal on approval and refuses a non-admin status change.
  const setStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) => {
      const { error } = await supabase.from('expenses').update({ status }).eq('id', id);
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      refresh();
      toast({ title: status === 'approved' ? 'Expense approved' : 'Expense rejected' });
    },
    onError: (error: any) => toast({ title: 'Error', description: error.message, variant: 'destructive' }),
  });

  // Expenses are cancelled, never deleted. The record and the reason stay on
  // file, and the journal behind it is reversed rather than disappearing.
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const reason = window.prompt('Why is this expense being cancelled?')?.trim();
      if (!reason) throw new Error('A cancellation needs a reason. Nothing was changed.');
      const { error } = await db
        .from('expenses')
        .update({ cancelled_at: new Date().toISOString(), cancellation_reason: reason })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast({ title: 'Expense cancelled' });
    },
    onError: (error: any) => toast({ title: 'Error', description: error.message, variant: 'destructive' }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div><Skeleton className="h-8 w-48 mb-2" /><Skeleton className="h-4 w-96" /></div>
          <Skeleton className="h-10 w-32" />
        </div>
        <Card>
          <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
          <CardContent>
            <div className="space-y-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Expenses</h1>
          <p className="text-muted-foreground">View and manage all registered expenses</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <BulkExpenseDialog onDone={refresh} />
          <ExpenseFormDialog onExpenseAdded={refresh} />
        </div>
      </div>

      <ExpenseFilters
        filterStartDate={filterStartDate}
        filterEndDate={filterEndDate}
        filterCategory={filterCategory}
        filterBudget={filterBudget}
        categories={categories}
        budgets={budgets}
        onStartDateChange={setFilterStartDate}
        onEndDateChange={setFilterEndDate}
        onCategoryChange={setFilterCategory}
        onBudgetChange={setFilterBudget}
        onClear={clearFilters}
        hasActiveFilters={hasActiveFilters}
        activeCount={activeCount}
      />

      <ExpenseTable
        expenses={filteredExpenses}
        totalCount={expenses.length}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        onAddExpense={() => {}}
        onEdit={(e) => { setEditingExpense(e as EditingExpense); setIsEditOpen(true); }}
        onDelete={(id) => setDeleteId(id)}
        onSetStatus={isAdmin ? (id, status) => setStatusMutation.mutate({ id, status }) : undefined}
        nameOf={nameOf}
      />

      {editingExpense && (
        <ExpenseFormDialog
          onExpenseAdded={refresh}
          editingExpense={editingExpense}
          isEditOpen={isEditOpen}
          onEditOpenChange={(open) => { setIsEditOpen(open); if (!open) setEditingExpense(null); }}
          onExpenseUpdated={() => { refresh(); setEditingExpense(null); }}
        />
      )}

      <ExpenseSummary expenses={filteredExpenses} />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
        title="Cancel this expense?"
        description="The expense stays on file, marked cancelled with your reason, and any journal posted against it is reversed. You will be asked why."
        confirmLabel="Cancel expense"
        onConfirm={() => { if (deleteId) { deleteMutation.mutate(deleteId); setDeleteId(null); } }}
      />
    </div>
  );
};

export default Expenses;
