import React, { useMemo, useState } from 'react';
import { Layers, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormSheet, Field, RequiredLegend } from '@/components/ui/form-sheet';
import { MoneyInput } from '@/components/ui/money-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import ReceiptUpload from '@/components/expenses/ReceiptUpload';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { useToast } from '@/hooks/use-toast';
import { formatMinor, parseMoney, isMoneyError } from '@/lib/money';
import {
  validateExpenseLine, validationErrors, errorMap, todayIso,
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
// Add several expenses at once.
//
// The grid stays a real table at lg — it is the right tool for keying a day of
// market purchases at a desk (§5.3). It calls the SAME validator as the single
// form, per row, and refuses to save any row that fails (§4).
//
// Settings shared by every row (date, payment method, cost centre, budget) sit
// once at the top rather than repeating on each line.
// ─────────────────────────────────────────────────────────────────────────────

const db = supabase as any;
const ONE_OFF = '__one_off__';
const METHODS_NEEDING_BANK = new Set(['transfer', 'card', 'pos']);

interface Row {
  amount: string;
  description: string;
  categoryId: string;
  payeeId: string;
  payeeName: string;
  accountId: string;
  reference: string;
  receipt: File | null;
}

const blankRow = (): Row => ({
  amount: '', description: '', categoryId: '', payeeId: '', payeeName: '',
  accountId: '', reference: '', receipt: null,
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
  const [shared, setShared] = useState({
    date: todayIso(),
    paymentMethod: '',
    bankAccountId: '',
    costCentreId: '',
    budgetId: '',
  });
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const { data: categories = [] } = useExpenseCategories();
  const { data: costCentres = [] } = useCostCentres();
  const { data: payees = [] } = usePayees();
  const { data: accounts = [] } = useExpenseAccounts();
  const { data: banks = [] } = useBankAccounts();
  const { data: lockedThrough } = useLockedThrough();
  const { data: budgetRows = [] } = useBudgetsWithSpend(user?.id);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (i: number) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const reset = () => {
    setRows([blankRow(), blankRow()]);
    setShared({ date: todayIso(), paymentMethod: '', bankAccountId: '', costCentreId: '', budgetId: '' });
    setShowErrors(false);
  };

  const needsBank = METHODS_NEEDING_BANK.has(shared.paymentMethod.toLowerCase());

  /** A row the user has not started is ignored rather than reported as broken. */
  const isBlank = (r: Row) =>
    !r.amount.trim() && !r.description.trim() && !r.categoryId && !r.payeeId && !r.reference.trim();

  const validated = useMemo(() => {
    return rows.map((r) => {
      if (isBlank(r)) return { blank: true as const };
      return {
        blank: false as const,
        result: validateExpenseLine(
          {
            description: r.description,
            amount: r.amount,
            category_id: r.categoryId,
            payee_id: r.payeeId && r.payeeId !== ONE_OFF ? r.payeeId : null,
            payee_name: r.payeeId === ONE_OFF || !r.payeeId ? r.payeeName : null,
            expense_account_code: accounts.find((a) => a.id === r.accountId)?.code ?? '',
            cost_centre: costCentres.find((c) => c.id === shared.costCentreId)?.name ?? '',
            budget_id: shared.budgetId || null,
            reference: r.reference,
            receipt_path: r.receipt ? 'pending-upload' : null,
            date: shared.date,
            payment_method: shared.paymentMethod,
            bank_account_id: shared.bankAccountId || null,
          },
          { lockedThrough },
        ),
      };
    });
  }, [rows, shared, accounts, costCentres, lockedThrough]);

  const errorsFor = (i: number): Record<string, string> => {
    const v = validated[i];
    return v.blank ? {} : errorMap(v.result);
  };

  const filledCount = validated.filter((v) => !v.blank).length;
  const failures = validated.flatMap((v) => (v.blank ? [] : validationErrors(v.result)));
  const badCount = validated.filter((v) => !v.blank && validationErrors(v.result).length > 0).length;

  const totalMinor = rows.reduce((sum, r) => {
    const p = parseMoney(r.amount);
    return isMoneyError(p) ? sum : sum + p.minor;
  }, 0n);

  const uploadReceipt = async (file: File): Promise<string> => {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${user!.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('receipts').upload(path, file);
    if (error) throw error;
    return path;
  };

  const save = async () => {
    setShowErrors(true);

    if (filledCount === 0) {
      toast({ title: 'Nothing to save', description: 'Fill in at least one row.', variant: 'destructive' });
      return;
    }
    // Refuse to save ANY row if one fails — no partial writes behind the
    // user's back.
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
      const payload = [];
      for (let i = 0; i < rows.length; i++) {
        const v = validated[i];
        if (v.blank || validationErrors(v.result).length > 0) continue;
        const value = (v.result as { ok: true; value: ValidatedExpenseLine }).value;
        const account = accounts.find((a) => a.id === rows[i].accountId);
        const receiptPath = rows[i].receipt ? await uploadReceipt(rows[i].receipt!) : null;

        payload.push({
          amount_minor: Number(value.amount_minor),
          description: value.description,
          category: categories.find((c) => c.id === value.category_id)?.name ?? null,
          category_id: value.category_id,
          date: value.date,
          budget_id: value.budget_id,
          expense_account_code: account?.code ?? null,
          account_type: account?.code === '5000' ? 'COGS' : 'OpEX',
          cost_center: value.cost_centre,
          payment_method: value.payment_method,
          bank_account_id: value.bank_account_id,
          vat_minor: 0,
          wht_minor: 0,
          reference: value.reference,
          receipt_path: receiptPath,
          payee_id: value.payee_id,
          payee_name: value.payee_name,
          created_by: user?.id,
          submitted_by: user?.id,
          submitted_at: new Date().toISOString(),
          status: isAdmin ? 'approved' : 'pending',
        });
      }

      const { error } = await db.from('expenses').insert(payload);
      if (error) throw error;

      toast({
        title: `${payload.length} expense${payload.length === 1 ? '' : 's'} added`,
        description: `Total ${formatMinor(totalMinor)}.`,
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

  const payeeSelectOptions = [
    { value: ONE_OFF, label: 'One-off payee — type a name' },
    ...payeeOptions(payees),
  ];

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
        description="Settings at the top apply to every row."
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
              Save all
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <RequiredLegend />

          {/* ── Settings shared by every row ── */}
          <div className="rounded-lg border p-3 sm:p-4 space-y-4">
            <h3 className="text-sm font-semibold">Applies to every row</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field id="bulk-date" label="Date" required>
                <Input
                  id="bulk-date"
                  type="date"
                  value={shared.date}
                  max={todayIso()}
                  onChange={(e) => setShared((s) => ({ ...s, date: e.target.value }))}
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

              <Field id="bulk-budget" label="Budget" required>
                <SearchableSelect
                  id="bulk-budget"
                  options={budgetOptions(budgetRows)}
                  value={shared.budgetId}
                  onChange={(v) => setShared((s) => ({ ...s, budgetId: v }))}
                  placeholder="Choose a budget"
                  title="Choose a budget"
                  required
                  invalid={showErrors && !shared.budgetId}
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
          </div>

          {/* ── The rows ── */}
          {/* Desktop headings — the grid is a real table at lg. */}
          <div className="hidden lg:grid grid-cols-12 gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="col-span-2">Amount *</span>
            <span className="col-span-3">Description *</span>
            <span className="col-span-2">Category *</span>
            <span className="col-span-2">Payee *</span>
            <span className="col-span-2">Account *</span>
            <span className="col-span-1" />
          </div>

          <div className="space-y-3 lg:space-y-2">
            {rows.map((row, i) => {
              const rowErrors = showErrors ? errorsFor(i) : {};
              const hasError = Object.keys(rowErrors).length > 0;
              return (
                <div
                  key={i}
                  className={[
                    'rounded-lg border p-3 space-y-3',
                    'lg:border-0 lg:p-0 lg:space-y-0 lg:grid lg:grid-cols-12 lg:gap-2 lg:items-start',
                    hasError ? 'border-destructive lg:border' : '',
                  ].join(' ')}
                >
                  <div className="lg:col-span-2">
                    <label htmlFor={`bulk-amount-${i}`} className="lg:sr-only text-xs font-medium">
                      Amount
                    </label>
                    <MoneyInput
                      id={`bulk-amount-${i}`}
                      value={row.amount}
                      onChange={(v) => setRow(i, { amount: v })}
                      error={rowErrors.amount}
                      showPreview={!!rowErrors.amount}
                    />
                  </div>

                  <div className="lg:col-span-3">
                    <label htmlFor={`bulk-desc-${i}`} className="lg:sr-only text-xs font-medium">
                      Description
                    </label>
                    <Input
                      id={`bulk-desc-${i}`}
                      value={row.description}
                      onChange={(e) => setRow(i, { description: e.target.value })}
                      placeholder="What was bought"
                      className="h-11 text-base"
                    />
                    {rowErrors.description && (
                      <p role="alert" className="text-xs text-destructive mt-1">
                        ⚠ {rowErrors.description}
                      </p>
                    )}
                  </div>

                  <div className="lg:col-span-2">
                    <label htmlFor={`bulk-cat-${i}`} className="lg:sr-only text-xs font-medium">
                      Category
                    </label>
                    <SearchableSelect
                      id={`bulk-cat-${i}`}
                      options={categoryOptions(categories)}
                      value={row.categoryId}
                      onChange={(v) => setRow(i, { categoryId: v })}
                      placeholder="Category"
                      title="Choose a category"
                      invalid={!!rowErrors.category_id}
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <label htmlFor={`bulk-payee-${i}`} className="lg:sr-only text-xs font-medium">
                      Payee
                    </label>
                    <SearchableSelect
                      id={`bulk-payee-${i}`}
                      options={payeeSelectOptions}
                      value={row.payeeId}
                      onChange={(v) => setRow(i, { payeeId: v, payeeName: v === ONE_OFF ? row.payeeName : '' })}
                      placeholder="Payee"
                      title="Choose a payee"
                      invalid={!!rowErrors.payee}
                    />
                    {row.payeeId === ONE_OFF && (
                      <Input
                        aria-label={`One-off payee name for row ${i + 1}`}
                        value={row.payeeName}
                        onChange={(e) => setRow(i, { payeeName: e.target.value })}
                        placeholder="Name"
                        className="h-11 text-base mt-2"
                      />
                    )}
                  </div>

                  <div className="lg:col-span-2">
                    <label htmlFor={`bulk-acct-${i}`} className="lg:sr-only text-xs font-medium">
                      Expense account
                    </label>
                    <SearchableSelect
                      id={`bulk-acct-${i}`}
                      options={accountOptions(accounts)}
                      value={row.accountId}
                      onChange={(v) => setRow(i, { accountId: v })}
                      placeholder="Account"
                      title="Choose an expense account"
                      invalid={!!rowErrors.expense_account_code}
                    />
                  </div>

                  <div className="lg:col-span-1 flex lg:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeRow(i)}
                      disabled={rows.length <= 1}
                      // 44x44. This was a small icon button that could not be
                      // hit reliably on a phone (U-05).
                      className="h-11 w-11 p-0 text-destructive shrink-0"
                      aria-label={`Remove row ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>

                  {/* Reference and receipt — full width beneath the row */}
                  <div className="lg:col-span-12 grid grid-cols-1 sm:grid-cols-2 gap-3 lg:pt-1 lg:pb-3 lg:border-b">
                    <div>
                      <label htmlFor={`bulk-ref-${i}`} className="text-xs font-medium">
                        Reference / invoice no. *
                      </label>
                      <Input
                        id={`bulk-ref-${i}`}
                        value={row.reference}
                        onChange={(e) => setRow(i, { reference: e.target.value })}
                        className="h-11 text-base mt-1"
                      />
                      {rowErrors.reference && (
                        <p role="alert" className="text-xs text-destructive mt-1">
                          ⚠ {rowErrors.reference}
                        </p>
                      )}
                    </div>
                    <div>
                      <span className="text-xs font-medium">Receipt</span>
                      {/* Receipt upload was absent from this route entirely. */}
                      <ReceiptUpload
                        id={`bulk-receipt-${i}`}
                        file={row.receipt}
                        onChange={(f) => setRow(i, { receipt: f })}
                        error={rowErrors.receipt}
                      />
                    </div>
                  </div>
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
