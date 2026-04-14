import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [department, setDepartment] = useState<Department | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUserRole = async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // Fetch user role
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (roleError && roleError.code !== 'PGRST116') {
        // Role fetch error - silently fail as this is not critical for UI
        setLoading(false);
        return;
      }

      setUserRole(roleData as UserRole);

      // Fetch department if user has one
      if (roleData?.department_id) {
        const { data: deptData, error: deptError } = await supabase
          .from('departments')
          .select('*')
          .eq('id', roleData.department_id)
          .single();

        if (!deptError) {
          setDepartment(deptData);
        }

        // Fetch permissions for the department
        const { data: permData, error: permError } = await supabase
          .from('department_permissions')
          .select('module_name, can_view, can_create, can_update, can_delete')
          .eq('department_id', roleData.department_id);

        if (!permError) {
          setPermissions(permData || []);
        }
      } else {
        setDepartment(null);
        setPermissions([]);
      }
    } catch (error) {
      // Silently handle errors - user will see appropriate UI state
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserRole();
  }, [user?.id]);

  const hasPermission = (module: string, action: 'view' | 'create' | 'update' | 'delete') => {
    // Only approved admins have all permissions
    if (userRole?.role === 'admin' && userRole?.role_status === 'approved') {
      return true;
    }
    // Pending or unapproved roles get no elevated permissions
    if (userRole?.role_status !== 'approved') {
      return false;
    }

    const permission = permissions.find(p => p.module_name === module);
    if (!permission) {
      return false;
    }

    switch (action) {
      case 'view':
        return permission.can_view;
      case 'create':
        return permission.can_create;
      case 'update':
        return permission.can_update;
      case 'delete':
        return permission.can_delete;
      default:
        return false;
    }
  };

  const isApproved = userRole?.role_status === 'approved';
  const isAdmin = userRole?.role === 'admin' && isApproved;
  const isManager = userRole?.role === 'manager' && isApproved;
  const isHR = userRole?.role === 'hr' && isApproved;
  const isEmployee = userRole?.role === 'employee' && isApproved;
  const isPending = !!userRole && !isApproved;

  const value = {
    userRole,
    department,
    permissions,
    isAdmin,
    isManager,
    isHR,
    isEmployee,
    isPending,
    loading,
    hasPermission,
    refetchRole: fetchUserRole,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
};