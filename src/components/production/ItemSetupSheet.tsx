import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatNairaCompact } from '@/lib/currency';
import {
  ITEM_CLASS_LABEL, fmtQty, isProduced, packCosts, setProductionItem, type ItemClass,
} from '@/lib/production';
import type { ProdItem } from '@/hooks/useProductionData';

const db = supabase as any;

interface PackRow { name: string; factor: string }

/** Class, lot code, shelf life and pack sizes for one item. */
export default function ItemSetupSheet({ item, open, onOpenChange, onSaved }: {
  item: ProdItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [cls, setCls] = useState<ItemClass>('raw_material');
  const [lotCode, setLotCode] = useState('');
  const [shelf, setShelf] = useState('');
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!item || !open) return;
    setCls(item.item_class);
    setLotCode(item.lot_code ?? '');
    setShelf(item.shelf_life_days ? String(item.shelf_life_days) : '');
    setPacks(item.units.slice(1).map((u) => ({ name: u.name, factor: String(u.factor) })));
    setDirty(false);
  }, [item, open]);

  if (!item) return null;
  const touch = () => setDirty(true);

  const classChanges = cls !== item.item_class;
  const movesAccount = classChanges && isProduced(cls) !== isProduced(item.item_class) && item.stock > 0 && item.cost > 0;

  const save = async () => {
    const clean = packs
      .map((p) => ({ name: p.name.trim(), factor: Number(p.factor) }))
      .filter((p) => p.name || p.factor);
    const bad = clean.find((p) => !p.name || !(p.factor > 0));
    if (bad) { toast({ title: 'Each pack size needs a name and how many it holds', variant: 'destructive' }); return; }
    const names = clean.map((p) => p.name.toLowerCase());
    if (names.includes(item.uom.toLowerCase()) || new Set(names).size !== names.length) {
      toast({ title: 'Pack names must be different from each other and from the base unit', variant: 'destructive' });
      return;
    }
    const days = shelf.trim() ? Math.round(Number(shelf)) : null;
    if (days !== null && !(days > 0)) { toast({ title: 'Shelf life must be a whole number of days', variant: 'destructive' }); return; }

    setSaving(true);
    try {
      await setProductionItem(item.id, cls, lotCode.trim() || null, days);
      // Pack sizes: replace the set. Recipes and runs keep their own copy of
      // the factor they were written with, so this never rewrites history.
      const { error: delErr } = await db.from('product_units').delete().eq('product_id', item.id);
      if (delErr) throw delErr;
      if (clean.length > 0) {
        const { error } = await db.from('product_units').insert(
          clean.map((p) => ({ product_id: item.id, unit_name: p.name, factor: p.factor, created_by: user?.id })),
        );
        if (error) throw error;
      }
      toast({ title: 'Item updated', description: movesAccount ? 'Stock on hand was moved to the matching inventory account.' : undefined });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Could not save', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const preview = packCosts(item.cost, [
    { name: item.uom, factor: 1 },
    ...packs.map((p) => ({ name: p.name.trim(), factor: Number(p.factor) })).filter((p) => p.name && p.factor > 0),
  ]);

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      title={item.name}
      description={`Counted in ${item.uom} · ${fmtQty(item.stock)} ${item.uom} on hand`}
      footer={
        <div className="flex gap-2.5 sm:justify-end">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-[2] sm:flex-none" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field id="item-class" label="What kind of item is this?"
          hint={movesAccount
            ? `Saving moves ${formatNairaCompact(item.stock * item.cost)} of stock on hand between Raw Materials (1200) and Finished Goods (1210).`
            : 'Finished and semi-finished items are produced here, tracked by lot, and held in Finished Goods (1210).'}>
          <Select value={cls} onValueChange={(v) => { setCls(v as ItemClass); touch(); }}>
            <SelectTrigger id="item-class"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(ITEM_CLASS_LABEL) as ItemClass[]).map((c) => (
                <SelectItem key={c} value={c}>{ITEM_CLASS_LABEL[c]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {isProduced(cls) && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="lot-code" label="Lot code"
              hint={`Lots are numbered ${(lotCode.trim() || item.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3) || 'LOT').toUpperCase()}-YYMMDD-01`}>
              <Input id="lot-code" value={lotCode} maxLength={8} placeholder="e.g. CC"
                onChange={(e) => { setLotCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()); touch(); }} />
            </Field>
            <Field id="shelf-life" label="Shelf life (days)" hint="Sets each lot's expiry date. Leave empty if it doesn't expire.">
              <Input id="shelf-life" type="number" inputMode="numeric" min="1" step="1" value={shelf}
                onChange={(e) => { setShelf(e.target.value); touch(); }} />
            </Field>
          </div>
        )}

        <div className="space-y-2">
          <div>
            <div className="text-sm font-medium">Pack sizes</div>
            <p className="text-xs text-muted-foreground">
              Larger or smaller units this item is bought, used or sold in, e.g. 1 bag = 50 {item.uom}, 1 carton = 24 {item.uom}.
            </p>
          </div>
          {packs.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-muted-foreground">1</span>
              <Input aria-label="Pack name" placeholder="bag" value={p.name} className="min-w-0 flex-1 sm:w-32 sm:flex-none"
                onChange={(e) => { setPacks(packs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))); touch(); }} />
              <span className="shrink-0 text-sm text-muted-foreground">=</span>
              <Input aria-label={`${item.uom} in one ${p.name || 'pack'}`} type="number" inputMode="decimal" min="0" step="any"
                placeholder="50" value={p.factor} className="w-20 shrink-0 sm:w-28"
                onChange={(e) => { setPacks(packs.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x))); touch(); }} />
              <span className="max-w-[4.5rem] shrink-0 truncate text-sm text-muted-foreground">{item.uom}</span>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove pack size" className="h-11 w-11 shrink-0"
                onClick={() => { setPacks(packs.filter((_, j) => j !== i)); touch(); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => { setPacks([...packs, { name: '', factor: '' }]); touch(); }}>
            <Plus className="mr-1.5 h-4 w-4" />Add pack size
          </Button>
        </div>

        {item.cost > 0 && (
          <div className="rounded-xl bg-muted/60 p-4 text-sm">
            <div className="mb-2 text-xs font-semibold text-muted-foreground">Current cost (moving average)</div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {preview.map((p) => (
                <span key={p.name}><span className="font-bold tabular-nums">{formatNairaCompact(p.cost)}</span> / {p.name}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </FormSheet>
  );
}
