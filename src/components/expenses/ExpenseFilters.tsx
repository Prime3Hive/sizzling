import React, { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, SlidersHorizontal, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Expense filters. On a phone these collapse into a bottom sheet (§7) rather
// than wrapping into four rows of controls above the list.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  filterStartDate: Date | undefined;
  filterEndDate: Date | undefined;
  filterCategory: string;
  filterBudget: string;
  categories: { id: string; name: string }[];
  budgets: { id: string; title: string }[];
  onStartDateChange: (d: Date | undefined) => void;
  onEndDateChange: (d: Date | undefined) => void;
  onCategoryChange: (v: string) => void;
  onBudgetChange: (v: string) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
  activeCount: number;
}

export default function ExpenseFilters(props: Props) {
  const {
    filterStartDate, filterEndDate, filterCategory, filterBudget,
    categories, budgets, onStartDateChange, onEndDateChange,
    onCategoryChange, onBudgetChange, onClear, hasActiveFilters, activeCount,
  } = props;
  const [sheetOpen, setSheetOpen] = useState(false);

  const DateField = ({
    id, label, value, onChange, placeholder,
  }: {
    id: string; label: string; value: Date | undefined;
    onChange: (d: Date | undefined) => void; placeholder: string;
  }) => (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            className={cn('h-11 w-full justify-start text-left font-normal', !value && 'text-muted-foreground')}
          >
            <CalendarIcon className="mr-2 h-4 w-4 shrink-0" aria-hidden />
            {value ? format(value, 'd MMM yyyy') : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={value} onSelect={onChange} initialFocus className="p-3 pointer-events-auto" />
        </PopoverContent>
      </Popover>
    </div>
  );

  const controls = (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <DateField id="filter-from" label="From" value={filterStartDate} onChange={onStartDateChange} placeholder="Start date" />
      <DateField id="filter-to" label="To" value={filterEndDate} onChange={onEndDateChange} placeholder="End date" />
      <div className="space-y-1.5">
        <Label htmlFor="filter-category" className="text-xs text-muted-foreground">Category</Label>
        <SearchableSelect
          id="filter-category"
          options={[{ value: 'all', label: 'All categories' }, ...categories.map((c) => ({ value: c.name, label: c.name }))]}
          value={filterCategory}
          onChange={onCategoryChange}
          placeholder="All categories"
          title="Filter by category"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="filter-budget" className="text-xs text-muted-foreground">Budget</Label>
        <SearchableSelect
          id="filter-budget"
          options={[{ value: 'all', label: 'All budgets' }, ...budgets.map((b) => ({ value: b.id, label: b.title }))]}
          value={filterBudget}
          onChange={onBudgetChange}
          placeholder="All budgets"
          title="Filter by budget"
        />
      </div>
    </div>
  );

  return (
    <>
      {/* Phone: one button that opens a bottom sheet. */}
      <div className="sm:hidden flex gap-2">
        <Button variant="outline" className="h-11 flex-1 justify-between" onClick={() => setSheetOpen(true)}>
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Filters
          </span>
          {activeCount > 0 && <Badge className="ml-2">{activeCount}</Badge>}
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" className="h-11" onClick={onClear}>
            <X className="h-4 w-4 mr-1" aria-hidden />
            Clear
          </Button>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="text-left">
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {controls}
            <div className="flex gap-2">
              <Button variant="outline" className="h-11 flex-1" onClick={onClear}>Clear all</Button>
              <Button className="h-11 flex-1" onClick={() => setSheetOpen(false)}>Show results</Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Tablet and desktop: inline. */}
      <Card className="hidden sm:block">
        <CardContent className="pt-6 space-y-3">
          {controls}
          {hasActiveFilters && (
            <Button variant="ghost" className="h-9" onClick={onClear}>
              <X className="h-3.5 w-3.5 mr-1" aria-hidden />
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>
    </>
  );
}
