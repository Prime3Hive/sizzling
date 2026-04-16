import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { RoleProvider, useRoles } from "./hooks/useRoles";
import * as Sentry from "@sentry/react";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";

import Expenses from "./pages/Expenses";
import Budgets from "./pages/Budgets";
import Reports from "./pages/Reports";
import BusinessManagement from "./pages/BusinessManagement";
import Inventory from "./pages/business/Inventory";
import InventoryRequests from "./pages/business/InventoryRequests";
import Sales from "./pages/business/Sales";
import Payments from "./pages/business/Payments";
import Analytics from "./pages/business/Analytics";
import KPIDashboard from "./pages/business/KPIDashboard";
import SKUManagement from "./pages/SKUManagement";
import UserManagement from "./pages/UserManagement";
import StaffProfiles from "./pages/StaffProfiles";
import NJCSupplies from "./pages/NJCSupplies";
import ProfitLoss from "./pages/ProfitLoss";
import Payroll from "./pages/Payroll";
import MyProfile from "./pages/MyProfile";
import StaffPortal from "./pages/StaffPortal";
import BirthdayCalendar from "./pages/BirthdayCalendar";
import MyPayslip from "./pages/MyPayslip";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useRoles();
  if (authLoading || roleLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
};

const AdminOrHRRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isHR, loading: roleLoading } = useRoles();
  if (authLoading || roleLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin && !isHR) return <Navigate to="/" replace />;
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
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/" element={<Layout />}>
                <Route index element={
                  <ProtectedRoute>
                    <Navigate to="/staff-portal" replace />
                  </ProtectedRoute>
                } />
                <Route path="expenses" element={
                  <ProtectedRoute>
                    <Expenses />
                  </ProtectedRoute>
                } />
                <Route path="budgets" element={
                  <ProtectedRoute>
                    <Budgets />
                  </ProtectedRoute>
                } />
                <Route path="reports" element={
                  <ProtectedRoute>
                    <Reports />
                  </ProtectedRoute>
                } />
                <Route path="business" element={
                  <ProtectedRoute>
                    <BusinessManagement />
                  </ProtectedRoute>
                } />
                <Route path="business/inventory" element={
                  <ProtectedRoute>
                    <Inventory />
                  </ProtectedRoute>
                } />
                <Route path="business/inventory-requests" element={
                  <ProtectedRoute>
                    <InventoryRequests />
                  </ProtectedRoute>
                } />
                <Route path="business/sku-management" element={
                  <ProtectedRoute>
                    <SKUManagement />
                  </ProtectedRoute>
                } />
                <Route path="business/sales" element={
                  <ProtectedRoute>
                    <Sales />
                  </ProtectedRoute>
                } />
                <Route path="business/payments" element={
                  <ProtectedRoute>
                    <Payments />
                  </ProtectedRoute>
                } />
                <Route path="business/analytics" element={
                  <ProtectedRoute>
                    <Analytics />
                  </ProtectedRoute>
                } />
                <Route path="business/kpi" element={
                  <ProtectedRoute>
                    <KPIDashboard />
                  </ProtectedRoute>
                } />
                <Route path="users" element={
                  <AdminRoute>
                    <UserManagement />
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
