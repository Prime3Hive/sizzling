import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { formatNairaCompact } from '@/lib/currency';
import { format, startOfWeek, endOfWeek, eachWeekOfInterval, startOfMonth, endOfMonth } from 'date-fns';
import { MONTHS } from '@/lib/expenseConstants';

interface Sale {
  id: string;
  sale_date: string;
  sale_number: string;
  sale_type: string | null;
  total_amount: number;
  customer_name: string | null;
  notes: string | null;
  status: string;
}

interface WeeklySalesEntryProps {
  sales: Sale[];
  selectedYear: string;
  onSaleAdded: () => void;
}

const WeeklySalesEntry = ({ sales, selectedYear, onSaleAdded }: WeeklySalesEntryProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const currentMonth = new Date().getMonth();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth.toString());
  const [showDialog, setShowDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editSale, setEditSale] = useState<Sale | null>(null);

  const monthIndex = parseInt(selectedMonth);
  const yearNum = parseInt(selectedYear);

  const monthStart = startOfMonth(new Date(yearNum, monthIndex));
  const monthEnd = endOfMonth(new Date(yearNum, monthIndex));

  const monthSales = sales.filter(s => {
    const d = new Date(s.sale_date);
    return d.getMonth() === monthIndex && d.getFullYear() === yearNum;
  });

  const weeks = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 1 });
  const weeklyData = weeks.map((weekStart, idx) => {
    const wEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
    const weekSales = monthSales.filter(s => {
      const d = new Date(s.sale_date);
      return d >= weekStart && d <= wEnd;
    });
    const shopSales = weekSales.filter(s => (s.sale_type || 'daily') === 'daily').reduce((sum, s) => sum + Number(s.total_amount), 0);
    const eventSales = weekSales.filter(s => s.sale_type === 'event').reduce((sum, s) => sum + Number(s.total_amount), 0);
    return { weekNum: idx + 1, start: weekStart, end: wEnd, shopSales, eventSales, total: shopSales + eventSales, entries: weekSales };
  });

  const monthTotalShop = weeklyData.reduce((s, w) => s + w.shopSales, 0);
  const monthTotalEvent = weeklyData.reduce((s, w) => s + w.eventSales, 0);
  const monthTotal = monthTotalShop + monthTotalEvent;

  const generateSaleNumber = () => {
    const d = new Date();
    // Use crypto.randomUUID for collision-resistant IDs
    const uniqueId = crypto.randomUUID().slice(0, 8).toUpperCase();
    return `WS-${format(d, 'yyyyMMdd')}-${uniqueId}`;
  };

  const handleAddSale = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    try {
      const { error } = await supabase.from('sales').insert({
        user_id: user.id,
        created_by: user.id,
        sale_number: generateSaleNumber(),
        sale_date: formData.get('sale_date') as string,
        sale_type: formData.get('sale_type') as string,
        total_amount: parseFloat(formData.get('total_amount') as string),
        customer_name: (formData.get('customer_name') as string) || null,
        notes: (formData.get('notes') as string) || null,
        status: 'completed',
      });
      if (error) throw error;
      toast({ title: 'Success', description: 'Sales entry recorded' });
      setShowDialog(false);
      onSaleAdded();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditSale = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editSale) return;
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    try {
      const { error } = await supabase.from('sales').update({
        sale_date: formData.get('sale_date') as string,
        sale_type: formData.get('sale_type') as string,
        total_amount: parseFloat(formData.get('total_amount') as string),
        customer_name: (formData.get('customer_name') as string) || null,
        notes: (formData.get('notes') as string) || null,
      }).eq('id', editSale.id);
      if (error) throw error;
      toast({ title: 'Updated', description: 'Sales entry updated' });
      setEditSale(null);
      onSaleAdded();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSale = async (id: string) => {
    try {
      const { error } = await supabase.from('sales').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Deleted', description: 'Sales entry removed' });
      onSaleAdded();
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const SaleForm = ({ onSubmit, defaults, title }: { onSubmit: (e: React.FormEvent<HTMLFormElement>) => void; defaults?: Sale; title: string }) => (
    <form onSubmit={onSubmit}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <div className="grid gap-4 py-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Date / Week Ending</Label>
            <Input name="sale_date" type="date" defaultValue={defaults?.sale_date || format(new Date(), 'yyyy-MM-dd')} required />
          </div>
          <div className="grid gap-2">
            <Label>Sales Type</Label>
            <Select name="sale_type" defaultValue={defaults?.sale_type || 'daily'}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Shop Sales</SelectItem>
                <SelectItem value="event">Event Sales</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label>Total Amount (₦)</Label>
          <Input name="total_amount" type="number" step="0.01" min="0" required defaultValue={defaults?.total_amount || ''} placeholder="e.g. 500000" />
        </div>
        <div className="grid gap-2">
          <Label>Description / Label</Label>
          <Input name="customer_name" defaultValue={defaults?.customer_name || ''} placeholder="e.g. Week 1 Shop Sales" />
        </div>
        <div className="grid gap-2">
          <Label>Notes (optional)</Label>
          <Textarea name="notes" defaultValue={defaults?.notes || ''} placeholder="Additional details..." />
        </div>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Save Entry'}</Button>
      </DialogFooter>
    </form>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Weekly Sales — {MONTHS[monthIndex]} {selectedYear}</h3>
        <div className="flex items-center gap-3">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={i.toString()}>{m}</SelectItem>)}</SelectContent>
          </Select>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Sales Entry</Button>
            </DialogTrigger>
            <DialogContent>
              <SaleForm onSubmit={handleAddSale} title="Record Weekly Sales" />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Weekly Summary */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Weekly Breakdown</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Shop Sales</TableHead>
                <TableHead className="text-right">Event Sales</TableHead>
                <TableHead className="text-right font-bold">Total</TableHead>
                <TableHead className="text-right">Entries</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeklyData.map(w => (
                <TableRow key={w.weekNum}>
                  <TableCell className="font-medium">Week {w.weekNum}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(w.start, 'dd MMM')} – {format(w.end, 'dd MMM')}</TableCell>
                  <TableCell className="text-right">{formatNairaCompact(w.shopSales)}</TableCell>
                  <TableCell className="text-right">{formatNairaCompact(w.eventSales)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatNairaCompact(w.total)}</TableCell>
                  <TableCell className="text-right"><Badge variant="outline">{w.entries.length}</Badge></TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-bold bg-muted/50">
                <TableCell colSpan={2}>MONTHLY TOTAL</TableCell>
                <TableCell className="text-right">{formatNairaCompact(monthTotalShop)}</TableCell>
                <TableCell className="text-right">{formatNairaCompact(monthTotalEvent)}</TableCell>
                <TableCell className="text-right">{formatNairaCompact(monthTotal)}</TableCell>
                <TableCell className="text-right"><Badge variant="outline">{monthSales.length}</Badge></TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Individual Entries with edit/delete */}
      {monthSales.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">All Sales Entries</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthSales.sort((a, b) => new Date(a.sale_date).getTime() - new Date(b.sale_date).getTime()).map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">{format(new Date(s.sale_date), 'dd MMM yyyy')}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.sale_number}</TableCell>
                    <TableCell className="text-sm">{s.customer_name || '-'}</TableCell>
                    <TableCell>
                      <Badge variant={(s.sale_type || 'daily') === 'daily' ? 'default' : 'secondary'} className="text-xs">
                        {(s.sale_type || 'daily') === 'daily' ? 'Shop' : 'Event'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatNairaCompact(Number(s.total_amount))}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditSale(s)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete sales entry?</AlertDialogTitle>
                              <AlertDialogDescription>This will permanently delete the sales entry "{s.customer_name || s.sale_number}" for {formatNairaCompact(Number(s.total_amount))}.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteSale(s.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editSale} onOpenChange={(open) => { if (!open) setEditSale(null); }}>
        <DialogContent>
          {editSale && <SaleForm onSubmit={handleEditSale} defaults={editSale} title={`Edit Sales Entry — ${editSale.customer_name || editSale.sale_number}`} />}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WeeklySalesEntry;
