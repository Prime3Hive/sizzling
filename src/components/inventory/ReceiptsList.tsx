import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Loader2, PackagePlus, Receipt, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form-sheet';
import { ResponsiveTable, type ResponsiveColumn } from '@/components/ui/responsive-table';
import { TablePagination } from '@/components/ui/table-pagination';
import { EmptyState, StatusPill } from '@/components/shell/ui';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { usePagination } from '@/hooks/usePagination';
import { useStockReceipts, type StockReceipt } from '@/hooks/useStockReceipts';
import { formatNairaCompact } from '@/lib/currency';
import { fmtQty } from '@/lib/units';

// Past receipts: every purchase received, newest first. Open one to see its
// lines; a manager or the owner can reverse it, which takes the stock and the
// expenses back together.

const db = supabase as any;
const naira = (minor: number) => formatNairaCompact(Number(minor) / 100);

export default function ReceiptsList({ canReceive, canReverse, onReceive }: {
  canReceive: boolean;
  canReverse: boolean;
  onReceive: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useStockReceipts();
  const receipts = useMemo(() => data?.receipts ?? [], [data]);
  const unpaid = data?.unpaid ?? new Set<string>();
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reversing, setReversing] = useState<StockReceipt | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: names = {} } = useQuery<Record<string, string>>({
    queryKey: ['profiles-directory-map'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('user_id, full_name');
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p) => [p.user_id, p.full_name ?? '']));
    },
    staleTime: 5 * 60_000,
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return receipts;
    return receipts.filter((r) =>
      r.receipt_number.toLowerCase().includes(q)
      || r.supplier_name.toLowerCase().includes(q)
      || (r.lpos?.lpo_number ?? '').toLowerCase().includes(q)
      || r.stock_receipt_lines.some((l) => l.description.toLowerCase().includes(q)));
  }, [receipts, search]);
  const pages = usePagination(shown, 25);
  const open = receipts.find((r) => r.id === openId) ?? null;

  const viewPhoto = async (path: string) => {
    const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { toast({ title: 'Could not open the receipt photo', variant: 'destructive' }); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const reverse = async () => {
    if (!reversing || reason.trim().length < 5) return;
    setBusy(true);
    try {
      const { error } = await db.rpc('fn_reverse_stock_receipt', { p_receipt_id: reversing.id, p_reason: reason.trim() });
      if (error) throw new Error(error.message);
      toast({ title: `${reversing.receipt_number} reversed`, description: 'The stock and its expenses were taken back together.' });
      setReversing(null); setOpenId(null);
      for (const key of [
        ['stock-receipts'], ['inventory-data'], ['inventory-item'], ['item-units'], ['skus-for-stock-in'], ['expenses'],
        ['lpos'], ['admin-payables'], ['profit-and-loss'], ['journal-entries'], ['journal-all-lines'], ['budgets-with-spend'], ['ops-low-stock'],
      ]) qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: 'Could not reverse the receipt', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const pill = (r: StockReceipt) => r.status === 'reversed'
    ? <StatusPill tone="neutral" label="Reversed" />
    : r.payment_method === 'Credit'
      ? (r.payable_id && unpaid.has(r.payable_id) ? <StatusPill tone="pending" label="Owed" /> : <StatusPill tone="info" label="On credit" />)
      : <StatusPill tone="good" label={r.payment_method === 'Cash' ? 'Paid, cash' : 'Paid, transfer'} />;

  const columns: ResponsiveColumn<StockReceipt>[] = [
    {
      key: 'number', header: 'Receipt', primary: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{r.supplier_name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {r.receipt_number}{r.lpos?.lpo_number ? ` · ${r.lpos.lpo_number}` : ' · market run'}
          </div>
        </div>
      ),
    },
    {
      key: 'total', header: 'Total', align: 'right',
      cell: (r) => <span className={r.status === 'reversed' ? 'tabular-nums text-muted-foreground line-through' : 'tabular-nums font-semibold'}>{naira(r.total_minor)}</span>,
    },
    { key: 'date', header: 'Date', cell: (r) => <span className="text-sm text-muted-foreground">{format(parseISO(r.received_date), 'd MMM yyyy')}</span> },
    { key: 'status', header: 'Status', cell: pill },
    {
      key: 'lines', header: 'Lines', hideOnMobile: true,
      cell: (r) => <span className="block max-w-xs truncate text-sm text-muted-foreground">{r.stock_receipt_lines.map((l) => l.description).join(', ')}</span>,
    },
    {
      key: 'by', header: 'Received by', hideOnMobile: true,
      cell: (r) => <span className="whitespace-nowrap text-sm text-muted-foreground">{r.created_by ? names[r.created_by] || '—' : '—'}</span>,
    },
  ];

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Every purchase received, newest first. Each one added its stock and recorded its expenses in one step.
        </p>
        <div className="flex gap-2">
          <Input aria-label="Search receipts" placeholder="Search supplier, item or number" value={search}
            onChange={(e) => setSearch(e.target.value)} className="sm:w-64" />
          {canReceive && <Button onClick={onReceive} className="shrink-0"><PackagePlus className="mr-2 h-4 w-4" />Receive</Button>}
        </div>
      </div>

      <ResponsiveTable
        columns={columns}
        data={pages.pageData}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpenId(r.id)}
        emptyState={<EmptyState icon={Receipt} tone="neutral"
          title={search ? 'No receipts match' : 'No receipts yet'}
          body={search ? undefined : 'A purchase recorded with Receive appears here.'}
          action={!search && canReceive ? <Button onClick={onReceive}><PackagePlus className="mr-2 h-4 w-4" />Receive</Button> : undefined} />}
      />
      <TablePagination page={pages.page} pageCount={pages.pageCount} total={pages.total} pageSize={pages.pageSize} onPageChange={pages.setPage} />

      {/* ── One receipt ── */}
      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        {open && (
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{open.receipt_number} · {open.supplier_name}</DialogTitle>
              <DialogDescription>
                Received {format(parseISO(open.received_date), 'd MMM yyyy')}
                {open.created_by && names[open.created_by] ? ` by ${names[open.created_by]}` : ''}
                {open.lpos?.lpo_number ? `, against ${open.lpos.lpo_number}` : ', a market run'}
                {' '}· {open.payment_method === 'Credit' ? 'on credit' : `paid by ${open.payment_method.toLowerCase()}`}.
              </DialogDescription>
            </DialogHeader>

            {open.status === 'reversed' && (
              <div className="rounded-lg border bg-muted/50 px-3 py-2 text-sm">
                <span className="font-medium">Reversed</span>
                {open.reversed_at ? ` on ${format(parseISO(open.reversed_at), 'd MMM yyyy')}` : ''}
                {open.reversed_by && names[open.reversed_by] ? ` by ${names[open.reversed_by]}` : ''}
                {open.reversal_reason ? `: ${open.reversal_reason}` : '.'}
              </div>
            )}

            <ul className="divide-y rounded-lg border text-sm">
              {open.stock_receipt_lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{l.description}</span>
                    <span className="block text-xs text-muted-foreground">
                      {l.kind === 'stock'
                        ? <>
                            {l.entered_qty != null ? `${fmtQty(Number(l.entered_qty))} ${l.entered_unit ?? ''}` : ''}
                            {l.entered_unit && l.entered_unit !== l.stock_unit ? ` = ${fmtQty(Number(l.stock_qty))} ${l.stock_unit ?? ''}` : ''}
                            {l.unit_cost != null ? ` · ${formatNairaCompact(Number(l.unit_cost))} per ${l.stock_unit ?? 'unit'}` : ''}
                            {' '}· {l.category}
                          </>
                        : <>Expense only · {l.category}</>}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums font-medium">{naira(l.amount_minor)}</span>
                </li>
              ))}
              <li className="flex justify-between gap-3 px-3 py-2 font-semibold">
                <span>Total</span><span className="tabular-nums">{naira(open.total_minor)}</span>
              </li>
            </ul>

            {open.notes && <p className="text-sm text-muted-foreground">{open.notes}</p>}
            {!open.receipt_path && open.no_receipt_reason && (
              <p className="text-xs text-muted-foreground">No receipt photo: {open.no_receipt_reason}</p>
            )}

            <DialogFooter>
              {open.receipt_path && (
                <Button variant="outline" onClick={() => viewPhoto(open.receipt_path!)}><Receipt className="mr-2 h-4 w-4" />Receipt photo</Button>
              )}
              {canReverse && open.status === 'posted' && (
                <Button variant="outline" className="text-destructive hover:text-destructive"
                  onClick={() => { setReason(''); setReversing(open); }}>
                  <Undo2 className="mr-2 h-4 w-4" />Reverse receipt
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* ── Reverse ── */}
      <Dialog open={!!reversing} onOpenChange={(o) => { if (!o) setReversing(null); }}>
        {reversing && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Reverse {reversing.receipt_number}</DialogTitle>
              <DialogDescription>
                This takes {naira(reversing.total_minor)} of stock and expenses back together: the stock leaves with a reversing
                entry, the expenses are cancelled, and each item’s average cost goes back to what it was. It is kept on record
                with your name and the reason. It is refused if some of the stock has already been used, or the supplier has
                already been paid.
              </DialogDescription>
            </DialogHeader>
            <Field id="reverse-reason" label="Why is it being reversed?" required>
              <Textarea id="reverse-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. entered twice; wrong supplier; goods returned the same day" />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReversing(null)}>Cancel</Button>
              <Button variant="destructive" onClick={reverse} disabled={busy || reason.trim().length < 5}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reverse receipt
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
