import React, { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { RoleProvider, useRoles } from "./hooks/useRoles";
import * as Sentry from "@sentry/react";
import Layout from "./components/Layout";

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
const SKUManagement     = lazy(() => import("./pages/SKUManagement"));
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
const NotFound          = lazy(() => import("./pages/NotFound"));

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
    },
  },
});

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useRoles();
  if (authLoading || roleLoading) return <PageLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

const AdminOrHRRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isHR, loading: roleLoading } = useRoles();
  if (authLoading || roleLoading) return <PageLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin && !isHR) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

// Business overview page: any user with at least one business module permission
const BusinessRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isManager, hasPermission, loading: roleLoading } = useRoles();
  if (authLoading || roleLoading) return <PageLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  const hasAny = isAdmin || isManager ||
    ['sales','inventory','invoices','finance','budgets','reports']
      .some(m => hasPermission(m, 'view'));
  if (!hasAny) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

// Module-level permission gate — uses department_permissions for granular access.
// Admin and HR always pass (handled inside hasPermission).
const PermissionRoute = ({ module, children }: { module: string; children: React.ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const { hasPermission, loading: roleLoading } = useRoles();
  if (authLoading || roleLoading) return <PageLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!hasPermission(module, 'view')) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <RoleProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/" element={<Layout />}>
                <Route index element={
                  <ProtectedRoute>
                    <Navigate to="/dashboard" replace />
                  </ProtectedRoute>
                } />
                <Route path="dashboard" element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } />
                <Route path="expenses" element={
                  <PermissionRoute module="budgets">
                    <Expenses />
                  </PermissionRoute>
                } />
                <Route path="budgets" element={
                  <PermissionRoute module="budgets">
                    <Budgets />
                  </PermissionRoute>
                } />
                <Route path="reports" element={
                  <PermissionRoute module="reports">
                    <Reports />
                  </PermissionRoute>
                } />
                <Route path="business" element={
                  <BusinessRoute>
                    <BusinessManagement />
                  </BusinessRoute>
                } />
                <Route path="business/inventory" element={
                  <PermissionRoute module="inventory">
                    <Inventory />
                  </PermissionRoute>
                } />
                <Route path="business/inventory-requests" element={
                  <ProtectedRoute>
                    <InventoryRequests />
                  </ProtectedRoute>
                } />
                <Route path="business/sku-management" element={
                  <PermissionRoute module="inventory">
                    <SKUManagement />
                  </PermissionRoute>
                } />
                <Route path="business/payments" element={
                  <PermissionRoute module="sales">
                    <Payments />
                  </PermissionRoute>
                } />
                <Route path="business/analytics" element={
                  <PermissionRoute module="inventory">
                    <Analytics />
                  </PermissionRoute>
                } />
                <Route path="business/kpi" element={
                  <AdminOrHRRoute>
                    <KPIDashboard />
                  </AdminOrHRRoute>
                } />
                <Route path="business/invoices" element={
                  <PermissionRoute module="invoices">
                    <Invoices />
                  </PermissionRoute>
                } />
                <Route path="business/finance" element={
                  <PermissionRoute module="finance">
                    <Finance />
                  </PermissionRoute>
                } />
                <Route path="users" element={
                  <AdminRoute>
                    <UserManagement />
                  </AdminRoute>
                } />
                <Route path="department-permissions" element={
                  <AdminRoute>
                    <DepartmentPermissions />
                  </AdminRoute>
                } />
                <Route path="company-files" element={
                  <AdminRoute>
                    <CompanyFiles />
                  </AdminRoute>
                } />
                <Route path="staff-profiles" element={
                  <AdminOrHRRoute>
                    <StaffProfiles />
                  </AdminOrHRRoute>
                } />
                <Route path="njc-supplies" element={
                  <AdminRoute>
                    <NJCSupplies />
                  </AdminRoute>
                } />
                <Route path="profit-loss" element={
                  <AdminRoute>
                    <ProfitLoss />
                  </AdminRoute>
                } />
                <Route path="payroll" element={
                  <AdminRoute>
                    <Payroll />
                  </AdminRoute>
                } />
                <Route path="my-profile" element={
                  <ProtectedRoute>
                    <MyProfile />
                  </ProtectedRoute>
                } />
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
