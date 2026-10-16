// Building blocks for the redesigned screens. Status is never colour alone:
// every pill carries its word, and the dot is decoration on top of it.

import * as React from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

// ── Page header ──────────────────────────────────────────────────────────────

export function PageHeader({
  eyebrow, title, description, actions, className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="text-sm font-medium text-muted-foreground">{eyebrow}</div>}
        {/* On a phone the top bar already shows the page's name, so the
            heading stays for screen readers but gives its space back. */}
        <h1 className="font-display text-[1.75rem] leading-tight font-bold max-lg:sr-only sm:text-[2rem]">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground max-lg:mt-0">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}

// ── Status pills ─────────────────────────────────────────────────────────────

export type Tone = 'pending' | 'good' | 'bad' | 'info' | 'neutral' | 'violet';

const TONE: Record<Tone, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  good: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  bad: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  neutral: 'bg-stone-100 text-stone-700 dark:bg-stone-500/15 dark:text-stone-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
};

const STATUS_TONE: Record<string, Tone> = {
  pending: 'pending', submitted: 'pending', draft: 'neutral', probation: 'pending',
  approved: 'good', fulfilled: 'good', published: 'good', active: 'good', paid: 'good', completed: 'good',
  rejected: 'bad', cancelled: 'bad', withdrawn: 'neutral', 'sent back': 'bad',
  'on leave': 'info', ready: 'neutral',
};

export function toneOf(status: string): Tone {
  return STATUS_TONE[status.toLowerCase()] ?? 'neutral';
}

export function StatusPill({ status, label, tone, className }: {
  status?: string; label?: string; tone?: Tone; className?: string;
}) {
  const text = label ?? status ?? '';
  const t = tone ?? toneOf(status ?? text);
  return (
    <span className={cn(
      'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-bold capitalize',
      TONE[t], className,
    )}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}

// ── Type tags (Inbox) ────────────────────────────────────────────────────────

export const KIND_TONE = {
  expense: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
  leave: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  attendance: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  inventory: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  signup: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
} as const;

export function TypeTag({ kind, children }: { kind: keyof typeof KIND_TONE; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-md px-2.5 text-xs font-bold', KIND_TONE[kind])}>
      {children}
    </span>
  );
}

// ── Avatars ──────────────────────────────────────────────────────────────────

const AVATAR_TONES = [
  'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200',
  'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
  'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  'bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-200',
];

export function initialsOf(name?: string | null, fallback = '?'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback.slice(0, 1).toUpperCase();
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Same person, same colour, everywhere — the tone is derived from the name. */
function toneIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % AVATAR_TONES.length;
}

export function InitialsAvatar({ name, size = 36, className, square }: {
  name?: string | null; size?: number; className?: string; square?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-bold',
        square ? 'rounded-lg' : 'rounded-full',
        AVATAR_TONES[toneIndex(name ?? '')], className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
    >
      {initialsOf(name)}
    </span>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────

export function StatTile({ label, value, sub, className, children }: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-2xl border bg-card p-4 sm:p-5', className)}>
      <span className="text-[13px] font-semibold text-muted-foreground">{label}</span>
      <span className="font-display text-2xl font-bold tabular-nums sm:text-[1.75rem]">{value}</span>
      {sub && <span className="text-xs text-muted-foreground sm:text-[12.5px]">{sub}</span>}
      {children}
    </div>
  );
}

export function Meter({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-muted', className)} role="presentation">
      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Filter chips ─────────────────────────────────────────────────────────────

export interface ChipOption<T extends string> { value: T; label: string; count?: number }

export function FilterChips<T extends string>({ options, value, onChange, className, label }: {
  options: ChipOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  label: string;
}) {
  return (
    <div role="group" aria-label={label}
      className={cn('-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-colors',
              on
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-card text-foreground/80 hover:border-foreground/30',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="tabular-nums opacity-70">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────

export function EmptyState({ icon: Icon, title, body, action, tone = 'good', className }: {
  icon: React.ElementType;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'good' | 'neutral';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      <span className={cn(
        'inline-flex h-16 w-16 items-center justify-center rounded-2xl',
        tone === 'good' ? TONE.good : 'bg-muted text-muted-foreground',
      )}>
        <Icon className="h-7 w-7" aria-hidden />
      </span>
      <div className="font-display text-xl font-bold">{title}</div>
      {body && <div className="max-w-sm text-sm text-muted-foreground">{body}</div>}
      {action}
    </div>
  );
}

// ── Detail fields ────────────────────────────────────────────────────────────

export function FieldGrid({ fields, className }: {
  fields: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn('grid grid-cols-2 gap-2.5 sm:gap-3', className)}>
      {fields.map((f) => (
        <div key={f.label} className="rounded-xl bg-muted/60 px-4 py-3">
          <dt className="text-xs font-semibold text-muted-foreground">{f.label}</dt>
          <dd className="mt-1 text-[15px] font-bold break-words">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Side panel: right-hand panel on desktop, bottom sheet on a phone ─────────

export function SidePanel({ open, onOpenChange, title, description, children, footer }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const wide = useMediaQuery('(min-width: 640px)');
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={wide ? 'right' : 'bottom'}
        className={cn(
          'flex flex-col gap-0 p-0',
          wide ? 'w-full sm:max-w-[480px]' : 'max-h-[88svh] rounded-t-3xl',
        )}
      >
        {!wide && <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border" />}
        <div className="flex h-16 shrink-0 items-center border-b px-6 pr-14">
          <SheetTitle className="text-[15px] font-bold">{title}</SheetTitle>
          {description && <SheetDescription className="sr-only">{description}</SheetDescription>}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2.5 border-t px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
