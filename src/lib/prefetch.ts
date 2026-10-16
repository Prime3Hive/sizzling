// Load a page's code before the tap lands, so moving around on a phone doesn't
// sit on the spinner while a chunk downloads over mobile data.
//
// These are the same dynamic imports App.tsx hands to lazy(), so the browser
// fetches each chunk once and the route renders from the module cache.

import { useEffect } from 'react';

const ROUTES: Record<string, () => Promise<unknown>> = {
  '/dashboard': () => import('@/pages/Home'),
  '/inbox': () => import('@/pages/Inbox'),
  '/me': () => import('@/pages/Me'),
  '/work': () => import('@/pages/Work'),
  '/people': () => import('@/pages/People'),
  '/operations': () => import('@/pages/Operations'),
  '/admin': () => import('@/pages/AdminHub'),
  '/finance/overview': () => import('@/pages/Dashboard'),
  '/expenses': () => import('@/pages/Expenses'),
  '/budgets': () => import('@/pages/Budgets'),
  '/reports': () => import('@/pages/Reports'),
  '/attendance': () => import('@/pages/Attendance'),
  '/payroll': () => import('@/pages/Payroll'),
  '/staff-portal': () => import('@/pages/StaffPortal'),
  '/my-payslip': () => import('@/pages/MyPayslip'),
  '/my-profile': () => import('@/pages/MyProfile'),
  '/staff-profiles': () => import('@/pages/StaffProfiles'),
  '/birthdays': () => import('@/pages/BirthdayCalendar'),
  '/profit-loss': () => import('@/pages/ProfitLoss'),
  '/commission': () => import('@/pages/Commission'),
  '/procurement': () => import('@/pages/Procurement'),
  '/accounting': () => import('@/pages/admin/Accounting'),
  '/staff-reports': () => import('@/pages/admin/StaffReportsAdmin'),
  '/business/inventory': () => import('@/pages/business/Inventory'),
  '/business/inventory-requests': () => import('@/pages/business/InventoryRequests'),
  '/business/invoices': () => import('@/pages/business/Invoices'),
  '/business/payments': () => import('@/pages/business/Payments'),
  '/business/finance': () => import('@/pages/business/Finance'),
  '/business/kpi': () => import('@/pages/business/KPIDashboard'),
  '/business/analytics': () => import('@/pages/business/Analytics'),
};

const started = new Set<string>();

/** Start loading the code for `path` (query string ignored). Safe to call often. */
export function prefetchRoute(path: string) {
  const key = path.split('?')[0];
  const load = ROUTES[key];
  if (!load || started.has(key)) return;
  started.add(key);
  // A failed prefetch is not an error: the real navigation retries it.
  load().catch(() => started.delete(key));
}

/** Don't spend a metered or slow connection on pages nobody asked for. */
function constrained(): boolean {
  const c = (navigator as any).connection;
  return !!c && (c.saveData || /(^|-)2g$/.test(c.effectiveType ?? ''));
}

/**
 * Warm the tab-bar pages once the app is idle, then load any page the moment a
 * finger or pointer lands on a link to it — usually 100–300ms before the click.
 */
export function usePrefetchOnIntent(idlePaths: string[]) {
  useEffect(() => {
    const onIntent = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.origin !== window.location.origin) return;
      prefetchRoute(a.pathname);
    };
    document.addEventListener('pointerdown', onIntent, { passive: true });
    document.addEventListener('mouseover', onIntent, { passive: true });
    document.addEventListener('focusin', onIntent);

    let idle: number | undefined;
    if (!constrained()) {
      const ric: (cb: () => void) => number =
        (window as any).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
      idle = ric(() => idlePaths.forEach(prefetchRoute));
    }
    return () => {
      document.removeEventListener('pointerdown', onIntent);
      document.removeEventListener('mouseover', onIntent);
      document.removeEventListener('focusin', onIntent);
      if (idle !== undefined) ((window as any).cancelIdleCallback ?? window.clearTimeout)(idle);
    };
    // The idle list is fixed for the life of the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
