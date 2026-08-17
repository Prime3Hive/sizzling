import * as React from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ─────────────────────────────────────────────────────────────────────────────
// SearchableSelect
//
// §5.2: "Selects with more than 8 options become a searchable sheet on mobile,
// not a native dropdown — the category list has 13 and the budget list has 12."
//
// Under the threshold it stays an ordinary Select, because a searchable sheet
// for three cost centres is worse than a dropdown, not better.
// ─────────────────────────────────────────────────────────────────────────────

const SEARCHABLE_ABOVE = 8;

export interface SelectOption {
  value: string;
  label: string;
  /** Second line, e.g. an account code or a remaining budget. */
  hint?: string;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Sheet/popover heading. */
  title?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  ariaDescribedBy?: string;
  invalid?: boolean;
  className?: string;
  /** Shown as the first option and clears the value. */
  emptyOptionLabel?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select',
  title,
  id,
  disabled,
  required,
  ariaDescribedBy,
  invalid,
  className,
  emptyOptionLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const selected = options.find((o) => o.value === value);
  const searchable = options.length > SEARCHABLE_ABOVE;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // Short lists keep the ordinary control.
  if (!searchable) {
    return (
      <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={ariaDescribedBy}
          className={cn('h-11 text-base', invalid && 'border-destructive', className)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {emptyOptionLabel && <SelectItem value="__none__">{emptyOptionLabel}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const trigger = (
    <Button
      type="button"
      variant="outline"
      id={id}
      role="combobox"
      aria-expanded={open}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => setOpen(true)}
      // 44px minimum tap target, 16px text so iOS does not zoom.
      className={cn(
        'h-11 w-full justify-between font-normal text-base',
        !selected && 'text-muted-foreground',
        invalid && 'border-destructive',
        className,
      )}
    >
      <span className="truncate">{selected ? selected.label : placeholder}</span>
      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  const list = (
    <div className="flex flex-col min-h-0">
      <div className="relative px-1 pb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          aria-label={`Search ${title ?? 'options'}`}
          className="pl-9 h-11 text-base"
        />
      </div>
      <div className="overflow-y-auto -mx-1 px-1" style={{ maxHeight: '60vh' }} role="listbox">
        {emptyOptionLabel && (
          <OptionRow
            label={emptyOptionLabel}
            selected={!value}
            onSelect={() => {
              onChange('');
              setOpen(false);
              setQuery('');
            }}
          />
        )}
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-sm text-muted-foreground text-center">No match for “{query}”.</p>
        )}
        {filtered.map((o) => (
          <OptionRow
            key={o.value}
            label={o.label}
            hint={o.hint}
            selected={o.value === value}
            onSelect={() => {
              onChange(o.value);
              setOpen(false);
              setQuery('');
            }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile: a searchable bottom sheet. */}
      <div className="sm:hidden">
        {trigger}
        <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
          <SheetContent side="bottom" className="h-[85vh] flex flex-col pb-[env(safe-area-inset-bottom)]">
            <SheetHeader className="text-left">
              <SheetTitle>{title ?? placeholder}</SheetTitle>
            </SheetHeader>
            <div className="mt-3 flex-1 min-h-0">{list}</div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: the same search, in a popover. */}
      <div className="hidden sm:block">
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent className="p-2 w-[--radix-popover-trigger-width] min-w-[16rem]" align="start">
            {list}
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}

function OptionRow({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        // 44px minimum row height for a reliable tap.
        'w-full text-left flex items-start gap-2 rounded-md px-3 py-3 min-h-[44px]',
        'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-muted',
      )}
    >
      <Check className={cn('h-4 w-4 mt-0.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}
