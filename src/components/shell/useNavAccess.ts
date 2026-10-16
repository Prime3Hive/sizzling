import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import type { NavAccess } from './navigation';

export function useNavAccess(): NavAccess & { loading: boolean } {
  const { isAdmin, isManager, isHR, isEmployee, isPending, hasPermission, canFeature, loading } = useRoles();
  return useMemo(
    () => ({ isAdmin, isManager, isHR, isEmployee, isPending, hasPermission, canFeature, loading }),
    // hasPermission/canFeature are rebuilt each render but only change with the
    // role data, which the flags already track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin, isManager, isHR, isEmployee, isPending, loading],
  );
}

export interface Me {
  userId: string | null;
  name: string;
  firstName: string;
  email: string | null;
  title: string | null;
  department: string | null;
  staffProfileId: string | null;
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** The signed-in person, preferring their staff profile over account metadata. */
export function useMe(): Me {
  const { user } = useAuth();
  const { userRole, department } = useRoles();

  const { data: profile } = useQuery({
    queryKey: ['me-staff-profile', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('staff_profiles')
        .select('id, full_name, position, departments(name)')
        .eq('linked_user_id', user!.id)
        .maybeSingle();
      return data as { id: string; full_name: string; position: string | null; departments: { name: string } | null } | null;
    },
    enabled: !!user,
    staleTime: 10 * 60_000,
  });

  const metaName = (user?.user_metadata?.full_name as string | undefined)?.trim();
  const name = profile?.full_name || metaName || user?.email || 'there';
  const roleTitle = userRole?.role === 'hr' ? 'HR' : userRole?.role ? titleCase(userRole.role) : null;

  return {
    userId: user?.id ?? null,
    name,
    firstName: name.includes('@') ? name.split('@')[0] : name.split(' ')[0],
    email: user?.email ?? null,
    title: profile?.position ? titleCase(profile.position) : roleTitle,
    department: profile?.departments?.name ?? department?.name ?? null,
    staffProfileId: profile?.id ?? null,
  };
}
