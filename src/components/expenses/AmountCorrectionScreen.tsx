import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertTriangle, Check, Copy, FileText, Loader2, Scissors, Trash2 } from 'lucide-react';
import ReportDetailsDialog, { type StaffReportRecord } from '@/components/reports/ReportDetailsDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MoneyInput } from '@/components/ui/money-input';
import SplitLinesDialog, { type DraftLine } from '@/components/expenses/SplitLinesDialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { formatMinor, parseMoney, isMoneyError } from '@/lib/money';
import { extractNumericTokens } from '@/lib/expenseValidation';
import { useExpenseCategories, categoryOptions } from '@/hooks/useExpenseReference';

// ─────────────────────────────────────────────────────────────────────────────
// Migration M-03 — re-capture the corrupted amounts.
//
// "Provide a correction screen showing the original narrative beside an
// editable line grid. A human enters the true figures from receipts. Log every
// correction with user and timestamp."
//
// Nothing here guesses. The factor is not always 1000, so the original text is
// shown verbatim next to an empty field and a person types what the receipt
// says. Every correction keeps its before-image (amount_corrected_from) and the
// user and time, written by a database trigger.
// ─────────────────────────────────────────────────────────────────────────────

const db = supabase as any;

interface SuspectRow {
  id: string;
  date: string;
  amount: number;
  amount_minor: number;
  description: string;
  category: string | null;
  status: string;
  amount_suspect: boolean;
  source_report_id: string | null;
}

export default function AmountCorrectionScreen() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: categories = [] } = useExpenseCategories();

  const [entered, setEntered] = useState<Record<string, string>>({});
  const [splitFor, setSplitFor] = useState<SuspectRow | null>(null);
  const [viewingReport, setViewingReport] = useState<StaffReportRecord | null>(null);

  const { data: rows = [], isLoading } = useQuery<SuspectRow[]>({
    queryKey: ['suspect-amounts'],
    queryFn: async () => {
      const { data, error } = await db
        .from('expenses')
        .select('id, date, amount, amount_minor, description, category, status, amount_suspect, source_report_id')
        .eq('amount_suspect', true)
        .is('cancelled_at', null)
        .order('date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // The reports behind these rows, so the approver can open what the staff
  // member actually submitted — including any receipts — rather than working
  // from the truncated description alone.
  const reportIds = Array.from(
    new Set(rows.map((r) => r.source_report_id).filter(Boolean) as string[]),
  );

  const { data: sourceReports = [] } = useQuery<StaffReportRecord[]>({
    queryKey: ['suspect-source-reports', reportIds.join(',')],
    queryFn: async () => {
      if (reportIds.length === 0) return [];
      const { data, error } = await db
        .from('staff_reports')
        .select('*')
        .in('id', reportIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: reportIds.length > 0,
  });

  const reportFor = (row: SuspectRow) =>
    row.source_report_id ? sourceReports.find((r) => r.id === row.source_report_id) ?? null : null;

  const correct = useMutation({
    mutationFn: async ({ row, minor }: { row: SuspectRow; minor: bigint }) => {
      const { error } = await db
        .from('expenses')
        .update({
          amount_minor: Number(minor),
          // The trigger records amount_corrected_from/by/at and clears the
          // suspect flag; passing the user here makes the intent explicit.
          amount_corrected_by: user?.id,
        })
        .eq('id', row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Amount corrected', description: 'The original value is kept on the record.' });
      qc.invalidateQueries({ queryKey: ['suspect-amounts'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (e: Error) => toast({ title: 'Could not save', description: e.message, variant: 'destructive' }),
  });

  const dismiss = useMutation({
    mutationFn: async (row: SuspectRow) => {
      const { error } = await db.from('expenses').update({ amount_suspect: false }).eq('id', row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Marked as correct', description: 'It will no longer appear here.' });
      qc.invalidateQueries({ queryKey: ['suspect-amounts'] });
    },
  });

  // The M-02 sweep found the same claim written to `expenses` more than once:
  // the old report-approval path created one row per free-text line, so a
  // single ₦1.54 report became three ₦1.54 rows. Correcting every one of them
  // would book the week three times over. Duplicates are cancelled, never
  // deleted — the row and the reason stay on file.
  const cancelDuplicate = useMutation({
    mutationFn: async ({ row, keptId }: { row: SuspectRow; keptId: string }) => {
      const { error } = await db
        .from('expenses')
        .update({
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id,
          cancellation_reason: `Duplicate of ${keptId} — same claim written twice by the pre-fix report approval (migration M-03).`,
          amount_suspect: false,
        })
        .eq('id', row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Marked as a duplicate', description: 'The row stays on file, cancelled with the reason.' });
      qc.invalidateQueries({ queryKey: ['suspect-amounts'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (e: Error) => toast({ title: 'Could not cancel', description: e.message, variant: 'destructive' }),
  });

  const applySplit = useMutation({
    mutationFn: async ({ row, lines }: { row: SuspectRow; lines: DraftLine[] }) => {
      // M-04: the narrative becomes one expense per purchase. The original row
      // is corrected to the first line and the rest are inserted alongside it,
      // so nothing is deleted.
      const parsed = lines.map((l) => {
        const p = parseMoney(l.amount);
        if (isMoneyError(p)) throw new Error(`${l.description}: ${p.error}`);
        return { ...l, minor: Number(p.minor) };
      });
      const [first, ...rest] = parsed;
      if (!first) throw new Error('Nothing to write.');

      const { error: upErr } = await db
        .from('expenses')
        .update({
          amount_minor: first.minor,
          description: first.description,
          category_id: first.categoryId,
          // `expenses.category` is NOT NULL, so a category that cannot be
          // resolved must fall back rather than fail the write.
          category: categories.find((c) => c.id === first.categoryId)?.name ?? 'Miscellaneous',
          amount_corrected_by: user?.id,
        })
        .eq('id', row.id);
      if (upErr) throw upErr;

      if (rest.length > 0) {
        const { error: insErr } = await db.from('expenses').insert(
          rest.map((l) => ({
            amount_minor: l.minor,
            description: l.description,
            category_id: l.categoryId,
            category: categories.find((c) => c.id === l.categoryId)?.name ?? 'Miscellaneous',
            date: row.date,
            budget_id: null,
            account_type: 'COGS',
            cost_center: 'Daily Orders',
            payment_method: 'Cash',
            payee_name: 'Unattributed — pre-migration',
            created_by: user?.id,
            status: 'approved',
            // A historical narrative being split, not a fresh capture.
            source: 'correction',
          })),
        );
        if (insErr) throw insErr;
      }
    },
    onSuccess: (_d, vars) => {
      toast({
        title: 'Narrative split',
        description: `${vars.lines.length} lines written. The original row keeps the first.`,
      });
      qc.invalidateQueries({ queryKey: ['suspect-amounts'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (e: Error) => toast({ title: 'Could not split', description: e.message, variant: 'destructive' }),
  });

  const totalSuspect = useMemo(
    () => rows.reduce((s, r) => s + BigInt(r.amount_minor ?? 0), 0n),
    [rows],
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading flagged records…</p>;
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Amount corrections</CardTitle>
          <CardDescription>Nothing is flagged for re-capture.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
          Amounts to re-capture
        </CardTitle>
        <CardDescription>
          {rows.length} record{rows.length === 1 ? '' : 's'} where the description mentions a figure at
          least 100× the stored amount, currently totalling {formatMinor(totalSuspect)}. Enter the true
          figure from the receipt — nothing is corrected automatically, because the factor is not
          always a thousand.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {rows.map((row) => {
          const tokens = extractNumericTokens(row.description ?? '');
          const largest = tokens.length ? Math.max(...tokens) : null;
          // Other suspect rows on the same date carrying the same amount are
          // almost certainly the same claim written more than once.
          const siblings = rows.filter(
            (r) => r.id !== row.id && r.date === row.date && r.amount_minor === row.amount_minor,
          );
          const report = reportFor(row);
          const typed = entered[row.id] ?? '';
          const parsed = typed.trim() === '' ? null : parseMoney(typed);
          const ready = parsed !== null && !isMoneyError(parsed);
          const splittable = tokens.filter((t) => t > 1000).length >= 3;

          return (
            <div key={row.id} className="rounded-lg border p-3 sm:p-4 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">
                  {format(new Date(row.date), 'dd MMM yyyy')}
                  {row.category && ` · ${row.category}`}
                </span>
                <div className="flex items-center gap-2">
                  {report ? (
                    <Button
                      variant="outline"
                      className="h-9"
                      onClick={() => setViewingReport(report)}
                    >
                      <FileText className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                      Open source report
                    </Button>
                  ) : row.source_report_id ? (
                    <span className="text-xs text-muted-foreground">Loading report…</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No linked report — captured directly
                    </span>
                  )}
                  <Badge variant="outline" className="capitalize">{row.status}</Badge>
                </div>
              </div>

              {siblings.length > 0 && (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-400"
                >
                  <Copy className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                  <span>
                    {siblings.length} other row{siblings.length === 1 ? '' : 's'} on {format(new Date(row.date), 'dd MMM yyyy')}{' '}
                    hold{siblings.length === 1 ? 's' : ''} the same {formatMinor(BigInt(row.amount_minor ?? 0))}. Correct{' '}
                    <strong>one</strong> of them to the true figure and cancel the rest, or the week is counted twice.
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* The original, verbatim */}
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    As recorded
                  </h4>
                  <p className="text-sm whitespace-pre-wrap break-words bg-muted/40 rounded p-2">
                    {row.description || <span className="italic text-muted-foreground">no description</span>}
                  </p>
                  <p className="text-sm">
                    Stored amount:{' '}
                    <span className="font-semibold tabular-nums">{formatMinor(BigInt(row.amount_minor ?? 0))}</span>
                  </p>
                  {largest !== null && (
                    <p className="text-sm text-amber-600">
                      Description mentions{' '}
                      <span className="font-semibold tabular-nums">{largest.toLocaleString('en-NG')}</span>
                    </p>
                  )}
                </div>

                {/* The correction */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    True amount from the receipt
                  </h4>
                  <MoneyInput
                    id={`correct-${row.id}`}
                    value={typed}
                    onChange={(v) => setEntered((p) => ({ ...p, [row.id]: v }))}
                    aria-label={`Corrected amount for ${row.description?.slice(0, 40) ?? 'this expense'}`}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="h-11"
                      disabled={!ready || correct.isPending}
                      onClick={() => ready && correct.mutate({ row, minor: (parsed as { minor: bigint }).minor })}
                    >
                      {correct.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden />}
                      Save correction
                    </Button>
                    {splittable && (
                      <Button variant="outline" className="h-11" onClick={() => setSplitFor(row)}>
                        <Scissors className="h-4 w-4 mr-2" aria-hidden />
                        Split into lines
                      </Button>
                    )}
                    {siblings.length > 0 && (
                      <Button
                        variant="outline"
                        className="h-11 text-destructive"
                        disabled={cancelDuplicate.isPending}
                        onClick={() => cancelDuplicate.mutate({ row, keptId: siblings[0].id })}
                      >
                        <Trash2 className="h-4 w-4 mr-2" aria-hidden />
                        Cancel as duplicate
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="h-11"
                      onClick={() => dismiss.mutate(row)}
                      disabled={dismiss.isPending}
                    >
                      <Check className="h-4 w-4 mr-2" aria-hidden />
                      Already correct
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>

      <ReportDetailsDialog
        report={viewingReport}
        open={!!viewingReport}
        onOpenChange={(o) => { if (!o) setViewingReport(null); }}
      />

      {splitFor && (
        <SplitLinesDialog
          open={!!splitFor}
          onOpenChange={(o) => { if (!o) setSplitFor(null); }}
          text={splitFor.description ?? ''}
          categories={categoryOptions(categories)}
          onConfirm={(lines) => applySplit.mutate({ row: splitFor, lines })}
        />
      )}
    </Card>
  );
}
