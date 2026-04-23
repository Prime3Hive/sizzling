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
  Boxes,
  TrendingUp,
  PieChart,
  LineChart,
  Wallet,
  MessageSquare,
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
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";

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

  const isStaff = !isAdmin && !isHR && !isManager && !isEmployee;

  const hasBusinessAccess = isAdmin
    || isManager
    || hasPermission('inventory', 'view')
    || hasPermission('sales', 'view')
    || hasPermission('invoices', 'view')
    || hasPermission('finance', 'view')
    || hasPermission('budgets', 'view')
    || hasPermission('reports', 'view');

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

  // Minimal sidebar for pending/no-role users
  if (isStaff) {
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
                    <UserCog className="h-4 w-4" />
                    My Profile
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/business/inventory-requests'}>
                  <Link to="/business/inventory-requests">
                    <ClipboardCheck className="h-4 w-4" />
                    Inventory Requests
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/staff-portal'}>
                  <Link to="/staff-portal">
                    <MessageSquare className="h-4 w-4" />
                    Staff Portal
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

  return (
    <Sidebar {...props}>
      <SidebarUserHeader />

      <SidebarContent>

        {/* ── Dashboard ── */}
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

        <SidebarSeparator />

        {/* ── MODULE 1: BUSINESS MANAGEMENT ── */}
        {hasBusinessAccess && (
          <SidebarGroup>
            <SidebarGroupLabel>Business</SidebarGroupLabel>
            <SidebarMenu>

              {hasBusinessAccess && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/business'}>
                    <Link to="/business">
                      <Building2 className="h-4 w-4" />
                      Overview
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Inventory */}
              {hasPermission('inventory', 'view') && (
                <SidebarMenuItem>
                  <Collapsible defaultOpen={location.pathname.startsWith('/business/inventory') || location.pathname === '/business/sku-management' || location.pathname === '/business/analytics'}>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton className="group/collapsible">
                        <Package className="h-4 w-4" />
                        Inventory
                        <ChevronRight className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={location.pathname === '/business/inventory'}>
                            <Link to="/business/inventory"><span>Inventory Management</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild isActive={location.pathname === '/business/sku-management'}>
                            <Link to="/business/sku-management"><Boxes className="h-3 w-3" /><span>SKU Management</span></Link>
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
              )}

              {/* Inventory Requests — all authenticated staff */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/business/inventory-requests'}>
                  <Link to="/business/inventory-requests">
                    <ClipboardCheck className="h-4 w-4" />Inventory Requests
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Payments */}
              {hasPermission('sales', 'view') && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/business/payments'}>
                    <Link to="/business/payments"><CreditCard className="h-4 w-4" />Payments</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Invoices */}
              {hasPermission('invoices', 'view') && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/business/invoices'}>
                    <Link to="/business/invoices"><ClipboardList className="h-4 w-4" />Invoices</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Finance */}
              {hasPermission('finance', 'view') && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/business/finance'}>
                    <Link to="/business/finance"><Landmark className="h-4 w-4" />Finance</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Expenses */}
              {(hasPermission('budgets', 'view') || hasPermission('finance', 'view')) && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/expenses'}>
                    <Link to="/expenses"><Receipt className="h-4 w-4" />Expenses</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Budgets */}
              {hasPermission('budgets', 'view') && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/budgets'}>
                    <Link to="/budgets"><Target className="h-4 w-4" />Budgets</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Reports */}
              {hasPermission('reports', 'view') && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname === '/reports'}>
                    <Link to="/reports"><BarChart3 className="h-4 w-4" />Reports</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Admin-only financial tools */}
              {isAdmin && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/profit-loss'}>
                      <Link to="/profit-loss"><LineChart className="h-4 w-4" />Profit & Loss</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={location.pathname === '/njc-supplies'}>
                      <Link to="/njc-supplies"><Package className="h-4 w-4" />NJC Supplies</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}

            </SidebarMenu>
          </SidebarGroup>
        )}

        <SidebarSeparator />

        {/* ── MODULE 2: ADMINISTRATION ── */}
        <SidebarGroup>
          <SidebarGroupLabel>Administration</SidebarGroupLabel>
          <SidebarMenu>

            {isAdmin && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/users'}>
                  <Link to="/users"><Users className="h-4 w-4" />User Management</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {isAdmin && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/department-permissions'}>
                  <Link to="/department-permissions"><ToggleLeft className="h-4 w-4" />Access Control</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {(isAdmin || isHR) && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/staff-profiles'}>
                  <Link to="/staff-profiles"><UserCog className="h-4 w-4" />Staff Profiles</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {isAdmin && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/payroll'}>
                  <Link to="/payroll"><Wallet className="h-4 w-4" />Payroll</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {/* KPI Dashboard — Admin and HR only */}
            {(isAdmin || isHR) && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location.pathname === '/business/kpi'}>
                  <Link to="/business/kpi"><PieChart className="h-4 w-4" />KPI Dashboard</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {/* Staff Portal — collapsible with tab links */}
            <SidebarMenuItem>
              <Collapsible defaultOpen={location.pathname === '/staff-portal'}>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton className="group/collapsible" isActive={location.pathname === '/staff-portal'}>
                    <ShieldCheck className="h-4 w-4" />
                    Staff Portal
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
                        <Link to="/staff-portal?tab=performance"><TrendingUp className="h-3 w-3" /><span>My Performance</span></Link>
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

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname === '/my-payslip'}>
                <Link to="/my-payslip"><FileText className="h-4 w-4" />My Payslip</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={location.pathname === '/my-profile'}>
                <Link to="/my-profile"><UserCog className="h-4 w-4" />My Profile</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

          </SidebarMenu>
        </SidebarGroup>

      </SidebarContent>

      <SidebarSignOutFooter />
    </Sidebar>
  );
}
