/**
 * Unified permission gate — use instead of AdminRoute / AdminOrHRRoute / PermissionRoute.
 *
 * As a route guard (with redirect):
 *   <Can roles={['admin']} redirect="/dashboard">...</Can>
 *   <Can module="inventory" redirect="/dashboard">...</Can>
 *
 * As an inline UI gate (no redirect — renders nothing when denied):
 *   <Can roles={['admin', 'hr']}>...</Can>
 *   <Can module="inventory" action="delete">...</Can>
 *   <Can feature="manage_kpi">...</Can>
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import type { Module, Action, AppRole } from '@/config/modules';
import type { Feature } from '@/config/capabilities';

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
  </div>
);

interface CanProps {
  children: React.ReactNode;
  /** Role-based check: at least one role must match */
  roles?: AppRole[];
  /** Module permission check (uses action, defaults to 'view') */
  module?: Module;
  action?: Action;
  /** Feature check against the capability matrix */
  feature?: Feature;
  /**
   * When provided, acts as a route guard:
   * - Shows PageLoader while loading
   * - Redirects to /auth if unauthenticated
   * - Redirects to this path if access denied
   */
  redirect?: string;
}

export function Can({
  children,
  roles,
  module,
  action = 'view',
  feature,
  redirect,
}: CanProps) {
  const { user, loading: authLoading } = useAuth();
  const {
    isAdmin, isHR, isManager, isEmployee,
    hasPermission, canFeature,
    loading: roleLoading,
  } = useRoles();

  if (authLoading || roleLoading) {
    return redirect ? <PageLoader /> : null;
  }

  if (redirect && !user) {
    return <Navigate to="/auth" replace />;
  }

  let allowed = false;

  if (roles?.length) {
    const map: Record<AppRole, boolean> = {
      admin: isAdmin, hr: isHR, manager: isManager, employee: isEmployee,
    };
    allowed = roles.some(r => map[r]);
  } else if (module) {
    allowed = hasPermission(module, action);
  } else if (feature) {
    allowed = canFeature(feature);
  } else {
    // No restriction specified — just require a user
    allowed = !!user;
  }

  if (!allowed) {
    return redirect ? <Navigate to={redirect} replace /> : null;
  }

  return <>{children}</>;
}
