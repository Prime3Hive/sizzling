import * as React from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
//
// Exactly one overlay is mounted at a time. Rendering the Sheet and the Popover
// together and hiding one with `sm:hidden` does not work — both portal to
// <body> and escape the wrapper, so the modal Sheet ends up painting over the
// desktop layout and marking the Popover's portal aria-hidden while the search
// box inside it still holds focus.
// ─────────────────────────────────────────────────────────────────────────────

const SEARCHABLE_ABOVE = 8;

// Radix forbids an empty SelectItem value, so the "no selection" row carries a
// sentinel that is mapped back to '' on the way out.
const NONE = '__none__';

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
  const isDesktop = useMediaQuery('(min-width: 640px)');

  // options.length is not stable: reference lists arrive asynchronously (0 -> 13)
  // and typing in the search box does not shrink it, but a parent re-filtering
  // its own source list can. Deciding afresh every render would swap the control
  // between Select and Popover mid-life — a full unmount that throws away focus
  // and any open dropdown.
  //
  // So the decision runs off the high-water mark: it can only ever go from
  // "ordinary Select" to "searchable", once, when the real list first lands. It
  // never goes back, so a filter that narrows the list leaves the control alone.
  const maxOptions = React.useRef(0);
  if (options.length > maxOptions.current) maxOptions.current = options.length;
  const decided = maxOptions.current > 0;
  const searchable = maxOptions.current > SEARCHABLE_ABOVE;

  // Never uncontrolled: '' is a valid controlled value for Radix Select and
  // still shows the placeholder, whereas undefined makes it uncontrolled and
  // React warns the moment a value is picked.
  const current = value ?? '';
  const selected = options.find((o) => o.value === current);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // Nothing to choose from yet. A neutral disabled trigger keeps the layout
  // stable while the list loads, instead of an empty dropdown that opens onto
  // nothing.
  if (!decided) {
    return (
      <Button
        type="button"
        variant="outline"
        id={id}
        disabled
        aria-describedby={ariaDescribedBy}
        className={cn(
          'h-11 w-full justify-between font-normal text-base text-muted-foreground',
          className,
        )}
      >
        <span className="truncate">{placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>
    );
  }

  // Short lists keep the ordinary control.
  if (!searchable) {
    return (
      <Select value={current} onValueChange={(v) => onChange(v === NONE ? '' : v)} disabled={disabled}>
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
          {emptyOptionLabel && <SelectItem value={NONE}>{emptyOptionLabel}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const close = () => {
    setOpen(false);
    setQuery('');
  };

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
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          aria-hidden
        />
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
            selected={!current}
            onSelect={() => {
              onChange('');
              close();
            }}
          />
        )}
        {filtered.length === 0 && (
          <p className="px-3 py-6 text-sm text-muted-foreground text-center">
            No match for “{query}”.
          </p>
        )}
        {filtered.map((o) => (
          <OptionRow
            key={o.value}
            label={o.label}
            hint={o.hint}
            selected={o.value === current}
            onSelect={() => {
              onChange(o.value);
              close();
            }}
          />
        ))}
      </div>
    </div>
  );

  const heading = title ?? placeholder;

  // Desktop: the same search, in a popover.
  if (isDesktop) {
    return (
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
      >
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          className="p-2 w-[--radix-popover-trigger-width] min-w-[16rem]"
          align="start"
          aria-label={heading}
        >
          {list}
        </PopoverContent>
      </Popover>
    );
  }

  // Mobile: a searchable bottom sheet.
  return (
    <>
      {trigger}
      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
      >
        <SheetContent side="bottom" className="h-[85vh] flex flex-col pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="text-left">
            <SheetTitle>{heading}</SheetTitle>
            <SheetDescription>Search the list, then tap an option to choose it.</SheetDescription>
          </SheetHeader>
          <div className="mt-3 flex-1 min-h-0">{list}</div>
        </SheetContent>
      </Sheet>
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
