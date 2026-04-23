import { createContext, useContext, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface UserRole {
  id: string;
  user_id: string;
  role: 'admin' | 'manager' | 'employee' | 'hr';
  department_id?: string;
  assigned_by?: string;
  assigned_at: string;
  role_status: 'approved' | 'pending';
}

interface Department {
  id: string;
  name: string;
  description?: string;
}

interface Permission {
  module_name: string;
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
}

interface RoleData {
  userRole: UserRole | null;
  department: Department | null;
  permissions: Permission[];
}

interface RoleContextType {
  userRole: UserRole | null;
  department: Department | null;
  permissions: Permission[];
  isAdmin: boolean;
  isManager: boolean;
  isHR: boolean;
  isEmployee: boolean;
  isPending: boolean;
  loading: boolean;
  hasPermission: (module: string, action: 'view' | 'create' | 'update' | 'delete') => boolean;
  refetchRole: () => Promise<void>;
}

const RoleContext = createContext<RoleContextType | undefined>(undefined);

export const useRoles = () => {
  const context = useContext(RoleContext);
  if (context === undefined) {
    throw new Error('useRoles must be used within a RoleProvider');
  }
  return context;
};

interface RoleProviderProps {
  children: ReactNode;
}

export const RoleProvider = ({ children }: RoleProviderProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Single cached query for all role data — 30 min staleTime since roles rarely change
  const { data: roleData, isLoading } = useQuery<RoleData>({
    queryKey: ['user-role-data', user?.id],
    queryFn: async (): Promise<RoleData> => {
      if (!user?.id) return { userRole: null, department: null, permissions: [] };

      const { data: roleRow, error: roleError } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (roleError && roleError.code !== 'PGRST116') {
        return { userRole: null, department: null, permissions: [] };
      }

      if (!roleRow?.department_id) {
        return { userRole: roleRow as UserRole | null, department: null, permissions: [] };
      }

      // Fetch department + permissions in parallel
      const [deptRes, permRes] = await Promise.all([
        supabase.from('departments').select('*').eq('id', roleRow.department_id).single(),
        supabase
          .from('department_permissions')
          .select('module_name, can_view, can_create, can_update, can_delete')
          .eq('department_id', roleRow.department_id),
      ]);

      return {
        userRole: roleRow as UserRole,
        department: deptRes.data as Department | null,
        permissions: (permRes.data || []) as Permission[],
      };
    },
    enabled: !!user?.id,
    staleTime: 30 * 60 * 1000,  // 30 minutes — roles rarely change mid-session
    gcTime:    60 * 60 * 1000,  // 1 hour
    refetchOnWindowFocus: false, // role doesn't change on tab switch
  });

  const userRole   = roleData?.userRole   ?? null;
  const department = roleData?.department ?? null;
  const permissions = roleData?.permissions ?? [];

  const hasPermission = (module: string, action: 'view' | 'create' | 'update' | 'delete'): boolean => {
    const approved = userRole?.role_status === 'approved';
    if (!approved) return false;
    // Only admin has universal access — all other roles use department permissions
    if (userRole?.role === 'admin') return true;

    const permission = permissions.find(p => p.module_name === module);
    if (!permission) return false;

    switch (action) {
      case 'view':   return permission.can_view;
      case 'create': return permission.can_create;
      case 'update': return permission.can_update;
      case 'delete': return permission.can_delete;
      default:       return false;
    }
  };

  const isApproved = userRole?.role_status === 'approved';
  const isAdmin    = userRole?.role === 'admin'    && isApproved;
  const isManager  = userRole?.role === 'manager'  && isApproved;
  const isHR       = userRole?.role === 'hr'       && isApproved;
  const isEmployee = userRole?.role === 'employee' && isApproved;
  const isPending  = !!userRole && !isApproved;

  const refetchRole = async () => {
    await queryClient.invalidateQueries({ queryKey: ['user-role-data', user?.id] });
  };

  const value: RoleContextType = {
    userRole,
    department,
    permissions,
    isAdmin,
    isManager,
    isHR,
    isEmployee,
    isPending,
    loading: isLoading,
    hasPermission,
    refetchRole,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};
