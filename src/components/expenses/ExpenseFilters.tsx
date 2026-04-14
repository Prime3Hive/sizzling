import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { EXPENSE_CATEGORIES } from '@/lib/expenseConstants';

interface ExpenseFiltersProps {
  filterStartDate: Date | undefined;
  filterEndDate: Date | undefined;
  filterCategory: string;
  filterBudget: string;
  budgets: { id: string; title: string }[];
  onStartDateChange: (d: Date | undefined) => void;
  onEndDateChange: (d: Date | undefined) => void;
  onCategoryChange: (v: string) => void;
  onBudgetChange: (v: string) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
}

const ExpenseFilters = ({
  filterStartDate, filterEndDate, filterCategory, filterBudget,
  budgets, onStartDateChange, onEndDateChange, onCategoryChange, onBudgetChange,
  onClear, hasActiveFilters,
}: ExpenseFiltersProps) => (
  <Card>
    <CardContent className="pt-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("w-36 justify-start text-left font-normal", !filterStartDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                {filterStartDate ? format(filterStartDate, "MMM d, yyyy") : "Start date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={filterStartDate} onSelect={onStartDateChange} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("w-36 justify-start text-left font-normal", !filterEndDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                {filterEndDate ? format(filterEndDate, "MMM d, yyyy") : "End date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={filterEndDate} onSelect={onEndDateChange} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={filterCategory} onValueChange={onCategoryChange}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Budget</Label>
          <Select value={filterBudget} onValueChange={onBudgetChange}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Budgets</SelectItem>
              {budgets.map(b => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClear} className="h-9">
            <X className="h-3.5 w-3.5 mr-1" />Clear
          </Button>
        )}
      </div>
    </CardContent>
  </Card>
);

export default ExpenseFilters;
