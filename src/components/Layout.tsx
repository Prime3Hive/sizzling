import React from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/hooks/useAuth';
import { PlusCircle, Home, BarChart3, Settings, LogOut, Building2 } from 'lucide-react';
import NotificationBell from '@/components/NotificationBell';

const Layout = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  if (!user) {
    return <Outlet />;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <header className="border-b border-border bg-card/95 backdrop-blur-sm shadow-sm">
            <div className="flex items-center justify-between py-4 px-4">
              <div className="flex items-center space-x-4">
                <SidebarTrigger className="mr-2" />
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-gradient-primary p-1 shadow-sm">
                  <img 
                    src="/favicon.png" 
                    alt="Sizzling Spices Logo" 
                    className="w-full h-full object-contain rounded-md"
                  />
                </div>
                <h1 className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                  Sizzling Spices Expense Tracker
                </h1>
              </div>

              <div className="flex items-center gap-2">
                <NotificationBell />
                <Button variant="outline" size="sm" onClick={handleSignOut} className="hover:shadow-sm transition-all duration-200">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 container mx-auto py-8 px-4">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Layout;