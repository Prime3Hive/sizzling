import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  ArrowDown, ArrowUp, ArrowUpDown, Check, Download, Eye, Paperclip,
  Pencil, Plus, Trash2, TriangleAlert, X,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatMinor, sumMinor } from '@/lib/money';
import { RECEIPT_THRESHOLD_MINOR } from '@/lib/expenseConfig';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// The expense list (§7).
//
// Desktop: a sortable table with a total for the filtered set, because a
// reviewer cannot check what they are approving without one.
// Mobile: cards, never a horizontally scrolling table.
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpenseRow {
  id: string;
  amount_minor?: number | null;
  amount: number;
  description: string;
  category: string | null;
  date: string;
  budget_id: string | null;
  receipt_path: string | null;
  created_at: string;
  cost_center: string | null;
  payment_method: string | null;
  expense_account_code?: string | null;
  payee_name?: string | null;
  payee_id?: string | null;
  reference?: string | null;
  status?: string;
  amount_suspect?: boolean;
  approved_by?: string | null;
  submitted_by?: string | null;
  budgets?: { title: string } | null;
  payees?: { name: string } | null;
}

type SortKey =
  | 'date' | 'payee' | 'description' | 'category' | 'account'
  | 'budget' | 'amount' | 'receipt' | 'status' | 'approver';

interface Props {
  expenses: ExpenseRow[];
  totalCount: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onAddExpense: () => void;
  onEdit?: (expense: ExpenseRow) => void;
  onDelete?: (id: string) => void;
  onSetStatus?: (id: string, status: 'approved' | 'rejected') => void;
  /** user_id → display name, for the approver column. */
  nameOf?: (id: string | null | undefined) => string;
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  approved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  rejected: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
};

const minorOf = (e: ExpenseRow): bigint =>
  BigInt(e.amount_minor ?? Math.round((Number(e.amount) || 0) * 100));

const payeeOf = (e: ExpenseRow): string => e.payees?.name ?? e.payee_name ?? '—';

/**
 * Truncate at a word boundary, never mid-word. The full text is revealed on
 * hover, and on tap on mobile.
 */
function truncateWords(text: string, max: number): { shown: string; truncated: boolean } {
  const clean = (text ?? '').trim();
  if (clean.length <= max) return { shown: clean, truncated: false };
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return { shown: (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut) + '…', truncated: true };
}

function TruncatedText({ text, max, className }: { text: string; max: number; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const { shown, truncated } = truncateWords(text, max);
  if (!truncated) return <span className={className}>{text}</span>;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className={cn('text-left', className)}
            aria-expanded={expanded}
          >
            {expanded ? text : shown}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function ExpenseTable({
  expenses, totalCount, hasActiveFilters, onClearFilters, onAddExpense,
  onEdit, onDelete, onSetStatus, nameOf,
}: Props) {
  const { toast } = useToast();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const sorted = useMemo(() => {
    const value = (e: ExpenseRow): string | number => {
      switch (sort.key) {
        case 'date': return e.date;
        case 'payee': return payeeOf(e).toLowerCase();
        case 'description': return (e.description ?? '').toLowerCase();
        case 'category': return (e.category ?? '').toLowerCase();
        case 'account': return e.expense_account_code ?? '';
        case 'budget': return (e.budgets?.title ?? '').toLowerCase();
        case 'amount': return Number(minorOf(e));
        case 'receipt': return e.receipt_path ? 1 : 0;
        case 'status': return e.status ?? 'approved';
        case 'approver': return (nameOf?.(e.approved_by) ?? '').toLowerCase();
      }
    };
    return [...expenses].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [expenses, sort, nameOf]);

  const total = sumMinor(sorted.map(minorOf));

  const viewReceipt = async (path: string) => {
    try {
      const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 60);
      if (error) throw error;
      window.open(data.signedUrl, '_blank');
    } catch (e: any) {
      toast({ title: 'Could not open the receipt', description: e.message, variant: 'destructive' });
    }
  };

  const downloadReceipt = async (path: string, id: string) => {
    try {
      const { data, error } = await supabase.storage.from('receipts').download(path);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${id}.${path.split('.').pop()}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: 'Could not download the receipt', description: e.message, variant: 'destructive' });
    }
  };

  const SortButton = ({ label, k, align }: { label: string; k: SortKey; align?: 'right' | 'center' }) => {
    const active = sort.key === k;
    const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        aria-label={`Sort by ${label}${active ? `, currently ${sort.dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded',
          active && 'text-foreground font-semibold',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {label}
        <Icon className="h-3 w-3 shrink-0" aria-hidden />
      </button>
    );
  };

  const ReceiptCell = ({ e }: { e: ExpenseRow }) => {
    const needed = minorOf(e) >= RECEIPT_THRESHOLD_MINOR;
    if (e.receipt_path) {
      return (
        <div className="flex gap-1 justify-center">
          <Button variant="ghost" className="h-11 w-11 md:h-9 md:w-9 p-0" onClick={() => viewReceipt(e.receipt_path!)} aria-label="View receipt">
            <Eye className="h-4 w-4" aria-hidden />
          </Button>
          <Button variant="ghost" className="h-11 w-11 md:h-9 md:w-9 p-0" onClick={() => downloadReceipt(e.receipt_path!, e.id)} aria-label="Download receipt">
            <Download className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      );
    }
    if (needed) {
      return (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex justify-center text-amber-600" aria-label="Receipt missing">
                <TriangleAlert className="h-4 w-4" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent>Receipt required above {formatMinor(RECEIPT_THRESHOLD_MINOR)}, none attached</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    return <span className="text-xs text-muted-foreground block text-center">—</span>;
  };

  if (expenses.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All expenses</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-12">
          <p className="text-muted-foreground mb-4">
            {totalCount === 0 ? 'No expenses recorded yet.' : 'No expenses match your filters.'}
          </p>
          {totalCount === 0 ? (
            <Button className="h-11" onClick={onAddExpense}>
              <Plus className="mr-2 h-4 w-4" aria-hidden />
              Add your first expense
            </Button>
          ) : (
            <Button variant="outline" className="h-11" onClick={onClearFilters}>
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 flex-wrap space-y-0">
        <div>
          <CardTitle>All expenses</CardTitle>
          <CardDescription>
            {hasActiveFilters ? `Showing ${expenses.length} of ${totalCount}` : `${totalCount} recorded`}
          </CardDescription>
        </div>
        {/* The total for the filtered set — previously absent. */}
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Total {hasActiveFilters ? 'shown' : ''}
          </p>
          <p className="text-xl font-bold tabular-nums" role="status">{formatMinor(total)}</p>
        </div>
      </CardHeader>

      <CardContent>
        {/* ── Desktop: sortable table ── */}
        <div className="hidden sm:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]"><SortButton label="Date" k="date" /></TableHead>
                <TableHead className="min-w-[130px]"><SortButton label="Payee" k="payee" /></TableHead>
                <TableHead className="min-w-[180px]"><SortButton label="Description" k="description" /></TableHead>
                <TableHead className="w-[130px]"><SortButton label="Category" k="category" /></TableHead>
                <TableHead className="w-[100px]"><SortButton label="Account" k="account" /></TableHead>
                <TableHead className="w-[120px]"><SortButton label="Budget" k="budget" /></TableHead>
                <TableHead className="w-[130px] text-right"><SortButton label="Amount" k="amount" align="right" /></TableHead>
                <TableHead className="w-[100px] text-center"><SortButton label="Receipt" k="receipt" /></TableHead>
                <TableHead className="w-[120px] text-center"><SortButton label="Status" k="status" /></TableHead>
                <TableHead className="w-[120px]"><SortButton label="Approver" k="approver" /></TableHead>
                <TableHead className="w-[100px] text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {format(new Date(e.date), 'dd MMM yyyy')}
                  </TableCell>
                  <TableCell><TruncatedText text={payeeOf(e)} max={22} className="text-sm" /></TableCell>
                  <TableCell><TruncatedText text={e.description ?? ''} max={48} className="text-sm" /></TableCell>
                  <TableCell>
                    {e.category ? <Badge variant="outline" className="font-normal">{e.category}</Badge> : '—'}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {e.expense_account_code ?? '—'}
                  </TableCell>
                  <TableCell><TruncatedText text={e.budgets?.title ?? '—'} max={18} className="text-sm" /></TableCell>
                  <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">
                    {formatMinor(minorOf(e))}
                    {e.amount_suspect && (
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-1 text-amber-600" aria-label="Amount looks wrong">⚠</span>
                          </TooltipTrigger>
                          <TooltipContent>
                            The description mentions a much larger figure. Flagged for re-capture (M-03).
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </TableCell>
                  <TableCell><ReceiptCell e={e} /></TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Badge variant="outline" className={cn('capitalize', STATUS_BADGE[e.status ?? 'approved'])}>
                        {e.status ?? 'approved'}
                      </Badge>
                      {onSetStatus && (e.status ?? 'approved') === 'pending' && (
                        <>
                          <Button variant="ghost" className="h-9 w-9 p-0 text-emerald-600" aria-label="Approve" onClick={() => onSetStatus(e.id, 'approved')}>
                            <Check className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button variant="ghost" className="h-9 w-9 p-0 text-destructive" aria-label="Reject" onClick={() => onSetStatus(e.id, 'rejected')}>
                            <X className="h-4 w-4" aria-hidden />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.approved_by ? (nameOf?.(e.approved_by) ?? '—') : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-center">
                      {onEdit && (
                        <Button variant="ghost" className="h-9 w-9 p-0" aria-label="Edit expense" onClick={() => onEdit(e)}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      )}
                      {onDelete && (
                        <Button variant="ghost" className="h-9 w-9 p-0 hover:text-destructive" aria-label="Cancel expense" onClick={() => onDelete(e.id)}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* ── Mobile: cards, not a scrolling table ── */}
        <div className="sm:hidden divide-y divide-border -mx-2">
          {sorted.map((e) => (
            <article key={e.id} className="px-2 py-3 space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-muted-foreground">{format(new Date(e.date), 'dd MMM yyyy')}</span>
                <span className="font-bold tabular-nums text-right">{formatMinor(minorOf(e))}</span>
              </div>

              <p className="font-medium text-sm">{payeeOf(e)}</p>
              <TruncatedText text={e.description ?? ''} max={70} className="text-sm text-muted-foreground block" />

              <p className="text-xs text-muted-foreground">
                {[e.category, e.budgets?.title, e.expense_account_code].filter(Boolean).join(' · ')}
              </p>

              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2 text-xs">
                  {e.receipt_path ? (
                    <button
                      type="button"
                      onClick={() => viewReceipt(e.receipt_path!)}
                      className="inline-flex items-center gap-1 text-muted-foreground min-h-[44px]"
                    >
                      <Paperclip className="h-3.5 w-3.5" aria-hidden />
                      receipt
                    </button>
                  ) : minorOf(e) >= RECEIPT_THRESHOLD_MINOR ? (
                    <span className="inline-flex items-center gap-1 text-amber-600 min-h-[44px]">
                      <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                      no receipt
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={cn('capitalize text-xs', STATUS_BADGE[e.status ?? 'approved'])}>
                    {e.status ?? 'approved'}
                  </Badge>
                  {e.approved_by && nameOf && (
                    <span className="text-xs text-muted-foreground">· {nameOf(e.approved_by)}</span>
                  )}
                </div>
              </div>

              {(onEdit || onDelete || (onSetStatus && (e.status ?? 'approved') === 'pending')) && (
                <div className="flex gap-2 pt-1">
                  {onSetStatus && (e.status ?? 'approved') === 'pending' && (
                    <>
                      <Button variant="outline" className="h-11 flex-1 text-emerald-600" onClick={() => onSetStatus(e.id, 'approved')}>
                        <Check className="h-4 w-4 mr-1.5" aria-hidden />Approve
                      </Button>
                      <Button variant="outline" className="h-11 flex-1 text-destructive" onClick={() => onSetStatus(e.id, 'rejected')}>
                        <X className="h-4 w-4 mr-1.5" aria-hidden />Reject
                      </Button>
                    </>
                  )}
                  {onEdit && (
                    <Button variant="ghost" className="h-11 w-11 p-0" aria-label="Edit expense" onClick={() => onEdit(e)}>
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                  {onDelete && (
                    <Button variant="ghost" className="h-11 w-11 p-0 text-destructive" aria-label="Cancel expense" onClick={() => onDelete(e.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
