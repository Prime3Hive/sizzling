// Feature matrix — defines what each role can do beyond module-level permissions.
// Use canFeature() (from useRoles) or the <Can feature="..."> gate in components.

import type { AppRole } from './modules';

export const FEATURES = [
  // Admin-only
  'approve_roles',        // approve/reject pending role assignments
  'manage_departments',   // create/edit departments and their permissions
  'company_files',        // access company file library
  'profit_loss',          // view profit & loss report
  'njc_supplies',         // view NJC supplies page
  // Admin + HR
  'view_all_staff',       // view full staff profiles list
  'manage_leave',         // approve/reject leave requests
  'manage_complaints',    // handle staff complaints
  'view_payroll',         // access payroll page
  // Admin + Manager
  'manage_kpi',           // create/assign KPI targets
  // All approved roles
  'view_kpi',             // view own KPI performance
  'submit_requests',      // submit leave / complaints / messages
  'view_own_payslip',     // view own payslip
] as const;

export type Feature = typeof FEATURES[number];

const ROLE_FEATURES: Record<AppRole, readonly Feature[]> = {
  admin: [
    'approve_roles', 'manage_departments', 'company_files', 'profit_loss', 'njc_supplies',
    'view_all_staff', 'manage_leave', 'manage_complaints', 'view_payroll',
    'manage_kpi',
    'view_kpi', 'submit_requests', 'view_own_payslip',
  ],
  hr: [
    'view_all_staff', 'manage_leave', 'manage_complaints', 'view_payroll',
    'view_kpi', 'submit_requests', 'view_own_payslip',
  ],
  manager: [
    'manage_kpi',
    'view_kpi', 'submit_requests', 'view_own_payslip',
  ],
  employee: [
    'view_kpi', 'submit_requests', 'view_own_payslip',
  ],
};

export function hasFeature(role: AppRole, feature: Feature): boolean {
  return (ROLE_FEATURES[role] as readonly string[]).includes(feature);
}
