import { createContext, useContext, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { hasFeature, type Feature } from '@/config/capabilities';
import type { AppRole } from '@/config/modules';

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
  /** Per-user overrides that take precedence over department permissions */
  userPermissions: Permission[];
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
  canFeature: (feature: Feature) => boolean;
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
        return { userRole: null, department: null, permissions: [], userPermissions: [] };
      }

      // Per-user overrides are fetched regardless of department membership
      const userPermsPromise = (supabase as any)
        .from('user_permissions')
        .select('module_name, can_view, can_create, can_update, can_delete')
        .eq('user_id', user.id);

      if (!roleRow?.department_id) {
        const userPermsRes = await userPermsPromise;
        return {
          userRole: roleRow as UserRole | null,
          department: null,
          permissions: [],
          userPermissions: (userPermsRes.data || []) as Permission[],
        };
      }

      // Fetch department + department permissions + user overrides in parallel
      const [deptRes, permRes, userPermsRes] = await Promise.all([
        supabase.from('departments').select('*').eq('id', roleRow.department_id).single(),
        supabase
          .from('department_permissions')
          .select('module_name, can_view, can_create, can_update, can_delete')
          .eq('department_id', roleRow.department_id),
        userPermsPromise,
      ]);

      return {
        userRole: roleRow as UserRole,
        department: deptRes.data as Department | null,
        permissions: (permRes.data || []) as Permission[],
        userPermissions: (userPermsRes.data || []) as Permission[],
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
  const userPermissions = roleData?.userPermissions ?? [];

  const readPerm = (p: Permission, action: 'view' | 'create' | 'update' | 'delete') => {
    switch (action) {
      case 'view':   return p.can_view;
      case 'create': return p.can_create;
      case 'update': return p.can_update;
      case 'delete': return p.can_delete;
      default:       return false;
    }
  };

  const hasPermission = (module: string, action: 'view' | 'create' | 'update' | 'delete'): boolean => {
    const approved = userRole?.role_status === 'approved';
    if (!approved) return false;
    // Admin has universal access
    if (userRole?.role === 'admin') return true;

    // 1) Per-user override wins when present (grant OR restrict)
    const override = userPermissions.find(p => p.module_name === module);
    if (override) return readPerm(override, action);

    // 2) Otherwise fall back to the department permission
    const permission = permissions.find(p => p.module_name === module);
    if (!permission) return false;
    return readPerm(permission, action);
  };

  const isApproved = userRole?.role_status === 'approved';
  const isAdmin    = userRole?.role === 'admin'    && isApproved;
  const isManager  = userRole?.role === 'manager'  && isApproved;
  const isHR       = userRole?.role === 'hr'       && isApproved;
  const isEmployee = userRole?.role === 'employee' && isApproved;
  const isPending  = !!userRole && !isApproved;

  const canFeature = (feature: Feature): boolean => {
    if (!isApproved || !userRole) return false;
    return hasFeature(userRole.role as AppRole, feature);
  };

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
    canFeature,
    refetchRole,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};
