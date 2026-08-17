import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Pencil, Plus, Scissors, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MoneyInput } from '@/components/ui/money-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import ReceiptUpload from '@/components/expenses/ReceiptUpload';
import SplitLinesDialog, { type DraftLine } from '@/components/expenses/SplitLinesDialog';
import { useToast } from '@/hooks/use-toast';
import { formatMinor, parseMoney, isMoneyError } from '@/lib/money';
import {
  validateExpenseLine, validationErrors, errorMap, checkExpenseClaim, looksLikePastedList,
} from '@/lib/expenseValidation';
import { useExpenseCategories, categoryOptions } from '@/hooks/useExpenseReference';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Staff expense claim capture (§6.2).
//
// This is the screen that matters most, because it is used standing in a
// market. One line at a time: amount, description, category, "Add another".
// After each line, a compact list of what has been added with a running total,
// each row editable and deletable.
//
// The draft is persisted on every change, so a dropped connection or a closed
// tab does not lose the claim.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClaimLine {
  id: string;
  description: string;
  amount: string;
  categoryId: string;
  receipt: File | null;
  receiptName: string | null;
}

export interface ClaimDraft {
  lines: ClaimLine[];
  statedTotal: string;
  notes: string;
}

const newLine = (): ClaimLine => ({
  id: Math.random().toString(36).slice(2),
  description: '',
  amount: '',
  categoryId: '',
  receipt: null,
  receiptName: null,
});

export const emptyDraft = (): ClaimDraft => ({ lines: [], statedTotal: '', notes: '' });

// ── Draft persistence ───────────────────────────────────────────────────────
// A File cannot be serialised, so only its name is kept; the user re-attaches
// after a reload. Everything they typed survives, which is the point.

const draftKey = (userId: string | undefined, reportDate: string) =>
  `expense-claim-draft:${userId ?? 'anon'}:${reportDate}`;

export function loadDraft(userId: string | undefined, reportDate: string): ClaimDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId, reportDate));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClaimDraft;
    return {
      ...parsed,
      lines: (parsed.lines ?? []).map((l) => ({ ...l, receipt: null })),
    };
  } catch {
    return null;
  }
}

export function saveDraft(userId: string | undefined, reportDate: string, draft: ClaimDraft) {
  try {
    // localStorage, not sessionStorage, so the draft survives a closed tab and
    // a re-authentication.
    localStorage.setItem(
      draftKey(userId, reportDate),
      JSON.stringify({ ...draft, lines: draft.lines.map(({ receipt, ...rest }) => rest) }),
    );
  } catch {
    /* storage full or blocked — the form still works, the draft just is not kept */
  }
}

export function clearDraft(userId: string | undefined, reportDate: string) {
  try {
    localStorage.removeItem(draftKey(userId, reportDate));
  } catch {
    /* nothing to do */
  }
}

interface Props {
  userId: string | undefined;
  reportDate: string;
  draft: ClaimDraft;
  onChange: (draft: ClaimDraft) => void;
  /** Report the validity upward so the parent can disable Submit. */
  onValidityChange?: (valid: boolean, outstanding: string[]) => void;
}

export default function StaffExpenseClaim({
  userId, reportDate, draft, onChange, onValidityChange,
}: Props) {
  const { toast } = useToast();
  const { data: categories = [] } = useExpenseCategories();

  const [entry, setEntry] = useState<ClaimLine>(newLine);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showEntryErrors, setShowEntryErrors] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitText, setSplitText] = useState('');

  // Persist on every change.
  useEffect(() => {
    saveDraft(userId, reportDate, draft);
  }, [draft, userId, reportDate]);

  const catOptions = categoryOptions(categories);

  // ── Validation of the line being entered ──
  const entryResult = useMemo(
    () =>
      validateExpenseLine(
        {
          description: entry.description,
          amount: entry.amount,
          category_id: entry.categoryId,
          // The claim carries the payee and the claim-level fields; a line
          // only owns its own three.
          payee_name: 'Staff claim',
          receipt_path: entry.receipt ? 'pending-upload' : null,
        },
        { scope: 'line' },
      ),
    [entry],
  );
  const entryErrors = errorMap(entryResult);
  const entryValid = validationErrors(entryResult).length === 0;
  const entryStarted = !!(entry.description.trim() || entry.amount.trim() || entry.categoryId);

  // ── Lines already added ──
  const parsedLines = draft.lines.map((l) => {
    const p = parseMoney(l.amount);
    return { line: l, minor: isMoneyError(p) ? 0n : p.minor, error: isMoneyError(p) ? p.error : null };
  });

  const statedParsed = draft.statedTotal.trim() === '' ? null : parseMoney(draft.statedTotal);
  const statedMinor = statedParsed && !isMoneyError(statedParsed) ? statedParsed.minor : null;

  const claimCheck = checkExpenseClaim({
    lines: parsedLines.map((p) => ({ amount_minor: p.minor })),
    statedTotalMinor: statedMinor,
  });

  // ── Tell the parent what is outstanding ──
  useEffect(() => {
    const outstanding: string[] = [];
    if (draft.lines.length === 0) outstanding.push('Add at least one expense line.');
    for (const p of parsedLines) {
      const r = validateExpenseLine(
        {
          description: p.line.description,
          amount: p.line.amount,
          category_id: p.line.categoryId,
          payee_name: 'Staff claim',
          receipt_path: p.line.receipt || p.line.receiptName ? 'pending-upload' : null,
        },
        { scope: 'line' },
      );
      for (const e of validationErrors(r)) outstanding.push(`“${p.line.description || 'untitled line'}”: ${e.message}`);
    }
    if (!claimCheck.reconciles) outstanding.push(claimCheck.errors[0]?.message ?? 'The lines do not match the stated total.');
    if (entryStarted && !entryValid) outstanding.push('Finish or clear the line you are entering.');

    onValidityChange?.(outstanding.length === 0, outstanding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, claimCheck.reconciles, entryStarted, entryValid]);

  const commitEntry = () => {
    setShowEntryErrors(true);
    if (!entryValid) {
      toast({
        title: 'Check this line',
        description: validationErrors(entryResult)[0]?.message,
        variant: 'destructive',
      });
      return;
    }
    if (editingId) {
      onChange({
        ...draft,
        lines: draft.lines.map((l) => (l.id === editingId ? { ...entry, id: editingId } : l)),
      });
      setEditingId(null);
    } else {
      onChange({ ...draft, lines: [...draft.lines, entry] });
    }
    setEntry(newLine());
    setShowEntryErrors(false);
  };

  const editLine = (l: ClaimLine) => {
    setEntry(l);
    setEditingId(l.id);
    setShowEntryErrors(false);
  };

  const removeLine = (id: string) => {
    onChange({ ...draft, lines: draft.lines.filter((l) => l.id !== id) });
    if (editingId === id) {
      setEditingId(null);
      setEntry(newLine());
    }
  };

  const applySplit = useCallback(
    (lines: DraftLine[]) => {
      onChange({
        ...draft,
        lines: [
          ...draft.lines,
          ...lines.map((l) => ({
            ...newLine(),
            description: l.description,
            amount: l.amount,
            categoryId: l.categoryId,
          })),
        ],
      });
      setEntry(newLine());
      toast({ title: `${lines.length} lines added`, description: 'Check each one before submitting.' });
    },
    [draft, onChange, toast],
  );

  const offerSplit = looksLikePastedList(entry.description);

  return (
    <div className="space-y-4">
      {/* ── Lines added so far ── */}
      {draft.lines.length > 0 && (
        <div className="rounded-lg border divide-y">
          {parsedLines.map(({ line, minor, error }) => (
            <div key={line.id} className="flex items-start gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{line.description || 'Untitled'}</p>
                <p className="text-xs text-muted-foreground">
                  {categories.find((c) => c.id === line.categoryId)?.name ?? 'No category'}
                  {line.receiptName && ' · receipt attached'}
                </p>
                {error && <p className="text-xs text-destructive mt-0.5">⚠ {error}</p>}
              </div>
              <span className="text-sm font-semibold tabular-nums whitespace-nowrap">{formatMinor(minor)}</span>
              <Button
                type="button" variant="ghost"
                className="h-11 w-11 p-0 shrink-0"
                aria-label={`Edit ${line.description || 'line'}`}
                onClick={() => editLine(line)}
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button" variant="ghost"
                className="h-11 w-11 p-0 shrink-0 text-destructive"
                aria-label={`Delete ${line.description || 'line'}`}
                onClick={() => removeLine(line.id)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}

          {/* Running total */}
          <div className="flex items-center justify-between p-3 bg-muted/40">
            <span className="text-sm font-medium">
              {draft.lines.length} line{draft.lines.length === 1 ? '' : 's'}
            </span>
            <span className="text-base font-bold tabular-nums" role="status">
              {formatMinor(claimCheck.totalMinor)}
            </span>
          </div>
        </div>
      )}

      {/* ── One line at a time ── */}
      <div className="rounded-lg border p-3 space-y-3">
        <h4 className="text-sm font-semibold">
          {editingId ? 'Edit this line' : `Add ${draft.lines.length === 0 ? 'an' : 'another'} expense`}
        </h4>

        <div className="space-y-1.5">
          <Label htmlFor="claim-amount" className="text-sm">
            Amount <span className="text-destructive" aria-hidden>*</span>
          </Label>
          <MoneyInput
            id="claim-amount"
            value={entry.amount}
            onChange={(v) => setEntry((e) => ({ ...e, amount: v }))}
            error={showEntryErrors ? entryErrors.amount : null}
            enterKeyHint="next"
            aria-required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="claim-description" className="text-sm">
            What was it for <span className="text-destructive" aria-hidden>*</span>
          </Label>
          <Textarea
            id="claim-description"
            rows={2}
            value={entry.description}
            onChange={(e) => setEntry((p) => ({ ...p, description: e.target.value }))}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              if (pasted && (/\n/.test(pasted) || looksLikePastedList(pasted))) {
                e.preventDefault();
                setSplitText(pasted);
                setSplitOpen(true);
              }
            }}
            placeholder="One purchase — e.g. 10kg of teriyaki"
            className="text-base"
            aria-required
            aria-invalid={showEntryErrors && !!entryErrors.description ? true : undefined}
          />
          {showEntryErrors && entryErrors.description && (
            <p role="alert" className="text-xs text-destructive">⚠ {entryErrors.description}</p>
          )}
          {offerSplit && (
            <Button
              type="button" variant="outline" className="h-11 w-full"
              onClick={() => { setSplitText(entry.description); setSplitOpen(true); }}
            >
              <Scissors className="h-4 w-4 mr-2" aria-hidden />
              This is a list — split it into lines
            </Button>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="claim-category" className="text-sm">
            Category <span className="text-destructive" aria-hidden>*</span>
          </Label>
          <SearchableSelect
            id="claim-category"
            options={catOptions}
            value={entry.categoryId}
            onChange={(v) => setEntry((e) => ({ ...e, categoryId: v }))}
            placeholder="Choose a category"
            title="Choose a category"
            required
            invalid={showEntryErrors && !!entryErrors.category_id}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Receipt</Label>
          <ReceiptUpload
            id="claim-receipt"
            file={entry.receipt}
            onChange={(f) => setEntry((e) => ({ ...e, receipt: f, receiptName: f?.name ?? null }))}
            error={showEntryErrors ? entryErrors.receipt : null}
          />
        </div>

        <div className="flex gap-2">
          {editingId && (
            <Button
              type="button" variant="outline" className="h-11 flex-1"
              onClick={() => { setEditingId(null); setEntry(newLine()); setShowEntryErrors(false); }}
            >
              Cancel edit
            </Button>
          )}
          <Button type="button" className="h-11 flex-1" onClick={commitEntry}>
            <Plus className="h-4 w-4 mr-2" aria-hidden />
            {editingId ? 'Save line' : 'Add another'}
          </Button>
        </div>
      </div>

      {/* ── Stated total, reconciled against the lines ── */}
      <div className="space-y-1.5">
        <Label htmlFor="claim-stated-total" className="text-sm">Total you wrote down (optional)</Label>
        <MoneyInput
          id="claim-stated-total"
          value={draft.statedTotal}
          onChange={(v) => onChange({ ...draft, statedTotal: v })}
          parseOptions={{ allowZero: true, label: 'total' }}
          showPreview={false}
        />
        {draft.lines.length > 0 && (
          <p
            className={cn(
              'text-xs flex items-start gap-1',
              claimCheck.reconciles ? 'text-muted-foreground' : 'text-amber-600',
            )}
            role="status"
          >
            {claimCheck.reconciles ? (
              <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
            )}
            <span>{claimCheck.message}</span>
          </p>
        )}
      </div>

      {/* ── Notes: explanation, never amounts ── */}
      <div className="space-y-1.5">
        <Label htmlFor="claim-notes" className="text-sm">Notes (optional)</Label>
        <Textarea
          id="claim-notes"
          rows={2}
          value={draft.notes}
          onChange={(e) => onChange({ ...draft, notes: e.target.value })}
          placeholder="Anything the approver should know — e.g. why a figure differs from the receipt."
          className="text-base"
        />
        <p className="text-xs text-muted-foreground">
          For explanation only. Amounts belong in the lines above.
        </p>
      </div>

      <SplitLinesDialog
        open={splitOpen}
        onOpenChange={setSplitOpen}
        text={splitText}
        categories={catOptions}
        onConfirm={applySplit}
      />
    </div>
  );
}
