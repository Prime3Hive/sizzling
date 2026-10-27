import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { formatNairaCompact } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { batchCost, fmtQty, isProduced, packCosts, toBase } from '@/lib/production';
import type { ProdItem, Recipe } from '@/hooks/useProductionData';
import UnitSelect from './UnitSelect';

const db = supabase as any;

interface LineRow { key: number; product_id: string; quantity: string; unit_name: string; factor: number }
interface CostRow { key: number; description: string; amount: string }

let seq = 0;
const nextKey = () => ++seq;

export default function RecipeSheet({ recipe, items, open, onOpenChange, onSaved }: {
  /** null = a new recipe. */
  recipe: Recipe | null;
  items: ProdItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [name, setName] = useState('');
  const [outputId, setOutputId] = useState('');
  const [yieldQty, setYieldQty] = useState('');
  const [yieldUnit, setYieldUnit] = useState({ name: '', factor: 1 });
  const [lines, setLines] = useState<LineRow[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  useEffect(() => {
    if (!open) return;
    if (recipe) {
      const out = itemById.get(recipe.output_product_id);
      setName(recipe.name);
      setOutputId(recipe.output_product_id);
      setYieldUnit({ name: recipe.yield_unit || out?.uom || 'unit', factor: recipe.yield_factor });
      setYieldQty(String(recipe.batch_yield / recipe.yield_factor));
      setLines(recipe.recipe_lines.map((l) => ({
        key: nextKey(), product_id: l.product_id, quantity: String(l.quantity),
        unit_name: l.unit_name || itemById.get(l.product_id)?.uom || 'unit', factor: l.factor,
      })));
      setCosts(recipe.recipe_costs.map((c) => ({ key: nextKey(), description: c.description, amount: String(c.amount) })));
      setNotes(recipe.notes ?? '');
      setActive(recipe.is_active);
    } else {
      setName(''); setOutputId(''); setYieldQty(''); setYieldUnit({ name: '', factor: 1 });
      setLines([{ key: nextKey(), product_id: '', quantity: '', unit_name: '', factor: 1 }]);
      setCosts([]); setNotes(''); setActive(true);
    }
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recipe]);

  const output = itemById.get(outputId);
  const outputOptions = useMemo<SelectOption[]>(() => items
    .filter((i) => isProduced(i.item_class))
    .map((i) => ({ value: i.id, label: i.name, hint: `${i.uom}${i.item_class === 'semi_finished' ? ' · semi-finished' : ''}` })), [items]);
  const inputOptions = useMemo<SelectOption[]>(() => items
    .filter((i) => i.id !== outputId)
    .map((i) => ({ value: i.id, label: i.name, hint: `${fmtQty(i.stock)} ${i.uom} · ${formatNairaCompact(i.cost)}/${i.uom}` })), [items, outputId]);

  const yieldBase = toBase(Number(yieldQty) || 0, yieldUnit.factor);
  const cost = batchCost(
    lines.map((l) => ({ actual: toBase(Number(l.quantity) || 0, l.factor), unitCost: itemById.get(l.product_id)?.cost ?? 0 })),
    costs.map((c) => Number(c.amount) || 0),
    yieldBase,
  );

  const save = async () => {
    if (!name.trim()) { toast({ title: 'Give the recipe a name', variant: 'destructive' }); return; }
    if (!output) { toast({ title: 'Choose what this recipe makes', variant: 'destructive' }); return; }
    if (!(yieldBase > 0)) { toast({ title: 'Enter what one batch yields', variant: 'destructive' }); return; }
    const goodLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0);
    if (goodLines.length === 0) { toast({ title: 'Add at least one ingredient with a quantity', variant: 'destructive' }); return; }
    if (new Set(goodLines.map((l) => l.product_id)).size !== goodLines.length) {
      toast({ title: 'Each ingredient should appear once', variant: 'destructive' }); return;
    }

    setSaving(true);
    try {
      const header = {
        name: name.trim(), output_product_id: output.id, batch_yield: yieldBase,
        yield_unit: yieldUnit.name || output.uom, yield_factor: yieldUnit.factor,
        is_active: active, notes: notes.trim() || null, updated_at: new Date().toISOString(),
      };
      let id = recipe?.id;
      if (id) {
        const { error } = await db.from('recipes').update(header).eq('id', id);
        if (error) throw error;
        // Lines are the recipe's current standard; runs keep their own copy.
        for (const t of ['recipe_lines', 'recipe_costs']) {
          const { error: e } = await db.from(t).delete().eq('recipe_id', id);
          if (e) throw e;
        }
      } else {
        const { data, error } = await db.from('recipes').insert({ ...header, created_by: user?.id }).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      const { error: lErr } = await db.from('recipe_lines').insert(goodLines.map((l, i) => ({
        recipe_id: id, product_id: l.product_id, quantity: Number(l.quantity),
        unit_name: l.unit_name || itemById.get(l.product_id)?.uom, factor: l.factor, sort_order: i + 1,
      })));
      if (lErr) throw lErr;
      const goodCosts = costs.filter((c) => c.description.trim() && Number(c.amount) >= 0 && c.amount !== '');
      if (goodCosts.length > 0) {
        const { error: cErr } = await db.from('recipe_costs').insert(goodCosts.map((c, i) => ({
          recipe_id: id, description: c.description.trim(), amount: Number(c.amount), sort_order: i + 1,
        })));
        if (cErr) throw cErr;
      }
      toast({ title: recipe ? 'Recipe updated' : 'Recipe created' });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Could not save the recipe', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      size="wide"
      title={recipe ? `Edit ${recipe.name}` : 'New recipe'}
      description="The standard ingredients and production expenses for one batch."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Batch cost </span>
            <span className="font-bold tabular-nums">{formatNairaCompact(cost.total)}</span>
            {output && yieldBase > 0 && (
              <span className="text-muted-foreground"> · {formatNairaCompact(cost.perUnit)}/{output.uom}</span>
            )}
          </div>
          <div className="flex w-full gap-2.5 sm:w-auto">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-[2] sm:flex-none" onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save recipe
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="recipe-name" label="Recipe name" required>
            <Input id="recipe-name" value={name} placeholder="e.g. Chin-chin, standard batch"
              onChange={(e) => { setName(e.target.value); touch(); }} />
          </Field>
          <Field id="recipe-output" label="Makes" required
            hint={outputOptions.length === 0 ? 'No finished goods yet. Set an item up as a finished good on the Items tab first.' : undefined}>
            <SearchableSelect id="recipe-output" options={outputOptions} value={outputId} title="What this recipe makes"
              placeholder="Choose a finished good…"
              onChange={(v) => {
                setOutputId(v);
                const o = itemById.get(v);
                setYieldUnit({ name: o?.uom ?? 'unit', factor: 1 });
                touch();
              }} />
          </Field>
        </div>

        <Field id="recipe-yield" label="One batch yields" required>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="recipe-yield" type="number" inputMode="decimal" min="0" step="any" className="w-28 sm:w-36"
              value={yieldQty} onChange={(e) => { setYieldQty(e.target.value); touch(); }} />
            {output && (
              <UnitSelect units={output.units} value={yieldUnit.name || output.uom} label="Yield unit" className="min-w-0 flex-1 sm:w-48 sm:flex-none"
                onChange={(u) => { setYieldUnit(u); touch(); }} />
            )}
            {output && yieldUnit.factor !== 1 && yieldBase > 0 && (
              <span className="w-full text-sm text-muted-foreground sm:w-auto">= {fmtQty(yieldBase)} {output.uom}</span>
            )}
          </div>
        </Field>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Ingredients per batch</h3>
          {lines.map((l, i) => {
            const it = itemById.get(l.product_id);
            const lineCost = it ? toBase(Number(l.quantity) || 0, l.factor) * it.cost : 0;
            return (
              // Phone: ingredient and remove, then quantity and unit, then cost. Wider: one row.
              <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-2 rounded-xl border p-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_11rem_6.5rem_2.75rem] sm:border-0 sm:p-0">
                <SearchableSelect options={inputOptions} value={l.product_id} title="Choose an ingredient"
                  placeholder="Ingredient…" className="order-1 col-span-2 min-w-0 sm:order-none sm:col-span-1"
                  onChange={(v) => {
                    const n = itemById.get(v);
                    setLines(lines.map((x, j) => (j === i ? { ...x, product_id: v, unit_name: n?.uom ?? 'unit', factor: 1 } : x)));
                    touch();
                  }} />
                <Input aria-label="Quantity per batch" type="number" inputMode="decimal" min="0" step="any" placeholder="Qty"
                  className="order-3 min-w-0 sm:order-none" value={l.quantity}
                  onChange={(e) => { setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x))); touch(); }} />
                {it ? (
                  <UnitSelect units={it.units} value={l.unit_name || it.uom} label="Unit"
                    className="order-4 col-span-2 min-w-0 sm:order-none sm:col-span-1"
                    onChange={(u) => { setLines(lines.map((x, j) => (j === i ? { ...x, unit_name: u.name, factor: u.factor } : x))); touch(); }} />
                ) : <span className="order-4 col-span-2 sm:order-none sm:col-span-1" />}
                <span className={cn('order-5 col-span-3 text-xs tabular-nums text-muted-foreground sm:order-none sm:col-span-1 sm:text-right sm:text-sm', !(lineCost > 0) && 'max-sm:hidden')}>{lineCost > 0 ? formatNairaCompact(lineCost) : ''}</span>
                <Button type="button" variant="ghost" size="icon" aria-label="Remove ingredient" className="order-2 h-11 w-11 justify-self-end sm:order-none"
                  onClick={() => { setLines(lines.filter((_, j) => j !== i)); touch(); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm"
            onClick={() => { setLines([...lines, { key: nextKey(), product_id: '', quantity: '', unit_name: '', factor: 1 }]); touch(); }}>
            <Plus className="mr-1.5 h-4 w-4" />Add ingredient
          </Button>
        </section>

        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">Production expenses per batch</h3>
            <p className="text-xs text-muted-foreground">Gas, diesel, power and other running costs (not salaries). They become part of each unit's cost.</p>
          </div>
          {costs.map((c, i) => (
            <div key={c.key} className="flex items-center gap-2">
              <Input aria-label="Expense" placeholder="e.g. Cooking gas" className="min-w-0 flex-1" value={c.description}
                onChange={(e) => { setCosts(costs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x))); touch(); }} />
              <Input aria-label="Amount per batch" type="number" inputMode="decimal" min="0" step="any" placeholder="₦" className="w-28 shrink-0 sm:w-32"
                value={c.amount}
                onChange={(e) => { setCosts(costs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x))); touch(); }} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove expense" className="h-11 w-11 shrink-0"
                onClick={() => { setCosts(costs.filter((_, j) => j !== i)); touch(); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm"
            onClick={() => { setCosts([...costs, { key: nextKey(), description: '', amount: '' }]); touch(); }}>
            <Plus className="mr-1.5 h-4 w-4" />Add expense
          </Button>
        </section>

        {output && yieldBase > 0 && cost.total > 0 && (
          <div className="rounded-xl bg-muted/60 p-4 text-sm">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">Standard cost at today's prices</div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span>Materials <b className="tabular-nums">{formatNairaCompact(cost.material)}</b></span>
              <span>Expenses <b className="tabular-nums">{formatNairaCompact(cost.other)}</b></span>
              {packCosts(cost.perUnit, output.units).map((p) => (
                <span key={p.name}><b className="tabular-nums">{formatNairaCompact(p.cost)}</b> / {p.name}</span>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field id="recipe-notes" label="Method / notes">
            <Textarea id="recipe-notes" rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={active} onCheckedChange={(v) => { setActive(v); touch(); }} />
            In use
          </label>
        </div>
      </div>
    </FormSheet>
  );
}
