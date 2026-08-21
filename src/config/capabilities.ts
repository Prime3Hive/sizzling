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
  'approve_attendance',   // approve the weekly attendance report + answer reviews
  // Admin + HR
  'view_all_staff',       // view full staff profiles list
  'manage_leave',         // approve/reject leave requests
  'manage_complaints',    // handle staff complaints
  'view_payroll',         // access payroll page
  'mark_attendance',      // mark attendance and submit the weekly report
  // Admin + Manager
  'manage_kpi',           // create/assign KPI targets
  // All approved roles
  'view_kpi',             // view own KPI performance
  'submit_requests',      // submit leave / complaints / messages
  'view_own_payslip',     // view own payslip
  'view_own_attendance',  // view own attendance and request a review
] as const;

export type Feature = typeof FEATURES[number];

const ROLE_FEATURES: Record<AppRole, readonly Feature[]> = {
  admin: [
    'approve_roles', 'manage_departments', 'company_files', 'profit_loss', 'njc_supplies',
    'approve_attendance',
    'view_all_staff', 'manage_leave', 'manage_complaints', 'view_payroll', 'mark_attendance',
    'manage_kpi',
    'view_kpi', 'submit_requests', 'view_own_payslip', 'view_own_attendance',
  ],
  hr: [
    'view_all_staff', 'manage_leave', 'manage_complaints', 'view_payroll', 'mark_attendance',
    'view_kpi', 'submit_requests', 'view_own_payslip', 'view_own_attendance',
  ],
  manager: [
    'manage_kpi',
    'view_kpi', 'submit_requests', 'view_own_payslip', 'view_own_attendance',
  ],
  employee: [
    'view_kpi', 'submit_requests', 'view_own_payslip', 'view_own_attendance',
  ],
};

export function hasFeature(role: AppRole, feature: Feature): boolean {
  return (ROLE_FEATURES[role] as readonly string[]).includes(feature);
}
