import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Plus, Trash2, Layers, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { formatNairaCompact } from '@/lib/currency';
import { EXPENSE_CATEGORIES, ACCOUNT_TYPES, COST_CENTERS } from '@/lib/expenseConstants';

interface Props {
  budgets: { id: string; title: string }[];
  onDone: () => void;
}

interface Row {
  date: string;
  category: string;
  amount: string;
  description: string;
  account_type: string;
  cost_center: string;
  budget_id: string; // '' = none
}

const blankRow = (): Row => ({
  date: new Date().toISOString().split('T')[0],
  category: '',
  amount: '',
  description: '',
  account_type: 'COGS',
  cost_center: 'Daily Orders',
  budget_id: '',
});

export default function BulkExpenseDialog({ budgets, onDone }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([blankRow(), blankRow()]);
  const [saving, setSaving] = useState(false);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows(prev => [...prev, blankRow()]);
  const removeRow = (i: number) => setRows(prev => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const total = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  const reset = () => setRows([blankRow(), blankRow()]);

  const save = async () => {
    const valid = rows.filter(r => (parseFloat(r.amount) || 0) > 0 && r.description.trim() && r.category);
    if (valid.length === 0) {
      toast({ title: 'Add at least one complete row', description: 'Each row needs a category, amount and description.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload = valid.map(r => ({
        amount: parseFloat(r.amount),
        description: r.description.trim(),
        category: r.category,
        date: r.date,
        budget_id: r.budget_id || null,
        account_type: r.account_type || 'COGS',
        cost_center: r.cost_center || 'Daily Orders',
        created_by: user?.id,
      }));
      const { error } = await supabase.from('expenses').insert(payload);
      if (error) throw error;
      toast({ title: `${valid.length} expense${valid.length === 1 ? '' : 's'} added`, description: `Total ${formatNairaCompact(total)}` });
      setOpen(false);
      reset();
      onDone();
    } catch (e: any) {
      toast({ title: 'Error adding expenses', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline"><Layers className="mr-2 h-4 w-4" />Add Multiple</Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Multiple Expenses</DialogTitle>
          <DialogDescription>Record several expenses at once — each row can have its own category and budget.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="hidden md:grid grid-cols-12 gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span className="col-span-2">Date</span>
            <span className="col-span-2">Category</span>
            <span className="col-span-2">Amount</span>
            <span className="col-span-3">Description</span>
            <span className="col-span-2">Budget</span>
            <span className="col-span-1" />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-center rounded-lg border p-2 md:p-0 md:border-0">
              <Input className="col-span-2 h-9" type="date" value={r.date} onChange={e => setRow(i, { date: e.target.value })} />
              <div className="col-span-2">
                <Select value={r.category || undefined} onValueChange={v => setRow(i, { category: v })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>{EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Input className="col-span-2 h-9" type="number" min="0" step="0.01" placeholder="0.00" value={r.amount} onChange={e => setRow(i, { amount: e.target.value })} />
              <Input className="col-span-2 md:col-span-3 h-9" placeholder="Description" value={r.description} onChange={e => setRow(i, { description: e.target.value })} />
              <div className="col-span-2">
                <Select value={r.budget_id || 'none'} onValueChange={v => setRow(i, { budget_id: v === 'none' ? '' : v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No budget</SelectItem>
                    {budgets.map(b => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 md:col-span-1 flex justify-end">
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removeRow(i)} disabled={rows.length <= 1}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {/* secondary fields */}
              <div className="col-span-2 md:col-span-12 grid grid-cols-2 gap-2 md:pl-0">
                <Select value={r.account_type} onValueChange={v => setRow(i, { account_type: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Account type" /></SelectTrigger>
                  <SelectContent>{ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={r.cost_center} onValueChange={v => setRow(i, { cost_center: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Cost center" /></SelectTrigger>
                  <SelectContent>{COST_CENTERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" /> Add row
          </Button>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <span className="text-sm text-muted-foreground mr-auto self-center">Total: <span className="font-semibold text-foreground">{formatNairaCompact(total)}</span></span>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save All
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
