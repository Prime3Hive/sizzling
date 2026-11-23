import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronUp, ClipboardList, History, Layers, Loader2, Plus, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { MoneyInput } from '@/components/ui/money-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import ReceiptUpload from '@/components/expenses/ReceiptUpload';
import PayeeField, { ONE_OFF } from '@/components/expenses/PayeeField';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { useToast } from '@/hooks/use-toast';
import { formatMinor, nairaToMinor, parseMoney, isMoneyError } from '@/lib/money';
import {
  validateExpenseLine, validationErrors, errorMap, todayIso,
  type ValidatedExpenseLine,
} from '@/lib/expenseValidation';
import { PAYMENT_METHODS } from '@/lib/expenseConstants';
import { RECEIPT_THRESHOLD_MINOR } from '@/lib/expenseConfig';
import { splitNarrative } from '@/lib/expenseSplitter';
import {
  autoReference, batchCode, budgetAlert, budgetForDate, duplicatesWithin,
  previousWeek, rowsFromPriorWeek,
} from '@/lib/bulkExpense';
import {
  useExpenseCategories, useCostCentres, useBankAccounts, useLockedThrough, useBudgetsWithSpend,
  categoryOptions, costCentreOptions, bankOptions, budgetOptions,
} from '@/hooks/useExpenseReference';

// ─────────────────────────────────────────────────────────────────────────────
// Add several expenses at once.
//
// A row is complete once it has an amount, a description and a category.
// Everything else is filled for it:
//   date            the batch date, unless the row gives its own
//   payee, method,  from the settings at the top
//   cost centre
//   account         from the category (the database enforces the same)
//   budget          the budget whose dates contain the row's date
//   reference       generated when left blank
//
// It calls the SAME validator as the single form, per row, and saves nothing
// if any row fails.
// ─────────────────────────────────────────────────────────────────────────────

const db = supabase as any;
const METHODS_NEEDING_BANK = new Set(['transfer', 'card', 'pos']);

/** Other forms hand rows to this one (a pasted list split on the single form). */
export const BULK_PREFILL_EVENT = 'expenses:bulk-prefill';
export interface BulkPrefill {
  rows: { description: string; amount: string; categoryId?: string }[];
  date?: string;
  payeeId?: string;
  payeeName?: string;
  paymentMethod?: string;
}

interface Row {
  /** '' means "use the batch date". */
  date: string;
  amount: string;
  description: string;
  categoryId: string;
  /** '' means "use the batch payee". */
  payeeId: string;
  payeeName: string;
  reference: string;
  receipt: File | null;
  noReceiptReason: string;
  open: boolean;
}

const blankRow = (patch: Partial<Row> = {}): Row => ({
  date: '', amount: '', description: '', categoryId: '', payeeId: '', payeeName: '',
  reference: '', receipt: null, noReceiptReason: '', open: false, ...patch,
});

const blankShared = () => ({
  date: todayIso(),
  paymentMethod: '',
  bankAccountId: '',
  costCentreId: '',
  /** '' means "by each row's date". */
  budgetId: '',
  payeeId: '',
  payeeName: '',
  receipt: null as File | null,
  noReceiptReason: '',
});

interface Props {
  budgets?: { id: string; title: string }[];
  onDone: () => void;
}

export default function BulkExpenseDialog({ onDone }: Props) {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([blankRow(), blankRow()]);
  const [shared, setShared] = useState(blankShared);
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [copying, setCopying] = useState(false);
  /** Row index → what it duplicates. Set on the first save; a second save goes ahead. */
  const [dupes, setDupes] = useState<Record<number, string> | null>(null);
  const code = useRef(batchCode());

  const { data: categories = [] } = useExpenseCategories();
  const { data: costCentres = [] } = useCostCentres();
  const { data: banks = [] } = useBankAccounts();
  const { data: lockedThrough } = useLockedThrough();
  const { data: budgetRows = [] } = useBudgetsWithSpend(user?.id);

  const changed = () => setDupes(null);
  const setRow = (i: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    if ('amount' in patch || 'date' in patch) changed();
  };
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (i: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : [blankRow()]));
    changed();
  };

  const reset = () => {
    setRows([blankRow(), blankRow()]);
    setShared(blankShared());
    setShowErrors(false);
    setPasteOpen(false);
    setPasteText('');
    setDupes(null);
    code.current = batchCode();
  };

  // Cost centre defaults to Daily Orders, as on the single form.
  useEffect(() => {
    if (shared.costCentreId || costCentres.length === 0) return;
    const daily = costCentres.find((c) => /daily/i.test(c.name)) ?? costCentres[0];
    setShared((s) => ({ ...s, costCentreId: daily.id }));
  }, [costCentres, shared.costCentreId]);

  // Rows handed over from the single form's "split into lines".
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const d = (e as CustomEvent<BulkPrefill>).detail;
      if (!d?.rows?.length) return;
      reset();
      setShared((s) => ({
        ...s,
        date: d.date || s.date,
        payeeId: d.payeeId ?? '',
        payeeName: d.payeeName ?? '',
        paymentMethod: d.paymentMethod ?? '',
      }));
      setRows(d.rows.map((r) => blankRow({ description: r.description, amount: r.amount, categoryId: r.categoryId ?? '' })));
      setOpen(true);
    };
    window.addEventListener(BULK_PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(BULK_PREFILL_EVENT, onPrefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const needsBank = METHODS_NEEDING_BANK.has(shared.paymentMethod.toLowerCase());

  /** A row the user has not started is ignored rather than reported as broken. */
  const isBlank = (r: Row) => !r.amount.trim() && !r.description.trim() && !r.categoryId;

  // What each row will actually be saved with, after the batch settings.
  const resolved = useMemo(() => rows.map((r, i) => {
    const date = r.date || shared.date;
    const payeeId = r.payeeId || shared.payeeId;
    const payeeName = r.payeeId ? r.payeeName : shared.payeeName;
    const category = categories.find((c) => c.id === r.categoryId);
    const budget = shared.budgetId
      ? budgetRows.find((b) => b.id === shared.budgetId) ?? null
      : budgetForDate(budgetRows, date);
    const parsed = parseMoney(r.amount);
    return {
      date,
      payeeId: payeeId && payeeId !== ONE_OFF ? payeeId : null,
      payeeName: payeeId === ONE_OFF || !payeeId ? payeeName : null,
      category,
      // The account follows the category. 5900 only if a category has none set.
      accountCode: category ? (category.account_code ?? '5900') : '',
      budget,
      reference: r.reference.trim() || autoReference(date, code.current, i),
      receipt: r.receipt ?? shared.receipt,
      noReceiptReason: r.noReceiptReason.trim() || shared.noReceiptReason.trim(),
      amountMinor: isMoneyError(parsed) ? 0n : parsed.minor,
    };
  }), [rows, shared, categories, budgetRows]);

  const validated = useMemo(() => rows.map((r, i) => {
    if (isBlank(r)) return { blank: true as const };
    const v = resolved[i];
    return {
      blank: false as const,
      result: validateExpenseLine(
        {
          description: r.description,
          amount: r.amount,
          category_id: r.categoryId,
          payee_id: v.payeeId,
          payee_name: v.payeeName,
          expense_account_code: v.accountCode,
          cost_centre: costCentres.find((c) => c.id === shared.costCentreId)?.name ?? '',
          budget_id: v.budget?.id ?? null,
          reference: v.reference,
          receipt_path: v.receipt ? 'pending-upload' : null,
          no_receipt_reason: v.noReceiptReason,
          date: v.date,
          payment_method: shared.paymentMethod,
          bank_account_id: shared.bankAccountId || null,
        },
        { lockedThrough },
      ),
    };
  }), [rows, resolved, shared, costCentres, lockedThrough]);

  const errorsFor = (i: number): Record<string, string> => {
    const v = validated[i];
    return v.blank ? {} : errorMap(v.result);
  };

  const filledCount = validated.filter((v) => !v.blank).length;
  const failures = validated.flatMap((v) => (v.blank ? [] : validationErrors(v.result)));
  const badCount = validated.filter((v) => !v.blank && validationErrors(v.result).length > 0).length;
  const totalMinor = resolved.reduce((sum, v, i) => (validated[i].blank ? sum : sum + v.amountMinor), 0n);

  // Budget warnings at 80% and 100%, counting every row in the batch together.
  const budgetAlerts = useMemo(() => {
    const add = new Map<string, bigint>();
    resolved.forEach((v, i) => {
      if (validated[i].blank || !v.budget) return;
      add.set(v.budget.id, (add.get(v.budget.id) ?? 0n) + v.amountMinor);
    });
    return [...add.entries()].flatMap(([id, addMinor]) => {
      const b = budgetRows.find((x) => x.id === id)!;
      const alert = budgetAlert(nairaToMinor(b.spent), addMinor, nairaToMinor(b.total_budget));
      return alert ? [{ id, title: b.title, alert }] : [];
    });
  }, [resolved, validated, budgetRows]);

  const upload = async (file: File): Promise<string> => {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${user!.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('receipts').upload(path, file);
    if (error) throw error;
    return path;
  };

  // ── Copy last week ────────────────────────────────────────────────────────
  const copyLastWeek = async () => {
    setCopying(true);
    try {
      const { from, to } = previousWeek(shared.date || todayIso());
      const { data, error } = await db
        .from('expenses')
        .select('date, amount_minor, amount, description, category_id, payee_id, payee_name')
        .gte('date', from).lte('date', to)
        .is('cancelled_at', null)
        .in('source', ['capture', 'report'])
        .order('date');
      if (error) throw error;
      const live = new Set(categories.map((c) => c.id));
      const copied = rowsFromPriorWeek(data ?? [], todayIso()).map((r) => blankRow({
        date: r.date === shared.date ? '' : r.date,
        amount: r.amount,
        description: r.description,
        // A category retired since last week has to be chosen again.
        categoryId: live.has(r.categoryId) ? r.categoryId : '',
        payeeId: r.payeeId ?? (r.payeeName ? ONE_OFF : ''),
        payeeName: r.payeeName,
      }));
      if (copied.length === 0) {
        toast({ title: 'Nothing to copy', description: `No expenses were recorded between ${from} and ${to}.` });
        return;
      }
      setRows((prev) => [...prev.filter((r) => !isBlank(r)), ...copied]);
      changed();
      toast({
        title: `${copied.length} row${copied.length === 1 ? '' : 's'} copied from last week`,
        description: 'Check each amount before saving. Remove the lines that did not repeat.',
      });
    } catch (e: any) {
      toast({ title: 'Could not copy last week', description: e.message, variant: 'destructive' });
    } finally {
      setCopying(false);
    }
  };

  // ── Paste a list: each line becomes its own row ───────────────────────────
  const makeRowsFromPaste = () => {
    const found = splitNarrative(pasteText).lines;
    if (found.length === 0) {
      toast({
        title: 'No amounts found',
        description: 'Put each purchase on its own line with its amount, for example "Plantain 12,000".',
        variant: 'destructive',
      });
      return;
    }
    setRows((prev) => [
      ...prev.filter((r) => !isBlank(r)),
      ...found.map((l) => blankRow({ description: l.description, amount: l.amountRaw })),
    ]);
    setPasteText('');
    setPasteOpen(false);
    changed();
    toast({ title: `${found.length} row${found.length === 1 ? '' : 's'} added`, description: 'Give each one a category.' });
  };

  // ── Duplicates: same date and amount, in this batch or already recorded ───
  const findDuplicates = async (): Promise<Record<number, string>> => {
    const out: Record<number, string> = {};
    const live = resolved.map((v, i) => ({ ...v, i })).filter((v) => !validated[v.i].blank && v.amountMinor > 0n);
    duplicatesWithin(resolved.map((v, i) => ({ date: v.date, amountMinor: validated[i].blank ? 0n : v.amountMinor })))
      .forEach((i) => { out[i] = 'Another row in this batch has the same date and amount.'; });
    if (live.length === 0) return out;

    const dates = live.map((v) => v.date).sort();
    const { data } = await db
      .from('expenses')
      .select('date, amount_minor, description, payee_name')
      .in('amount_minor', [...new Set(live.map((v) => Number(v.amountMinor)))])
      .gte('date', dates[0]).lte('date', dates[dates.length - 1])
      .is('cancelled_at', null)
      .neq('status', 'rejected');
    for (const v of live) {
      const hit = (data ?? []).find((e: any) => e.date === v.date && BigInt(e.amount_minor ?? 0) === v.amountMinor);
      if (hit) out[v.i] = `Already recorded on ${hit.date}: ${hit.payee_name ? `${hit.payee_name} · ` : ''}${hit.description ?? ''}`.slice(0, 160);
    }
    return out;
  };

  const save = async () => {
    setShowErrors(true);

    if (filledCount === 0) {
      toast({ title: 'Nothing to save', description: 'Fill in at least one row.', variant: 'destructive' });
      return;
    }
    // Refuse to save ANY row if one fails: no partial writes.
    if (badCount > 0) {
      toast({
        title: `${badCount} row${badCount === 1 ? '' : 's'} need${badCount === 1 ? 's' : ''} attention`,
        description: failures[0]?.message,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      if (dupes === null) {
        const found = await findDuplicates();
        if (Object.keys(found).length > 0) {
          setDupes(found);
          toast({
            title: 'Possible duplicates',
            description: `${Object.keys(found).length} row(s) match an expense with the same date and amount. Check them, then press "Save anyway" if they are separate purchases.`,
            variant: 'destructive',
          });
          return;
        }
        setDupes({});
      }

      // One upload for the batch receipt, however many rows use it.
      const sharedPath = shared.receipt && resolved.some((v, i) => !validated[i].blank && !rows[i].receipt)
        ? await upload(shared.receipt)
        : null;

      const payload = [];
      for (let i = 0; i < rows.length; i++) {
        const v = validated[i];
        if (v.blank) continue;
        const value = (v.result as { ok: true; value: ValidatedExpenseLine }).value;
        const r = resolved[i];
        const receiptPath = rows[i].receipt ? await upload(rows[i].receipt!) : sharedPath;

        payload.push({
          amount_minor: Number(value.amount_minor),
          description: value.description,
          category: r.category?.name ?? null,
          category_id: value.category_id,
          date: value.date,
          budget_id: value.budget_id,
          expense_account_code: r.accountCode || null,
          account_type: r.accountCode >= '5000' && r.accountCode <= '5099' ? 'COGS' : 'OpEX',
          cost_center: value.cost_centre,
          payment_method: value.payment_method,
          bank_account_id: value.bank_account_id,
          vat_minor: 0,
          wht_minor: 0,
          reference: value.reference,
          receipt_path: receiptPath,
          no_receipt_reason: receiptPath ? null : value.no_receipt_reason,
          payee_id: value.payee_id,
          payee_name: value.payee_name,
          source: 'capture',
          created_by: user?.id,
          submitted_by: user?.id,
          submitted_at: new Date().toISOString(),
          status: isAdmin ? 'approved' : 'pending',
        });
      }

      const { data: savedRows, error } = await db.from('expenses').insert(payload).select('status');
      if (error) throw error;

      const held = (savedRows ?? []).filter((x: any) => x.status === 'pending').length;
      toast({
        title: `${payload.length} expense${payload.length === 1 ? '' : 's'} added`,
        description: `Total ${formatMinor(totalMinor)}.${held ? ` ${held} waiting for approval.` : ''}`,
      });
      setOpen(false);
      reset();
      onDone();
    } catch (e: any) {
      toast({ title: 'Could not save', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const dupeCount = dupes ? Object.keys(dupes).length : 0;

  return (
    <>
      <Button variant="outline" className="h-11" onClick={() => { reset(); setOpen(true); }}>
        <Layers className="mr-2 h-4 w-4" aria-hidden />
        Add Multiple
      </Button>

      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="Add multiple expenses"
        description="A row needs an amount, a description and a category. The rest comes from the settings at the top."
        size="wide"
        dirty={filledCount > 0}
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <span className="text-sm sm:mr-auto self-center" role="status">
              {filledCount} row{filledCount === 1 ? '' : 's'} · total{' '}
              <span className="font-semibold tabular-nums">{formatMinor(totalMinor)}</span>
              {showErrors && badCount > 0 && (
                <span className="text-destructive"> · {badCount} need attention</span>
              )}
            </span>
            <Button variant="outline" className="h-11" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="h-11" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden />}
              {dupeCount > 0 ? 'Save anyway' : 'Save all'}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* ── Settings shared by every row ── */}
          <div className="rounded-lg border p-3 sm:p-4 space-y-4">
            <h3 className="text-sm font-semibold">Applies to every row</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field id="bulk-date" label="Date" required hint="A row can carry its own date.">
                <Input
                  id="bulk-date"
                  type="date"
                  value={shared.date}
                  max={todayIso()}
                  onChange={(e) => { setShared((s) => ({ ...s, date: e.target.value })); changed(); }}
                  className="h-11 text-base"
                />
              </Field>

              <Field id="bulk-method" label="Payment method" required>
                <SearchableSelect
                  id="bulk-method"
                  options={[...PAYMENT_METHODS, 'Credit'].map((m) => ({ value: m, label: m }))}
                  value={shared.paymentMethod}
                  onChange={(v) =>
                    setShared((s) => ({
                      ...s,
                      paymentMethod: v,
                      bankAccountId: METHODS_NEEDING_BANK.has(v.toLowerCase()) ? s.bankAccountId : '',
                    }))
                  }
                  placeholder="Choose a method"
                  title="How were these paid?"
                  required
                  invalid={showErrors && !shared.paymentMethod}
                />
              </Field>

              <Field id="bulk-centre" label="Cost centre" required>
                <SearchableSelect
                  id="bulk-centre"
                  options={costCentreOptions(costCentres)}
                  value={shared.costCentreId}
                  onChange={(v) => setShared((s) => ({ ...s, costCentreId: v }))}
                  placeholder="Choose a cost centre"
                  title="Choose a cost centre"
                  required
                  invalid={showErrors && !shared.costCentreId}
                />
              </Field>

              <Field id="bulk-budget" label="Budget" hint="Left alone, each row goes to the budget for its date.">
                <SearchableSelect
                  id="bulk-budget"
                  options={budgetOptions(budgetRows)}
                  value={shared.budgetId}
                  onChange={(v) => setShared((s) => ({ ...s, budgetId: v }))}
                  placeholder="By each row's date"
                  emptyOptionLabel="By each row's date"
                  title="Choose a budget"
                />
              </Field>

              <Field id="bulk-payee" label="Payee / supplier" required className="sm:col-span-2" hint="A row can name a different one.">
                <PayeeField
                  id="bulk-payee"
                  value={shared.payeeId}
                  name={shared.payeeName}
                  onChange={(v, n) => setShared((s) => ({ ...s, payeeId: v, payeeName: n }))}
                  invalid={showErrors && failures.some((f) => f.field === 'payee') && !shared.payeeId}
                  required
                />
              </Field>

              {needsBank && (
                <Field id="bulk-bank" label="Bank account" required className="sm:col-span-2">
                  <SearchableSelect
                    id="bulk-bank"
                    options={bankOptions(banks)}
                    value={shared.bankAccountId}
                    onChange={(v) => setShared((s) => ({ ...s, bankAccountId: v }))}
                    placeholder="Choose the account used"
                    title="Which bank account?"
                    required
                    invalid={showErrors && !shared.bankAccountId}
                  />
                </Field>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-sm font-medium">One receipt for the batch</span>
                <p className="text-xs text-muted-foreground mb-1.5">
                  For example the market list. Used for every row of {formatMinor(RECEIPT_THRESHOLD_MINOR)} or more that has no receipt of its own.
                </p>
                <ReceiptUpload
                  id="bulk-shared-receipt"
                  file={shared.receipt}
                  onChange={(f) => setShared((s) => ({ ...s, receipt: f }))}
                />
              </div>
              {!shared.receipt && (
                <Field
                  id="bulk-shared-reason"
                  label="No receipt? Say why"
                  hint="Applies to rows without a receipt. These are listed under Expenses → No receipt."
                >
                  <Input
                    id="bulk-shared-reason"
                    value={shared.noReceiptReason}
                    onChange={(e) => setShared((s) => ({ ...s, noReceiptReason: e.target.value }))}
                    placeholder="e.g. Open-market traders do not issue receipts"
                    className="h-11 text-base"
                  />
                </Field>
              )}
            </div>
          </div>

          {/* ── Faster ways in ── */}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={copyLastWeek} disabled={copying}>
              {copying
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />
                : <History className="h-4 w-4 mr-2" aria-hidden />}
              Copy last week
            </Button>
            <Button type="button" variant="outline" className="h-11" onClick={() => setPasteOpen((o) => !o)} aria-expanded={pasteOpen}>
              <ClipboardList className="h-4 w-4 mr-2" aria-hidden />
              Paste a list
            </Button>
          </div>

          {pasteOpen && (
            <div className="rounded-lg border p-3 space-y-2">
              <label htmlFor="bulk-paste" className="text-sm font-medium">Paste the list, one purchase per line with its amount</label>
              <Textarea
                id="bulk-paste"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={6}
                placeholder={'Plantain 12,000\nBus fuel 50,000\nBike fuel 38,000'}
                className="text-base"
              />
              <div className="flex gap-2">
                <Button type="button" className="h-11" onClick={makeRowsFromPaste} disabled={!pasteText.trim()}>
                  Make rows
                </Button>
                <Button type="button" variant="ghost" className="h-11" onClick={() => setPasteOpen(false)}>Close</Button>
              </div>
            </div>
          )}

          {budgetAlerts.map(({ id, title, alert }) => (
            <p key={id} role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
              <span>
                {alert.level === 'over'
                  ? <>These rows take <b>{title}</b> over budget by {formatMinor(alert.overByMinor)}.</>
                  : <>These rows bring <b>{title}</b> to {alert.pct.toFixed(0)}% of its budget.</>}
              </span>
            </p>
          ))}

          {/* ── The rows ── */}
          <div className="hidden lg:grid grid-cols-12 gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="col-span-2">Amount *</span>
            <span className="col-span-4">Description *</span>
            <span className="col-span-3">Category *</span>
            <span className="col-span-2">Date</span>
            <span className="col-span-1" />
          </div>

          <div className="space-y-3 lg:space-y-2">
            {rows.map((row, i) => {
              const rowErrors = showErrors ? errorsFor(i) : {};
              const hasError = Object.keys(rowErrors).length > 0;
              const v = resolved[i];
              const dupe = dupes?.[i];
              const needsReceipt = v.amountMinor >= RECEIPT_THRESHOLD_MINOR && !v.receipt;
              const detailError = rowErrors.receipt || rowErrors.no_receipt_reason || rowErrors.reference || rowErrors.payee || rowErrors.date;
              const showDetail = row.open || !!detailError;
              return (
                <div
                  key={i}
                  className={[
                    'rounded-lg border p-3 space-y-3',
                    'lg:border-0 lg:border-b lg:rounded-none lg:px-0 lg:pt-0 lg:pb-2 lg:space-y-0 lg:grid lg:grid-cols-12 lg:gap-2 lg:items-start',
                    hasError ? 'border-destructive' : '',
                  ].join(' ')}
                >
                  <div className="lg:col-span-2">
                    <label htmlFor={`bulk-amount-${i}`} className="lg:sr-only text-xs font-medium">Amount</label>
                    <MoneyInput
                      id={`bulk-amount-${i}`}
                      value={row.amount}
                      onChange={(val) => setRow(i, { amount: val })}
                      error={rowErrors.amount}
                      showPreview={!!rowErrors.amount}
                    />
                  </div>

                  <div className="lg:col-span-4">
                    <label htmlFor={`bulk-desc-${i}`} className="lg:sr-only text-xs font-medium">Description</label>
                    <Input
                      id={`bulk-desc-${i}`}
                      value={row.description}
                      onChange={(e) => setRow(i, { description: e.target.value })}
                      placeholder="What was bought"
                      className="h-11 text-base"
                    />
                    {rowErrors.description && (
                      <p role="alert" className="text-xs text-destructive mt-1">⚠ {rowErrors.description}</p>
                    )}
                  </div>

                  <div className="lg:col-span-3">
                    <label htmlFor={`bulk-cat-${i}`} className="lg:sr-only text-xs font-medium">Category</label>
                    <SearchableSelect
                      id={`bulk-cat-${i}`}
                      options={categoryOptions(categories)}
                      value={row.categoryId}
                      onChange={(val) => setRow(i, { categoryId: val })}
                      placeholder="Category"
                      title="Choose a category"
                      invalid={!!rowErrors.category_id}
                    />
                    {v.category && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Account {v.accountCode}{v.budget ? ` · ${v.budget.title}` : ' · no budget covers this date'}
                      </p>
                    )}
                  </div>

                  <div className="lg:col-span-2">
                    <label htmlFor={`bulk-date-${i}`} className="lg:sr-only text-xs font-medium">Date</label>
                    <Input
                      id={`bulk-date-${i}`}
                      type="date"
                      value={row.date || shared.date}
                      max={todayIso()}
                      onChange={(e) => setRow(i, { date: e.target.value === shared.date ? '' : e.target.value })}
                      className={`h-11 text-base ${row.date ? '' : 'text-muted-foreground'}`}
                      aria-invalid={!!rowErrors.date || undefined}
                    />
                  </div>

                  <div className="lg:col-span-1 flex gap-1 lg:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setRow(i, { open: !row.open })}
                      className="h-11 w-11 p-0 shrink-0"
                      aria-expanded={showDetail}
                      aria-label={`Payee, reference and receipt for row ${i + 1}`}
                      title="Payee, reference and receipt"
                    >
                      {showDetail ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeRow(i)}
                      className="h-11 w-11 p-0 text-destructive shrink-0"
                      aria-label={`Remove row ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>

                  {(dupe || rowErrors.date || (needsReceipt && !showDetail && !v.noReceiptReason)) && (
                    <div className="lg:col-span-12 space-y-1">
                      {rowErrors.date && <p role="alert" className="text-xs text-destructive">⚠ {rowErrors.date}</p>}
                      {dupe && (
                        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />Possible duplicate. {dupe}
                        </p>
                      )}
                      {needsReceipt && !showDetail && !v.noReceiptReason && (
                        <p className="text-xs text-muted-foreground">
                          Needs a receipt, or a reason for not having one. Add either at the top for the whole batch, or open this row.
                        </p>
                      )}
                    </div>
                  )}

                  {showDetail && (
                    <div className="lg:col-span-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:pt-1 lg:pb-2">
                      <div>
                        <label htmlFor={`bulk-payee-${i}`} className="text-xs font-medium">Payee</label>
                        <div className="mt-1">
                          <PayeeField
                            id={`bulk-payee-${i}`}
                            value={row.payeeId}
                            name={row.payeeName}
                            onChange={(val, n) => setRow(i, { payeeId: val, payeeName: n })}
                            placeholder="Same as the batch"
                            emptyOptionLabel="Same as the batch"
                            invalid={!!rowErrors.payee}
                          />
                        </div>
                        {rowErrors.payee && <p role="alert" className="text-xs text-destructive mt-1">⚠ {rowErrors.payee}</p>}
                      </div>
                      <div>
                        <label htmlFor={`bulk-ref-${i}`} className="text-xs font-medium">Reference / invoice no.</label>
                        <Input
                          id={`bulk-ref-${i}`}
                          value={row.reference}
                          onChange={(e) => setRow(i, { reference: e.target.value })}
                          placeholder={v.reference}
                          className="h-11 text-base mt-1"
                        />
                        {rowErrors.reference && <p role="alert" className="text-xs text-destructive mt-1">⚠ {rowErrors.reference}</p>}
                      </div>
                      <div>
                        <span className="text-xs font-medium">Receipt for this row</span>
                        <ReceiptUpload
                          id={`bulk-receipt-${i}`}
                          file={row.receipt}
                          onChange={(f) => setRow(i, { receipt: f })}
                          error={rowErrors.receipt}
                        />
                      </div>
                      {!row.receipt && (
                        <div>
                          <label htmlFor={`bulk-reason-${i}`} className="text-xs font-medium">No receipt? Say why</label>
                          <Input
                            id={`bulk-reason-${i}`}
                            value={row.noReceiptReason}
                            onChange={(e) => setRow(i, { noReceiptReason: e.target.value })}
                            placeholder={shared.noReceiptReason || 'Reason'}
                            className="h-11 text-base mt-1"
                            aria-invalid={!!rowErrors.no_receipt_reason || undefined}
                          />
                          {rowErrors.no_receipt_reason && (
                            <p role="alert" className="text-xs text-destructive mt-1">⚠ {rowErrors.no_receipt_reason}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Button type="button" variant="outline" className="h-11" onClick={addRow}>
            <Plus className="h-4 w-4 mr-2" aria-hidden />
            Add row
          </Button>
        </div>
      </FormSheet>
    </>
  );
}
