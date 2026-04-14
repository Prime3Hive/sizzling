import { 
  Target, 
  BarChart3, 
  Building2, 
  Package, 
  ShoppingCart, 
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
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useRoles } from "@/hooks/useRoles";
import { useAuth } from "@/hooks/useAuth";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user } = useAuth();
  const { hasPermission, isAdmin, isHR, isManager, isEmployee, isPending, loading, userRole } = useRoles();
  const location = useLocation();

  if (loading) {
    return (
      <Sidebar {...props}>
        <SidebarContent>
          <div className="p-4">Loading...</div>
        </SidebarContent>
      </Sidebar>
    );
  }

  const isStaff = !isAdmin && !isHR && !isManager && !isEmployee;

  const hasBusinessAccess = isAdmin
    || hasPermission('inventory', 'view')
    || hasPermission('sales', 'view')
    || hasPermission('budgets', 'view')
    || hasPermission('reports', 'view');

  // No-role or pending users: minimal sidebar
  if (isStaff) {
    return (
      <Sidebar {...props}>
        <SidebarContent>
          {isPending && (
            <SidebarGroup>
              <div className="mx-2 mt-2 mb-1 rounded-md bg-warning/10 border border-warning/20 px-3 py-2 text-xs text-warning">
                Your <span className="font-semibold capitalize">{userRole?.role}</span> role is pending approval.
              </div>
            </SidebarGroup>
          )}
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/my-profile">
                    <UserCog className="h-4 w-4" />
                    My Profile
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/staff-portal">
                    <MessageSquare className="h-4 w-4" />
                    Staff Portal
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    );
  }

  return (
    <Sidebar {...props}>
      <SidebarContent>

        {/* ── MODULE 1: BUSINESS MANAGEMENT ── */}
        {hasBusinessAccess && (
          <SidebarGroup>
            <SidebarGroupLabel>Business Management</SidebarGroupLabel>
            <SidebarMenu>

              {/* Overview */}
              {(isAdmin || hasPermission('inventory', 'view') || hasPermission('sales', 'view')) && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link to="/business">
                      <Building2 className="h-4 w-4" />
                      Overview
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Inventory */}
              {(isAdmin || hasPermission('inventory', 'view')) && (
                <SidebarMenuItem>
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton>
                        <Package className="h-4 w-4" />
                        Inventory
                        <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <Link to="/business/inventory"><span>Inventory Management</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <Link to="/business/sku-management"><Boxes className="h-3 w-3" /><span>SKU Management</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <Link to="/business/inventory-requests"><span>Inventory Requests</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <Link to="/business/analytics"><TrendingUp className="h-3 w-3" /><span>Analytics</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton asChild>
                            <Link to="/business/kpi"><PieChart className="h-3 w-3" /><span>KPI Dashboard</span></Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                </SidebarMenuItem>
              )}

              {/* Sales & Payments */}
              {(isAdmin || hasPermission('sales', 'view')) && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/business/sales"><ShoppingCart className="h-4 w-4" />Sales</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/business/payments"><CreditCard className="h-4 w-4" />Payments</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}

              {/* Expenses & Budgets */}
              {(isAdmin || hasPermission('budgets', 'view')) && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/expenses"><Receipt className="h-4 w-4" />Expenses</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/budgets"><Target className="h-4 w-4" />Budgets</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}

              {/* Reports */}
              {(isAdmin || hasPermission('reports', 'view')) && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link to="/reports"><BarChart3 className="h-4 w-4" />Reports</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Admin-only financial tools */}
              {isAdmin && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/profit-loss"><LineChart className="h-4 w-4" />Profit & Loss</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <Link to="/njc-supplies"><Package className="h-4 w-4" />NJC Supplies</Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}

            </SidebarMenu>
          </SidebarGroup>
        )}

        {/* ── MODULE 2: ADMINISTRATION ── */}
        <SidebarGroup>
          <SidebarGroupLabel>Administration</SidebarGroupLabel>
          <SidebarMenu>

            {/* User Management — admin only */}
            {isAdmin && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/users"><Users className="h-4 w-4" />User Management</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {/* Staff Profiles — admin + HR */}
            {(isAdmin || isHR) && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/staff-profiles"><UserCog className="h-4 w-4" />Staff Profiles</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {/* Payroll — admin only */}
            {isAdmin && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link to="/payroll"><Wallet className="h-4 w-4" />Payroll</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}

            {/* Staff Portal — all role holders */}
            <SidebarMenuItem>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton>
                    <ShieldCheck className="h-4 w-4" />
                    Staff Portal
                    <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild>
                        <Link to="/staff-portal"><CalendarDays className="h-3 w-3" /><span>Leave Requests</span></Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild>
                        <Link to="/staff-portal"><AlertTriangle className="h-3 w-3" /><span>Complaints</span></Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton asChild>
                        <Link to="/staff-portal"><Mail className="h-3 w-3" /><span>Messages</span></Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>

            {/* My Profile — everyone */}
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link to="/my-profile"><UserCog className="h-4 w-4" />My Profile</Link>
              </SidebarMenuButton>
            </SidebarMenuItem>

          </SidebarMenu>
        </SidebarGroup>

      </SidebarContent>
    </Sidebar>
  );
}