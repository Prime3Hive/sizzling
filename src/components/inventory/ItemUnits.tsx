import { useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { formatNairaCompact } from '@/lib/currency';
import { fmtQty, normaliseUnit, packProblems, STANDARD_UNITS, STOCK_UNIT_RULE, type PackDraft } from '@/lib/units';

// The unit model for one item:
//   stock unit      what the kitchen counts in; balances are kept in it
//   pack sizes      other units it arrives in, each "1 bag = 10 kg"
//   purchase unit   the pack size goods usually arrive in

const db = supabase as any;

export const unitSelectCls = 'h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export { packProblems, STOCK_UNIT_RULE };
export type { PackDraft };

export function PackSizesEditor({ stockUnit, packs, onChange, purchaseUnit, onPurchaseUnit, unitChoices }: {
  stockUnit: string;
  packs: PackDraft[];
  onChange: (packs: PackDraft[]) => void;
  purchaseUnit: string;
  onPurchaseUnit: (u: string) => void;
  unitChoices: string[];
}) {
  const set = (i: number, patch: Partial<PackDraft>) => onChange(packs.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const named = packs.map((p) => normaliseUnit(p.name)).filter(Boolean);
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <div>
        <div className="text-sm font-medium">How it is bought</div>
        <p className="text-xs text-muted-foreground">
          If it arrives in bags, cartons or baskets, say how many {stockUnit || 'stock units'} one holds. Stock is still kept in {stockUnit || 'the stock unit'}.
        </p>
      </div>
      {packs.map((p, i) => (
        <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)_auto_5.5rem_auto_auto] items-center gap-2 text-sm">
          <span className="text-muted-foreground">1</span>
          <select aria-label="Purchase unit" className={unitSelectCls} value={normaliseUnit(p.name)}
            onChange={(e) => {
              const was = normaliseUnit(p.name);
              set(i, { name: e.target.value });
              if (purchaseUnit === was) onPurchaseUnit(e.target.value);
            }}>
            <option value="">unit</option>
            {unitChoices.filter((u) => u !== stockUnit).map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <span className="text-muted-foreground">=</span>
          <Input aria-label={`${stockUnit} in one ${p.name || 'unit'}`} type="number" inputMode="decimal" min="0" step="any"
            className="h-10" value={p.factor} onChange={(e) => set(i, { factor: e.target.value })} />
          <span className="text-muted-foreground">{stockUnit}</span>
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Remove pack size"
            onClick={() => {
              if (purchaseUnit === normaliseUnit(p.name)) onPurchaseUnit(stockUnit);
              onChange(packs.filter((_, j) => j !== i));
            }}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...packs, { name: '', factor: '' }])}>
        <Plus className="mr-1.5 h-4 w-4" />Add a pack size
      </Button>
      {named.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="purchase-unit" className="text-sm">Usually bought by the</Label>
          <select id="purchase-unit" className={unitSelectCls} value={purchaseUnit || stockUnit}
            onChange={(e) => onPurchaseUnit(e.target.value)}>
            <option value={stockUnit}>{stockUnit}</option>
            {named.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

/** Save an item's pack sizes and purchase unit. Rows no longer listed are removed. */
export async function saveItemUnits(productId: string, stockUnit: string, packs: PackDraft[], purchaseUnit: string) {
  const want = packs
    .map((p) => ({ name: normaliseUnit(p.name), factor: parseFloat(p.factor) }))
    .filter((p) => p.name && p.factor > 0 && p.name !== normaliseUnit(stockUnit));
  const { data: have, error } = await db.from('product_units').select('id, unit_name, factor').eq('product_id', productId);
  if (error) throw error;
  const existing = new Map<string, { id: string; factor: number }>(
    (have ?? []).map((r: any) => [normaliseUnit(r.unit_name), { id: r.id, factor: Number(r.factor) }]),
  );

  // The purchase unit must be convertible when it is set, so add first.
  for (const p of want) {
    const row = existing.get(p.name);
    if (!row) {
      const ins = await db.from('product_units').insert({ product_id: productId, unit_name: p.name, factor: p.factor });
      if (ins.error) throw ins.error;
    } else if (row.factor !== p.factor) {
      const up = await db.from('product_units').update({ factor: p.factor }).eq('id', row.id);
      if (up.error) throw up.error;
    }
  }
  const pu = normaliseUnit(purchaseUnit);
  const keep = new Set(want.map((p) => p.name));
  const up = await db.from('products')
    .update({ purchase_unit: pu && keep.has(pu) ? pu : null }).eq('id', productId);
  // Before the units migration the column does not exist; pack sizes still save.
  if (up.error && !/purchase_unit/.test(up.error.message ?? '')) throw up.error;

  for (const [name, row] of existing) {
    if (keep.has(name)) continue;
    const del = await db.from('product_units').delete().eq('id', row.id);
    if (del.error) throw del.error;
  }
}

// ── Change the stock unit ────────────────────────────────────────────────────

export function ChangeStockUnitDialog({ open, onOpenChange, item, unitChoices, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: { id: string; name: string; unit: string; onHand: number; cost: number; reorder: number } | null;
  unitChoices: string[];
  onDone: () => void;
}) {
  const [unit, setUnit] = useState('');
  const [factor, setFactor] = useState('1');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setUnit(''); setFactor('1'); setNote(''); } }, [open]);
  if (!item) return null;

  const f = parseFloat(factor);
  const ok = !!unit && f > 0;
  const save = async () => {
    setSaving(true);
    try {
      const { error } = await db.rpc('fn_change_stock_unit', {
        p_sku_id: item.id, p_new_unit: unit, p_factor: f, p_note: note.trim() || null,
      });
      if (error) throw error;
      toast({ title: `${item.name} is now stocked in ${unit}` });
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Could not change the unit', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change stock unit: {item.name}</DialogTitle>
          <DialogDescription>
            The balance, cost and reorder level are restated in the new unit, so the stock value stays the same.
            Earlier movements are kept as they were and marked “before unit change”.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Now stocked in</Label>
              <Input value={item.unit} disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-unit">Change to</Label>
              <select id="new-unit" className={unitSelectCls} value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="">Choose</option>
                {unitChoices.filter((u) => u !== item.unit).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="unit-factor">1 {item.unit} =</Label>
            <div className="flex items-center gap-2">
              <Input id="unit-factor" type="number" inputMode="decimal" min="0" step="any" className="w-32"
                value={factor} onChange={(e) => setFactor(e.target.value)} />
              <span className="text-sm text-muted-foreground">{unit || 'new unit'}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Use 1 when the old unit was only a label for the new one (a “piece” that was really a kg).
            </p>
          </div>
          {ok && (
            <div className="rounded-xl bg-muted/60 px-4 py-3 text-sm">
              <div>On hand: {fmtQty(item.onHand)} {item.unit} → <b>{fmtQty(item.onHand * f)} {unit}</b></div>
              <div>Cost: {formatNairaCompact(item.cost)} per {item.unit} → <b>{formatNairaCompact(item.cost / f)} per {unit}</b></div>
              <div>Reorder at: {fmtQty(item.reorder)} {item.unit} → <b>{fmtQty(Math.round(item.reorder * f))} {unit}</b></div>
              {f !== 1 && <div className="mt-1 text-xs text-muted-foreground">“{item.unit}” is kept as a pack size (1 {item.unit} = {fmtQty(f)} {unit}).</div>}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="unit-note">Note (optional)</Label>
            <Textarea id="unit-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the unit is changing" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!ok || saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Change unit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── The unit list (admin) ────────────────────────────────────────────────────

export function UnitListDialog({ open, onOpenChange, custom, canEdit, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  custom: string[];
  canEdit: boolean;
  onSave: (units: string[]) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = async (next: string[]) => {
    setBusy(true);
    try { await onSave(next); setName(''); }
    catch (e) { toast({ title: 'Could not save', description: (e as Error).message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const add = () => {
    const n = normaliseUnit(name);
    if (!n) return;
    if ((STANDARD_UNITS as readonly string[]).includes(n) || custom.includes(n)) {
      toast({ title: `"${n}" is already on the list` });
      setName('');
      return;
    }
    apply([...custom, n]);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Units</DialogTitle>
          <DialogDescription>
            The units an item can be stocked or bought in. Pack sizes (1 bag = 10 kg) are set on each item, under Edit item.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {STANDARD_UNITS.map((u) => <span key={u} className="rounded-md border bg-muted/50 px-2 py-1 text-xs">{u}</span>)}
            {custom.map((u) => (
              <span key={u} className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-xs">
                {u}
                {canEdit && (
                  <button type="button" aria-label={`Remove ${u}`} disabled={busy} onClick={() => apply(custom.filter((x) => x !== u))}>
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
          {canEdit ? (
            <div className="flex gap-2">
              <Input aria-label="New unit" placeholder="Add a unit, e.g. bucket" value={name}
                onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
              <Button onClick={add} disabled={busy || !name.trim()}>Add</Button>
            </div>
          ) : <p className="text-xs text-muted-foreground">Only an admin can add a unit.</p>}
          <p className="text-xs text-muted-foreground">{STOCK_UNIT_RULE}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
