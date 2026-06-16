import {
  Target,
  BarChart3,
  Building2,
  Package,
  CreditCard,
  Users,
  ChevronRight,
  Receipt,
  UserCog,
  TrendingUp,
  PieChart,
  LineChart,
  Wallet,
  CalendarDays,
  AlertTriangle,
  Mail,
  ShieldCheck,
  Cake,
  FileText,
  LayoutDashboard,
  LogOut,
  ClipboardList,
  Landmark,
  ToggleLeft,
  ClipboardCheck,
  HardDrive,
  User,
  Send,
  FolderOpen,
  Truck,
  Inbox,
  Scale,
} from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";
import { Can } from "@/components/Can";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function UserAvatar({ name, email }: { name?: string; email?: string }) {
  const initials = name
    ? name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : (email?.[0] ?? '?').toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-gradient-primary flex items-center justify-center text-white text-sm font-bold shrink-0">
      {initials}
    </div>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user, signOut } = useAuth();
  const { hasPermission, isAdmin, isHR, isManager, isEmployee, isPending, loading, userRole } = useRoles();
  const location = useLocation();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  // On mobile, auto-close the navigation drawer after navigating to a new route
  // (covers query-param changes like ?tab=… too).
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [location.pathname, location.search, isMobile, setOpenMobile]);

  // Unread contact-message count (admins only) — drives the Messages badge
  const { data: unreadMessages = 0 } = useQuery({
    queryKey: ["contact-messages-unread"],
    enabled: !!isAdmin,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from("contact_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "new");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const displayName = user?.user_metadata?.full_name as string | undefined;
  const email = user?.email;
  const roleLabel = userRole?.role ?? 'member';

  const roleBadgeColor: Record<string, string> = {
    admin: 'bg-destructive/10 text-destructive border-destructive/20',
    manager: 'bg-primary/10 text-primary border-primary/20',
    hr: 'bg-purple-100 text-purple-700 border-purple-200',
    employee: 'bg-success/10 text-success border-success/20',
    pending: 'bg-warning/10 text-warning border-warning/20',
  };

  if (loading) {
    return (
      <Sidebar {...props}>
        <SidebarContent>
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        </SidebarContent>
      </Sidebar>
    );
  }

  // Hub access checks
  const hasCommerceAccess = isAdmin
    || isManager
    || hasPermission('inventory', 'view')
    || hasPermission('sales', 'view')
    || hasPermission('invoices', 'view');

  const hasFinanceAccess = isAdmin
    || isManager
    || hasPermission('finance', 'view')
    || hasPermission('budgets', 'view')
    || hasPermission('reports', 'view');

  const hasPeopleAccess = isAdmin || isHR;

  const isInventoryActive = location.pathname.startsWith('/business/inventory')
    || location.pathname === '/business/sku-management'
    || location.pathname === '/business/analytics';

  const isStaffRequestsActive = location.pathname === '/staff-portal';

  const SidebarUserHeader = () => (
    <SidebarHeader className="border-b border-border/60 pb-3">
      <div className="flex items-center gap-3 px-1 pt-1">
        <UserAvatar name={displayName} email={email} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{displayName ?? email}</p>
          {displayName && <p className="text-xs text-muted-foreground truncate">{email}</p>}
          <Badge
            variant="outline"
            className={`mt-1 text-[10px] px-1.5 py-0 capitalize ${roleBadgeColor[roleLabel] ?? ''}`}
          >
            {roleLabel}
          </Badge>
        </div>
      </div>
      {isPending && (
        <div className="mx-1 mt-2 rounded-md bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
          Your <span className="font-semibold capitalize">{userRole?.role}</span> role is pending approval.
        </div>
      )}
    </SidebarHeader>
  );

  const SidebarSignOutFooter = () => (
    <SidebarFooter className="border-t border-border/60 pt-2">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
        onClick={handleSignOut}
      >
        <LogOut className="h-4 w-4" />
        Sign Out
      </Button>
    </SidebarFooter>
  );

  // Pending users: minimal sidebar — no staff portal until approved
  if (isPending) {
    return (
      <Sidebar {...props}>
        <SidebarUserHeader />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/dashboard'}>
                  <Link to="/dashboard">
                    <LayoutDashboard className="h-4 w-4" />
                    Dashboard
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/my-profile'}>
                  <Link to="/my-profile">
                    <User className="h-4 w-4" />
                    My Profile
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarSignOutFooter />
      </Sidebar>
    );
  }

  // Employee sidebar: no elevated role, no dept permissions → focused employee view
  if (isEmployee && !isAdmin && !isHR && !isManager && !hasCommerceAccess && !hasFinanceAccess) {
    return (
      <Sidebar {...props}>
        <SidebarUserHeader />
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/dashboard'}>
                  <Link to="/dashboard"><LayoutDashboard className="h-4 w-4" />Dashboard</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/my-profile'}>
                  <Link to="/my-profile"><User className="h-4 w-4" />My Profile</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/my-payslip'}>
                  <Link to="/my-payslip"><FileText className="h-4 w-4" />My Payslip</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/business/inventory-requests'}>
                  <Link to="/business/inventory-requests">
                    <ClipboardCheck className="h-4 w-4" />Inventory Requests
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Collapsible defaultOpen={location.pathname === '/staff-portal'}>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton className="group/collapsible">
                      <Send className="h-4 w-4" />
                      My Requests
                      <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <Link to="/staff-portal?tab=leave"><CalendarDays className="h-3 w-3" /><span>Leave Requests</span></Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <Link to="/staff-portal?tab=complaints"><AlertTriangle className="h-3 w-3" /><span>Complaints</span></Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <Link to="/staff-portal?tab=messages"><Mail className="h-3 w-3" /><span>Messages</span></Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <Link to="/business/kpi"><TrendingUp className="h-3 w-3" /><span>My Performance</span></Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={location.search.includes('tab=documents')}>
                          <Link to="/staff-portal?tab=documents"><FolderOpen className="h-3 w-3" /><span>My Documents</span></Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </Collapsible>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarSignOutFooter />
      </Sidebar>
    );
  }

  return (
    <Sidebar {...props}>
      <SidebarUserHeader />

      <SidebarContent>

        {/* ── Overview ── */}
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname === '/dashboard' || location.pathname === '/'}>
                <Link to="/dashboard">
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {/* ── COMMERCE HUB ── */}
        {hasCommerceAccess && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Commerce</SidebarGroupLabel>
              <SidebarMenu>

                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/business'}>
                    <Link to="/business">
                      <Building2 className="h-4 w-4" />
                      Overview
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Inventory — collapsible */}
                <Can module="inventory">
                  <SidebarMenuItem>
                    <Collapsible defaultOpen={isInventoryActive}>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton className="group/collapsible" isActive={isInventoryActive}>
                          <Package className="h-4 w-4" />
                          Inventory
                          <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={location.pathname === '/business/inventory'}>
                              <Link to="/business/inventory"><span>Stock Management</span></Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={location.pathname === '/business/analytics'}>
                              <Link to="/business/analytics"><TrendingUp className="h-3 w-3" /><span>Analytics</span></Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </Collapsible>
                  </SidebarMenuItem>
                </Can>

                {/* Inventory Requests — all approved staff */}
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/business/inventory-requests'}>
                    <Link to="/business/inventory-requests">
                      <ClipboardCheck className="h-4 w-4" />Inventory Requests
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <Can module="sales">
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/business/payments'}>
                      <Link to="/business/payments"><CreditCard className="h-4 w-4" />Payments</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Can>

                <Can module="invoices">
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/business/invoices'}>
                      <Link to="/business/invoices"><ClipboardList className="h-4 w-4" />Invoices</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Can>

              </SidebarMenu>
            </SidebarGroup>
          </>
        )}

        {/* ── FINANCE HUB ── */}
        {hasFinanceAccess && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Finance</SidebarGroupLabel>
              <SidebarMenu>

                <Can module="finance">
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/business/finance'}>
                      <Link to="/business/finance"><Landmark className="h-4 w-4" />Finance Ledger</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Can>

                <Can roles={['admin']}>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/accounting'}>
                      <Link to="/accounting"><Scale className="h-4 w-4" />Accounting</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Can>

                <Can module="budgets">
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/expenses'}>
                      <Link to="/expenses"><Receipt className="h-4 w-4" />Expenses</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/budgets'}>
                      <Link to="/budgets"><Target className="h-4 w-4" />Budgets</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Can>

                <Can module="reports">
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/reports'}>
                      <Link to="/reports"><BarChart3 className="h-4 w-4" />Finance Report</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Can>

                <Can feature="profit_loss">
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/profit-loss'}>
                      <Link to="/profit-loss"><LineChart className="h-4 w-4" />Profit & Loss</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Can>
                <Can feature="njc_supplies">
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/njc-supplies'}>
                      <Link to="/njc-supplies"><Package className="h-4 w-4" />NJC Supplies</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Can>

                <Can roles={['admin', 'manager']}>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/procurement'}>
                      <Link to="/procurement"><Truck className="h-4 w-4" />Procurement</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Can>

              </SidebarMenu>
            </SidebarGroup>
          </>
        )}

        {/* ── PEOPLE HUB ── */}
        {hasPeopleAccess && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>People</SidebarGroupLabel>
              <SidebarMenu>

                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/staff-profiles'}>
                    <Link to="/staff-profiles"><UserCog className="h-4 w-4" />Staff Profiles</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                <Can feature="view_payroll">
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/payroll'}>
                      <Link to="/payroll"><Wallet className="h-4 w-4" />Payroll</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </Can>

                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/business/kpi'}>
                    <Link to="/business/kpi"><PieChart className="h-4 w-4" />KPI Dashboard</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

                {/* Staff Requests — collapsible admin/hr view of all staff requests */}
                <SidebarMenuItem>
                  <Collapsible defaultOpen={isStaffRequestsActive}>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton className="group/collapsible" isActive={isStaffRequestsActive}>
                        <Send className="h-4 w-4" />
                        Staff Requests
                        <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <Link to="/staff-portal?tab=leave"><CalendarDays className="h-3 w-3" /><span>Leave Requests</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <Link to="/staff-portal?tab=complaints"><AlertTriangle className="h-3 w-3" /><span>Complaints</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <Link to="/staff-portal?tab=messages"><Mail className="h-3 w-3" /><span>Messages</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                </SidebarMenuItem>

                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/birthdays'}>
                    <Link to="/birthdays"><Cake className="h-4 w-4" />Birthday Calendar</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>

              </SidebarMenu>
            </SidebarGroup>
          </>
        )}

        <SidebarSeparator />

        {/* ── MY SPACE ── */}
        <SidebarGroup>
          <SidebarGroupLabel>My Space</SidebarGroupLabel>
          <SidebarMenu>

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname === '/my-profile'}>
                <Link to="/my-profile"><User className="h-4 w-4" />My Profile</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname === '/my-payslip'}>
                <Link to="/my-payslip"><FileText className="h-4 w-4" />My Payslip</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname === '/business/kpi'}>
                <Link to="/business/kpi"><TrendingUp className="h-4 w-4" />My Performance</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.search.includes('tab=documents')}>
                <Link to="/staff-portal?tab=documents"><FolderOpen className="h-4 w-4" />My Documents</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

          </SidebarMenu>
        </SidebarGroup>

        {/* ── ADMINISTRATION ── */}
        <Can roles={['admin']}>
          <SidebarSeparator />
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarMenu>

              <Can feature="approve_roles">
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/users'}>
                    <Link to="/users"><Users className="h-4 w-4" />User Management</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </Can>

              <Can feature="manage_departments">
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/department-permissions'}>
                    <Link to="/department-permissions"><ToggleLeft className="h-4 w-4" />Access Control</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </Can>

              <Can feature="company_files">
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/company-files'}>
                    <Link to="/company-files"><HardDrive className="h-4 w-4" />Company Files</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </Can>

              <Can roles={['admin']}>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/bank-accounts'}>
                    <Link to="/bank-accounts"><Landmark className="h-4 w-4" />Bank Accounts</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/messages'}>
                    <Link to="/messages">
                      <Inbox className="h-4 w-4" />
                      <span>Messages</span>
                      {unreadMessages > 0 && (
                        <Badge className="ml-auto bg-blue-600 text-white text-[10px] h-5 min-w-5 px-1.5">
                          {unreadMessages}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </Can>

            </SidebarMenu>
          </SidebarGroup>
        </Can>

      </SidebarContent>

      <SidebarSignOutFooter />
    </Sidebar>
  );
}
