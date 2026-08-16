import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { useAuth } from '@/hooks/useAuth';
import NotificationBell from '@/components/NotificationBell';
import ThemeToggle from '@/components/ThemeToggle';
import { useBirthdayNotifications } from '@/hooks/useBirthdayNotifications';

const Layout = () => {
  const { user } = useAuth();
  useBirthdayNotifications();

  if (!user) {
    return <Outlet />;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <AppSidebar />

        <div className="flex-1 flex flex-col min-w-0">
          {/* ── Top header ── */}
          <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-sm shadow-sm">
            <div className="flex items-center justify-between h-14 md:h-16 px-3 md:px-5">

              {/* Left: sidebar trigger + logo */}
              <div className="flex items-center gap-2 md:gap-3 min-w-0">
                <SidebarTrigger className="shrink-0 text-muted-foreground hover:text-foreground" />
                <div className="w-8 h-8 md:w-9 md:h-9 rounded-lg overflow-hidden bg-gradient-primary p-0.5 shadow-sm shrink-0">
                  <img
                    src="/favicon.png"
                    alt="Sizzling Spices"
                    className="w-full h-full object-contain rounded-md"
                  />
                </div>
                {/* Short label on phones so the header isn't just two icons
                    floating against empty space; full name from sm up. */}
                <span className="min-w-0 truncate text-sm sm:text-base font-bold bg-gradient-primary bg-clip-text text-transparent">
                  <span className="sm:hidden">Sizzling Spices</span>
                  <span className="hidden sm:inline">Sizzling Spices Portal</span>
                </span>
              </div>

              {/* Right: theme + notifications — sign-out lives in sidebar footer */}
              <div className="flex items-center gap-1 shrink-0">
                <ThemeToggle />
                <NotificationBell />
              </div>
            </div>
          </header>

          {/* ── Page content ── */}
          {/* min-w-0 lets wide children (tables, chart scrollers) shrink to the
              column instead of widening it rather than widening the page. */}
          <main className="flex-1 min-w-0 w-full max-w-screen-2xl mx-auto px-3 py-4 sm:px-5 sm:py-6 md:px-8 md:py-8">
            <Outlet />
            {/* Additive spacer for the home-indicator / gesture bar. Kept as its
                own element so it stacks with the responsive py-* above instead
                of competing with it in the cascade. */}
            <div aria-hidden className="h-[env(safe-area-inset-bottom,0px)]" />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default Layout;
