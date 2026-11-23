import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { buildItemUnits, type ItemUnits } from '@/lib/units';

// Units for every stock item, keyed by the item (sku) id: its stock unit, its
// pack sizes, the unit it is usually bought in, when its unit last changed and
// the largest single delivery on record.

const db = supabase as any;

export interface ItemUnitInfo extends ItemUnits {
  productId: string;
  /** Latest unit change or opening count; movements before it are "before unit change". */
  resetAt: string | null;
  /** Largest single stock-in since then, in stock units. */
  largestReceipt: number | null;
  hasMovements: boolean;
  // The item master (migration 20261124100000). Unset until then.
  /** raw_ingredient, packaging, cleaning, fuel, finished_good; null = not set. */
  kind: string | null;
  storagePlace: string | null;
  /** The usual supplier (a payee id). */
  payeeId: string | null;
  countedWeekly: boolean;
  /** Made in production (finished or semi-finished): its type is fixed. */
  produced: boolean;
}

interface Raw {
  products: any[];
  changes: { product_id: string; changed_at: string }[];
  receipts: { product_id: string; quantity_change: number; created_at: string }[];
  /** false until migration 20261123200000 is applied. */
  ready: boolean;
  /** false until migration 20261124100000 is applied. */
  masterReady: boolean;
}

export function useItemUnits() {
  const { user } = useAuth();

  const query = useQuery<Raw>({
    queryKey: ['item-units'],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      let ready = true;
      let masterReady = true;
      let res = await db.from('products')
        .select('id, sku_id, uom, purchase_unit, item_class, item_kind, storage_place, default_payee_id, counted_weekly, product_units(unit_name, factor)');
      if (res.error) {
        // Before the item master migration there are no type or storage columns.
        masterReady = false;
        res = await db.from('products').select('id, sku_id, uom, purchase_unit, product_units(unit_name, factor)');
      }
      if (res.error) {
        // Before the units migration there is no purchase_unit column.
        ready = false;
        res = await db.from('products').select('id, sku_id, uom, product_units(unit_name, factor)');
        if (res.error) res = await db.from('products').select('id, sku_id, uom');
      }
      const [changes, receipts] = await Promise.all([
        ready ? db.from('product_unit_changes').select('product_id, changed_at').order('changed_at', { ascending: false }).limit(5000) : { data: [] },
        db.from('inventory_movements').select('product_id, quantity_change, created_at')
          .eq('movement_type', 'purchase').gt('quantity_change', 0).limit(10000),
      ]);
      return {
        products: res.data ?? [],
        changes: (changes as any).data ?? [],
        receipts: (receipts as any).data ?? [],
        ready,
        masterReady,
      };
    },
  });

  const bySku = useMemo(() => {
    const out = new Map<string, ItemUnitInfo>();
    const raw = query.data;
    if (!raw) return out;
    const resetByProduct = new Map<string, string>();
    for (const c of raw.changes) {
      if (!resetByProduct.has(c.product_id)) resetByProduct.set(c.product_id, c.changed_at);
    }
    const largest = new Map<string, number>();
    const moved = new Set<string>();
    for (const r of raw.receipts) {
      moved.add(r.product_id);
      const reset = resetByProduct.get(r.product_id);
      if (reset && r.created_at < reset) continue;
      const q = Number(r.quantity_change);
      if (q > (largest.get(r.product_id) ?? 0)) largest.set(r.product_id, q);
    }
    for (const p of raw.products) {
      if (!p.sku_id || out.has(p.sku_id)) continue;
      out.set(p.sku_id, {
        ...buildItemUnits(p.uom, p.product_units ?? [], p.purchase_unit),
        productId: p.id,
        resetAt: resetByProduct.get(p.id) ?? null,
        largestReceipt: largest.get(p.id) ?? null,
        hasMovements: moved.has(p.id),
        kind: p.item_kind ?? null,
        storagePlace: p.storage_place ?? null,
        payeeId: p.default_payee_id ?? null,
        countedWeekly: p.counted_weekly !== false,
        produced: !!p.item_class && p.item_class !== 'raw_material',
      });
    }
    return out;
  }, [query.data]);

  return {
    bySku,
    ready: query.data?.ready ?? false,
    masterReady: query.data?.masterReady ?? false,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
