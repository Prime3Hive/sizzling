import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, FileSpreadsheet, Search, CheckCircle, Clock, Users, DollarSign, Calendar, Pencil, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { formatNairaCompact } from '@/lib/currency';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { SALARY_PERIODS } from '@/lib/expenseConstants';

interface StaffProfile {
  id: string;
  full_name: string;
  salary: number | null;
  position: string;
  department_id: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  departments?: { name: string } | null;
}

interface PayrollRecord {
  id: string;
  staff_profile_id: string;
  staff_name: string;
  staff_id_number: string | null;
  department: string | null;
  position: string | null;
  salary_period: string;
  period_start: string;
  period_end: string;
  basic_salary: number;
  allowances: number;
  deductions: number;
  net_pay: number;
  payment_method: string | null;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  status: string;
  notes: string | null;
  paid_at: string | null;
  created_at: string;
}

const Payroll = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editRecord, setEditRecord] = useState<PayrollRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [allowances, setAllowances] = useState(0);
  const [deductions, setDeductions] = useState(0);

  const { data: staffProfiles = [] } = useQuery({
    queryKey: ['payroll-staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_profiles')
        .select('id, full_name, salary, position, department_id, bank_name, account_number, account_name, departments(name)')
        .order('full_name');
      if (error) throw error;
      return (data || []) as StaffProfile[];
    },
  });

  const { data: payrollRecords = [], isLoading } = useQuery({
    queryKey: ['payroll-records', periodFilter],
    queryFn: async () => {
      let query = supabase.from('payroll_records').select('*').order('created_at', { ascending: false });
      if (periodFilter && periodFilter !== 'all') query = query.eq('salary_period', periodFilter);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as PayrollRecord[];
    },
  });

  // Check for duplicate payroll
  const checkDuplicate = async (staffId: string, periodStart: string, periodEnd: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from('payroll_records')
      .select('id')
      .eq('staff_profile_id', staffId)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .limit(1);
    if (error) return false;
    return (data?.length || 0) > 0;
  };

  const generatePayrollMutation = useMutation({
    mutationFn: async (formData: { salary_period: string; period_start: string; period_end: string; allowances: number; deductions: number }) => {
      if (!user) throw new Error('Not authenticated');
      const staffWithSalary = staffProfiles.filter(s => s.salary && s.salary > 0);
      if (staffWithSalary.length === 0) throw new Error('No staff with salary found');

      // Check for duplicates
      const duplicateChecks = await Promise.all(
        staffWithSalary.map(s => checkDuplicate(s.id, formData.period_start, formData.period_end))
      );
      const newStaff = staffWithSalary.filter((_, i) => !duplicateChecks[i]);

      if (newStaff.length === 0) {
        throw new Error('Payroll already exists for all staff in this period. Change the dates or generate for individual staff.');
      }

      const skippedCount = staffWithSalary.length - newStaff.length;

      const records = newStaff.map(staff => ({
        user_id: user.id,
        staff_profile_id: staff.id,
        staff_name: staff.full_name,
        staff_id_number: `EMP-${staff.id.substring(0, 4).toUpperCase()}`,
        department: staff.departments?.name || null,
        position: staff.position,
        salary_period: formData.salary_period,
        period_start: formData.period_start,
        period_end: formData.period_end,
        basic_salary: staff.salary!,
        allowances: formData.allowances,
        deductions: formData.deductions,
        net_pay: staff.salary! + formData.allowances - formData.deductions,
        bank_name: staff.bank_name,
        account_number: staff.account_number,
        account_name: staff.account_name,
        status: 'pending',
      }));

      const { error } = await supabase.from('payroll_records').insert(records);
      if (error) throw error;
      return { created: newStaff.length, skipped: skippedCount };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-records'] });
      setShowDialog(false);
      setAllowances(0);
      setDeductions(0);
      const msg = result.skipped > 0
        ? `Created ${result.created} records. ${result.skipped} skipped (already exist).`
        : `Payroll generated for ${result.created} staff`;
      toast({ title: 'Success', description: msg });
    },
    onError: (error: any) => toast({ title: 'Error', description: error.message, variant: 'destructive' }),
  });

  const generateSingleMutation = useMutation({
    mutationFn: async (formData: { staff_profile_id: string; salary_period: string; period_start: string; period_end: string; basic_salary: number; allowances: number; deductions: number }) => {
      if (!user) throw new Error('Not authenticated');
      const staff = staffProfiles.find(s => s.id === formData.staff_profile_id);
      if (!staff) throw new Error('Staff not found');

      const isDuplicate = await checkDuplicate(staff.id, formData.period_start, formData.period_end);
      if (isDuplicate) {
        throw new Error(`Payroll for ${staff.full_name} already exists for this period (${formData.period_start} to ${formData.period_end}).`);
      }

      const { error } = await supabase.from('payroll_records').insert({
        user_id: user.id,
        staff_profile_id: staff.id,
        staff_name: staff.full_name,
        staff_id_number: `EMP-${staff.id.substring(0, 4).toUpperCase()}`,
        department: staff.departments?.name || null,
        position: staff.position,
        salary_period: formData.salary_period,
        period_start: formData.period_start,
        period_end: formData.period_end,
        basic_salary: formData.basic_salary,
        allowances: formData.allowances,
        deductions: formData.deductions,
        net_pay: formData.basic_salary + formData.allowances - formData.deductions,
        bank_name: staff.bank_name,
        account_number: staff.account_number,
        account_name: staff.account_name,
        status: 'pending',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-records'] });
      setShowDialog(false);
      setSelectedStaffId('');
      setAllowances(0);
      setDeductions(0);
      toast({ title: 'Success', description: 'Payroll entry created' });
    },
    onError: (error: any) => toast({ title: 'Error', description: error.message, variant: 'destructive' }),
  });

  // Edit mutation
  const editMutation = useMutation({
    mutationFn: async (data: { id: string; allowances: number; deductions: number; basic_salary: number; notes: string | null }) => {
      const net_pay = data.basic_salary + data.allowances - data.deductions;
      const { error } = await supabase.from('payroll_records')
        .update({ allowances: data.allowances, deductions: data.deductions, basic_salary: data.basic_salary, net_pay, notes: data.notes })
        .eq('id', data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-records'] });
      setEditRecord(null);
      toast({ title: 'Updated', description: 'Payroll record updated' });
    },
    onError: (error: any) => toast({ title: 'Error', description: error.message, variant: 'destructive' }),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('payroll_records').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-records'] });
      toast({ title: 'Deleted', description: 'Payroll record removed' });
    },
    onError: (error: any) => toast({ title: 'Error', description: error.message, variant: 'destructive' }),
  });

  const markPaidMutation = useMutation({
    mutationFn: async (id: string) => {
      const record = payrollRecords.find(r => r.id === id);
      if (!record) throw new Error('Record not found');

      const paidAt = new Date().toISOString();
      const { error } = await supabase.from('payroll_records').update({ status: 'paid', paid_at: paidAt }).eq('id', id);
      if (error) throw error;

      // Auto-record salary as OpEX expense
      const { data: budgets } = await supabase
        .from('budgets')
        .select('id')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (!budgets || budgets.length === 0) {
        throw new Error('No budget found. Please create a budget first before processing payroll.');
      }

      const { error: expError } = await supabase.from('expenses').insert({
        amount: Number(record.net_pay),
        description: `Salary payment — ${record.staff_name} (${format(new Date(record.period_start), 'dd MMM yyyy')} to ${format(new Date(record.period_end), 'dd MMM yyyy')})`,
        category: 'Salaries & Wages',
        date: record.period_end,
        budget_id: budgets[0].id,
        account_type: 'OpEX',
        cost_center: 'Daily Orders',
        payment_method: record.payment_method || null,
        bank_account: record.bank_name || null,
      });
      if (expError) throw expError;

      // Send notification to the staff member if they have a linked account
      try {
        const { data: staffProfile } = await supabase
          .from('staff_profiles')
          .select('linked_user_id')
          .eq('id', record.staff_profile_id)
          .single();

        if (staffProfile?.linked_user_id) {
          await supabase.from('notifications').insert({
            user_id: staffProfile.linked_user_id,
            title: 'Salary Paid',
            message: `Your salary of ${formatNairaCompact(Number(record.net_pay))} for ${format(new Date(record.period_start), 'dd MMM')} – ${format(new Date(record.period_end), 'dd MMM yyyy')} has been processed.`,
            type: 'payroll',
            related_id: id,
          });
        }
      } catch (notifErr) {
        console.error('Notification error (non-blocking):', notifErr);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-records'] });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['pl-expenses'] });
      toast({ title: 'Success', description: 'Marked as paid & recorded as OpEX expense' });
    },
  });

  const filteredRecords = useMemo(() => {
    return payrollRecords.filter(r => {
      const matchesSearch = r.staff_name.toLowerCase().includes(searchTerm.toLowerCase()) || (r.staff_id_number || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [payrollRecords, searchTerm, statusFilter]);

  const totalNetPay = filteredRecords.reduce((sum, r) => sum + Number(r.net_pay), 0);
  const totalBasic = filteredRecords.reduce((sum, r) => sum + Number(r.basic_salary), 0);
  const paidCount = filteredRecords.filter(r => r.status === 'paid').length;
  const pendingCount = filteredRecords.filter(r => r.status === 'pending').length;

  const exportToExcel = () => {
    const headers = ['S/N', 'Staff ID', 'Staff Name', 'Department', 'Position', 'Salary Period', 'Period Start', 'Period End', 'Basic Salary', 'Allowances', 'Deductions', 'Net Pay', 'Bank Name', 'Account Number', 'Account Name', 'Status', 'Paid Date'];
    const rows = filteredRecords.map((r, i) => [
      i + 1, r.staff_id_number, r.staff_name, r.department, r.position, r.salary_period,
      r.period_start, r.period_end, r.basic_salary, r.allowances, r.deductions, r.net_pay,
      r.bank_name, r.account_number, r.account_name, r.status,
      r.paid_at ? format(new Date(r.paid_at), 'dd/MM/yyyy') : '',
    ]);
    rows.push(['', '', '', '', '', '', '', 'TOTAL', totalBasic,
      filteredRecords.reduce((s, r) => s + Number(r.allowances), 0),
      filteredRecords.reduce((s, r) => s + Number(r.deductions), 0),
      totalNetPay, '', '', '', '', '']);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Payroll');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([wbout], { type: 'application/octet-stream' }), `Payroll_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const selectedStaff = selectedStaffId && selectedStaffId !== 'all' ? staffProfiles.find(s => s.id === selectedStaffId) : undefined;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Payroll Management</h1>
          <p className="text-muted-foreground mt-1">Generate and manage staff payroll</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={exportToExcel} disabled={filteredRecords.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />Export Excel
          </Button>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Generate Payroll</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <form onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const salaryPeriod = fd.get('salary_period') as string;
                const periodStart = fd.get('period_start') as string;
                const periodEnd = fd.get('period_end') as string;
                if (selectedStaffId && selectedStaffId !== 'all') {
                  generateSingleMutation.mutate({ staff_profile_id: selectedStaffId, salary_period: salaryPeriod, period_start: periodStart, period_end: periodEnd, basic_salary: selectedStaff?.salary || 0, allowances, deductions });
                } else {
                  generatePayrollMutation.mutate({ salary_period: salaryPeriod, period_start: periodStart, period_end: periodEnd, allowances, deductions });
                }
              }}>
                <DialogHeader>
                  <DialogTitle>Generate Payroll</DialogTitle>
                  <DialogDescription>Create payroll entries for staff. Duplicate periods are automatically skipped.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>Staff</Label>
                    <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                      <SelectTrigger><SelectValue placeholder="All Staff" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Staff</SelectItem>
                        {staffProfiles.filter(s => s.salary && s.salary > 0).map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.full_name} — {formatNairaCompact(s.salary || 0)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Salary Period</Label>
                    <Select name="salary_period" defaultValue="monthly">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SALARY_PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2"><Label>Period Start</Label><Input name="period_start" type="date" required /></div>
                    <div className="grid gap-2"><Label>Period End</Label><Input name="period_end" type="date" required /></div>
                  </div>
                  {selectedStaff && (
                    <div className="p-3 rounded-md bg-muted/50 text-sm">
                      <p><strong>Basic Salary:</strong> {formatNairaCompact(selectedStaff.salary || 0)}</p>
                      <p><strong>Bank:</strong> {selectedStaff.bank_name || 'N/A'} — {selectedStaff.account_number || 'N/A'}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2"><Label>Allowances (₦)</Label><Input type="number" min="0" step="0.01" value={allowances} onChange={e => setAllowances(parseFloat(e.target.value) || 0)} /></div>
                    <div className="grid gap-2"><Label>Deductions (₦)</Label><Input type="number" min="0" step="0.01" value={deductions} onChange={e => setDeductions(parseFloat(e.target.value) || 0)} /></div>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={generatePayrollMutation.isPending || generateSingleMutation.isPending}>
                    {(generatePayrollMutation.isPending || generateSingleMutation.isPending) ? 'Generating...' : 'Generate'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Staff</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold">{staffProfiles.filter(s => s.salary && s.salary > 0).length}</div><p className="text-xs text-muted-foreground">With salary on profile</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Total Net Pay</CardTitle><DollarSign className="h-4 w-4 text-muted-foreground" /></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatNairaCompact(totalNetPay)}</div><p className="text-xs text-muted-foreground">{filteredRecords.length} records</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Paid</CardTitle><CheckCircle className="h-4 w-4 text-green-600" /></CardHeader>
          <CardContent><div className="text-2xl font-bold text-green-600">{paidCount}</div><p className="text-xs text-muted-foreground">Completed payments</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm font-medium">Pending</CardTitle><Clock className="h-4 w-4 text-amber-600" /></CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{pendingCount}</div><p className="text-xs text-muted-foreground">Awaiting payment</p></CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search staff name or ID..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="paid">Paid</SelectItem></SelectContent>
        </Select>
        <Select value={periodFilter} onValueChange={setPeriodFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All Periods" /></SelectTrigger>
          <SelectContent><SelectItem value="all">All Periods</SelectItem>{SALARY_PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {/* Payroll Table */}
      <Card>
        <CardHeader><CardTitle>Payroll Records</CardTitle><CardDescription>{filteredRecords.length} record(s) found</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No payroll records yet</p>
              <p className="text-sm">Click "Generate Payroll" to create entries from staff profiles</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>S/N</TableHead>
                  <TableHead>Staff ID</TableHead>
                  <TableHead>Staff Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Basic Salary</TableHead>
                  <TableHead className="text-right">Allowances</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right font-bold">Net Pay</TableHead>
                  <TableHead>Bank Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">{r.staff_id_number}</TableCell>
                    <TableCell className="font-medium">{r.staff_name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.department || '-'}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <Badge variant="outline" className="text-xs">{r.salary_period}</Badge>
                        <p className="text-xs text-muted-foreground mt-1">{format(new Date(r.period_start), 'dd MMM')} – {format(new Date(r.period_end), 'dd MMM yyyy')}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatNairaCompact(Number(r.basic_salary))}</TableCell>
                    <TableCell className="text-right text-green-600">{formatNairaCompact(Number(r.allowances))}</TableCell>
                    <TableCell className="text-right text-destructive">{formatNairaCompact(Number(r.deductions))}</TableCell>
                    <TableCell className="text-right font-bold">{formatNairaCompact(Number(r.net_pay))}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.bank_name ? `${r.bank_name} - ${r.account_number}` : '-'}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'paid' ? 'default' : 'secondary'} className="text-xs">{r.status === 'paid' ? 'Paid' : 'Pending'}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {r.status === 'pending' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => markPaidMutation.mutate(r.id)}>
                              <CheckCircle className="h-3 w-3 mr-1" />Pay
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setEditRecord(r); }}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete payroll record?</AlertDialogTitle>
                              <AlertDialogDescription>This will permanently delete the payroll record for {r.staff_name} ({format(new Date(r.period_start), 'dd MMM')} – {format(new Date(r.period_end), 'dd MMM yyyy')}).</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteMutation.mutate(r.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 font-bold bg-muted/50">
                  <TableCell colSpan={5}>TOTAL</TableCell>
                  <TableCell className="text-right">{formatNairaCompact(totalBasic)}</TableCell>
                  <TableCell className="text-right text-green-600">{formatNairaCompact(filteredRecords.reduce((s, r) => s + Number(r.allowances), 0))}</TableCell>
                  <TableCell className="text-right text-destructive">{formatNairaCompact(filteredRecords.reduce((s, r) => s + Number(r.deductions), 0))}</TableCell>
                  <TableCell className="text-right">{formatNairaCompact(totalNetPay)}</TableCell>
                  <TableCell colSpan={3}></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editRecord} onOpenChange={(open) => { if (!open) setEditRecord(null); }}>
        <DialogContent>
          {editRecord && (
            <form onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              editMutation.mutate({
                id: editRecord.id,
                basic_salary: parseFloat(fd.get('edit_basic') as string),
                allowances: parseFloat(fd.get('edit_allowances') as string),
                deductions: parseFloat(fd.get('edit_deductions') as string),
                notes: (fd.get('edit_notes') as string) || null,
              });
            }}>
              <DialogHeader>
                <DialogTitle>Edit Payroll — {editRecord.staff_name}</DialogTitle>
                <DialogDescription>{format(new Date(editRecord.period_start), 'dd MMM')} – {format(new Date(editRecord.period_end), 'dd MMM yyyy')}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2"><Label>Basic Salary (₦)</Label><Input name="edit_basic" type="number" step="0.01" defaultValue={editRecord.basic_salary} required /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2"><Label>Allowances (₦)</Label><Input name="edit_allowances" type="number" step="0.01" defaultValue={editRecord.allowances} /></div>
                  <div className="grid gap-2"><Label>Deductions (₦)</Label><Input name="edit_deductions" type="number" step="0.01" defaultValue={editRecord.deductions} /></div>
                </div>
                <div className="grid gap-2"><Label>Notes</Label><Textarea name="edit_notes" defaultValue={editRecord.notes || ''} placeholder="Optional notes..." /></div>
              </div>
              <DialogFooter><Button type="submit" disabled={editMutation.isPending}>{editMutation.isPending ? 'Saving...' : 'Save Changes'}</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Payroll;
