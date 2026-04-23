import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRoles } from '@/hooks/useRoles';
import { toast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ShoppingCart, Package, ClipboardList, Landmark,
  Receipt, BarChart3, ShieldCheck, Info,
} from 'lucide-react';

// ── Module registry ───────────────────────────────────────────────────────────
// Only modules that can be delegated to departments appear here.
// Admin-only pages (Payroll, P&L, NJC Supplies, User Management) are excluded.

interface ModuleDef {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  /** Permissions that make sense for this module (others are hidden) */
  allowedActions: ('view' | 'create' | 'update' | 'delete')[];
}

const MODULES: ModuleDef[] = [
  {
    key: 'sales',
    label: 'Sales & Payments',
    description: 'Record sales transactions, process payments, view sales history.',
    icon: ShoppingCart,
    allowedActions: ['view', 'create', 'update', 'delete'],
  },
  {
    key: 'inventory',
    label: 'Inventory Management',
    description: 'Manage products, warehouses, SKUs, KPI and analytics dashboards.',
    icon: Package,
    allowedActions: ['view', 'create', 'update', 'delete'],
  },
  {
    key: 'invoices',
    label: 'Invoices & Quotations',
    description: 'Create and manage client invoices, quotations and convert to invoices.',
    icon: ClipboardList,
    allowedActions: ['view', 'create', 'update', 'delete'],
  },
  {
    key: 'finance',
    label: 'Finance Overview',
    description: 'View finance ledger, accounts receivable, revenue and cash reports.',
    icon: Landmark,
    allowedActions: ['view'],
  },
  {
    key: 'budgets',
    label: 'Expenses & Budgets',
    description: 'Record expenses, create and manage budget allocations.',
    icon: Receipt,
    allowedActions: ['view', 'create', 'update', 'delete'],
  },
  {
    key: 'reports',
    label: 'Business Reports',
    description: 'Access operational and financial summary reports.',
    icon: BarChart3,
    allowedActions: ['view'],
  },
];

const ACTION_LABELS: Record<string, string> = {
  view:   'View',
  create: 'Create',
  update: 'Edit',
  delete: 'Delete',
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Department { id: string; name: string; description?: string }

interface ModulePerms {
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
}

// map[dept_id][module_key] = ModulePerms
type PermMap = Record<string, Record<string, ModulePerms>>;

const DEFAULT_PERMS: ModulePerms = {
  can_view: false, can_create: false, can_update: false, can_delete: false,
};

const ACTION_TO_FIELD: Record<string, keyof ModulePerms> = {
  view: 'can_view', create: 'can_create', update: 'can_update', delete: 'can_delete',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function DepartmentPermissions() {
  const { isAdmin } = useRoles();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [permMap, setPermMap] = useState<PermMap>({});
  const [loading, setLoading] = useState(true);
  // tracks which cells are mid-save: "deptId:moduleKey:action"
  const [saving, setSaving] = useState<Set<string>>(new Set());

  // ── Load data ──────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [deptRes, permRes] = await Promise.all([
        supabase.from('departments').select('id, name, description').order('name'),
        supabase.from('department_permissions').select('*'),
      ]);

      if (deptRes.error) { toast({ title: 'Failed to load departments', variant: 'destructive' }); return; }
      if (permRes.error) { toast({ title: 'Failed to load permissions', variant: 'destructive' }); return; }

      const depts = (deptRes.data || []) as Department[];
      setDepartments(depts);

      // Build map from flat rows
      const map: PermMap = {};
      for (const dept of depts) map[dept.id] = {};
      for (const row of (permRes.data || [])) {
        if (!map[row.department_id]) map[row.department_id] = {};
        map[row.department_id][row.module_name] = {
          can_view:   row.can_view,
          can_create: row.can_create,
          can_update: row.can_update,
          can_delete: row.can_delete,
        };
      }
      setPermMap(map);
      setLoading(false);
    };
    load();
  }, []);

  // ── Toggle handler ─────────────────────────────────────────
  const handleToggle = useCallback(async (
    deptId: string,
    moduleKey: string,
    action: 'view' | 'create' | 'update' | 'delete',
    newValue: boolean,
  ) => {
    const field = ACTION_TO_FIELD[action];
    const prev = permMap[deptId]?.[moduleKey] ?? DEFAULT_PERMS;

    // Build the new perms with cascade logic:
    // Turning View OFF → clear everything
    // Turning any write ON → ensure View is also ON
    let next: ModulePerms = { ...prev, [field]: newValue };
    if (action === 'view' && !newValue) {
      next = { can_view: false, can_create: false, can_update: false, can_delete: false };
    } else if (action !== 'view' && newValue) {
      next.can_view = true;
    }

    // Optimistic update
    setPermMap(m => ({
      ...m,
      [deptId]: { ...m[deptId], [moduleKey]: next },
    }));

    const saveKey = `${deptId}:${moduleKey}`;
    setSaving(s => new Set(s).add(saveKey));

    const { error } = await supabase
      .from('department_permissions')
      .upsert(
        {
          department_id: deptId,
          module_name:   moduleKey,
          can_view:      next.can_view,
          can_create:    next.can_create,
          can_update:    next.can_update,
          can_delete:    next.can_delete,
        },
        { onConflict: 'department_id,module_name' },
      );

    setSaving(s => { const n = new Set(s); n.delete(saveKey); return n; });

    if (error) {
      // Rollback
      setPermMap(m => ({
        ...m,
        [deptId]: { ...m[deptId], [moduleKey]: prev },
      }));
      toast({ title: 'Failed to save permission', description: error.message, variant: 'destructive' });
    }
  }, [permMap]);

  if (!isAdmin) return null;

  // ── Loading skeleton ───────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start gap-3">
        <div className="p-2 bg-primary/10 rounded-lg mt-0.5">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Department Permissions</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Control which modules each department can access. Changes save instantly and apply to new logins.
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex gap-2 items-start rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          <strong>Admin</strong> always has access to every module regardless of these settings.
          All other roles — including HR, Manager, and Employee — only access modules enabled for their department.
          Active sessions pick up permission changes within 30 minutes.
        </span>
      </div>

      {/* Department tabs */}
      <Tabs defaultValue={departments[0]?.id}>
        <TabsList className="h-auto flex-wrap gap-1">
          {departments.map(dept => (
            <TabsTrigger key={dept.id} value={dept.id} className="text-sm">
              {dept.name}
            </TabsTrigger>
          ))}
        </TabsList>

        {departments.map(dept => (
          <TabsContent key={dept.id} value={dept.id} className="mt-4">
            <PermissionGrid
              dept={dept}
              perms={permMap[dept.id] ?? {}}
              saving={saving}
              onToggle={handleToggle}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// ── PermissionGrid ─────────────────────────────────────────────────────────────

function PermissionGrid({
  dept,
  perms,
  saving,
  onToggle,
}: {
  dept: Department;
  perms: Record<string, ModulePerms>;
  saving: Set<string>;
  onToggle: (deptId: string, module: string, action: 'view' | 'create' | 'update' | 'delete', value: boolean) => void;
}) {
  const activeCount = MODULES.filter(m => perms[m.key]?.can_view).length;

  return (
    <div className="space-y-4">
      {/* Dept summary */}
      <div className="flex items-center gap-3">
        <div>
          <span className="font-semibold text-base">{dept.name}</span>
          {dept.description && (
            <span className="text-muted-foreground text-sm ml-2">— {dept.description}</span>
          )}
        </div>
        <Badge variant="outline" className="ml-auto text-xs">
          {activeCount} / {MODULES.length} modules active
        </Badge>
      </div>

      {/* Permission table */}
      <Card>
        <CardContent className="p-0">
          {/* Header row */}
          <div className="grid grid-cols-[1fr_repeat(4,80px)] gap-0 px-5 py-3 border-b bg-muted/40 rounded-t-lg">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Module</span>
            {(['view', 'create', 'update', 'delete'] as const).map(a => (
              <span key={a} className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-center">
                {ACTION_LABELS[a]}
              </span>
            ))}
          </div>

          {/* Module rows */}
          {MODULES.map((mod, idx) => {
            const mp = perms[mod.key] ?? DEFAULT_PERMS;
            const isSaving = saving.has(`${dept.id}:${mod.key}`);
            const Icon = mod.icon;
            const isLast = idx === MODULES.length - 1;

            return (
              <div
                key={mod.key}
                className={`grid grid-cols-[1fr_repeat(4,80px)] gap-0 items-center px-5 py-4 ${!isLast ? 'border-b' : ''} hover:bg-muted/20 transition-colors`}
              >
                {/* Module info */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-1.5 rounded-md shrink-0 ${mp.can_view ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-none">{mod.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{mod.description}</p>
                  </div>
                  {isSaving && (
                    <span className="text-xs text-muted-foreground italic shrink-0">saving…</span>
                  )}
                </div>

                {/* Permission toggles */}
                {(['view', 'create', 'update', 'delete'] as const).map(action => {
                  const isAllowed = mod.allowedActions.includes(action);
                  const fieldMap: Record<string, boolean> = {
                    view:   mp.can_view,
                    create: mp.can_create,
                    update: mp.can_update,
                    delete: mp.can_delete,
                  };
                  const checked = fieldMap[action];

                  return (
                    <div key={action} className="flex justify-center">
                      {isAllowed ? (
                        <Switch
                          checked={checked}
                          disabled={isSaving}
                          onCheckedChange={val => onToggle(dept.id, mod.key, action, val)}
                          aria-label={`${ACTION_LABELS[action]} ${mod.label}`}
                          className={checked ? '' : 'opacity-50'}
                        />
                      ) : (
                        <span className="text-muted-foreground/30 text-lg select-none">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
