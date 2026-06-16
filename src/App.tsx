import React, { lazy as reactLazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { RoleProvider, useRoles } from "./hooks/useRoles";
import { Can } from "./components/Can";
import * as Sentry from "@sentry/react";
import Layout from "./components/Layout";
import SessionTimeoutWarning from "./components/SessionTimeoutWarning";
import PageLoader from "./components/PageLoader";

/**
 * lazy() wrapper that survives stale deploys. When a code-split chunk fails to
 * load (its hashed filename was replaced by a newer build), reload the page once
 * so the browser fetches the fresh index.html + new chunk names. If it still
 * fails after one reload, surface the real error.
 */
function lazy<T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return reactLazy(async () => {
    const RELOAD_KEY = "chunk-reload-attempted";
    try {
      const mod = await factory();
      sessionStorage.removeItem(RELOAD_KEY);
      return mod;
    } catch (err) {
      if (!sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, "1");
        window.location.reload();
        return new Promise<{ default: T }>(() => {}); // hold render until reload
      }
      throw err;
    }
  });
}

const Dashboard         = lazy(() => import("./pages/Dashboard"));
const Auth              = lazy(() => import("./pages/Auth"));
const Expenses          = lazy(() => import("./pages/Expenses"));
const Budgets           = lazy(() => import("./pages/Budgets"));
const Reports           = lazy(() => import("./pages/Reports"));
const BusinessManagement = lazy(() => import("./pages/BusinessManagement"));
const Inventory         = lazy(() => import("./pages/business/Inventory"));
const InventoryRequests = lazy(() => import("./pages/business/InventoryRequests"));
const Payments          = lazy(() => import("./pages/business/Payments"));
const Analytics         = lazy(() => import("./pages/business/Analytics"));
const KPIDashboard      = lazy(() => import("./pages/business/KPIDashboard"));
const Invoices          = lazy(() => import("./pages/business/Invoices"));
const Finance           = lazy(() => import("./pages/business/Finance"));
const UserManagement    = lazy(() => import("./pages/UserManagement"));
const StaffProfiles     = lazy(() => import("./pages/StaffProfiles"));
const NJCSupplies       = lazy(() => import("./pages/NJCSupplies"));
const ProfitLoss        = lazy(() => import("./pages/ProfitLoss"));
const Payroll           = lazy(() => import("./pages/Payroll"));
const MyProfile         = lazy(() => import("./pages/MyProfile"));
const StaffPortal       = lazy(() => import("./pages/StaffPortal"));
const BirthdayCalendar  = lazy(() => import("./pages/BirthdayCalendar"));
const MyPayslip         = lazy(() => import("./pages/MyPayslip"));
const DepartmentPermissions = lazy(() => import("./pages/admin/DepartmentPermissions"));
const CompanyFiles      = lazy(() => import("./pages/admin/CompanyFiles"));
const BankAccounts      = lazy(() => import("./pages/admin/BankAccounts"));
const Messages          = lazy(() => import("./pages/admin/Messages"));
const Accounting        = lazy(() => import("./pages/admin/Accounting"));
const Contact           = lazy(() => import("./pages/Contact"));
const PendingApproval   = lazy(() => import("./pages/PendingApproval"));
const Procurement       = lazy(() => import("./pages/Procurement"));
const NotFound          = lazy(() => import("./pages/NotFound"));


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
    },
  },
});

// Requires authentication. By default also blocks pending users (redirect to /pending-approval).
// Pass allowPending for routes that pending users should be able to reach (dashboard, my-profile).
const ProtectedRoute = ({
  children,
  allowPending = false,
}: {
  children: React.ReactNode;
  allowPending?: boolean;
}) => {
  const { user, loading: authLoading } = useAuth();
  const { isPending, loading: roleLoading } = useRoles();
  if (authLoading || roleLoading) return <PageLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  if (isPending && !allowPending) return <Navigate to="/pending-approval" replace />;
  return <>{children}</>;
};

// Business overview: any user with at least one business module permission.
const BusinessRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isManager, hasPermission, loading: roleLoading } = useRoles();
  if (authLoading || roleLoading) return <PageLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  const hasAny = isAdmin || isManager ||
    (['sales', 'inventory', 'invoices', 'finance', 'budgets', 'reports'] as const)
      .some(m => hasPermission(m, 'view'));
  if (!hasAny) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <SessionTimeoutWarning />
        <RoleProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              {/* Public, no-login contact + newsletter page */}
              <Route path="/contact" element={<Contact />} />
              <Route path="/" element={<Layout />}>
                <Route index element={
                  <ProtectedRoute allowPending>
                    <Navigate to="/dashboard" replace />
                  </ProtectedRoute>
                } />
                {/* Pending users land here until approved */}
                <Route path="pending-approval" element={
                  <ProtectedRoute allowPending>
                    <PendingApproval />
                  </ProtectedRoute>
                } />
                {/* Open to all authenticated users (including pending) */}
                <Route path="dashboard" element={
                  <ProtectedRoute allowPending>
                    <Dashboard />
                  </ProtectedRoute>
                } />
                <Route path="my-profile" element={
                  <ProtectedRoute allowPending>
                    <MyProfile />
                  </ProtectedRoute>
                } />
                {/* Requires approved role (pending users → /pending-approval) */}
                <Route path="staff-portal" element={
                  <ProtectedRoute>
                    <StaffPortal />
                  </ProtectedRoute>
                } />
                <Route path="birthdays" element={
                  <ProtectedRoute>
                    <BirthdayCalendar />
                  </ProtectedRoute>
                } />
                <Route path="my-payslip" element={
                  <ProtectedRoute>
                    <MyPayslip />
                  </ProtectedRoute>
                } />
                <Route path="business/inventory-requests" element={
                  <ProtectedRoute>
                    <InventoryRequests />
                  </ProtectedRoute>
                } />
                <Route path="business/kpi" element={
                  <ProtectedRoute>
                    <KPIDashboard />
                  </ProtectedRoute>
                } />
                {/* Module-permission-gated routes */}
                <Route path="expenses" element={
                  <Can module="budgets" redirect="/dashboard">
                    <Expenses />
                  </Can>
                } />
                <Route path="budgets" element={
                  <Can module="budgets" redirect="/dashboard">
                    <Budgets />
                  </Can>
                } />
                <Route path="reports" element={
                  <Can module="reports" redirect="/dashboard">
                    <Reports />
                  </Can>
                } />
                <Route path="business" element={
                  <BusinessRoute>
                    <BusinessManagement />
                  </BusinessRoute>
                } />
                <Route path="business/inventory" element={
                  <Can module="inventory" redirect="/dashboard">
                    <Inventory />
                  </Can>
                } />
                {/* SKU Catalog consolidated into the single Inventory module */}
                <Route path="business/sku-management" element={<Navigate to="/business/inventory" replace />} />
                <Route path="business/payments" element={
                  <Can module="sales" redirect="/dashboard">
                    <Payments />
                  </Can>
                } />
                <Route path="business/analytics" element={
                  <Can module="inventory" redirect="/dashboard">
                    <Analytics />
                  </Can>
                } />
                <Route path="business/invoices" element={
                  <Can module="invoices" redirect="/dashboard">
                    <Invoices />
                  </Can>
                } />
                <Route path="business/finance" element={
                  <Can module="finance" redirect="/dashboard">
                    <Finance />
                  </Can>
                } />
                {/* Role-gated routes */}
                <Route path="users" element={
                  <Can roles={['admin']} redirect="/dashboard">
                    <UserManagement />
                  </Can>
                } />
                <Route path="department-permissions" element={
                  <Can roles={['admin']} redirect="/dashboard">
                    <DepartmentPermissions />
                  </Can>
                } />
                <Route path="company-files" element={
                  <Can roles={['admin']} redirect="/dashboard">
                    <CompanyFiles />
                  </Can>
                } />
                <Route path="bank-accounts" element={
                  <Can roles={['admin']} redirect="/dashboard">
                    <BankAccounts />
                  </Can>
                } />
                <Route path="messages" element={
                  <Can roles={['admin']} redirect="/dashboard">
                    <Messages />
                  </Can>
                } />
                <Route path="accounting" element={
                  <Can roles={['admin']} redirect="/dashboard">
                    <Accounting />
                  </Can>
                } />
                <Route path="staff-profiles" element={
                  <Can roles={['admin', 'hr']} redirect="/dashboard">
                    <StaffProfiles />
                  </Can>
                } />
                <Route path="njc-supplies" element={
                  <Can roles={['admin']} redirect="/dashboard">
                    <NJCSupplies />
                  </Can>
                } />
                <Route path="profit-loss" element={
                  <Can roles={['admin']} redirect="/dashboard">
                    <ProfitLoss />
                  </Can>
                } />
                <Route path="payroll" element={
                  <Can roles={['admin']} redirect="/dashboard">
                    <Payroll />
                  </Can>
                } />
                <Route path="procurement" element={
                  <Can roles={['admin', 'manager']} redirect="/dashboard">
                    <Procurement />
                  </Can>
                } />
              </Route>
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
        </RoleProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

const SentryApp = Sentry.withErrorBoundary(App, {
  fallback: ({ error, resetError }) => (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-4xl">⚠️</div>
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        {(error as Error)?.message || "An unexpected error occurred. Our team has been notified."}
      </p>
      <button
        onClick={resetError}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
      >
        Try Again
      </button>
    </div>
  ),
  showDialog: false,
});

export default SentryApp;
