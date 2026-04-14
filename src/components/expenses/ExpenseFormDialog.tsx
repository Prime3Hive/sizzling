import React, { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { EXPENSE_CATEGORIES, ACCOUNT_TYPES, COST_CENTERS, PAYMENT_METHODS } from '@/lib/expenseConstants';

const expenseSchema = z.object({
  amount: z.number().positive('Amount must be positive').max(999999999, 'Amount too large'),
  description: z.string().min(1, 'Description required').max(500, 'Description too long'),
  category: z.string().min(1, 'Category required').max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  budgetId: z.string().uuid('Invalid budget'),
  accountType: z.string().max(50).optional(),
  costCenter: z.string().max(100).optional(),
  bankAccount: z.string().max(100).optional(),
  paymentMethod: z.string().max(50).optional(),
});

interface ExpenseFormDialogProps {
  budgets: { id: string; title: string }[];
  onExpenseAdded: () => void;
}

const ExpenseFormDialog = ({ budgets, onExpenseAdded }: ExpenseFormDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    amount: '',
    description: '',
    category: '',
    date: new Date().toISOString().split('T')[0],
    budgetId: budgets.length === 1 ? budgets[0].id : '',
    accountType: 'COGS',
    costCenter: 'Daily Orders',
    bankAccount: '',
    paymentMethod: '',
  });

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file type', description: 'Please select an image file.', variant: 'destructive' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Please select an image smaller than 5MB.', variant: 'destructive' });
      return;
    }
    setReceiptFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setReceiptPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const uploadReceipt = async (): Promise<string | null> => {
    if (!receiptFile || !user) return null;
    setIsUploading(true);
    try {
      const fileExt = receiptFile.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      const { error } = await supabase.storage.from('receipts').upload(fileName, receiptFile);
      if (error) throw error;
      return fileName;
    } catch (error: any) {
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      amount: '', description: '', category: '',
      date: new Date().toISOString().split('T')[0],
      budgetId: budgets.length === 1 ? budgets[0].id : '',
      accountType: 'COGS', costCenter: 'Daily Orders', bankAccount: '', paymentMethod: '',
    });
    setReceiptFile(null);
    setReceiptPreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.budgetId) {
      toast({ title: 'Budget required', description: 'Please select a budget.', variant: 'destructive' });
      return;
    }

    // Validate with Zod
    const validation = expenseSchema.safeParse({
      amount: parseFloat(formData.amount),
      description: formData.description,
      category: formData.category,
      date: formData.date,
      budgetId: formData.budgetId,
      accountType: formData.accountType,
      costCenter: formData.costCenter,
      bankAccount: formData.bankAccount || undefined,
      paymentMethod: formData.paymentMethod || undefined,
    });

    if (!validation.success) {
      const firstError = validation.error.errors[0];
      toast({ title: 'Validation Error', description: firstError.message, variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      let receiptPath = null;
      if (receiptFile) {
        receiptPath = await uploadReceipt();
        if (!receiptPath) return;
      }
      const { error } = await supabase.from('expenses').insert({
        amount: validation.data.amount,
        description: validation.data.description,
        category: validation.data.category,
        date: validation.data.date,
        budget_id: validation.data.budgetId,
        receipt_path: receiptPath,
        account_type: validation.data.accountType || 'COGS',
        cost_center: validation.data.costCenter || 'Daily Orders',
        bank_account: validation.data.bankAccount || null,
        payment_method: validation.data.paymentMethod || null,
      });
      if (error) throw error;
      toast({ title: 'Expense added!', description: 'Your expense has been recorded.' });
      setIsOpen(false);
      resetForm();
      onExpenseAdded();
    } catch (error: any) {
      toast({ title: 'Error adding expense', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="mr-2 h-4 w-4" />Add Expense</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Expense</DialogTitle>
          <DialogDescription>Record a new expense to track your spending</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (₦)</Label>
              <Input id="amount" type="number" step="0.01" min="0" placeholder="0.00" value={formData.amount} onChange={(e) => handleInputChange('amount', e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={formData.date} onChange={(e) => handleInputChange('date', e.target.value)} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" placeholder="What did you spend money on?" value={formData.description} onChange={(e) => handleInputChange('description', e.target.value)} required />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={formData.category} onValueChange={(v) => handleInputChange('category', v)} required>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>{EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Budget</Label>
              <Select value={formData.budgetId} onValueChange={(v) => handleInputChange('budgetId', v)} required>
                <SelectTrigger><SelectValue placeholder="Select budget" /></SelectTrigger>
                <SelectContent>{budgets.map(b => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Account Type</Label>
              <Select value={formData.accountType} onValueChange={(v) => handleInputChange('accountType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ACCOUNT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cost Center</Label>
              <Select value={formData.costCenter} onValueChange={(v) => handleInputChange('costCenter', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{COST_CENTERS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Bank Account (Optional)</Label>
              <Input placeholder="e.g. Main Account" value={formData.bankAccount} onChange={(e) => handleInputChange('bankAccount', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Payment Method (Optional)</Label>
              <Select value={formData.paymentMethod} onValueChange={(v) => handleInputChange('paymentMethod', v)}>
                <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                <SelectContent>{PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Receipt (Optional)</Label>
            {!receiptPreview ? (
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-input rounded-lg cursor-pointer bg-muted/50 hover:bg-muted transition-colors">
                <div className="flex flex-col items-center pt-5 pb-6">
                  <p className="mb-2 text-sm text-muted-foreground"><span className="font-semibold">Click to upload</span> receipt image</p>
                  <p className="text-xs text-muted-foreground">PNG, JPG or JPEG (MAX. 5MB)</p>
                </div>
                <Input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
              </label>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <img src={receiptPreview} alt="Receipt preview" className="w-full max-w-md h-48 object-cover rounded-lg border" />
                  <Button type="button" variant="destructive" size="sm" className="absolute top-2 right-2" onClick={() => { setReceiptFile(null); setReceiptPreview(null); }}>Remove</Button>
                </div>
                <p className="text-sm text-muted-foreground">Receipt: {receiptFile?.name}</p>
              </div>
            )}
          </div>
          {budgets.length === 0 && (
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Create a budget first before adding expenses.</p>
            </div>
          )}
          <div className="flex gap-4">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" disabled={isSubmitting || isUploading || budgets.length === 0} className="flex-1">
              {isSubmitting ? 'Adding...' : isUploading ? 'Uploading...' : 'Add Expense'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ExpenseFormDialog;
