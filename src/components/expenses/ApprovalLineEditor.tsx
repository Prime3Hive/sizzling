import React, { useEffect, useMemo } from 'react';
import { AlertTriangle, Plus, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { formatMinor, parseMoney, isMoneyError } from '@/lib/money';
import { checkImplausible, extractNumericTokens } from '@/lib/expenseValidation';
import { useExpenseCategories, categoryOptions } from '@/hooks/useExpenseReference';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// ApprovalLineEditor
//
// An approver could previously only accept or reject a report wholesale. That
// left no way forward when a line was wrong — and the corrupted historical
// reports are exactly that case: approving one is refused with
//
//   "The description mentions 922,340.00 but the amount is 922.34."
//
// The check is right. Being unable to act on it is not. This lets the approver
// correct the figure from the receipt before approving, and shows which lines
// would be refused and why, before they try.
//
// Amendments are recorded on the report, so what the staff member submitted and
// what the approver changed it to both survive.
// ─────────────────────────────────────────────────────────────────────────────

export interface EditableLine {
  key: string;
  description: string;
  /** Raw text, parsed with parseMoney like every other amount field. */
  amount: string;
  categoryId: string;
  categoryName: string;
  receiptPath: string | null;
  /** What the staff member originally submitted, for the audit note. */
  originalMinor: number | null;
}

/** Build editable rows from whatever shape the report's JSON lines are in. */
export function linesFromReport(details: any): EditableLine[] {
  const raw: any[] = details?.lines ?? [];
  return raw.map((l, i) => {
    const minor: number | null =
      typeof l.amount_minor === 'number'
        ? l.amount_minor
        : typeof l.amount === 'number'
          ? Math.round(l.amount * 100)
          : null;
    return {
      key: `${i}`,
      description: String(l.description ?? '').trim(),
      amount: minor === null ? '' : (minor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
      categoryId: l.category_id ?? '',
      categoryName: String(l.category ?? ''),
      receiptPath: l.receipt_path ?? null,
      originalMinor: minor,
    };
  });
}

export const blankLine = (): EditableLine => ({
  key: Math.random().toString(36).slice(2),
  description: '',
  amount: '',
  categoryId: '',
  categoryName: '',
  receiptPath: null,
  originalMinor: null,
});

export interface LineIssue {
  key: string;
  message: string;
  /** The figure the description itself states, when there is one. */
  suggestMinor: number | null;
}

/**
 * Which lines the database would refuse, and what the text says the amount
 * probably should be. Mirrors fn_validate_expense_amounts so the approver sees
 * the refusal before submitting rather than after.
 */
export function lineIssues(lines: EditableLine[]): LineIssue[] {
  const out: LineIssue[] = [];
  for (const l of lines) {
    const parsed = parseMoney(l.amount);
    if (isMoneyError(parsed)) {
      out.push({ key: l.key, message: parsed.error, suggestMinor: null });
      continue;
    }
    if (!l.description.trim()) {
      out.push({ key: l.key, message: 'This line needs a description.', suggestMinor: null });
      continue;
    }
    if (!l.categoryId) {
      out.push({ key: l.key, message: 'Choose a category for this line.', suggestMinor: null });
      continue;
    }
    const check = checkImplausible(l.description, parsed.minor);
    if (check.implausible) {
      const tokens = extractNumericTokens(l.description);
      const largest = tokens.length ? Math.max(...tokens) : null;
      out.push({
        key: l.key,
        message: check.message!,
        suggestMinor: largest === null ? null : Math.round(largest * 100),
      });
    }
  }
  return out;
}

interface Props {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  /** The total the staff member stated, if the report carried one. */
  statedTotalMinor?: number | null;
  disabled?: boolean;
}

export default function ApprovalLineEditor({ lines, onChange, statedTotalMinor, disabled }: Props) {
  const { data: categories = [] } = useExpenseCategories();
  const options = categoryOptions(categories);

  // Legacy reports carry a free-text category name and no id. Match it to the
  // controlled list once the list has loaded, so the approver is not made to
  // re-pick every line by hand.
  useEffect(() => {
    if (categories.length === 0) return;
    let changed = false;
    const mapped = lines.map((l) => {
      if (l.categoryId || !l.categoryName) return l;
      const hit = categories.find(
        (c) => c.name.toLowerCase() === l.categoryName.trim().toLowerCase(),
      );
      if (!hit) return l;
      changed = true;
      return { ...l, categoryId: hit.id };
    });
    if (changed) onChange(mapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, lines]);

  const set = (key: string, patch: Partial<EditableLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key));

  const issues = useMemo(() => lineIssues(lines), [lines]);
  const issueFor = (key: string) => issues.find((i) => i.key === key);

  const totalMinor = lines.reduce((sum, l) => {
    const p = parseMoney(l.amount);
    return isMoneyError(p) ? sum : sum + p.minor;
  }, 0n);

  const amended = lines.some((l) => {
    const p = parseMoney(l.amount);
    return !isMoneyError(p) && l.originalMinor !== null && Number(p.minor) !== l.originalMinor;
  });

  const statedMismatch =
    statedTotalMinor != null && BigInt(statedTotalMinor) !== totalMinor;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-sm font-semibold">Expense lines</Label>
        <span className="text-xs text-muted-foreground">
          Correct any figure from the receipt before approving.
        </span>
      </div>

      {lines.length === 0 && (
        <p className="text-sm text-muted-foreground border rounded-md p-3">
          This report has no lines. Add one, or reject it and ask for them.
        </p>
      )}

      {lines.map((line, i) => {
        const issue = issueFor(line.key);
        return (
          <div
            key={line.key}
            className={cn('rounded-lg border p-2.5 space-y-2', issue && 'border-destructive')}
          >
            <div className="flex items-start gap-2">
              <span className="text-xs text-muted-foreground pt-2.5 w-5 shrink-0">{i + 1}.</span>
              <div className="flex-1 min-w-0 space-y-2">
                <Input
                  aria-label={`Description for line ${i + 1}`}
                  value={line.description}
                  onChange={(e) => set(line.key, { description: e.target.value })}
                  placeholder="What was bought"
                  className="h-10 text-base"
                  disabled={disabled}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <MoneyInput
                    aria-label={`Amount for line ${i + 1}`}
                    value={line.amount}
                    onChange={(v) => set(line.key, { amount: v })}
                    showPreview={false}
                    disabled={disabled}
                  />
                  <SearchableSelect
                    options={options}
                    value={line.categoryId}
                    onChange={(v) => set(line.key, { categoryId: v })}
                    placeholder="Category"
                    title="Choose a category"
                    invalid={!line.categoryId}
                    disabled={disabled}
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-10 p-0 shrink-0 text-destructive"
                aria-label={`Remove line ${i + 1}`}
                onClick={() => remove(line.key)}
                disabled={disabled}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            {issue && (
              <div className="flex flex-wrap items-start gap-2 pl-7">
                <p role="alert" className="text-xs text-destructive flex-1 min-w-[12rem]">
                  ⚠ {issue.message}
                </p>
                {issue.suggestMinor !== null && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9"
                    disabled={disabled}
                    onClick={() =>
                      set(line.key, {
                        amount: (issue.suggestMinor! / 100)
                          .toFixed(2)
                          .replace(/\B(?=(\d{3})+(?!\d))/g, ','),
                      })
                    }
                  >
                    <Wand2 className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                    Use {formatMinor(BigInt(issue.suggestMinor))}
                  </Button>
                )}
              </div>
            )}

            {line.originalMinor !== null &&
              (() => {
                const p = parseMoney(line.amount);
                if (isMoneyError(p) || Number(p.minor) === line.originalMinor) return null;
                return (
                  <p className="text-xs text-amber-600 pl-7">
                    Amended from {formatMinor(BigInt(line.originalMinor))} — the original stays on the
                    report.
                  </p>
                );
              })()}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-10"
        onClick={() => onChange([...lines, blankLine()])}
        disabled={disabled}
      >
        <Plus className="h-4 w-4 mr-1.5" aria-hidden />
        Add line
      </Button>

      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-sm font-medium">
          {lines.length} line{lines.length === 1 ? '' : 's'}
        </span>
        <span className="text-base font-bold tabular-nums">{formatMinor(totalMinor)}</span>
      </div>

      {statedMismatch && (
        <p role="status" className="text-xs text-amber-600 flex items-start gap-1">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>
            The staff member stated {formatMinor(BigInt(statedTotalMinor!))}, but these lines total{' '}
            {formatMinor(totalMinor)}.
          </span>
        </p>
      )}

      {issues.length > 0 && (
        <p role="alert" className="text-xs text-destructive">
          {issues.length} line{issues.length === 1 ? '' : 's'} must be corrected before this can be
          approved.
        </p>
      )}

      {amended && issues.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Your amendments are recorded on the report alongside what was submitted.
        </p>
      )}
    </div>
  );
}
