import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ClipboardList, Package, PackageCheck, Truck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useRoles } from '@/hooks/useRoles';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, PageHeader } from '@/components/shell/ui';
import { cn } from '@/lib/utils';

const db = supabase as any;

function HubCard({ to, icon: Icon, title, sub, stat, tone }: {
  to: string; icon: React.ElementType; title: string; sub: string; stat?: string | null;
  tone: string;
}) {
  return (
    <Link to={to} className="flex flex-col gap-3.5 rounded-2xl border bg-card p-5 transition-all hover:border-orange-300 hover:shadow-card-hover">
      <span className={cn('inline-flex h-11 w-11 items-center justify-center rounded-xl', tone)}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-base font-bold">{title}</span>
        <span className="text-[13px] leading-relaxed text-muted-foreground">{sub}</span>
      </span>
      {stat && <span className="text-[13px] font-bold text-brand-soft-foreground">{stat}</span>}
    </Link>
  );
}

export default function Operations() {
  const { user } = useAuth();
  const { isAdmin, isManager, hasPermission, canFeature } = useRoles();
  const canInventory = hasPermission('inventory', 'view');
  const canProcure = isAdmin || isManager;
  const canManageRequests = isAdmin || isManager;

  const { data: lowStock = [], isLoading: stockLoading } = useQuery({
    queryKey: ['ops-low-stock'],
    queryFn: async () => {
      const { data } = await db
        .from('skus')
        .select('id, name, stock_quantity, reorder_level, unit_of_measure, category')
        .gt('reorder_level', 0)
        .eq('is_archived', false);
      return (data ?? [])
        .filter((s: any) => Number(s.stock_quantity) <= Number(s.reorder_level))
        .sort((a: any, b: any) => Number(a.stock_quantity) / Number(a.reorder_level) - Number(b.stock_quantity) / Number(b.reorder_level));
    },
    enabled: canInventory,
  });

  const { data: pendingRequests = 0 } = useQuery({
    queryKey: ['ops-pending-requests', canManageRequests ? 'all' : user?.id],
    queryFn: async () => {
      let q = supabase.from('inventory_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (!canManageRequests) q = q.eq('user_id', user!.id);
      const { count } = await q;
      return count ?? 0;
    },
    enabled: !!user,
  });

  const { data: openLpos = 0 } = useQuery({
    queryKey: ['ops-open-lpos'],
    queryFn: async () => {
      const { count } = await db.from('lpos').select('id', { count: 'exact', head: true })
        .in('status', ['draft', 'sent', 'partially_received']);
      return count ?? 0;
    },
    enabled: canProcure,
  });

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Operations" description="Stock, purchasing and supply, from request to delivery." />

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        {canInventory && (
          <HubCard to="/business/inventory" icon={Package} title="Inventory" sub="Stock levels, movements and counts"
            tone="bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300"
            stat={stockLoading ? null : lowStock.length ? `${plural(lowStock.length, 'item')} low` : 'Nothing low'} />
        )}
        <HubCard to="/business/inventory-requests" icon={ClipboardList} title="Stock requests"
          sub={canManageRequests ? 'Requests from departments' : 'Ask the store for what you need'}
          tone="bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300"
          stat={pendingRequests ? `${plural(pendingRequests, 'request')} pending` : 'None pending'} />
        {canProcure && (
          <HubCard to="/procurement" icon={Truck} title="Procurement" sub="Purchase orders and suppliers"
            tone="bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300"
            stat={openLpos ? `${plural(openLpos, 'purchase order')} open` : 'No open orders'} />
        )}
        {canInventory && (
          <HubCard to="/business/analytics" icon={BarChart3} title="Analytics" sub="Stock value and movement trends"
            tone="bg-stone-200 text-stone-700 dark:bg-stone-500/15 dark:text-stone-300" />
        )}
        {canFeature('njc_supplies') && (
          <HubCard to="/njc-supplies" icon={PackageCheck} title="NJC Supplies" sub="Supply records and deliveries"
            tone="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" />
        )}
      </div>

      {canInventory && (
        <section className="overflow-hidden rounded-2xl border bg-card">
          <div className="flex items-center justify-between gap-3 p-5">
            <h2 className="text-base font-bold">Below reorder level</h2>
            <Button asChild variant="outline" size="sm"><Link to="/business/inventory">All stock</Link></Button>
          </div>
          {stockLoading ? (
            <div className="space-y-2 px-5 pb-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : lowStock.length === 0 ? (
            <EmptyState icon={Package} title="Stock levels are healthy" body="Nothing is at or below its reorder level." className="pt-2" />
          ) : (
            <>
              <div className="hidden h-11 grid-cols-[minmax(0,2fr)_1fr_1fr_150px] items-center gap-4 border-t px-5 text-xs font-bold uppercase tracking-[0.04em] text-muted-foreground md:grid">
                <span>Item</span><span>In stock</span><span>Reorder at</span><span />
              </div>
              <ul>
                {lowStock.slice(0, 12).map((s: any) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-3 text-sm md:grid md:h-16 md:grid-cols-[minmax(0,2fr)_1fr_1fr_150px] md:py-0">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-bold">{s.name}</span>
                      <span className="text-[12.5px] text-muted-foreground">{s.category}</span>
                    </span>
                    <span className="font-bold tabular-nums text-red-700 dark:text-red-400">
                      {Number(s.stock_quantity)} {s.unit_of_measure}<span className="font-normal text-muted-foreground md:hidden"> of {Number(s.reorder_level)}</span>
                    </span>
                    <span className="hidden tabular-nums text-muted-foreground md:block">{Number(s.reorder_level)} {s.unit_of_measure}</span>
                    <Button asChild variant="outline" size="sm" className="ml-auto md:ml-0">
                      <Link to={canProcure ? '/procurement' : '/business/inventory-requests'}>{canProcure ? 'Raise PO' : 'Request stock'}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
