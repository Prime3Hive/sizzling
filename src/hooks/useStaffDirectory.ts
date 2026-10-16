import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { todayIso } from '@/lib/attendance';

export interface DirectoryPerson {
  id: string;
  full_name: string;
  position: string | null;
  employment_type: string | null;
  employment_date: string | null;
  year_of_joining: number | null;
  phone_number: string | null;
  email_address: string | null;
  linked_user_id: string | null;
  department_id: string | null;
  departments: { name: string } | null;
  onLeave: boolean;
}

/**
 * The staff list for People and for the search palette. Admin and HR only,
 * matching the Staff Profiles route. HR does not see admins' profiles — the
 * same rule StaffProfiles.tsx applies.
 */
export function useStaffDirectory() {
  const { user } = useAuth();
  const { isAdmin, isHR } = useRoles();
  const enabled = !!user && (isAdmin || isHR);

  return useQuery<DirectoryPerson[]>({
    queryKey: ['staff-directory', isAdmin ? 'admin' : 'hr'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('id, full_name, position, employment_type, employment_date, year_of_joining, phone_number, email_address, linked_user_id, department_id, departments(name)')
        .eq('employment_status', 'active')
        .order('full_name');
      if (error) throw error;
      let rows = (data ?? []) as unknown as Omit<DirectoryPerson, 'onLeave'>[];

      if (isHR && !isAdmin) {
        const { data: admins } = await supabase.from('user_roles').select('user_id').eq('role', 'admin');
        const adminIds = new Set((admins ?? []).map((r) => r.user_id));
        rows = rows.filter((p) => !p.linked_user_id || !adminIds.has(p.linked_user_id));
      }

      // Who is off today. A read the viewer's policy refuses just means nobody
      // shows as on leave, never a broken directory.
      const today = todayIso();
      const { data: leave } = await supabase
        .from('staff_leave_requests')
        .select('user_id, staff_profile_id')
        .eq('status', 'approved')
        .lte('start_date', today)
        .gte('end_date', today);
      const offIds = new Set((leave ?? []).map((l) => l.staff_profile_id).filter(Boolean));
      const offUsers = new Set((leave ?? []).map((l) => l.user_id));

      return rows.map((p) => ({
        ...p,
        onLeave: offIds.has(p.id) || (!!p.linked_user_id && offUsers.has(p.linked_user_id)),
      }));
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

export const positionLabel = (p: string | null | undefined) =>
  p ? p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—';

export const employmentLabel = (t: string | null | undefined) =>
  t ? t.replace(/_/g, '-').replace(/^\w/, (c) => c.toUpperCase()) : '—';
