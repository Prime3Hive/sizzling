// The ＋ New button in the phone's tab bar. Everything a person starts from
// their phone, one tap away, and each tile lands inside that page's own create
// form (via ?new=, see useNewParam) so nothing is duplicated here.

import { Link } from 'react-router-dom';
import {
  CalendarCheck, CalendarDays, ChevronRight, Factory, FileText, HandCoins, Package, Receipt, ReceiptText, X,
} from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { NavAccess } from './navigation';

interface Action {
  to: string;
  label: string;
  sub: string;
  icon: React.ElementType;
  tone: string;
}

const TONES = {
  orange: 'bg-brand-soft text-primary',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
};

export function createActions(a: NavAccess): { mine: Action[]; team: Action[] } {
  const approved = !a.isPending && (a.isAdmin || a.isManager || a.isHR || a.isEmployee);
  const mine: Action[] = [];
  const team: Action[] = [];
  if (!approved) return { mine, team };

  // Expenses: people who run budgets log them directly; everyone else claims
  // them back through a report, which is how the money reaches the ledger.
  if (a.hasPermission('budgets', 'create')) {
    mine.push({ to: '/expenses?new=1', label: 'Expense', sub: 'Log company spending', icon: Receipt, tone: TONES.orange });
  } else {
    mine.push({ to: '/staff-portal?tab=reports&new=expense', label: 'Expense claim', sub: 'Money you spent for work', icon: Receipt, tone: TONES.orange });
  }
  mine.push({ to: '/staff-portal?tab=leave&new=1', label: 'Leave', sub: 'Ask for time off', icon: CalendarDays, tone: TONES.blue });
  mine.push({ to: '/business/inventory-requests?new=1', label: 'Stock request', sub: 'Ask the store for items', icon: Package, tone: TONES.violet });
  mine.push({ to: '/staff-portal?tab=reports&new=1', label: 'Daily report', sub: 'Today’s sales and notes', icon: FileText, tone: TONES.green });

  if (a.canFeature('mark_attendance')) {
    team.push({ to: '/attendance', label: 'Mark this week’s attendance', sub: '', icon: CalendarCheck, tone: '' });
  }
  if (a.hasPermission('production', 'view') && a.hasPermission('production', 'create')) {
    team.push({ to: '/business/production?new=1', label: 'Record production', sub: '', icon: Factory, tone: '' });
  }
  if (a.hasPermission('invoices', 'create')) {
    team.push({ to: '/business/invoices?new=1', label: 'Invoice a customer', sub: '', icon: ReceiptText, tone: '' });
  }
  if (a.hasPermission('sales', 'create')) {
    team.push({ to: '/business/payments?new=1', label: 'Record a payment received', sub: '', icon: HandCoins, tone: '' });
  }
  return { mine, team };
}

export default function CreateSheet({ open, onOpenChange, access }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  access: NavAccess;
}) {
  const { mine, team } = createActions(access);
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="gap-0 px-4 pt-2 [&>button:last-child]:hidden">
        <div aria-hidden className="mx-auto mb-3 mt-1 h-1.5 w-10 rounded-full bg-border" />
        <div className="flex items-center gap-2 px-1 pb-4">
          <SheetTitle className="flex-1 font-display text-[22px] font-bold">What do you need?</SheetTitle>
          <SheetDescription className="sr-only">Start a new request or record</SheetDescription>
          <button type="button" onClick={close} aria-label="Close"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {mine.map((m) => {
            const Icon = m.icon;
            return (
              <Link key={m.to} to={m.to} onClick={close}
                className="flex min-h-[124px] flex-col gap-2.5 rounded-2xl border bg-card p-4 transition-colors active:bg-accent hover:border-orange-300">
                <span className={cn('inline-flex h-11 w-11 items-center justify-center rounded-xl', m.tone)}>
                  <Icon className="h-[22px] w-[22px]" aria-hidden />
                </span>
                <span className="text-[15px] font-extrabold">{m.label}</span>
                <span className="-mt-1.5 text-[12.5px] leading-snug text-muted-foreground">{m.sub}</span>
              </Link>
            );
          })}
        </div>

        {team.length > 0 && (
          <div className="mt-5 px-1">
            <div className="pb-1 text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground">For your team</div>
            {team.map((t) => {
              const Icon = t.icon;
              return (
                <Link key={t.to} to={t.to} onClick={close}
                  className="flex min-h-[52px] items-center gap-3 border-t text-[15px] font-semibold first:border-t-0">
                  <Icon className="h-5 w-5 text-primary" aria-hidden />
                  <span className="flex-1">{t.label}</span>
                  <ChevronRight className="h-[18px] w-[18px] text-muted-foreground" aria-hidden />
                </Link>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
