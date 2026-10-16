import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { settingsFromRow, type CommissionSettings } from '@/lib/commission';

// commission_* tables are newer than the generated types.
const db = supabase as any;

export interface CommissionPeriodRow {
  id: string;
  period_month: string;
  period_start: string;
  period_end: string;
  status: 'approved' | 'void';
  settings: any;
  weeks: { week: number; start: string; end: string; sales: number; flat: number; excess: number; total: number }[];
  total_sales: number;
  base_pool: number;
  escalator_bonus: number;
  total_pool: number;
  total_allocated: number;
  approved_by: string | null;
  approved_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export interface CommissionPayoutRow {
  id: string;
  period_id: string;
  staff_profile_id: string;
  staff_name: string;
  department: string | null;
  commission_group: string;
  amount: number;
  payroll_record_id: string | null;
}

export function useCommissionSettings(enabled = true) {
  return useQuery({
    queryKey: ['commission-settings'],
    queryFn: async (): Promise<{ id: string | null; settings: CommissionSettings }> => {
      const { data, error } = await db.from('commission_settings').select('*').maybeSingle();
      if (error) throw error;
      return { id: data?.id ?? null, settings: settingsFromRow(data) };
    },
    enabled,
  });
}

/**
 * Commission recognised as a cost between two dates — approved months whose
 * accrual date (the period's last Sunday) falls in range. This is the same
 * figure the ledger books to 5120, so every P&L view adds it to staff cost.
 * Payroll's own cost (basic + allowances + employer pension) never includes
 * commission, so nothing is counted twice when the commission is paid.
 */
export function useCommissionCost(from: string, to: string, enabled = true) {
  const q = useQuery({
    queryKey: ['commission-cost', from, to],
    queryFn: async () => {
      const { data, error } = await db
        .from('commission_periods')
        .select('period_month, period_end, total_allocated')
        .eq('status', 'approved')
        .gte('period_end', from)
        .lte('period_end', to);
      // Before the migration is applied the table does not exist: treat as none.
      if (error) return [] as { period_month: string; period_end: string; total_allocated: number }[];
      return (data ?? []) as { period_month: string; period_end: string; total_allocated: number }[];
    },
    enabled: enabled && !!from && !!to,
  });
  const rows = q.data ?? [];
  const total = rows.reduce((t, r) => t + Number(r.total_allocated || 0), 0);
  /** Cost for one calendar month (0-based index), by accrual date. */
  const forMonth = (monthIndex: number) =>
    rows
      .filter((r) => new Date(`${r.period_end}T00:00:00`).getMonth() === monthIndex)
      .reduce((t, r) => t + Number(r.total_allocated || 0), 0);
  return { rows, total, forMonth, isLoading: q.isLoading };
}
