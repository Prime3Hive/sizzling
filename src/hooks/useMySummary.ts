// The signed-in person's own figures, shared by the staff Home and Me screens:
// leave left this year, latest payslip, this week's published attendance, and
// what is missing from their profile.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { leaveUsage, type LeaveRow } from '@/lib/leave';
import { weekDays, weekStartOf } from '@/lib/attendance';

const db = supabase as any;

export interface WeekDay { date: string; status: string | null }

export function useMySummary() {
  const { user } = useAuth();
  const { userRole } = useRoles();
  const enabled = !!user && userRole?.role_status === 'approved';
  const year = new Date().getFullYear();

  const profileQ = useQuery({
    queryKey: ['my-summary-profile', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('staff_profiles')
        .select('id, phone_number, emergency_contact_name, emergency_contact_phone, residential_address, date_of_birth, account_number, passport_path')
        .eq('linked_user_id', user!.id)
        .maybeSingle();
      return data ?? null;
    },
    enabled,
  });
  const profile = profileQ.data as Record<string, string | null> | null | undefined;

  // Same key and shape as the leave form, so the two share one cache entry.
  const leaveQ = useQuery({
    queryKey: ['my-year-leave', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_leave_requests')
        .select('leave_type, start_date, end_date, status')
        .eq('user_id', user!.id)
        .in('status', ['pending', 'approved'])
        .gte('start_date', `${year}-01-01`)
        .lte('start_date', `${year}-12-31`);
      if (error) throw error;
      return (data ?? []) as LeaveRow[];
    },
    enabled,
  });

  const payslipQ = useQuery({
    queryKey: ['my-latest-payslip', profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('payroll_records')
        .select('id, net_pay, salary_period, period_start, period_end, status')
        .eq('staff_profile_id', profile!.id!)
        .order('period_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
    enabled: enabled && !!profile?.id,
  });

  const weekStart = weekStartOf(new Date());
  const days = weekDays(weekStart);
  const weekQ = useQuery({
    queryKey: ['my-week-attendance', user?.id, weekStart],
    queryFn: async () => {
      const { data } = await db
        .from('attendance_records')
        .select('work_date, status')
        .eq('user_id', user!.id)
        .gte('work_date', days[0])
        .lte('work_date', days[6]);
      return (data ?? []) as { work_date: string; status: string }[];
    },
    enabled,
  });

  const byDate = new Map((weekQ.data ?? []).map((r) => [r.work_date, r.status]));
  // Monday to Friday always; the weekend only when someone was marked.
  const week: WeekDay[] = days
    .map((date) => ({ date, status: byDate.get(date) ?? null }))
    .filter((d, i) => i < 5 || d.status);

  const missing: { label: string; field: string }[] = [];
  if (profile) {
    if (!profile.phone_number) missing.push({ label: 'Add your phone number', field: 'phone_number' });
    if (!profile.emergency_contact_name || !profile.emergency_contact_phone)
      missing.push({ label: 'Add an emergency contact', field: 'emergency_contact' });
    if (!profile.residential_address) missing.push({ label: 'Add your home address', field: 'residential_address' });
    if (!profile.date_of_birth) missing.push({ label: 'Add your date of birth', field: 'date_of_birth' });
    if (!profile.account_number) missing.push({ label: 'Add your bank details for payroll', field: 'account_number' });
  }

  return {
    hasProfile: !!profile,
    leave: leaveUsage(leaveQ.data ?? []),
    payslip: payslipQ.data as { net_pay: number; salary_period: string | null; period_start: string; period_end: string; status: string } | null | undefined,
    week,
    missing,
    loading: profileQ.isLoading || leaveQ.isLoading,
  };
}
