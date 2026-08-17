import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormSheet } from '@/components/ui/form-sheet';
import { MoneyInput } from '@/components/ui/money-input';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { splitNarrative } from '@/lib/expenseSplitter';
import { formatMinor, parseMoney, isMoneyError } from '@/lib/money';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// SplitLinesDialog — §3.2, the feature that makes staff stop pasting narratives.
//
// They paste; we split it for them, show the preview, let them correct any row
// and assign categories, and reconcile against a stated total before anything
// is written.
// ─────────────────────────────────────────────────────────────────────────────

export interface DraftLine {
  description: string;
  amount: string;
  categoryId: string;
}

interface SplitLinesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pasted text to split. */
  text: string;
  categories: SelectOption[];
  onConfirm: (lines: DraftLine[]) => void;
}

export default function SplitLinesDialog({
  open,
  onOpenChange,
  text,
  categories,
  onConfirm,
}: SplitLinesDialogProps) {
  const detected = useMemo(() => splitNarrative(text), [text]);
  const [rows, setRows] = useState<DraftLine[]>([]);

  useEffect(() => {
    if (!open) return;
    setRows(
      detected.lines.map((l) => ({
        description: l.description,
        // Show the amount exactly as it appeared, so the user can check it
        // against what they typed originally.
        amount: l.amountRaw,
        categoryId: '',
      })),
    );
  }, [open, detected]);

  const setRow = (i: number, patch: Partial<DraftLine>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const totalMinor = rows.reduce((sum, r) => {
    const p = parseMoney(r.amount, { allowZero: true });
    return isMoneyError(p) ? sum : sum + p.minor;
  }, 0n);

  const stated = detected.statedTotalMinor;
  const reconciles = stated === null || stated === totalMinor;
  const everyRowValid = rows.every((r) => {
    const p = parseMoney(r.amount);
    return !isMoneyError(p) && r.description.trim() !== '' && r.categoryId !== '';
  });

  const summary =
    rows.length === 0
      ? 'Nothing to split.'
      : stated === null
        ? `${rows.length} line${rows.length === 1 ? '' : 's'} totalling ${formatMinor(totalMinor)}.`
        : reconciles
          ? `${rows.length} line${rows.length === 1 ? '' : 's'} totalling ${formatMinor(totalMinor)} — matches the stated total.`
          : `${rows.length} line${rows.length === 1 ? '' : 's'} totalling ${formatMinor(totalMinor)}, but the text states ${formatMinor(stated)}.`;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Split into separate lines"
      description="Each purchase becomes its own line. Check the amounts and give each one a category."
      size="wide"
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
          <div
            className={cn(
              'flex items-start gap-2 text-sm sm:mr-auto',
              reconciles ? 'text-muted-foreground' : 'text-amber-600',
            )}
            role="status"
          >
            {reconciles ? (
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
            )}
            <span>{summary}</span>
          </div>
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="h-11"
            disabled={rows.length === 0 || !everyRowValid}
            onClick={() => {
              onConfirm(rows);
              onOpenChange(false);
            }}
          >
            Use these {rows.length} line{rows.length === 1 ? '' : 's'}
          </Button>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No separate amounts could be found in that text. Enter the lines by hand instead.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Desktop column headings */}
          <div className="hidden lg:grid grid-cols-12 gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="col-span-5">Description</span>
            <span className="col-span-3">Detected amount</span>
            <span className="col-span-3">Category</span>
            <span className="col-span-1" />
          </div>

          {rows.map((row, i) => {
            const parsed = parseMoney(row.amount);
            const bad = isMoneyError(parsed);
            return (
              <div
                key={i}
                className="grid grid-cols-1 lg:grid-cols-12 gap-2 lg:gap-2 rounded-lg border p-3 lg:border-0 lg:p-0 lg:items-start"
              >
                <div className="lg:col-span-5">
                  <label htmlFor={`split-desc-${i}`} className="lg:sr-only text-xs font-medium">
                    Description
                  </label>
                  <Input
                    id={`split-desc-${i}`}
                    value={row.description}
                    onChange={(e) => setRow(i, { description: e.target.value })}
                    className="h-11 text-base"
                    enterKeyHint="next"
                  />
                </div>

                <div className="lg:col-span-3">
                  <label htmlFor={`split-amt-${i}`} className="lg:sr-only text-xs font-medium">
                    Amount
                  </label>
                  <MoneyInput
                    id={`split-amt-${i}`}
                    value={row.amount}
                    onChange={(v) => setRow(i, { amount: v })}
                    className="h-11"
                    error={bad ? parsed.error : null}
                  />
                </div>

                <div className="lg:col-span-3">
                  <label htmlFor={`split-cat-${i}`} className="lg:sr-only text-xs font-medium">
                    Category
                  </label>
                  <SearchableSelect
                    id={`split-cat-${i}`}
                    options={categories}
                    value={row.categoryId}
                    onChange={(v) => setRow(i, { categoryId: v })}
                    placeholder="Category"
                    title="Choose a category"
                    required
                    invalid={row.categoryId === ''}
                  />
                </div>

                <div className="lg:col-span-1 flex lg:justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeRow(i)}
                    // 44x44 minimum — this is the control that was a small icon
                    // button and could not be hit reliably on a phone.
                    className="h-11 w-11 p-0 text-destructive"
                    aria-label={`Remove line ${i + 1}: ${row.description || 'untitled'}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>
            );
          })}

          {detected.leftover && (
            <p className="text-xs text-muted-foreground border-t pt-3">
              Text with no amount attached, kept out of the lines:{' '}
              <span className="italic">“{detected.leftover}”</span>
            </p>
          )}
        </div>
      )}
    </FormSheet>
  );
}
