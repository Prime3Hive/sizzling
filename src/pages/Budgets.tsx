import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Edit, Trash2, DollarSign, Eye, Search, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface BudgetItem {
  id: string;
  budget_id: string;
  category: string;
  amount: number;
}

interface Expense {
  id: string;
  budget_id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
}

interface Budget {
  id: string;
  title: string;
  total_budget: number;
  start_date: string;
  end_date: string;
  type: string;
  details?: string;
  created_at: string;
}

interface BudgetWithDetails extends Budget {
  items: BudgetItem[];
  expenses: Expense[];
  totalSpent: number;
}

const budgetTypes = ['week', 'event', 'activity'];
const expenseCategories = ['proteins', 'staff', 'waiters', 'chef', 'miscellaneous'];

const Budgets = () => {
  const [budgets, setBudgets] = useState<BudgetWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<BudgetWithDetails | null>(null);
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');

  const [formData, setFormData] = useState({
    title: '',
    totalBudget: '',
    startDate: '',
    endDate: '',
    type: 'monthly',
    details: ''
  });

  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      fetchBudgets();
    }
  }, [user]);

  const fetchBudgets = async () => {
    try {
      const { data: budgetsData, error: budgetsError } = await supabase
        .from('budgets')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (budgetsError) throw budgetsError;

      if (!budgetsData || budgetsData.length === 0) {
        setBudgets([]);
        setLoading(false);
        return;
      }

      const budgetIds = budgetsData.map(b => b.id);

      const [itemsResult, expensesResult] = await Promise.all([
        supabase
          .from('budget_items')
          .select('*')
          .in('budget_id', budgetIds),
        supabase
          .from('expenses')
          .select('*')
          .in('budget_id', budgetIds)
          .order('date', { ascending: false })
      ]);

      if (itemsResult.error) throw itemsResult.error;
      if (expensesResult.error) throw expensesResult.error;

      const items = itemsResult.data || [];
      const expenses = expensesResult.data || [];

      const budgetsWithDetails: BudgetWithDetails[] = budgetsData.map(budget => {
        const budgetItems = items.filter(item => item.budget_id === budget.id);
        const budgetExpenses = expenses.filter(exp => exp.budget_id === budget.id);
        const totalSpent = budgetExpenses.reduce((sum, exp) => sum + Number(exp.amount), 0);

        return {
          ...budget,
          items: budgetItems,
          expenses: budgetExpenses,
          totalSpent
        };
      });

      setBudgets(budgetsWithDetails);
    } catch (error: any) {
      toast({
        title: 'Error loading budgets',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const budgetData = {
        title: formData.title,
        total_budget: parseFloat(formData.totalBudget),
        start_date: formData.startDate,
        end_date: formData.endDate,
        type: formData.type,
        details: formData.details,
        user_id: user?.id
      };

      if (editingBudget) {
        const { error } = await supabase
          .from('budgets')
          .update(budgetData)
          .eq('id', editingBudget.id);

        if (error) throw error;
        toast({ title: 'Budget updated successfully!' });
      } else {
        const { error } = await supabase
          .from('budgets')
          .insert(budgetData);

        if (error) throw error;
        toast({ title: 'Budget created successfully!' });
      }

      setIsDialogOpen(false);
      setEditingBudget(null);
      resetForm();
      fetchBudgets();
    } catch (error: any) {
      toast({
        title: 'Error saving budget',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleEdit = (budget: Budget, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingBudget(budget);
    setFormData({
      title: budget.title,
      totalBudget: budget.total_budget.toString(),
      startDate: budget.start_date,
      endDate: budget.end_date,
      type: budget.type,
      details: budget.details || ''
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (budgetId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this budget? This will also delete all associated expenses.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('budgets')
        .delete()
        .eq('id', budgetId);

      if (error) throw error;
      toast({ title: 'Budget deleted successfully!' });
      fetchBudgets();
    } catch (error: any) {
      toast({
        title: 'Error deleting budget',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleBudgetClick = (budget: BudgetWithDetails) => {
    setSelectedBudget(budget);
    setIsDetailDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      title: '',
      totalBudget: '',
      startDate: '',
      endDate: '',
      type: 'monthly',
      details: ''
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
    }).format(amount);
  };

  const getExpensesByCategory = (expenses: Expense[]) => {
    const categoryTotals: Record<string, { total: number; count: number; expenses: Expense[] }> = {};
    
    // Initialize all categories
    expenseCategories.forEach(cat => {
      categoryTotals[cat] = { total: 0, count: 0, expenses: [] };
    });
    
    expenses.forEach(exp => {
      const category = exp.category.toLowerCase();
      if (categoryTotals[category]) {
        categoryTotals[category].total += Number(exp.amount);
        categoryTotals[category].count += 1;
        categoryTotals[category].expenses.push(exp);
      } else {
        // Handle any category not in predefined list
        if (!categoryTotals['miscellaneous']) {
          categoryTotals['miscellaneous'] = { total: 0, count: 0, expenses: [] };
        }
        categoryTotals['miscellaneous'].total += Number(exp.amount);
        categoryTotals['miscellaneous'].count += 1;
        categoryTotals['miscellaneous'].expenses.push(exp);
      }
    });
    
    return categoryTotals;
  };

  const getSpentPercentage = (spent: number, total: number) => {
    if (total === 0) return 0;
    return Math.min((spent / total) * 100, 100);
  };

  const filteredBudgets = useMemo(() => {
    return budgets.filter(budget => {
      if (searchQuery && !budget.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterType !== 'all' && budget.type !== filterType) return false;
      return true;
    });
  }, [budgets, searchQuery, filterType]);

  const hasActiveBudgetFilters = searchQuery || filterType !== 'all';

  const clearBudgetFilters = () => {
    setSearchQuery('');
    setFilterType('all');
  };

  if (loading) {
    return <div className="text-center py-12">Loading budgets...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Budgets</h1>
          <p className="text-muted-foreground">Manage your spending limits and financial goals.</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setEditingBudget(null); }}>
              <Plus className="h-4 w-4 mr-2" />
              Create Budget
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingBudget ? 'Edit Budget' : 'Create New Budget'}</DialogTitle>
              <DialogDescription>
                Set up a budget to track your spending against your financial goals.
              </DialogDescription>
            </DialogHeader>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Budget Title</Label>
                <Input
                  id="title"
                  placeholder="e.g., Monthly Expenses"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="details">Budget Details</Label>
                <Textarea
                  id="details"
                  placeholder="Describe what this budget covers..."
                  value={formData.details}
                  onChange={(e) => setFormData(prev => ({ ...prev, details: e.target.value }))}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="totalBudget">Total Budget (₦)</Label>
                <Input
                  id="totalBudget"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={formData.totalBudget}
                  onChange={(e) => setFormData(prev => ({ ...prev, totalBudget: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Budget Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {budgetTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="endDate">End Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" className="flex-1">
                  {editingBudget ? 'Update Budget' : 'Create Budget'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 flex-1 min-w-[200px] max-w-xs">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search budgets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {budgetTypes.map(t => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {hasActiveBudgetFilters && (
              <Button variant="ghost" size="sm" onClick={clearBudgetFilters} className="h-9">
                <X className="h-3.5 w-3.5 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {filteredBudgets.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            {budgets.length === 0 ? (
              <>
                <h3 className="text-lg font-semibold mb-2">No budgets yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first budget to start tracking your expenses
                </p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Your First Budget
                </Button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold mb-2">No budgets match your filters</h3>
                <Button variant="outline" onClick={clearBudgetFilters}>
                  Clear Filters
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredBudgets.map((budget) => {
            const spentPercentage = getSpentPercentage(budget.totalSpent, budget.total_budget);
            const remaining = budget.total_budget - budget.totalSpent;
            const isOverBudget = remaining < 0;

            return (
              <Card 
                key={budget.id} 
                className="cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => handleBudgetClick(budget)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-lg">{budget.title}</CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {budget.type.charAt(0).toUpperCase() + budget.type.slice(1)}
                        </Badge>
                      </CardDescription>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleEdit(budget, e)}
                        title="Edit budget"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleDelete(budget.id, e)}
                        title="Delete budget"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-3">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-foreground">{formatCurrency(budget.total_budget)}</p>
                    <p className="text-xs text-muted-foreground">Total Budget</p>
                  </div>

                  <Progress 
                    value={spentPercentage} 
                    className={`h-2 ${isOverBudget ? '[&>div]:bg-destructive' : ''}`}
                  />

                  <div className="flex justify-between text-sm">
                    <span className={`font-medium ${isOverBudget ? 'text-destructive' : 'text-primary'}`}>
                      {formatCurrency(budget.totalSpent)} spent
                    </span>
                    <span className={`font-medium ${isOverBudget ? 'text-destructive' : 'text-green-600'}`}>
                      {formatCurrency(remaining)} left
                    </span>
                  </div>

                  <p className="text-xs text-muted-foreground text-center">
                    {new Date(budget.start_date).toLocaleDateString()} - {new Date(budget.end_date).toLocaleDateString()}
                  </p>

                  <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground pt-2 border-t border-border">
                    <Eye className="h-3 w-3" />
                    <span>Click to view details</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Budget Detail Dialog */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedBudget && (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl">{selectedBudget.title}</DialogTitle>
                <DialogDescription>
                  <Badge variant="outline" className="mr-2">
                    {selectedBudget.type.charAt(0).toUpperCase() + selectedBudget.type.slice(1)}
                  </Badge>
                  {new Date(selectedBudget.start_date).toLocaleDateString()} - {new Date(selectedBudget.end_date).toLocaleDateString()}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                {/* Budget vs Spent Summary */}
                <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Initial Budget</p>
                    <p className="text-2xl font-bold text-foreground">{formatCurrency(selectedBudget.total_budget)}</p>
                  </div>
                  <div className="text-center border-x border-border">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Spent</p>
                    <p className={`text-2xl font-bold ${selectedBudget.totalSpent > selectedBudget.total_budget ? 'text-destructive' : 'text-primary'}`}>
                      {formatCurrency(selectedBudget.totalSpent)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Balance</p>
                    <p className={`text-2xl font-bold ${selectedBudget.total_budget - selectedBudget.totalSpent < 0 ? 'text-destructive' : 'text-green-600'}`}>
                      {formatCurrency(selectedBudget.total_budget - selectedBudget.totalSpent)}
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Budget Usage</span>
                    <span className={`font-medium ${selectedBudget.totalSpent > selectedBudget.total_budget ? 'text-destructive' : ''}`}>
                      {getSpentPercentage(selectedBudget.totalSpent, selectedBudget.total_budget).toFixed(1)}%
                    </span>
                  </div>
                  <Progress 
                    value={getSpentPercentage(selectedBudget.totalSpent, selectedBudget.total_budget)} 
                    className={`h-3 ${selectedBudget.totalSpent > selectedBudget.total_budget ? '[&>div]:bg-destructive' : ''}`}
                  />
                </div>

                {/* Expenses by Category Comparison */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-foreground">Expenses by Category</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Items</TableHead>
                        <TableHead className="text-right">Amount Spent</TableHead>
                        <TableHead className="text-right">% of Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(() => {
                        const categoryData = getExpensesByCategory(selectedBudget.expenses);
                        return expenseCategories.map(category => {
                          const data = categoryData[category] || { total: 0, count: 0 };
                          const percentage = selectedBudget.totalSpent > 0 
                            ? (data.total / selectedBudget.totalSpent * 100).toFixed(1)
                            : '0.0';
                          return (
                            <TableRow key={category}>
                              <TableCell className="font-medium capitalize">{category}</TableCell>
                              <TableCell className="text-right">{data.count}</TableCell>
                              <TableCell className="text-right">{formatCurrency(data.total)}</TableCell>
                              <TableCell className="text-right">{percentage}%</TableCell>
                            </TableRow>
                          );
                        });
                      })()}
                      <TableRow className="font-bold bg-muted/50">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right">{selectedBudget.expenses.length}</TableCell>
                        <TableCell className="text-right">{formatCurrency(selectedBudget.totalSpent)}</TableCell>
                        <TableCell className="text-right">100%</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* All Expenses List */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-foreground">All Expenses ({selectedBudget.expenses.length})</h3>
                  {selectedBudget.expenses.length > 0 ? (
                    <div className="max-h-64 overflow-y-auto border rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedBudget.expenses.map((expense) => (
                            <TableRow key={expense.id}>
                              <TableCell className="text-sm">
                                {new Date(expense.date).toLocaleDateString()}
                              </TableCell>
                              <TableCell className="font-medium">{expense.description}</TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="capitalize">
                                  {expense.category}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(expense.amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg">
                      No expenses recorded for this budget yet
                    </div>
                  )}
                </div>

                {/* Budget Notes */}
                {selectedBudget.details && (
                  <div className="space-y-2 pt-4 border-t border-border">
                    <h3 className="font-semibold text-foreground">Notes</h3>
                    <p className="text-sm text-muted-foreground">{selectedBudget.details}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Budgets;
