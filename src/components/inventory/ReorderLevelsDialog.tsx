import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormSheet } from '@/components/ui/form-sheet';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// ─────────────────────────────────────────────────────────────────────────────
// Reorder levels for every item on one screen. 10 kg of gas and 10 pieces of
// croaker are not the same warning, so each item carries its own level in its
// own unit. 0 means "only tell me when it runs out".
// ─────────────────────────────────────────────────────────────────────────────

interface Item {
  id: string;
  name: string;
  category: string | null;
  unit_of_measure: string | null;
  stock_quantity: number;
  reorder_level: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: Item[];
  onDone: () => void;
}

/** Save reorder levels for one item or many. */
export async function setReorderLevels(levels: { sku_id: string; level: number }[]) {
  const { error } = await (supabase as any).rpc('fn_set_reorder_levels', { p_levels: levels });
  if (error) throw error;
}

export default function ReorderLevelsDialog({ open, onOpenChange, items, onDone }: Props) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setDraft({}); setQuery(''); }
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...items]
      .filter((it) => !q || it.name.toLowerCase().includes(q) || (it.category ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name));
  }, [items, query]);

  const changes = useMemo(() => items.flatMap((it) => {
    const raw = draft[it.id];
    if (raw === undefined || raw.trim() === '') return [];
    const level = Number(raw);
    if (!Number.isFinite(level) || level < 0 || level === Number(it.reorder_level)) return [];
    return [{ sku_id: it.id, level }];
  }), [draft, items]);

  const save = async () => {
    if (changes.length === 0) { onOpenChange(false); return; }
    setSaving(true);
    try {
      await setReorderLevels(changes);
      toast({ title: `${changes.length} reorder level${changes.length === 1 ? '' : 's'} updated` });
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast({
        title: 'Could not save reorder levels',
        description: /fn_set_reorder_levels/.test(e.message ?? '')
          ? 'Apply database migration 20261123100000_fix_list_nov23 first.'
          : e.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reorder levels"
      description="The stock level at which each item is flagged, in its own unit. 0 flags it only when it runs out."
      size="wide"
      dirty={changes.length > 0}
      footer={
        <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
          <span className="text-sm text-muted-foreground sm:mr-auto self-center" role="status">
            {changes.length} change{changes.length === 1 ? '' : 's'}
          </span>
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-11" onClick={save} disabled={saving || changes.length === 0}>
            {saving ? 'Saving…' : 'Save levels'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items or categories"
            aria-label="Search items"
            className="pl-9 h-11 text-base"
          />
        </div>

        <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_110px_150px] gap-3 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Item</span><span className="text-right">In stock</span><span>Reorder at</span>
        </div>

        <ul className="divide-y rounded-lg border">
          {shown.map((it) => {
            const unit = it.unit_of_measure ?? '';
            return (
              <li key={it.id} className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_110px_150px] items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{it.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {it.category ?? 'No category'}
                    <span className="sm:hidden"> · {Number(it.stock_quantity)} {unit} in stock</span>
                  </span>
                </span>
                <span className="hidden sm:block text-right text-sm tabular-nums text-muted-foreground">
                  {Number(it.stock_quantity)} {unit}
                </span>
                <span className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    aria-label={`Reorder level for ${it.name}${unit ? `, in ${unit}` : ''}`}
                    value={draft[it.id] ?? String(Number(it.reorder_level))}
                    onChange={(e) => setDraft((d) => ({ ...d, [it.id]: e.target.value }))}
                    className="h-10 w-24 text-base tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground">{unit}</span>
                </span>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">No items match.</li>
          )}
        </ul>
      </div>
    </FormSheet>
  );
}
