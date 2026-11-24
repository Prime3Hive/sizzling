import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { usePayees } from '@/hooks/useExpenseReference';
import type { ItemUnitInfo } from '@/hooks/useItemUnits';
import { formatNairaCompact } from '@/lib/currency';
import { INVENTORY_CATEGORIES } from '@/lib/inventoryConstants';
import { ITEM_KINDS, hasProblems, itemProblems, nameKey } from '@/lib/itemMaster';
import { recordStockMovements, setProductCost } from '@/lib/stockMovements';
import { fmtQty, normaliseUnit, similarItems } from '@/lib/units';
import { PackSizesEditor, packProblems, saveItemUnits, unitSelectCls, STOCK_UNIT_RULE, type PackDraft } from '@/components/inventory/ItemUnits';
import { setReorderLevels } from '@/components/inventory/ReorderLevelsDialog';

// One form for adding an item and for editing one, so an item is set up once,
// fully: name, type, category, stock unit, pack sizes, usual supplier, storage
// place, minimum level and whether it is on the weekly count.
//
// The form keeps its own state and is given a `key` per item by the page, so
// it can never show the details of the item that was open before.

const db = supabase as any;

export interface ItemRow {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  stock_quantity: number;
  reorder_level: number;
  cost_per_unit: number;
  is_archived: boolean;
}

export default function ItemFormSheet({
  open, onOpenChange, item, skus, unitsBySku, masterReady, targetReady, unitChoices, storagePlaces,
  isAdmin, canRecord, onSaved, onChangeUnit, onCorrectCount, onOpenItem,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The item being edited; null to add a new one. */
  item: ItemRow | null;
  skus: ItemRow[];
  unitsBySku: Map<string, ItemUnitInfo>;
  /** false until migration 20261124100000 is applied: type, place and supplier are hidden. */
  masterReady: boolean;
  /** false until migration 20261124500000 is applied: the target level is hidden. */
  targetReady?: boolean;
  unitChoices: string[];
  storagePlaces: string[];
  isAdmin: boolean;
  canRecord: boolean;
  onSaved: () => void;
  onChangeUnit: (item: ItemRow) => void;
  onCorrectCount: (item: ItemRow) => void;
  onOpenItem: (id: string) => void;
}) {
  const { user } = useAuth();
  const { data: payees = [] } = usePayees();
  const info = item ? unitsBySku.get(item.id) : undefined;
  const produced = !!info?.produced;

  const [name, setName] = useState('');
  const [category, setCategory] = useState('Proteins');
  const [kind, setKind] = useState('');
  const [stockUnit, setStockUnit] = useState('kg');
  const [packs, setPacks] = useState<PackDraft[]>([]);
  const [purchaseUnit, setPurchaseUnit] = useState('');
  const [payeeId, setPayeeId] = useState('');
  const [place, setPlace] = useState('');
  const [minLevel, setMinLevel] = useState('');
  const [target, setTarget] = useState('');
  const [opening, setOpening] = useState('');
  const [cost, setCost] = useState('');
  const [correctCost, setCorrectCost] = useState(false);
  const [counted, setCounted] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  // Fill the form once each time it opens.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) { wasOpen.current = false; return; }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setName(item?.name ?? '');
    setCategory(item?.category ?? 'Proteins');
    setKind(produced ? 'finished_good' : info?.kind ?? '');
    setStockUnit(item ? normaliseUnit(item.unit_of_measure) : 'kg');
    setPacks((info?.units ?? []).slice(1).map((u) => ({ name: u.name, factor: String(u.factor) })));
    setPurchaseUnit(item ? info?.purchaseUnit ?? normaliseUnit(item.unit_of_measure) : '');
    setPayeeId(info?.payeeId ?? '');
    setPlace(info?.storagePlace ?? '');
    // A new item starts blank: the minimum level has to be typed, even if it is 0.
    setMinLevel(item ? String(Number(item.reorder_level ?? 0)) : '');
    setTarget(info?.targetLevel != null ? String(info.targetLevel) : '');
    setOpening('');
    setCost(item ? String(Number(item.cost_per_unit ?? 0)) : '');
    setCorrectCost(false);
    setCounted(info?.countedWeekly ?? true);
    setDirty(false);
    setTried(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const touch = () => setDirty(true);
  const unit = normaliseUnit(stockUnit);

  // An item being edited may keep the name it has, even where an older
  // duplicate exists: the name is only checked when it is new or changed.
  const nameUnchanged = !!item && nameKey(name) === nameKey(item.name);
  const problems = itemProblems({ name, kind, stockUnit, minLevel }, nameUnchanged ? [] : skus,
    { exceptId: item?.id, requireKind: masterReady });
  const show = (msg?: string) => (tried ? msg ?? null : null);

  // Similar names, shown before a second copy is created. An exact match is an
  // error; a near match (PRAWNS, PUD PRAWNS) is a prompt to look first.
  const similar = useMemo(
    () => (item ? [] : similarItems(name, skus)),
    [item, name, skus],
  );

  const supplierOptions = useMemo(() => payees.map((p) => ({ value: p.id, label: p.name })), [payees]);
  const placeChoices = useMemo(() => {
    const all = [...storagePlaces];
    if (place && !all.some((p) => nameKey(p) === nameKey(place))) all.push(place);
    return all;
  }, [storagePlaces, place]);
  const kindChoices = ITEM_KINDS.filter((k) => produced ? k.value === 'finished_good' : k.value !== 'finished_good');

  const master = () => (masterReady ? {
    // A produced item's type is set by the database from its production class.
    ...(produced ? {} : { item_kind: kind || null }),
    storage_place: place || null,
    default_payee_id: payeeId || null,
    counted_weekly: counted,
    // Blank = not set: the To buy list then uses twice the minimum.
    ...(targetReady ? { target_level: target.trim() === '' ? null : Math.max(Number(target) || 0, 0) } : {}),
  } : {});

  const save = async () => {
    setTried(true);
    if (hasProblems(problems)) {
      toast({ title: 'Some details are missing', description: Object.values(problems)[0], variant: 'destructive' });
      return;
    }
    if (targetReady && target.trim() !== '' && (Number(target) || 0) < (Number(minLevel) || 0)) {
      toast({ title: 'The target level is below the minimum', description: 'A reorder brings stock up to the target, so it has to be at or above the minimum.', variant: 'destructive' });
      return;
    }
    const packIssues = packProblems(unit, packs);
    if (packIssues.length) { toast({ title: 'Check the pack sizes', description: packIssues.join(' '), variant: 'destructive' }); return; }
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    const level = Number(minLevel) || 0;
    try {
      if (!item) {
        const costNum = Number(cost) || 0;
        const { data: product, error } = await db.from('products').insert({
          name: name.trim(), category, item_type: 'non_sellable', uom: unit,
          // cost_price is the value used to value stock; price mirrors it for a stock item.
          price: costNum, cost_price: costNum,
          user_id: user!.id, created_by: user!.id,
          ...master(),
        }).select('id, sku_id').single();
        if (error) throw error;

        // The item exists from here. Anything below that fails is reported, and
        // the item is left to be finished from Edit item rather than added twice.
        const unfinished: string[] = [];
        if (packs.some((p) => normaliseUnit(p.name))) {
          await saveItemUnits(product.id, unit, packs, purchaseUnit).catch((e) => unfinished.push(`pack sizes (${(e as Error).message})`));
        }
        const openingQty = Number(opening) || 0;
        if (openingQty > 0) {
          await recordStockMovements({
            lines: [{ product_id: product.id, quantity_change: openingQty, unit_price: costNum || undefined }],
            type: 'adjustment', referenceType: 'opening', note: `Opening stock — ${name.trim()}`,
          }).catch((e) => unfinished.push(`opening stock (${(e as Error).message})`));
        }
        if (product.sku_id) {
          await setReorderLevels([{ sku_id: product.sku_id, level }]).catch((e) => unfinished.push(`minimum level (${(e as Error).message})`));
        }
        toast(unfinished.length
          ? { title: `${name.trim()} added, but not everything was saved`, description: `Open Edit item to finish: ${unfinished.join('; ')}.`, variant: 'destructive' }
          : { title: `${name.trim()} added` });
      } else {
        // By product where it is known: an item with two linked products must
        // not have both renamed to the same thing.
        const base = db.from('products')
          // Never `price` (the selling price) and never the unit: the unit only
          // changes through "Change stock unit", which restates stock and cost.
          .update({ name: name.trim(), category, ...master() });
        const { error } = await (info?.productId ? base.eq('id', info.productId) : base.eq('sku_id', item.id));
        if (error) throw error;

        if (info?.productId) await saveItemUnits(info.productId, unit, packs, purchaseUnit);
        if (level !== Number(item.reorder_level)) await setReorderLevels([{ sku_id: item.id, level }]);

        let revalued = 0;
        const costNum = Number(cost);
        if (correctCost && Number.isFinite(costNum) && costNum >= 0 && costNum !== Number(item.cost_per_unit)) {
          revalued = await setProductCost(item.id, costNum, 'corrected on the item form');
        }
        toast({
          title: `${name.trim()} updated`,
          description: revalued !== 0
            ? `Stock on hand revalued by ${revalued > 0 ? '+' : '−'}${formatNairaCompact(Math.abs(revalued))} in the books.`
            : undefined,
        });
      }
      setDirty(false);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast({ title: item ? 'Could not update the item' : 'Could not add the item', description: (e as Error).message, variant: 'destructive' });
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const leaveFor = (go: () => void) => {
    if (dirty && !window.confirm('Leave this form? Changes you have not saved will be lost.')) return;
    onOpenChange(false);
    go();
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty}
      title={item ? 'Edit item' : 'Add item'}
      description={item
        ? `Quantities and cost are in ${unit}, this item’s stock unit.`
        : 'Set the item up once, fully. Everything about it is kept in the stock unit you choose.'}
      footer={
        <div className="flex gap-2.5 sm:justify-end">
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-[2] sm:flex-none" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{item ? 'Save item' : 'Add item'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field id="item-name" label="Name" required error={show(problems.name)}>
          <Input id="item-name" value={name} autoComplete="off" placeholder="e.g. Chicken Wings"
            onChange={(e) => { setName(e.target.value); touch(); }} />
        </Field>
        {similar.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-medium">Already in the list. Use one of these instead of adding it again?</p>
            <ul className="mt-1 space-y-0.5">
              {similar.map((it) => (
                <li key={it.id}>
                  <button type="button" className="text-left underline underline-offset-2" onClick={() => leaveFor(() => onOpenItem(it.id))}>
                    {it.name}
                  </button>
                  {' '}· {fmtQty(Number(it.stock_quantity))} {it.unit_of_measure}{it.is_archived ? ' · archived' : ''}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {masterReady && (
            <Field id="item-kind" label="Type" required error={show(problems.kind)}
              hint={produced ? 'Made in production. Its type is set there.' : undefined}>
              <select id="item-kind" className={unitSelectCls} value={kind} disabled={produced}
                onChange={(e) => { setKind(e.target.value); touch(); }}>
                {!produced && <option value="">Choose</option>}
                {kindChoices.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </Field>
          )}
          <Field id="item-category" label="Category">
            <select id="item-category" className={unitSelectCls} value={category}
              onChange={(e) => { setCategory(e.target.value); touch(); }}>
              {!INVENTORY_CATEGORIES.some((c) => c.value === category) && <option value={category}>{category}</option>}
              {INVENTORY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
        </div>

        <Field id="item-unit" label="Stock unit" required error={show(problems.stockUnit)}
          hint={item ? 'The unit the kitchen counts it in.' : STOCK_UNIT_RULE}>
          {item ? (
            <div className="flex gap-2">
              <Input id="item-unit" value={unit} disabled className="min-w-0" />
              <Button type="button" variant="outline" className="shrink-0" onClick={() => leaveFor(() => onChangeUnit(item))}>
                Change
              </Button>
            </div>
          ) : (
            <select id="item-unit" className={unitSelectCls} value={unit}
              onChange={(e) => {
                setStockUnit(e.target.value);
                setPacks((p) => p.filter((x) => normaliseUnit(x.name) !== e.target.value));
                setPurchaseUnit('');
                touch();
              }}>
              {unitChoices.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          )}
        </Field>

        <PackSizesEditor stockUnit={unit} packs={packs} onChange={(p) => { setPacks(p); touch(); }}
          purchaseUnit={purchaseUnit} onPurchaseUnit={(u) => { setPurchaseUnit(u); touch(); }} unitChoices={unitChoices} />

        {masterReady && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="item-supplier" label="Usual supplier" hint="Optional. Filled in for you when this item is received.">
              <SearchableSelect id="item-supplier" options={supplierOptions} value={payeeId}
                onChange={(v) => { setPayeeId(v); touch(); }}
                title="Usual supplier" placeholder="No usual supplier" emptyOptionLabel="No usual supplier" />
            </Field>
            <Field id="item-place" label="Storage place" hint="Where it is kept. The count sheet follows this order.">
              <select id="item-place" className={unitSelectCls} value={place}
                onChange={(e) => { setPlace(e.target.value); touch(); }}>
                <option value="">Not set</option>
                {placeChoices.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="item-min" label={`Minimum level (${unit})`} required error={show(problems.minLevel)}
            hint="At or below this, the item is flagged to buy. 0 flags it only when it runs out.">
            <Input id="item-min" type="number" inputMode="decimal" min="0" step="any" value={minLevel}
              onChange={(e) => { setMinLevel(e.target.value); touch(); }} />
          </Field>
          {!item ? (
            <Field id="item-opening" label={`Opening stock (${unit})`} hint="What is on the shelf today. Leave blank for none.">
              <Input id="item-opening" type="number" inputMode="decimal" min="0" step="any" value={opening}
                onChange={(e) => { setOpening(e.target.value); touch(); }} />
            </Field>
          ) : (
            <Field id="item-onhand" label={`On hand (${unit})`}
              hint="Changes only through receiving, usage, a count or a correction with a reason.">
              <div className="flex gap-2">
                <Input id="item-onhand" value={fmtQty(Number(item.stock_quantity))} disabled className="min-w-0" />
                {canRecord && (
                  <Button type="button" variant="outline" className="shrink-0" onClick={() => leaveFor(() => onCorrectCount(item))}>
                    Correct
                  </Button>
                )}
              </div>
            </Field>
          )}
        </div>

        {masterReady && targetReady && (
          <Field id="item-target" label={`Target level (${unit})`}
            hint={`A reorder brings stock back up to this. Blank: twice the minimum${Number(minLevel) > 0 ? ` (${fmtQty(Number(minLevel) * 2)} ${unit})` : ''}.`}>
            <Input id="item-target" type="number" inputMode="decimal" min="0" step="any" className="sm:w-1/2" value={target}
              onChange={(e) => { setTarget(e.target.value); touch(); }} />
          </Field>
        )}

        {!item ? (
          <Field id="item-cost" label={`Cost per ${unit} (₦)`}
            hint="The starting cost. After setup it is recalculated from each receipt and is not typed again.">
            <Input id="item-cost" type="number" inputMode="decimal" min="0" step="0.01" value={cost}
              onChange={(e) => { setCost(e.target.value); touch(); }} />
          </Field>
        ) : (
          <Field id="item-cost" label={`Average cost per ${unit} (₦)`}
            hint={correctCost
              ? 'Stock on hand will be revalued in the books at the new cost.'
              : 'Recalculated from each receipt. It is not typed after setup.'}>
            <div className="flex gap-2">
              <Input id="item-cost" type="number" inputMode="decimal" min="0" step="0.01" value={cost} disabled={!correctCost}
                className="min-w-0" onChange={(e) => { setCost(e.target.value); touch(); }} />
              {isAdmin && !correctCost && (
                <Button type="button" variant="outline" className="shrink-0" onClick={() => setCorrectCost(true)}>Correct</Button>
              )}
            </div>
          </Field>
        )}

        {masterReady && (
          <label htmlFor="item-counted" className="flex items-start justify-between gap-4 rounded-xl border p-3">
            <span>
              <span className="block text-sm font-medium">Counted weekly</span>
              <span className="block text-xs text-muted-foreground">Turn off for low-value items that are left out of the weekly count.</span>
            </span>
            <Switch id="item-counted" checked={counted} onCheckedChange={(v) => { setCounted(v); touch(); }} />
          </label>
        )}

        {!masterReady && (
          <p className="text-xs text-muted-foreground">
            Type, storage place, usual supplier and the weekly count setting need the latest database update (20261124100000).
          </p>
        )}
      </div>
    </FormSheet>
  );
}

// ── Archiving ────────────────────────────────────────────────────────────────

/**
 * Archiving an item that still has stock: the stock is corrected to zero, with
 * a reason, and then the item is archived. An item with stock on hand cannot
 * be archived any other way.
 */
export function ArchiveItemDialog({ item, onOpenChange, onDone }: {
  item: ItemRow | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (item) setReason(''); }, [item]);
  if (!item) return null;

  const onHand = Number(item.stock_quantity);
  const value = Math.max(onHand, 0) * Number(item.cost_per_unit || 0);

  const archive = async () => {
    if (!reason.trim()) { toast({ title: 'Say why the stock is being written down to zero', variant: 'destructive' }); return; }
    setSaving(true);
    try {
      // Re-read the balance: it may have moved since the list was loaded.
      const { data: now, error: readErr } = await db.from('skus').select('stock_quantity').eq('id', item.id).maybeSingle();
      if (readErr) throw readErr;
      const current = Number(now?.stock_quantity ?? onHand);
      if (current !== 0) {
        await recordStockMovements({
          lines: [{ sku_id: item.id, quantity_change: -current }],
          type: 'adjustment', transactionType: 'ADJUSTMENT',
          note: `Corrected to zero before archiving: ${reason.trim()}`,
        });
      }
      const { error } = await db.from('skus').update({ is_archived: true }).eq('id', item.id);
      if (error) throw error;
      toast({ title: `${item.name} archived`, description: 'Its history is kept. Restore it from the Archived list.' });
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast({ title: 'Could not archive the item', description: (e as Error).message, variant: 'destructive' });
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Archive {item.name}</DialogTitle>
          <DialogDescription>
            It still shows {fmtQty(onHand)} {item.unit_of_measure} on hand
            {value > 0 ? `, worth ${formatNairaCompact(value)}` : ''}. An item with stock cannot be archived.
            To archive it, the stock is first corrected to zero and the reason is kept on its history.
          </DialogDescription>
        </DialogHeader>
        <Field id="archive-reason" label="Why is the stock going to zero?" required>
          <Textarea id="archive-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. no longer stocked and the last of it was used; counted wrong; duplicate of another item" />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={archive} disabled={saving || !reason.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Correct to zero and archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Storage places ───────────────────────────────────────────────────────────

/** The list of storage places, in the order the count sheet follows. */
export function StoragePlacesDialog({ open, onOpenChange, places, canEdit, inUse, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  places: string[];
  canEdit: boolean;
  /** Places that items are kept in, lower-cased: these cannot be removed. */
  inUse: Set<string>;
  onSave: (places: string[]) => Promise<void>;
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
    const n = name.replace(/\s+/g, ' ').trim();
    if (!n) return;
    if (places.some((p) => nameKey(p) === nameKey(n))) { toast({ title: `“${n}” is already on the list` }); setName(''); return; }
    apply([...places, n]);
  };
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = [...places];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    apply(next);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Storage places</DialogTitle>
          <DialogDescription>
            Where stock is kept. Each item is given one under Edit item, and the count sheet lists items in this order.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ul className="divide-y rounded-lg border">
            {places.map((p, i) => (
              <li key={p} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="w-5 text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{p}</span>
                {canEdit && (
                  <>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9" disabled={busy || i === 0}
                      aria-label={`Move ${p} up`} onClick={() => moveUp(i)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9"
                      disabled={busy || inUse.has(nameKey(p))}
                      title={inUse.has(nameKey(p)) ? 'Items are kept here. Move them first.' : undefined}
                      aria-label={`Remove ${p}`} onClick={() => apply(places.filter((x) => x !== p))}>
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
            {places.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No storage places yet.</li>}
          </ul>
          {canEdit ? (
            <div className="flex gap-2">
              <Input aria-label="New storage place" placeholder="Add a place, e.g. Bar fridge" value={name}
                onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
              <Button onClick={add} disabled={busy || !name.trim()}>Add</Button>
            </div>
          ) : <p className="text-xs text-muted-foreground">Only an admin can change this list.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
