import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { SelectOption } from '@/components/ui/searchable-select';
import { EXPENSE_ACCOUNTS } from '@/lib/expenseConfig';
import { formatMinor, nairaToMinor } from '@/lib/money';

// ─────────────────────────────────────────────────────────────────────────────
// Reference data for the expense forms.
//
// One hook per controlled list, so every capture route reads the same options
// from the same place. Free-text category, cost centre and account inputs are
// gone — these lists are the only way to set them.
// ─────────────────────────────────────────────────────────────────────────────

const db = supabase as any; // generated types predate these tables

export interface ExpenseCategory {
  id: string;
  name: string;
  account_code: string | null;
}

export function useExpenseCategories() {
  return useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data, error } = await db
        .from('expense_categories')
        .select('id, name, account_code')
        .eq('is_active', true)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export function useCostCentres() {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ['cost-centres'],
    queryFn: async () => {
      const { data, error } = await db
        .from('cost_centres')
        .select('id, name')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export interface Payee {
  id: string;
  name: string;
  kind: string;
}

export function usePayees() {
  return useQuery<Payee[]>({
    queryKey: ['payees'],
    queryFn: async () => {
      const { data, error } = await db
        .from('payees')
        .select('id, name, kind')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

/** Chart-of-accounts rows for the expense accounts the form may reach. */
export function useExpenseAccounts() {
  return useQuery<{ id: string; code: string; name: string }[]>({
    queryKey: ['expense-accounts'],
    queryFn: async () => {
      const { data, error } = await db
        .from('chart_of_accounts')
        .select('id, code, name')
        .in('code', EXPENSE_ACCOUNTS.map((a) => a.code))
        .eq('is_active', true)
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export function useBankAccounts() {
  return useQuery<{ id: string; bank_name: string; account_name: string; account_number: string }[]>({
    queryKey: ['bank-accounts-active'],
    queryFn: async () => {
      const { data, error } = await db
        .from('bank_accounts')
        .select('id, bank_name, account_name, account_number')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * The date the books are closed through, so the form can reject a date in a
 * closed period before the server does.
 */
export function useLockedThrough() {
  return useQuery<string | null>({
    queryKey: ['period-locked-through'],
    queryFn: async () => {
      const { data, error } = await db
        .from('period_locks')
        .select('locked_through')
        .order('locked_through', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.locked_through ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

export interface BudgetOption {
  id: string;
  title: string;
  total_budget: number;
  start_date: string;
  end_date: string;
  spent: number;
}

/**
 * Budgets with their spend so far, so the form can show the remaining balance
 * beneath the field and warn before it is exceeded (§5.4).
 */
export function useBudgetsWithSpend(userId: string | undefined) {
  return useQuery<BudgetOption[]>({
    queryKey: ['budgets-with-spend', userId],
    queryFn: async () => {
      const { data, error } = await db
        .from('budget_summary')
        .select('id, title, total_budget, start_date, end_date, total_spent')
        .eq('user_id', userId)
        .order('start_date', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((b: any) => ({
        id: b.id,
        title: b.title,
        total_budget: Number(b.total_budget) || 0,
        start_date: b.start_date,
        end_date: b.end_date,
        spent: Number(b.total_spent) || 0,
      }));
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}

// ── Option mappers ──────────────────────────────────────────────────────────

export const categoryOptions = (rows: ExpenseCategory[]): SelectOption[] =>
  rows.map((c) => ({ value: c.id, label: c.name }));

export const costCentreOptions = (rows: { id: string; name: string }[]): SelectOption[] =>
  rows.map((c) => ({ value: c.id, label: c.name }));

export const payeeOptions = (rows: Payee[]): SelectOption[] =>
  rows.map((p) => ({ value: p.id, label: p.name, hint: p.kind === 'supplier' ? undefined : p.kind }));

export const accountOptions = (rows: { id: string; code: string; name: string }[]): SelectOption[] =>
  rows.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}`, hint: undefined }));

export const bankOptions = (
  rows: { id: string; bank_name: string; account_name: string; account_number: string }[],
): SelectOption[] =>
  rows.map((b) => ({
    value: b.id,
    label: `${b.bank_name} — ${b.account_name}`,
    hint: b.account_number,
  }));

export const budgetOptions = (rows: BudgetOption[]): SelectOption[] =>
  rows.map((b) => ({
    value: b.id,
    label: b.title,
    hint: `${formatMinor(nairaToMinor(b.total_budget - b.spent))} remaining of ${formatMinor(nairaToMinor(b.total_budget))}`,
  }));
