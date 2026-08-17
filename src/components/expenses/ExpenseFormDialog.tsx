import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormSheet, Field, RequiredLegend } from '@/components/ui/form-sheet';
import { MoneyInput } from '@/components/ui/money-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import ReceiptUpload from '@/components/expenses/ReceiptUpload';
import SplitLinesDialog, { type DraftLine } from '@/components/expenses/SplitLinesDialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { useToast } from '@/hooks/use-toast';
import { parseMoney, isMoneyError, formatMinor, nairaToMinor } from '@/lib/money';
import {
  validateExpenseLine,
  validationErrors,
  errorMap,
  todayIso,
  type FieldError,
  type ExpenseLineInput,
  type ValidatedExpenseLine,
} from '@/lib/expenseValidation';
import { PAYMENT_METHODS } from '@/lib/expenseConstants';
import {
  useExpenseCategories, useCostCentres, usePayees, useExpenseAccounts,
  useBankAccounts, useLockedThrough, useBudgetsWithSpend,
  categoryOptions, costCentreOptions, payeeOptions, accountOptions,
  bankOptions, budgetOptions,
} from '@/hooks/useExpenseReference';

// ─────────────────────────────────────────────────────────────────────────────
// Add / edit a single expense.
//
// Mobile first: a full-screen sheet below 640px with a sticky action bar, one
// column, 44px targets and 16px text. Two columns from 640px, capped at 720px
// so a text input is never 1400px wide.
//
// Field order is identical at every width (§5.1) — staff who learn one order
// should not have to relearn it on another device.
// ─────────────────────────────────────────────────────────────────────────────

const db = supabase as any;

const ONE_OFF = '__one_off__';

interface FormState {
  amount: string;
  date: string;
  payeeId: string;
  payeeName: string;
  description: string;
  categoryId: string;
  budgetId: string;
  accountId: string;
  costCentreId: string;
  paymentMethod: string;
  bankAccountId: string;
  vat: string;
  wht: string;
  reference: string;
}

const blank = (): FormState => ({
  amount: '',
  date: todayIso(),
  payeeId: '',
  payeeName: '',
  description: '',
  categoryId: '',
  budgetId: '',
  accountId: '',
  costCentreId: '',
  // NO pre-selected value. The old control displayed "Select method" while
  // actually holding "Card" (§5.4).
  paymentMethod: '',
  bankAccountId: '',
  vat: '',
  wht: '',
  reference: '',
});

export interface EditingExpense {
  id: string;
  amount_minor?: number;
  amount: number;
  description: string;
  category: string;
  category_id?: string | null;
  date: string;
  budget_id: string | null;
  cost_center: string | null;
  payment_method: string | null;
  receipt_path: string | null;
  expense_account_code?: string | null;
  payee_id?: string | null;
  payee_name?: string | null;
  reference?: string | null;
  vat_minor?: number | null;
  wht_minor?: number | null;
  bank_account_id?: string | null;
}

interface Props {
  budgets?: { id: string; title: string }[];
  onExpenseAdded: () => void;
  editingExpense?: EditingExpense | null;
  isEditOpen?: boolean;
  onEditOpenChange?: (open: boolean) => void;
  onExpenseUpdated?: () => void;
}

const METHODS_NEEDING_BANK = new Set(['transfer', 'card', 'pos']);

export default function ExpenseFormDialog({
  onExpenseAdded,
  editingExpense,
  isEditOpen,
  onEditOpenChange,
  onExpenseUpdated,
}: Props) {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const { toast } = useToast();

  const isEditMode = !!editingExpense;
  const [selfOpen, setSelfOpen] = useState(false);
  const open = isEditMode ? (isEditOpen ?? false) : selfOpen;
  const setOpen = isEditMode ? (onEditOpenChange ?? (() => {})) : setSelfOpen;

  const [form, setForm] = useState<FormState>(blank);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [existingReceipt, setExistingReceipt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const { data: categories = [] } = useExpenseCategories();
  const { data: costCentres = [] } = useCostCentres();
  const { data: payees = [] } = usePayees();
  const { data: accounts = [] } = useExpenseAccounts();
  const { data: banks = [] } = useBankAccounts();
  const { data: lockedThrough } = useLockedThrough();
  const { data: budgetRows = [] } = useBudgetsWithSpend(user?.id);

  const set = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  useEffect(() => {
    if (!editingExpense) return;
    const minor = editingExpense.amount_minor ?? Math.round((editingExpense.amount ?? 0) * 100);
    setForm({
      amount: (minor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','),
      date: editingExpense.date,
      payeeId: editingExpense.payee_id ?? '',
      payeeName: editingExpense.payee_name ?? '',
      description: editingExpense.description ?? '',
      categoryId: editingExpense.category_id ?? '',
      budgetId: editingExpense.budget_id ?? '',
      accountId: accounts.find((a) => a.code === editingExpense.expense_account_code)?.id ?? '',
      costCentreId: costCentres.find((c) => c.name === editingExpense.cost_center)?.id ?? '',
      paymentMethod: editingExpense.payment_method ?? '',
      bankAccountId: editingExpense.bank_account_id ?? '',
      vat: editingExpense.vat_minor ? (editingExpense.vat_minor / 100).toString() : '',
      wht: editingExpense.wht_minor ? (editingExpense.wht_minor / 100).toString() : '',
      reference: editingExpense.reference ?? '',
    });
    setExistingReceipt(editingExpense.receipt_path);
    setReceiptFile(null);
    setErrors({});
    setTouched({});
    setDirty(false);
  }, [editingExpense, accounts, costCentres]);

  // ── Category may pre-fill the account, but it stays editable ──────────────
  const chosenCategory = categories.find((c) => c.id === form.categoryId);
  useEffect(() => {
    if (!chosenCategory?.account_code) return;
    if (form.accountId) return; // never overwrite a choice the user made
    const match = accounts.find((a) => a.code === chosenCategory.account_code);
    if (match) setForm((p) => ({ ...p, accountId: match.id }));
  }, [chosenCategory, accounts, form.accountId]);

  const amountParsed = form.amount.trim() === '' ? null : parseMoney(form.amount);
  const amountMinor = amountParsed && !isMoneyError(amountParsed) ? amountParsed.minor : 0n;

  const selectedBudget = budgetRows.find((b) => b.id === form.budgetId);
  const budgetRemaining = selectedBudget
    ? nairaToMinor(selectedBudget.total_budget - selectedBudget.spent)
    : null;
  const overBudget = budgetRemaining !== null && amountMinor > budgetRemaining;

  const needsBank = METHODS_NEEDING_BANK.has(form.paymentMethod.toLowerCase());

  const toValidatorInput = (): ExpenseLineInput => ({
    description: form.description,
    amount: form.amount,
    category_id: form.categoryId,
    payee_id: form.payeeId && form.payeeId !== ONE_OFF ? form.payeeId : null,
    payee_name: form.payeeId === ONE_OFF || !form.payeeId ? form.payeeName : null,
    expense_account_code: accounts.find((a) => a.id === form.accountId)?.code ?? '',
    cost_centre: costCentres.find((c) => c.id === form.costCentreId)?.name ?? '',
    budget_id: form.budgetId || null,
    vat: form.vat,
    wht: form.wht,
    reference: form.reference,
    receipt_path: receiptFile ? 'pending-upload' : existingReceipt,
    date: form.date,
    payment_method: form.paymentMethod,
    bank_account_id: form.bankAccountId || null,
  });

  /** Live errors, so a blurred field can show its own message (§5.3). */
  const liveErrors = useMemo(() => {
    return errorMap(validateExpenseLine(toValidatorInput(), { lockedThrough }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, receiptFile, existingReceipt, lockedThrough, accounts, costCentres]);

  const errorFor = (field: string) =>
    errors[field] ?? (touched[field] ? liveErrors[field] : undefined) ?? null;

  const splitOffered = !!liveErrors.description && form.description.trim().length > 0;

  const reset = () => {
    setForm(blank());
    setReceiptFile(null);
    setExistingReceipt(null);
    setErrors({});
    setTouched({});
    setDirty(false);
  };

  const uploadReceipt = async (): Promise<string | null> => {
    if (!receiptFile || !user) return null;
    const ext = receiptFile.name.split('.').pop() || 'jpg';
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('receipts').upload(path, receiptFile);
    if (error) throw error;
    return path;
  };

  const focusFirstError = (errs: FieldError[]) => {
    const first = errs[0];
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(`#expense-${first.field}`);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // The same validator every other route calls. Nothing bypasses it.
    const result = validateExpenseLine(toValidatorInput(), { lockedThrough });
    const failures = validationErrors(result);
    if (failures.length > 0) {
      setErrors(errorMap(result));
      setTouched((t) => ({ ...t, ...Object.fromEntries(failures.map((x) => [x.field, true])) }));
      focusFirstError(failures);
      toast({ title: 'Check the form', description: failures[0].message, variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      let receiptPath = existingReceipt;
      if (receiptFile) receiptPath = await uploadReceipt();

      const value = (result as { ok: true; value: ValidatedExpenseLine }).value;
      const account = accounts.find((a) => a.id === form.accountId);
      const payload = {
        amount_minor: Number(value.amount_minor),
        description: value.description,
        category: chosenCategory?.name ?? null,
        category_id: value.category_id,
        date: value.date,
        budget_id: value.budget_id,
        expense_account_code: account?.code ?? null,
        // The old two-value column is kept in step for anything still reading
        // it, but the account code above is what the journal now uses.
        account_type: account?.code === '5000' ? 'COGS' : 'OpEX',
        cost_center: value.cost_centre,
        payment_method: value.payment_method,
        bank_account_id: value.bank_account_id,
        vat_minor: Number(value.vat_minor),
        wht_minor: Number(value.wht_minor),
        reference: value.reference,
        receipt_path: receiptPath,
        payee_id: value.payee_id,
        payee_name: value.payee_name,
      };

      if (isEditMode && editingExpense) {
        const { error } = await db.from('expenses').update(payload).eq('id', editingExpense.id);
        if (error) throw error;
        toast({ title: 'Expense updated', description: `${formatMinor(value.amount_minor)} saved.` });
        setOpen(false);
        onExpenseUpdated?.();
      } else {
        const { error } = await db.from('expenses').insert({
          ...payload,
          created_by: user?.id,
          submitted_by: user?.id,
          submitted_at: new Date().toISOString(),
          status: isAdmin ? 'approved' : 'pending',
        });
        if (error) throw error;
        toast({
          title: 'Expense added',
          description: isAdmin
            ? `${formatMinor(value.amount_minor)} recorded.`
            : `${formatMinor(value.amount_minor)} submitted — it counts once an admin approves it.`,
        });
        setOpen(false);
        reset();
        onExpenseAdded();
      }
    } catch (err: any) {
      toast({ title: 'Could not save', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const applySplit = (lines: DraftLine[]) => {
    // The single-entry form holds one expense. The split belongs on a claim,
    // so keep the first line here and tell the user where the rest went.
    const [first, ...rest] = lines;
    if (first) {
      set({ amount: first.amount, description: first.description, categoryId: first.categoryId });
    }
    if (rest.length > 0) {
      toast({
        title: `${rest.length} more line${rest.length === 1 ? '' : 's'} detected`,
        description: 'Use "Add Multiple" to enter them all at once — this form records one expense.',
      });
    }
  };

  const payeeSelectOptions = [
    { value: ONE_OFF, label: 'One-off payee — type a name' },
    ...payeeOptions(payees),
  ];

  const body = (
    <form
      ref={formRef}
      id="expense-form"
      onSubmit={submit}
      onKeyDown={(e) => {
        // Ctrl/Cmd+Enter saves (§5.3).
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          formRef.current?.requestSubmit();
        }
      }}
      className="space-y-4"
    >
      <RequiredLegend />

      {/* 1 Amount, 2 Date — paired from sm up */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="expense-amount" label="Amount" required error={errorFor('amount')}>
          <MoneyInput
            id="expense-amount"
            value={form.amount}
            onChange={(v) => set({ amount: v })}
            onBlur={() => setTouched((t) => ({ ...t, amount: true }))}
            error={errorFor('amount')}
            aria-required
            enterKeyHint="next"
          />
        </Field>

        <Field id="expense-date" label="Date" required error={errorFor('date')}>
          <Input
            id="expense-date"
            type="date"
            value={form.date}
            max={todayIso()}
            onChange={(e) => set({ date: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, date: true }))}
            className="h-11 text-base"
            aria-required
          />
        </Field>
      </div>

      {/* 3 Payee */}
      <Field
        id="expense-payee"
        label="Payee / supplier"
        required
        error={errorFor('payee')}
        hint="Who received the money."
      >
        <SearchableSelect
          id="expense-payee"
          options={payeeSelectOptions}
          value={form.payeeId}
          onChange={(v) => set({ payeeId: v, payeeName: v === ONE_OFF ? form.payeeName : '' })}
          placeholder="Choose a supplier"
          title="Choose a payee"
          required
          invalid={!!errorFor('payee')}
        />
        {form.payeeId === ONE_OFF && (
          <Input
            aria-label="One-off payee name"
            placeholder="Name of the person or business paid"
            value={form.payeeName}
            onChange={(e) => set({ payeeName: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, payee: true }))}
            className="h-11 text-base mt-2"
          />
        )}
      </Field>

      {/* 4 Description */}
      <Field
        id="expense-description"
        label="Description"
        required
        error={errorFor('description')}
        hint="One purchase. Paste a list and it will be split for you."
      >
        <Textarea
          id="expense-description"
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          onBlur={() => setTouched((t) => ({ ...t, description: true }))}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (pasted && /\n/.test(pasted)) {
              // Multi-line paste is a list by definition — offer the splitter
              // as soon as it lands, rather than at submit.
              setTimeout(() => setSplitOpen(true), 0);
            }
          }}
          rows={3}
          className="text-base min-h-[80px]"
          aria-required
        />
        {splitOffered && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 mt-1"
            onClick={() => setSplitOpen(true)}
          >
            <Scissors className="h-4 w-4 mr-2" aria-hidden />
            Split into lines
          </Button>
        )}
      </Field>

      {/* 5 Category, 6 Budget */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field id="expense-category_id" label="Category" required error={errorFor('category_id')}>
          <SearchableSelect
            id="expense-category_id"
            options={categoryOptions(categories)}
            value={form.categoryId}
            onChange={(v) => set({ categoryId: v })}
            placeholder="Choose a category"
            title="Choose a category"
            required
            invalid={!!errorFor('category_id')}
          />
        </Field>

        <Field
          id="expense-budget_id"
          label="Budget"
          required
          error={errorFor('budget_id')}
          hint={
            selectedBudget
              ? `${formatMinor(budgetRemaining!)} remaining of ${formatMinor(nairaToMinor(selectedBudget.total_budget))}`
              : undefined
          }
        >
          <SearchableSelect
            id="expense-budget_id"
            options={budgetOptions(budgetRows)}
            value={form.budgetId}
            onChange={(v) => set({ budgetId: v })}
            placeholder="Choose a budget"
            title="Choose a budget"
            required
          />
          {overBudget && (
            <p role="alert" className="text-xs text-amber-600 flex items-start gap-1 mt-1">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
              <span>
                This takes the budget {formatMinor(amountMinor - budgetRemaining!)} over. You can still
                save it — it will show as overspent.
              </span>
            </p>
          )}
        </Field>
      </div>

      {/* 7 Expense account, 7b Cost centre */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          id="expense-expense_account_code"
          label="Expense account"
          required
          error={errorFor('expense_account_code')}
          hint="Where this lands in the ledger."
        >
          <SearchableSelect
            id="expense-expense_account_code"
            options={accountOptions(accounts)}
            value={form.accountId}
            onChange={(v) => set({ accountId: v })}
            placeholder="Choose an account"
            title="Choose an expense account"
            required
            invalid={!!errorFor('expense_account_code')}
          />
        </Field>

        <Field id="expense-cost_centre" label="Cost centre" required error={errorFor('cost_centre')}>
          <SearchableSelect
            id="expense-cost_centre"
            options={costCentreOptions(costCentres)}
            value={form.costCentreId}
            onChange={(v) => set({ costCentreId: v })}
            placeholder="Choose a cost centre"
            title="Choose a cost centre"
            required
            invalid={!!errorFor('cost_centre')}
          />
        </Field>
      </div>

      {/* 8 Payment method, 9 Bank account (conditional) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          id="expense-payment_method"
          label="Payment method"
          required
          error={errorFor('payment_method')}
          hint="Decides which account the money leaves."
        >
          <SearchableSelect
            id="expense-payment_method"
            options={[...PAYMENT_METHODS, 'Credit'].map((m) => ({ value: m, label: m }))}
            value={form.paymentMethod}
            onChange={(v) => set({ paymentMethod: v, bankAccountId: METHODS_NEEDING_BANK.has(v.toLowerCase()) ? form.bankAccountId : '' })}
            placeholder="Choose a method"
            title="How was this paid?"
            required
            invalid={!!errorFor('payment_method')}
          />
        </Field>

        {needsBank && (
          <Field
            id="expense-bank_account_id"
            label="Bank account"
            required
            error={errorFor('bank_account_id')}
          >
            <SearchableSelect
              id="expense-bank_account_id"
              options={bankOptions(banks)}
              value={form.bankAccountId}
              onChange={(v) => set({ bankAccountId: v })}
              placeholder="Choose the account used"
              title="Which bank account?"
              required
              invalid={!!errorFor('bank_account_id')}
            />
          </Field>
        )}
      </div>

      {/* 10 VAT / WHT, 11 Reference */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field id="expense-vat" label="VAT" error={errorFor('vat')}>
            <MoneyInput
              id="expense-vat"
              value={form.vat}
              onChange={(v) => set({ vat: v })}
              parseOptions={{ allowZero: true, label: 'VAT' }}
              showPreview={false}
              error={errorFor('vat')}
            />
          </Field>
          <Field id="expense-wht" label="WHT" error={errorFor('wht')}>
            <MoneyInput
              id="expense-wht"
              value={form.wht}
              onChange={(v) => set({ wht: v })}
              parseOptions={{ allowZero: true, label: 'WHT' }}
              showPreview={false}
              error={errorFor('wht')}
            />
          </Field>
        </div>

        <Field
          id="expense-reference"
          label="Reference / invoice no."
          required
          error={errorFor('reference')}
        >
          <Input
            id="expense-reference"
            value={form.reference}
            onChange={(e) => set({ reference: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, reference: true }))}
            className="h-11 text-base"
            inputMode="text"
            aria-required
          />
        </Field>
      </div>

      {/* 12 Receipt */}
      <Field
        id="expense-receipt"
        label="Receipt"
        required={amountMinor >= 1_000_000n}
        error={errorFor('receipt')}
      >
        <ReceiptUpload
          id="expense-receipt"
          file={receiptFile}
          onChange={(f) => { setReceiptFile(f); setDirty(true); }}
          existingPath={existingReceipt}
          onRemoveExisting={() => { setExistingReceipt(null); setDirty(true); }}
          required={amountMinor >= 1_000_000n}
          error={errorFor('receipt')}
        />
      </Field>
    </form>
  );

  const footer = (
    <div className="flex flex-col-reverse sm:flex-row gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-11 sm:flex-1"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
      <Button type="submit" form="expense-form" disabled={saving} className="h-11 sm:flex-1">
        {saving ? 'Saving…' : isEditMode ? 'Save changes' : 'Add expense'}
      </Button>
    </div>
  );

  return (
    <>
      {!isEditMode && (
        <Button className="h-11" onClick={() => { reset(); setSelfOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          Add Expense
        </Button>
      )}

      <FormSheet
        open={open}
        onOpenChange={(o) => { if (!o) setDirty(false); setOpen(o); }}
        title={isEditMode ? 'Edit expense' : 'Add expense'}
        description={isEditMode ? 'Update the details below.' : 'One purchase per expense.'}
        dirty={dirty}
        footer={footer}
      >
        {body}
      </FormSheet>

      <SplitLinesDialog
        open={splitOpen}
        onOpenChange={setSplitOpen}
        text={form.description}
        categories={categoryOptions(categories)}
        onConfirm={applySplit}
      />
    </>
  );
}
