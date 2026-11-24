import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { CheckCircle2, ClipboardCheck, Loader2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { EmptyState, StatusPill } from '@/components/shell/ui';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import type { ItemUnitInfo } from '@/hooks/useItemUnits';
import { useInventorySettings } from '@/hooks/useInventorySettings';
import { useStockCounts, type StockCount as Count, type StockCountLine } from '@/hooks/useStockOut';
import { formatNairaCompact } from '@/lib/currency';
import { cn } from '@/lib/utils';
import { orderForCount } from '@/lib/itemMaster';
import { fmtQty } from '@/lib/units';
import {
  countSummary, countedAs, countedQty, isUncounted, needsReason, type CountEntry, type CountRule,
} from '@/lib/stockRoutes';

// The weekly count. The store keeper counts the shelf without seeing what the
// records expect, and submits. The differences are then shown in quantity and
// naira, and a manager or the owner approves: only then does stock move, by
// one count-difference movement per item. Nothing is relabelled as usage.

const db = supabase as any;
const DRAFT_KEY = 'stock-count-draft';
const today = () => new Date().toISOString().slice(0, 10);

interface CountItem {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  is_archived?: boolean;
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtQty(Math.abs(n))}`;

export default function StockCount({ skus, unitsBySku, storagePlaces, canCount, canApprove, isAdmin, onChanged }: {
  skus: CountItem[];
  unitsBySku: Map<string, ItemUnitInfo>;
  storagePlaces: string[];
  canCount: boolean;
  canApprove: boolean;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { settings } = useInventorySettings();
  const { data: counts = [], isLoading } = useStockCounts();
  const rule: CountRule = { pct: settings.count_reason_pct, valueMinor: settings.count_reason_value_minor };

  const { data: names = {} } = useQuery<Record<string, string>>({
    queryKey: ['profiles-directory-map'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('user_id, full_name');
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p) => [p.user_id, p.full_name ?? '']));
    },
    staleTime: 5 * 60_000,
  });

  const pending = counts.find((c) => c.status === 'submitted') ?? null;
  const past = counts.filter((c) => c.status !== 'submitted');

  // ── Counting ──────────────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false);
  const [kind, setKind] = useState<'weekly' | 'opening'>('weekly');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [entries, setEntries] = useState<Record<string, CountEntry>>({});
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);

  const packOf = (id: string) => {
    const u = unitsBySku.get(id);
    if (!u || u.purchaseUnit === u.stockUnit) return null;
    const pack = u.units.find((x) => x.name === u.purchaseUnit);
    return pack && pack.factor > 0 ? pack : null;
  };
  const unitOf = (s: CountItem) => unitsBySku.get(s.id)?.stockUnit ?? s.unit_of_measure;

  // Archived items are not on the shelf. Items marked "not counted weekly" are
  // left off, except for an opening count, which is a full count.
  const sheetItems = useMemo(() => {
    const active = skus.filter((s) => !s.is_archived);
    const list = kind === 'opening' ? active : active.filter((s) => unitsBySku.get(s.id)?.countedWeekly !== false);
    return orderForCount(list, (s) => unitsBySku.get(s.id)?.storagePlace, storagePlaces);
  }, [skus, kind, unitsBySku, storagePlaces]);
  const leftOut = skus.filter((s) => !s.is_archived).length - sheetItems.length;
  const countedIds = sheetItems.filter((s) => !isUncounted(entries[s.id])).map((s) => s.id);

  const openSheet = () => {
    // Pick up a count that was started and not submitted (a phone that slept,
    // a tab closed by mistake).
    let draft: { date?: string; kind?: 'weekly' | 'opening'; notes?: string; entries?: Record<string, CountEntry> } = {};
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') ?? {}; } catch { /* no draft */ }
    const resume = draft.date === today() && draft.entries && Object.keys(draft.entries).length > 0;
    setEntries(resume ? draft.entries! : {});
    setKind(resume && draft.kind === 'opening' && isAdmin ? 'opening' : 'weekly');
    setNotes(resume ? draft.notes ?? '' : '');
    setDate(today());
    setSheetOpen(true);
    if (resume) toast({ title: 'Carried on from where you stopped', description: `${Object.keys(draft.entries!).length} items already counted today.` });
  };
  useEffect(() => {
    if (!sheetOpen) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ date: today(), kind, notes, entries })); } catch { /* storage blocked */ }
  }, [sheetOpen, kind, notes, entries]);

  const setEntry = (id: string, patch: Partial<CountEntry>) =>
    setEntries((p) => ({ ...p, [id]: { packs: '', loose: '', ...p[id], ...patch } }));

  const submitCount = async () => {
    if (countedIds.length === 0) { toast({ title: 'Count at least one item', variant: 'destructive' }); return; }
    const missed = sheetItems.length - countedIds.length;
    if (missed > 0 && !window.confirm(`${missed} item${missed === 1 ? ' has' : 's have'} no count. ${missed === 1 ? 'It' : 'They'} will be left as the records show. Submit the count?`)) return;
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      const lines = countedIds.map((id) => {
        const s = sheetItems.find((x) => x.id === id)!;
        const pack = packOf(id);
        return { sku_id: id, counted: countedQty(entries[id], pack?.factor), counted_as: countedAs(entries[id], pack?.name, unitOf(s)) };
      });
      const { error } = await db.rpc('fn_submit_stock_count', { p_lines: lines, p_count_date: date, p_kind: kind, p_notes: notes.trim() || null });
      if (error) throw new Error(error.message);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      setEntries({});
      setSheetOpen(false);
      toast({ title: 'Count submitted', description: 'The differences are shown below. Stock changes when a manager approves it.' });
      qc.invalidateQueries({ queryKey: ['stock-counts'] });
    } catch (e) {
      toast({ title: 'Could not submit the count', description: (e as Error).message, variant: 'destructive' });
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  // ── Deciding ──────────────────────────────────────────────────────────────
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Count | null>(null);
  useEffect(() => { setReasons({}); }, [pending?.id]);

  const pendingLines = useMemo(
    () => (pending ? [...pending.stock_count_lines].sort((a, b) => Math.abs(Number(b.difference) * Number(b.unit_cost)) - Math.abs(Number(a.difference) * Number(a.unit_cost)) || a.item_name.localeCompare(b.item_name)) : []),
    [pending],
  );
  const summary = countSummary(pendingLines, pending?.kind === 'opening' ? { pct: Infinity, valueMinor: Infinity } : rule, reasons, (l) => (l as StockCountLine).id);
  const ownCount = !!pending && pending.counted_by === user?.id;
  const mayDecide = canApprove && (!ownCount || isAdmin) && (pending?.kind !== 'opening' || isAdmin);

  const decide = async () => {
    if (!pending || !deciding) return;
    if (deciding === 'reject' && !decisionNote.trim()) { toast({ title: 'Say why the count is being sent back', variant: 'destructive' }); return; }
    setBusy(true);
    try {
      const { data, error } = await db.rpc('fn_decide_stock_count', {
        p_count_id: pending.id, p_approve: deciding === 'approve',
        p_reasons: Object.fromEntries(Object.entries(reasons).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()])),
        p_note: decisionNote.trim() || null,
      });
      if (error) throw new Error(error.message);
      toast(deciding === 'approve'
        ? { title: `${pending.count_number} approved`, description: `${Number(data ?? 0)} item${Number(data) === 1 ? '' : 's'} corrected to the count.` }
        : { title: `${pending.count_number} sent back`, description: 'No stock was changed.' });
      setDeciding(null); setDecisionNote('');
      for (const key of [['stock-counts'], ['inventory-data'], ['inventory-item'], ['item-units'], ['ops-low-stock'], ['skus-for-stock-in']]) qc.invalidateQueries({ queryKey: key });
      onChanged();
    } catch (e) {
      toast({ title: deciding === 'approve' ? 'Could not approve the count' : 'Could not send the count back', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const lineRow = (l: StockCountLine, editable: boolean, ruleFor: CountRule) => {
    const diff = Number(l.difference);
    const value = diff * Number(l.unit_cost);
    const must = needsReason(Number(l.expected_qty), Number(l.counted_qty), Number(l.unit_cost), ruleFor);
    const why = reasons[l.id] ?? l.reason ?? '';
    const unit = l.stock_unit ?? '';
    return (
      <li key={l.id} className={cn('space-y-1.5 px-3 py-2.5 text-sm', diff !== 0 && 'bg-amber-50/50 dark:bg-amber-500/5')}>
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate font-medium">{l.item_name}</span>
            <span className="block text-xs text-muted-foreground">
              Expected {fmtQty(Number(l.expected_qty))} {unit} · counted {fmtQty(Number(l.counted_qty))} {unit}
              {l.counted_as && l.counted_as !== `${fmtQty(Number(l.counted_qty))} ${unit}` ? ` (${l.counted_as})` : ''}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className={cn('block tabular-nums font-semibold', diff < 0 ? 'text-destructive' : diff > 0 ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>
              {diff === 0 ? 'Matches' : `${signed(diff)} ${unit}`}
            </span>
            {diff !== 0 && <span className="block text-xs tabular-nums text-muted-foreground">{value < 0 ? '−' : '+'}{formatNairaCompact(Math.abs(value))}</span>}
          </span>
        </div>
        {diff !== 0 && (editable
          ? (must || why) && (
            <Input aria-label={`Reason for the difference in ${l.item_name}`} value={why}
              placeholder={must ? 'Reason for this difference (needed before approval)' : 'Reason (optional)'}
              className={cn('h-9 text-sm', must && !why.trim() && 'border-amber-400')}
              onChange={(e) => setReasons((p) => ({ ...p, [l.id]: e.target.value }))} />
          )
          : why && <p className="text-xs text-muted-foreground">Reason: {why}</p>)}
      </li>
    );
  };

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  let lastPlace: string | null = null;

  return (
    <div className="space-y-5">
      {/* ── A count waiting for approval ── */}
      {pending ? (
        <section className="overflow-hidden rounded-2xl border">
          <div className="flex flex-col gap-3 border-b bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold">{pending.kind === 'opening' ? 'Opening count' : 'Count'} {pending.count_number}</h2>
                <StatusPill tone="pending" label="Waiting for approval" />
              </div>
              <p className="text-sm text-muted-foreground">
                Counted {format(parseISO(pending.count_date), 'EEE d MMM yyyy')}
                {pending.counted_by && names[pending.counted_by] ? ` by ${names[pending.counted_by]}` : ''}.
                {' '}No stock has changed yet.
              </p>
              {pending.notes && <p className="mt-1 text-sm">{pending.notes}</p>}
            </div>
            {mayDecide ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => { setDecisionNote(''); setDeciding('reject'); }}><Undo2 className="mr-2 h-4 w-4" />Send back</Button>
                <Button onClick={() => { setDecisionNote(''); setDeciding('approve'); }} disabled={summary.unexplained > 0}>
                  <CheckCircle2 className="mr-2 h-4 w-4" />Approve
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {ownCount && canApprove ? 'You did this count, so someone else approves it.' : pending.kind === 'opening' ? 'The owner approves an opening count.' : 'A manager or the owner approves it.'}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            <Stat label="Items counted" value={String(summary.counted)} />
            <Stat label="Items that differ" value={String(summary.differ)} tone={summary.differ ? 'warn' : undefined} />
            <Stat label="Short" value={formatNairaCompact(summary.shortValue)} tone={summary.shortValue ? 'bad' : undefined} />
            <Stat label="Over" value={formatNairaCompact(summary.overValue)} />
          </div>
          {summary.unexplained > 0 && (
            <p className="mx-4 mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              {summary.unexplained} difference{summary.unexplained === 1 ? '' : 's'} above {rule.pct}% of expected or {formatNairaCompact(rule.valueMinor / 100)} still need{summary.unexplained === 1 ? 's' : ''} a reason before the count can be approved.
              {!mayDecide && ' Tell the approver what happened.'}
            </p>
          )}
          <ul className="divide-y border-t">
            {pendingLines.map((l) => lineRow(l, mayDecide, pending.kind === 'opening' ? { pct: Infinity, valueMinor: Infinity } : rule))}
          </ul>
        </section>
      ) : (
        <section className="flex flex-col gap-3 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold">Weekly count</h2>
            <p className="text-sm text-muted-foreground">
              Count what is on the shelf. You will not see what the records expect until you submit, so the count is a real one.
              Stock changes only when a manager approves it.
            </p>
          </div>
          {canCount && <Button onClick={openSheet} className="shrink-0"><ClipboardCheck className="mr-2 h-4 w-4" />Start a count</Button>}
        </section>
      )}

      {/* ── Earlier counts ── */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earlier counts</h3>
        {past.length === 0 ? (
          <EmptyState icon={ClipboardCheck} tone="neutral" title="No counts yet" body="Approved and sent-back counts are listed here." />
        ) : (
          <ul className="divide-y rounded-xl border">
            {past.map((c) => {
              const s = countSummary(c.stock_count_lines);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => setViewing(c)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/40">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.kind === 'opening' ? 'Opening count' : 'Count'} {c.count_number}</span>
                      <span className="block text-xs text-muted-foreground">
                        {format(parseISO(c.count_date), 'd MMM yyyy')} · {s.counted} counted · {s.differ} differed
                        {s.differ > 0 && c.status === 'approved' ? ` · net ${s.netValue < 0 ? '−' : '+'}${formatNairaCompact(Math.abs(s.netValue))}` : ''}
                      </span>
                    </span>
                    {c.status === 'approved' ? <StatusPill tone="good" label="Approved" /> : <StatusPill tone="neutral" label="Sent back" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── The count sheet ── */}
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        size="wide"
        title={kind === 'opening' ? 'Opening count' : 'Weekly count'}
        description="Type what is on the shelf. Leave a line blank only if you did not count it: blank is not zero."
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <span className="text-sm sm:mr-auto" role="status">
              <b className="tabular-nums">{countedIds.length}</b> of {sheetItems.length} counted
              <span className="text-muted-foreground"> · saved on this device as you go</span>
            </span>
            <div className="flex gap-2.5">
              <Button variant="outline" className="h-11 flex-1 sm:flex-none" onClick={() => setSheetOpen(false)}>Close</Button>
              <Button className="h-11 flex-[2] sm:flex-none" onClick={submitCount} disabled={saving || countedIds.length === 0}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit count
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <Field id="count-date" label="Date counted">
              <Input id="count-date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {isAdmin && (
              <div role="radiogroup" aria-label="What this count is" className="grid grid-cols-2 gap-2 self-end">
                {([['weekly', 'Weekly count'], ['opening', 'Opening count']] as const).map(([v, label]) => (
                  <button key={v} type="button" role="radio" aria-checked={kind === v} onClick={() => setKind(v)}
                    className={cn('h-11 rounded-xl border text-sm font-semibold', kind === v ? 'border-primary bg-primary/5' : 'text-muted-foreground')}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {kind === 'opening' && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              A full count posted as the new starting point, once every item has its right stock unit and pack sizes. Earlier
              movements stay on record, marked as before the opening count, and are left out of balances and usage from then on.
            </p>
          )}
          {leftOut > 0 && kind !== 'opening' && (
            <p className="text-xs text-muted-foreground">
              {leftOut} item{leftOut === 1 ? ' is' : 's are'} left out of the weekly count (set under Edit item) and not on this sheet.
            </p>
          )}

          <div className="rounded-xl border">
            {sheetItems.map((s) => {
              const place = unitsBySku.get(s.id)?.storagePlace?.trim() || 'No storage place set';
              const heading = place !== lastPlace ? place : null;
              lastPlace = place;
              const pack = packOf(s.id);
              const unit = unitOf(s);
              const e = entries[s.id];
              const done = !isUncounted(e);
              return (
                <div key={s.id}>
                  {heading && <div className="border-b bg-muted/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{heading}</div>}
                  <div className={cn('flex flex-col gap-2 border-b px-3 py-2.5 last:border-b-0 sm:flex-row sm:items-center', done && 'bg-green-50/40 dark:bg-green-500/5')}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{s.name}</div>
                      {done && pack && <div className="text-xs text-muted-foreground">= {fmtQty(countedQty(e!, pack.factor))} {unit}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      {pack && (
                        <>
                          <Input type="number" inputMode="decimal" min="0" step="any" className="h-11 w-20 text-right text-base tabular-nums"
                            aria-label={`${s.name}: whole ${pack.name}`} value={e?.packs ?? ''} placeholder="0"
                            onChange={(ev) => setEntry(s.id, { packs: ev.target.value })} />
                          <span className="w-12 text-xs text-muted-foreground">{pack.name}</span>
                          <span className="text-xs text-muted-foreground">and</span>
                        </>
                      )}
                      <Input type="number" inputMode="decimal" min="0" step="any" className="h-11 w-24 text-right text-base tabular-nums"
                        aria-label={`${s.name}: ${pack ? 'loose ' : ''}${unit}`} value={e?.loose ?? ''} placeholder={pack ? '0' : ''}
                        onChange={(ev) => setEntry(s.id, { loose: ev.target.value })} />
                      <span className="w-12 text-xs text-muted-foreground">{unit}</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {sheetItems.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">No items to count.</p>}
          </div>

          <Field id="count-notes" label="Notes">
            <Textarea id="count-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the approver should know: a freezer that failed, stock moved between stores" />
          </Field>
        </div>
      </FormSheet>

      {/* ── Approve or send back ── */}
      <Dialog open={!!deciding} onOpenChange={(o) => { if (!o) setDeciding(null); }}>
        {deciding && pending && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{deciding === 'approve' ? `Approve ${pending.count_number}` : `Send ${pending.count_number} back`}</DialogTitle>
              <DialogDescription>
                {deciding === 'approve'
                  ? `${summary.differ} item${summary.differ === 1 ? '' : 's'} will be corrected to the count: ${formatNairaCompact(summary.shortValue)} short and ${formatNairaCompact(summary.overValue)} over. Each is recorded as a count difference with your name, and cannot be edited afterwards.`
                  : 'No stock is changed. The store keeper is told why and can count again.'}
              </DialogDescription>
            </DialogHeader>
            <Field id="decision-note" label={deciding === 'approve' ? 'Note (optional)' : 'Why is it being sent back?'} required={deciding === 'reject'}>
              <Textarea id="decision-note" rows={3} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)}
                placeholder={deciding === 'approve' ? '' : 'e.g. count the dry store again; the rice figure cannot be right'} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeciding(null)}>Cancel</Button>
              <Button onClick={decide} disabled={busy || (deciding === 'reject' && !decisionNote.trim())}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{deciding === 'approve' ? 'Approve and correct stock' : 'Send back'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* ── An earlier count ── */}
      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) setViewing(null); }}>
        {viewing && (
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{viewing.kind === 'opening' ? 'Opening count' : 'Count'} {viewing.count_number}</DialogTitle>
              <DialogDescription>
                Counted {format(parseISO(viewing.count_date), 'd MMM yyyy')}
                {viewing.counted_by && names[viewing.counted_by] ? ` by ${names[viewing.counted_by]}` : ''}.
                {' '}{viewing.status === 'approved' ? 'Approved' : 'Sent back'}
                {viewing.decided_at ? ` on ${format(parseISO(viewing.decided_at), 'd MMM yyyy')}` : ''}
                {viewing.decided_by && names[viewing.decided_by] ? ` by ${names[viewing.decided_by]}` : ''}.
                {viewing.decision_note ? ` ${viewing.decision_note}` : ''}
              </DialogDescription>
            </DialogHeader>
            <ul className="divide-y rounded-lg border">
              {[...viewing.stock_count_lines]
                .sort((a, b) => Math.abs(Number(b.difference) * Number(b.unit_cost)) - Math.abs(Number(a.difference) * Number(a.unit_cost)))
                .map((l) => lineRow(l, false, rule))}
            </ul>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-bold tabular-nums', tone === 'warn' && 'text-amber-700 dark:text-amber-400', tone === 'bad' && 'text-destructive')}>{value}</div>
    </div>
  );
}
