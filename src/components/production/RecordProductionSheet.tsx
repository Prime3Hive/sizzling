import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { formatNairaCompact } from '@/lib/currency';
import { cn } from '@/lib/utils';
import {
  VARIANCE_FLAG_PCT, batchCost, fmtQty, fromBase, isProduced, packCosts, round4, scaleRecipe, submitProductionRun,
  toBase, variance,
} from '@/lib/production';
import type { ProdItem, Recipe } from '@/hooks/useProductionData';
import UnitSelect from './UnitSelect';

interface InputRow {
  key: number;
  product_id: string;
  unit_name: string;
  factor: number;
  /** Recipe standard in base units; null for an extra line. */
  standardBase: number | null;
  /** What was used, in unit_name. */
  actual: string;
  /** Typed over, so a change of batches no longer resets it. */
  edited: boolean;
}
interface CostRow { key: number; description: string; amount: string; edited: boolean }

let seq = 0;
const nextKey = () => ++seq;
const today = () => new Date().toISOString().slice(0, 10);
const WAREHOUSE_AUTO = '__auto';

export default function RecordProductionSheet({ open, onOpenChange, items, recipes, warehouses, onSaved, initialRecipeId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ProdItem[];
  recipes: Recipe[];
  warehouses: { id: string; name: string }[];
  onSaved: (runId: string) => void;
  initialRecipeId?: string | null;
}) {
  const { toast } = useToast();
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [recipeId, setRecipeId] = useState('');
  const [outputId, setOutputId] = useState('');
  const [date, setDate] = useState(today());
  const [batches, setBatches] = useState('1');
  const [outQty, setOutQty] = useState('');
  const [outUnit, setOutUnit] = useState({ name: '', factor: 1 });
  const [outEdited, setOutEdited] = useState(false);
  const [warehouse, setWarehouse] = useState(WAREHOUSE_AUTO);
  const [rows, setRows] = useState<InputRow[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  const recipe = recipes.find((r) => r.id === recipeId) ?? null;
  const output = itemById.get(outputId);

  // Fill (or refill) from a recipe for a number of batches. Lines the person
  // has typed over keep their figure; the standard always follows the recipe.
  const applyRecipe = (r: Recipe | null, b: number, keepEdits: boolean) => {
    if (!r) return;
    const out = itemById.get(r.output_product_id);
    setOutputId(r.output_product_id);
    if (!keepEdits || !outEdited) {
      const unit = { name: r.yield_unit || out?.uom || 'unit', factor: r.yield_factor };
      setOutUnit(unit);
      setOutQty(String(round4((r.batch_yield * b) / unit.factor)));
    }
    const scaled = scaleRecipe(r.recipe_lines, b);
    setRows((prev) => {
      const fromRecipe = scaled.map((s) => {
        const old = keepEdits ? prev.find((p) => p.product_id === s.product_id && p.standardBase !== null) : undefined;
        const unit = old ? { name: old.unit_name, factor: old.factor } : { name: s.unit_name || itemById.get(s.product_id)?.uom || 'unit', factor: s.factor };
        return {
          key: old?.key ?? nextKey(), product_id: s.product_id, unit_name: unit.name, factor: unit.factor,
          standardBase: s.standard,
          actual: old?.edited ? old.actual : String(fromBase(s.standard, unit.factor)),
          edited: old?.edited ?? false,
        };
      });
      const extras = keepEdits ? prev.filter((p) => p.standardBase === null) : [];
      return [...fromRecipe, ...extras];
    });
    setCosts((prev) => {
      const edited = keepEdits ? prev.filter((c) => c.edited) : [];
      const fromRecipe = r.recipe_costs
        .filter((c) => !edited.some((e) => e.description === c.description))
        .map((c) => ({ key: nextKey(), description: c.description, amount: String(Math.round(c.amount * b * 100) / 100), edited: false }));
      return [...fromRecipe, ...edited];
    });
  };

  useEffect(() => {
    if (!open) return;
    setDate(today()); setBatches('1'); setOutEdited(false); setWarehouse(WAREHOUSE_AUTO); setNotes('');
    const r = recipes.find((x) => x.id === initialRecipeId) ?? null;
    if (r) {
      setRecipeId(r.id);
      applyRecipe(r, 1, false);
    } else {
      setRecipeId(''); setOutputId(''); setOutQty(''); setOutUnit({ name: '', factor: 1 });
      setRows([{ key: nextKey(), product_id: '', unit_name: '', factor: 1, standardBase: null, actual: '', edited: false }]);
      setCosts([]);
    }
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialRecipeId]);

  const recipeOptions = useMemo<SelectOption[]>(() => recipes
    .filter((r) => r.is_active)
    .map((r) => {
      const o = itemById.get(r.output_product_id);
      return { value: r.id, label: r.name, hint: o ? `makes ${fmtQty(r.batch_yield / r.yield_factor)} ${r.yield_unit || o.uom} of ${o.name}` : undefined };
    }), [recipes, itemById]);
  const outputOptions = useMemo<SelectOption[]>(() => items
    .filter((i) => isProduced(i.item_class))
    .map((i) => ({ value: i.id, label: i.name, hint: `${fmtQty(i.stock)} ${i.uom} in stock` })), [items]);
  const inputOptions = useMemo<SelectOption[]>(() => items
    .filter((i) => i.id !== outputId)
    .map((i) => ({ value: i.id, label: i.name, hint: `${fmtQty(i.stock)} ${i.uom} on hand` })), [items, outputId]);

  const outBase = toBase(Number(outQty) || 0, outUnit.factor || 1);
  const est = batchCost(
    rows.map((r) => ({ actual: toBase(Number(r.actual) || 0, r.factor), unitCost: itemById.get(r.product_id)?.cost ?? 0 })),
    costs.map((c) => Number(c.amount) || 0),
    outBase,
  );
  const shortages = rows
    .map((r) => ({ r, it: itemById.get(r.product_id), need: toBase(Number(r.actual) || 0, r.factor) }))
    .filter((x) => x.it && x.need > x.it.stock);

  const submit = async () => {
    if (!output) { toast({ title: 'Choose what was produced', variant: 'destructive' }); return; }
    if (!(outBase > 0)) { toast({ title: 'Enter how much was produced', variant: 'destructive' }); return; }
    const used = rows.filter((r) => r.product_id && Number(r.actual) > 0);
    if (used.length === 0) { toast({ title: 'Enter the raw materials used', variant: 'destructive' }); return; }
    if (date > today()) { toast({ title: 'Production can’t be dated in the future', variant: 'destructive' }); return; }

    setSaving(true);
    try {
      const id = await submitProductionRun({
        recipe_id: recipe?.id ?? null,
        output_product_id: output.id,
        production_date: date,
        batches: recipe ? Number(batches) || null : null,
        output_qty: outBase,
        output_unit: outUnit.name || output.uom,
        output_factor: outUnit.factor || 1,
        warehouse_id: warehouse === WAREHOUSE_AUTO ? null : warehouse,
        notes: notes.trim() || null,
        inputs: rows.filter((r) => r.product_id).map((r) => ({
          product_id: r.product_id,
          standard_qty: r.standardBase,
          actual_qty: toBase(Number(r.actual) || 0, r.factor),
          unit_name: r.unit_name,
          factor: r.factor,
        })),
        costs: costs
          .filter((c) => Number(c.amount) > 0)
          .map((c) => ({ description: c.description.trim() || 'Production expense', amount: Number(c.amount) })),
      });
      toast({ title: 'Production recorded', description: 'It has gone for approval. Stock moves once it is approved.' });
      onSaved(id);
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Could not record production', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const setRow = (i: number, patch: Partial<InputRow>) => { setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x))); touch(); };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      size="wide"
      title="Record production"
      description="What was made and what went into it. It goes to an approver before stock moves."
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <span className="text-muted-foreground">Estimated </span>
            <b className="tabular-nums">{formatNairaCompact(est.total)}</b>
            {output && outBase > 0 && est.total > 0 && (
              <span className="text-muted-foreground">
                {' · '}{formatNairaCompact(est.perUnit)}/{output.uom}
                {/* Every pack size is spelled out in the body; the bar keeps to one line on a phone. */}
                <span className="hidden sm:inline">
                  {packCosts(est.perUnit, output.units).slice(1).map((p) => ` · ${formatNairaCompact(p.cost)}/${p.name}`).join('')}
                </span>
              </span>
            )}
          </div>
          <div className="flex w-full gap-2.5 sm:w-auto">
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-[2] sm:flex-none" onClick={submit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send for approval
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="prod-recipe" label="Recipe" hint={recipeOptions.length === 0 ? 'No recipes yet. You can still record by listing the materials yourself.' : undefined}>
            <SearchableSelect id="prod-recipe" options={recipeOptions} value={recipeId} title="Choose a recipe"
              placeholder="Choose a recipe…" emptyOptionLabel="No recipe — list materials myself"
              onChange={(v) => {
                setRecipeId(v);
                const r = recipes.find((x) => x.id === v) ?? null;
                if (r) { setOutEdited(false); applyRecipe(r, Number(batches) || 1, false); }
                touch();
              }} />
          </Field>
          {recipe ? (
            <Field id="prod-batches" label="Batches" required>
              <Input id="prod-batches" type="number" inputMode="decimal" min="0" step="any" value={batches}
                onChange={(e) => {
                  setBatches(e.target.value);
                  const b = Number(e.target.value);
                  if (b > 0) applyRecipe(recipe, b, true);
                  touch();
                }} />
            </Field>
          ) : (
            <Field id="prod-output" label="What was produced" required
              hint={outputOptions.length === 0 ? 'Set an item up as a finished good on the Items tab first.' : undefined}>
              <SearchableSelect id="prod-output" options={outputOptions} value={outputId} title="What was produced"
                placeholder="Choose a finished good…"
                onChange={(v) => { setOutputId(v); setOutUnit({ name: itemById.get(v)?.uom ?? 'unit', factor: 1 }); touch(); }} />
            </Field>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
          <Field id="prod-qty" label={output ? `${output.name} produced` : 'Quantity produced'} required
            className="sm:col-span-2 lg:col-span-1"
            hint={output && outUnit.factor !== 1 && outBase > 0 ? `= ${fmtQty(outBase)} ${output.uom}` : undefined}>
            <div className="flex gap-2">
              <Input id="prod-qty" type="number" inputMode="decimal" min="0" step="any" value={outQty} className="min-w-0 flex-1"
                onChange={(e) => { setOutQty(e.target.value); setOutEdited(true); touch(); }} />
              {output && (
                <UnitSelect units={output.units} value={outUnit.name || output.uom} label="Unit produced" className="w-36 shrink-0 sm:w-44"
                  onChange={(u) => {
                    setOutQty(String(fromBase(outBase, u.factor)));
                    setOutUnit(u); touch();
                  }} />
              )}
            </div>
          </Field>
          <Field id="prod-date" label="Production date" required>
            <Input id="prod-date" type="date" max={today()} value={date} onChange={(e) => { setDate(e.target.value); touch(); }} />
          </Field>
          <Field id="prod-wh" label="Store in">
            <Select value={warehouse} onValueChange={(v) => { setWarehouse(v); touch(); }}>
              <SelectTrigger id="prod-wh"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={WAREHOUSE_AUTO}>Where it is usually kept</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">Raw materials used</h3>
            <p className="text-xs text-muted-foreground">
              {recipe ? 'Filled from the recipe. Change any line to what was actually used.' : 'List every material that went into this batch.'}
            </p>
          </div>
          {rows.map((r, i) => {
            const it = itemById.get(r.product_id);
            const actualBase = toBase(Number(r.actual) || 0, r.factor);
            const v = r.standardBase !== null ? variance(r.standardBase, actualBase) : null;
            const flagged = v?.pct != null && Math.abs(v.pct) > VARIANCE_FLAG_PCT;
            const short = it && actualBase > it.stock;
            return (
              <div key={r.key} className="rounded-xl border p-2.5">
                {/* Phone: name and remove on one line, quantity and unit under
                    it. Wider: one row. */}
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_11rem_2.75rem]">
                  {r.standardBase !== null && it ? (
                    <div className="order-1 col-span-2 min-w-0 sm:order-none sm:col-span-1">
                      <div className="truncate text-sm font-semibold">{it.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Recipe: {fmtQty(fromBase(r.standardBase, r.factor))} {r.unit_name}
                      </div>
                    </div>
                  ) : (
                    <SearchableSelect options={inputOptions} value={r.product_id} title="Choose a material"
                      placeholder="Material…" className="order-1 col-span-2 sm:order-none sm:col-span-1"
                      onChange={(val) => setRow(i, { product_id: val, unit_name: itemById.get(val)?.uom ?? 'unit', factor: 1 })} />
                  )}
                  <Input aria-label={`${it?.name ?? 'Material'} used`} type="number" inputMode="decimal" min="0" step="any"
                    placeholder="Used" value={r.actual}
                    className={cn('order-3 min-w-0 sm:order-none', flagged && 'border-amber-500 focus-visible:ring-amber-500')}
                    onChange={(e) => setRow(i, { actual: e.target.value, edited: true })} />
                  {it ? (
                    <UnitSelect units={it.units} value={r.unit_name || it.uom} label="Unit"
                      className="order-4 col-span-2 min-w-0 sm:order-none sm:col-span-1"
                      onChange={(u) => setRow(i, {
                        unit_name: u.name, factor: u.factor,
                        actual: r.actual === '' ? '' : String(fromBase(actualBase, u.factor)),
                      })} />
                  ) : <span className="order-4 col-span-2 sm:order-none sm:col-span-1" />}
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove line"
                    className="order-2 h-11 w-11 justify-self-end sm:order-none"
                    onClick={() => { setRows(rows.filter((_, j) => j !== i)); touch(); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {(flagged || short) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {flagged && v && (
                      <span className="text-amber-700 dark:text-amber-400">
                        {v.diff > 0 ? 'Over' : 'Under'} the recipe by {fmtQty(Math.abs(fromBase(v.diff, r.factor)))} {r.unit_name} ({Math.abs(v.pct!)}%)
                      </span>
                    )}
                    {short && it && (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                        Only {fmtQty(fromBase(it.stock, r.factor))} {r.unit_name} on hand
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm"
            onClick={() => { setRows([...rows, { key: nextKey(), product_id: '', unit_name: '', factor: 1, standardBase: null, actual: '', edited: true }]); touch(); }}>
            <Plus className="mr-1.5 h-4 w-4" />Add material
          </Button>
          {shortages.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Approval is refused while a material is short, unless negative stock is turned on in Inventory setup. Record the missing stock-in first.
            </p>
          )}
        </section>

        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold">Production expenses</h3>
            <p className="text-xs text-muted-foreground">
              Gas, diesel, power and similar for this batch (not salaries). Added to the batch's cost per unit. Pay them through Expenses under “Production Expenses”.
            </p>
          </div>
          {costs.map((c, i) => (
            <div key={c.key} className="flex items-center gap-2">
              <Input aria-label="Expense" placeholder="e.g. Cooking gas" className="min-w-0 flex-1" value={c.description}
                onChange={(e) => { setCosts(costs.map((x, j) => (j === i ? { ...x, description: e.target.value, edited: true } : x))); touch(); }} />
              <Input aria-label="Amount" type="number" inputMode="decimal" min="0" step="any" placeholder="₦" className="w-28 shrink-0 sm:w-32"
                value={c.amount}
                onChange={(e) => { setCosts(costs.map((x, j) => (j === i ? { ...x, amount: e.target.value, edited: true } : x))); touch(); }} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove expense" className="h-11 w-11 shrink-0"
                onClick={() => { setCosts(costs.filter((_, j) => j !== i)); touch(); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm"
            onClick={() => { setCosts([...costs, { key: nextKey(), description: '', amount: '', edited: true }]); touch(); }}>
            <Plus className="mr-1.5 h-4 w-4" />Add expense
          </Button>
        </section>

        {output && outBase > 0 && est.total > 0 && (
          <div className="rounded-xl bg-muted/60 p-4 text-sm">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">
              Estimate at today's costs. The final figure is fixed when it is approved.
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <span>Materials <b className="tabular-nums">{formatNairaCompact(est.material)}</b></span>
              <span>Expenses <b className="tabular-nums">{formatNairaCompact(est.other)}</b></span>
              <span>Total <b className="tabular-nums">{formatNairaCompact(est.total)}</b></span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
              {packCosts(est.perUnit, output.units).map((p) => (
                <span key={p.name}><b className="tabular-nums">{formatNairaCompact(p.cost)}</b> per {p.name}</span>
              ))}
            </div>
          </div>
        )}

        <Field id="prod-notes" label="Notes">
          <Textarea id="prod-notes" rows={2} value={notes} placeholder="Anything the approver should know"
            onChange={(e) => { setNotes(e.target.value); touch(); }} />
        </Field>
      </div>
    </FormSheet>
  );
}
