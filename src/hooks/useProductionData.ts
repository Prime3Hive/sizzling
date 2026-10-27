import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { unitsFor, type ItemClass, type PackUnit, type RunStatus } from '@/lib/production';

const db = supabase as any;

export interface ProdItem {
  id: string;
  sku_id: string | null;
  name: string;
  uom: string;
  category: string | null;
  item_class: ItemClass;
  lot_code: string | null;
  shelf_life_days: number | null;
  cost: number;
  stock: number;
  units: PackUnit[];
}

export interface Recipe {
  id: string;
  name: string;
  output_product_id: string;
  batch_yield: number;
  yield_unit: string | null;
  yield_factor: number;
  is_active: boolean;
  notes: string | null;
  recipe_lines: { id: string; product_id: string; quantity: number; unit_name: string | null; factor: number; sort_order: number }[];
  recipe_costs: { id: string; description: string; amount: number; sort_order: number }[];
}

export interface Lot {
  id: string;
  lot_number: string;
  product_id: string;
  production_run_id: string | null;
  produced_on: string;
  expires_on: string | null;
  qty_produced: number;
  qty_remaining: number;
  unit_cost: number | null;
  status: 'pending' | 'active' | 'void';
}

export interface Run {
  id: string;
  run_number: string;
  recipe_id: string | null;
  output_product_id: string;
  production_date: string;
  batches: number | null;
  output_qty: number;
  output_unit: string | null;
  output_factor: number;
  warehouse_id: string | null;
  lot_id: string | null;
  status: RunStatus;
  material_cost: number | null;
  other_cost: number | null;
  total_cost: number | null;
  unit_cost: number | null;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  production_run_inputs: {
    id: string; product_id: string; standard_qty: number | null; actual_qty: number;
    unit_name: string | null; factor: number; unit_cost: number | null; line_cost: number | null; sort_order: number;
  }[];
  production_run_costs: { id: string; description: string; amount: number; sort_order: number }[];
}

const num = (v: unknown) => Number(v ?? 0) || 0;

export const PRODUCTION_KEYS = [['production'], ['inbox'], ['inventory-data'], ['inventory-item'], ['products-for-movement']];

export function useProductionData(enabled = true) {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['production'],
    enabled,
    queryFn: async () => {
      const [prodRes, unitRes, recipeRes, runRes, lotRes, whRes, nameRes] = await Promise.all([
        db.from('products')
          .select('id, sku_id, name, uom, category, item_class, lot_code, shelf_life_days, cost_price, inventory(quantity)')
          .order('name'),
        db.from('product_units').select('product_id, unit_name, factor'),
        db.from('recipes')
          .select('*, recipe_lines(id, product_id, quantity, unit_name, factor, sort_order), recipe_costs(id, description, amount, sort_order)')
          .order('name'),
        db.from('production_runs')
          .select('*, production_run_inputs(*), production_run_costs(*)')
          .order('production_date', { ascending: false })
          .order('recorded_at', { ascending: false })
          .limit(300),
        db.from('stock_lots').select('*').neq('status', 'void')
          .order('produced_on', { ascending: false }).limit(500),
        db.from('warehouses').select('id, name').order('created_at'),
        supabase.from('profiles').select('user_id, full_name'),
      ]);
      for (const r of [prodRes, unitRes, recipeRes, runRes, lotRes]) if (r.error) throw r.error;

      const packs = new Map<string, PackUnit[]>();
      for (const u of unitRes.data ?? []) {
        const list = packs.get(u.product_id) ?? [];
        list.push({ name: u.unit_name, factor: num(u.factor) });
        packs.set(u.product_id, list);
      }

      const items: ProdItem[] = (prodRes.data ?? []).map((p: any) => ({
        id: p.id, sku_id: p.sku_id, name: p.name, uom: p.uom || 'unit', category: p.category,
        item_class: (p.item_class ?? 'raw_material') as ItemClass,
        lot_code: p.lot_code, shelf_life_days: p.shelf_life_days,
        cost: num(p.cost_price),
        stock: (p.inventory ?? []).reduce((s: number, r: any) => s + num(r.quantity), 0),
        units: unitsFor(p.uom, packs.get(p.id) ?? []),
      }));

      const sortBy = <T extends { sort_order: number }>(a: T[]) => [...(a ?? [])].sort((x, y) => x.sort_order - y.sort_order);
      const recipes: Recipe[] = (recipeRes.data ?? []).map((r: any) => ({
        ...r,
        batch_yield: num(r.batch_yield), yield_factor: num(r.yield_factor) || 1,
        recipe_lines: sortBy(r.recipe_lines).map((l: any) => ({ ...l, quantity: num(l.quantity), factor: num(l.factor) || 1 })),
        recipe_costs: sortBy(r.recipe_costs).map((c: any) => ({ ...c, amount: num(c.amount) })),
      }));

      const runs: Run[] = (runRes.data ?? []).map((r: any) => ({
        ...r,
        output_qty: num(r.output_qty), output_factor: num(r.output_factor) || 1,
        production_run_inputs: sortBy(r.production_run_inputs).map((i: any) => ({
          ...i, actual_qty: num(i.actual_qty), factor: num(i.factor) || 1,
          standard_qty: i.standard_qty == null ? null : num(i.standard_qty),
        })),
        production_run_costs: sortBy(r.production_run_costs).map((c: any) => ({ ...c, amount: num(c.amount) })),
      }));

      const lots: Lot[] = (lotRes.data ?? []).map((l: any) => ({
        ...l, qty_produced: num(l.qty_produced), qty_remaining: num(l.qty_remaining),
      }));

      return {
        items,
        recipes,
        runs,
        lots,
        warehouses: (whRes.data ?? []) as { id: string; name: string }[],
        names: Object.fromEntries((nameRes.data ?? []).map((p: any) => [p.user_id, p.full_name ?? ''])) as Record<string, string>,
      };
    },
  });

  const data = q.data;
  const itemById = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data?.items]);
  const lotById = useMemo(() => new Map((data?.lots ?? []).map((l) => [l.id, l])), [data?.lots]);

  const refresh = () => { for (const key of PRODUCTION_KEYS) qc.invalidateQueries({ queryKey: key }); };

  return {
    ...q,
    items: data?.items ?? [],
    recipes: data?.recipes ?? [],
    runs: data?.runs ?? [],
    lots: data?.lots ?? [],
    warehouses: data?.warehouses ?? [],
    nameOf: (id: string | null | undefined) => (id && data?.names[id]) || 'Someone',
    itemById,
    lotById,
    refresh,
  };
}
