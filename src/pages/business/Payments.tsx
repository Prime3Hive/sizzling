import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNewParam } from '@/hooks/useNewParam';
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/ui/responsive-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, CreditCard, CheckCircle, Clock, XCircle, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { formatNairaCompact } from "@/lib/currency";
import { useMoneyReceived, type MoneyReceived } from "@/hooks/useProfitAndLoss";

const KIND_LABEL: Record<MoneyReceived["kind"], string> = {
  sale_payment: "Sale payment",
  invoice_payment: "Invoice payment",
  takings: "Takings",
};

interface Payment {
  id: string;
  sale_id: string;
  payment_method: string;
  amount: number;
  status: string;
  payment_date: string;
  bank_reference: string;
  transaction_id: string;
  notes: string;
  created_at: string;
  sale: {
    sale_number: string;
    customer_name: string;
    total_amount: number;
  };
}

interface Sale {
  id: string;
  sale_number: string;
  customer_name: string;
  total_amount: number;
}

const Payments = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const openOnArrival = !!useNewParam();
  const [showAddPayment, setShowAddPayment] = useState(openOnArrival);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // One submit at a time: a double click recorded the same payment twice.
  const [savingPayment, setSavingPayment] = useState(false);
  const qc = useQueryClient();

  // Everything received, whatever it was paid against. Finance and the
  // dashboard add up these same rows for "cash collected".
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [kindFilter, setKindFilter] = useState<"all" | MoneyReceived["kind"]>("all");
  const received = useMoneyReceived(from, to, !!user);

  // Cached, so coming back to this page shows the last list at once and
  // refreshes behind it instead of starting from a spinner.
  const { data, isPending: loading, error: loadError } = useQuery({
    queryKey: ['payments-page', user?.id],
    enabled: !!user,
    queryFn: async () => {
      // Payments with their sale
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select(`
          *,
          sale:sales(sale_number, customer_name, total_amount)
        `)
        .order('created_at', { ascending: false });
      if (paymentsError) throw paymentsError;

      // Sales a payment can be recorded against
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('id, sale_number, customer_name, total_amount')
        .eq('user_id', user!.id)
        .neq('status', 'cancelled');
      if (salesError) throw salesError;

      return { payments: (paymentsData || []) as Payment[], sales: (salesData || []) as Sale[] };
    },
  });
  const payments = data?.payments ?? [];
  const sales = data?.sales ?? [];
  const fetchData = () => {
    qc.invalidateQueries({ queryKey: ['payments-page'] });
    qc.invalidateQueries({ queryKey: ['money-received'] });
    qc.invalidateQueries({ queryKey: ['cash-collected'] });
  };

  useEffect(() => {
    if (!loadError) return;
    console.error('Error fetching data:', loadError);
    toast({ title: "Error", description: "Failed to fetch payments data", variant: "destructive" });
  }, [loadError, toast]);

  const addPayment = async (formData: FormData) => {
    if (savingPayment) return;
    setSavingPayment(true);
    try {
      const paymentData = {
        sale_id: formData.get('sale_id') as string,
        payment_method: formData.get('payment_method') as string,
        amount: parseFloat(formData.get('amount') as string),
        status: formData.get('status') as string,
        payment_date: formData.get('payment_date') as string,
        bank_reference: formData.get('bank_reference') as string,
        transaction_id: formData.get('transaction_id') as string,
        notes: formData.get('notes') as string,
      };

      const { error } = await supabase
        .from('payments')
        .insert([paymentData]);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Payment recorded successfully",
      });
      setShowAddPayment(false);
      fetchData();
    } catch (error) {
      console.error('Error creating payment:', error);
      toast({
        title: "Error",
        description: (error as any)?.message || "Failed to record payment",
        variant: "destructive",
      });
    } finally {
      setSavingPayment(false);
    }
  };

  const updatePaymentStatus = async (paymentId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('payments')
        .update({ status: newStatus })
        .eq('id', paymentId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Payment status updated",
      });
      fetchData();
    } catch (error) {
      console.error('Error updating payment:', error);
      toast({
        title: "Error",
        description: "Failed to update payment status",
        variant: "destructive",
      });
    }
  };

  const filteredPayments = payments.filter(payment => {
    const matchesSearch = payment.sale.sale_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         payment.transaction_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         payment.bank_reference?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || payment.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // "Total Payments" reflects actual cash collected, so it only counts completed
  // payments — matching how Finance Overview and the Dashboard read this table.
  const completedPayments = payments.filter(p => p.status === 'completed');
  const totalPayments = completedPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const pendingPayments = payments.filter(p => p.status === 'pending');
  const failedPayments = payments.filter(p => p.status === 'failed');

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  const q = searchTerm.trim().toLowerCase();
  const receivedRows = received.rows.filter((r) =>
    (kindFilter === "all" || r.kind === kindFilter) &&
    (!q || [r.document, r.customer, r.reference, r.method].some((v) => (v ?? '').toLowerCase().includes(q))));
  const receivedTotal = receivedRows.reduce((t, r) => t + Math.round(r.amount * 100), 0) / 100;

  const receivedColumns: ResponsiveColumn<MoneyReceived>[] = [
    { key: "date", header: "Date", cell: (r) => format(new Date(r.received_on), 'dd MMM yyyy') },
    { key: "doc", header: "Sale / invoice", primary: true, cell: (r) => <span className="font-medium">{r.document ?? '—'}</span> },
    { key: "kind", header: "Type", cell: (r) => <Badge variant="outline">{KIND_LABEL[r.kind]}</Badge> },
    { key: "customer", header: "Customer", cell: (r) => r.customer || '—' },
    { key: "method", header: "Method", cell: (r) => <span className="capitalize">{r.method.replace(/_/g, ' ')}</span> },
    { key: "ref", header: "Reference", hideOnMobile: true, cell: (r) => r.reference || '—' },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="font-semibold tabular-nums">{formatNairaCompact(r.amount)}</span> },
  ];

  const paymentColumns: ResponsiveColumn<Payment>[] = [
    { key: "sale", header: "Sale Number", primary: true, cell: (p) => <span className="font-medium">{p.sale.sale_number}</span> },
    { key: "customer", header: "Customer", cell: (p) => p.sale.customer_name || 'N/A' },
    { key: "method", header: "Payment Method", cell: (p) => <span className="capitalize">{p.payment_method.replace('_', ' ')}</span> },
    { key: "total", header: "Sale Total", align: "right", cell: (p) => formatNairaCompact(p.sale.total_amount) },
    { key: "paid", header: "Amount Paid", align: "right", cell: (p) => formatNairaCompact(p.amount) },
    { key: "date", header: "Date", cell: (p) => p.payment_date ? format(new Date(p.payment_date), 'MMM dd, yyyy') : 'N/A' },
    { key: "txn", header: "Transaction ID", hideOnMobile: true, cell: (p) => p.transaction_id || 'N/A' },
    {
      key: "status", header: "Status",
      cell: (p) => (
        <div className="flex items-center gap-2">
          {getStatusIcon(p.status)}
          <Badge variant={p.status === 'completed' ? 'default' : p.status === 'pending' ? 'secondary' : 'destructive'}>{p.status}</Badge>
        </div>
      ),
    },
    {
      key: "actions", header: "Actions", align: "right", mobileFooter: true,
      cell: (p) => (
        <div className="flex gap-2 md:justify-end">
          {p.status === 'pending' && (
            <>
              <Button size="sm" variant="outline" onClick={() => updatePaymentStatus(p.id, 'completed')}>Mark Completed</Button>
              <Button size="sm" variant="outline" onClick={() => updatePaymentStatus(p.id, 'failed')}>Mark Failed</Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Payments</h1>
          <p className="text-muted-foreground mt-1">
            All money received: sale payments, invoice payments and takings paid on the spot
          </p>
        </div>
        <Dialog open={showAddPayment} onOpenChange={setShowAddPayment}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={(e) => {
              e.preventDefault();
              addPayment(new FormData(e.currentTarget));
            }}>
              <DialogHeader>
                <DialogTitle>Record New Payment</DialogTitle>
                <DialogDescription>
                  Record a payment for a sale transaction
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="sale_id">Sale</Label>
                  <Select name="sale_id" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Select sale" />
                    </SelectTrigger>
                    <SelectContent>
                      {sales.map(sale => (
                        <SelectItem key={sale.id} value={sale.id}>
                          {sale.sale_number} - {sale.customer_name} ({formatNairaCompact(sale.total_amount)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="payment_method">Payment Method</Label>
                    <Select name="payment_method" required>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="credit_card">Credit Card</SelectItem>
                        <SelectItem value="debit_card">Debit Card</SelectItem>
                        <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                        <SelectItem value="check">Check</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="amount">Amount</Label>
                    <Input id="amount" name="amount" type="number" step="0.01" required />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="payment_date">Payment Date</Label>
                    <Input 
                      id="payment_date" 
                      name="payment_date" 
                      type="date" 
                      defaultValue={format(new Date(), 'yyyy-MM-dd')}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="status">Status</Label>
                    <Select name="status" defaultValue="pending">
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="transaction_id">Transaction ID</Label>
                    <Input id="transaction_id" name="transaction_id" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="bank_reference">Bank Reference</Label>
                    <Input id="bank_reference" name="bank_reference" />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" name="notes" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={savingPayment}>{savingPayment ? 'Saving…' : 'Record Payment'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Received in period</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNairaCompact(received.error ? totalPayments : received.total)}</div>
            <p className="text-xs text-muted-foreground mt-1">{received.rows.length} payment record{received.rows.length === 1 ? '' : 's'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sale payments completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{completedPayments.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{pendingPayments.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{failedPayments.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search payments..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Everything received */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle>Money received</CardTitle>
              <CardDescription>
                {receivedRows.length} record{receivedRows.length === 1 ? '' : 's'} · {formatNairaCompact(receivedTotal)}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor="recv-from" className="text-xs">From</Label>
                <Input id="recv-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="recv-to" className="text-xs">To</Label>
                <Input id="recv-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
              </div>
              <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as typeof kindFilter)}>
                <SelectTrigger className="h-9 w-44" aria-label="Type of payment"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="invoice_payment">Invoice payments</SelectItem>
                  <SelectItem value="sale_payment">Sale payments</SelectItem>
                  <SelectItem value="takings">Takings</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {received.error ? (
            <p role="alert" className="text-sm text-destructive py-6 text-center">
              The full list could not load: {received.error.message}. If this mentions fn_money_received, apply database migration 20261123100000_fix_list_nov23. Sale payments are still listed below.
            </p>
          ) : (
            <ResponsiveTable
              columns={receivedColumns}
              data={receivedRows}
              rowKey={(r) => `${r.kind}-${r.id}`}
              mobileSubtitle={(r) => `${KIND_LABEL[r.kind]} · ${r.customer || '—'}`}
              emptyState={<p className="text-center text-muted-foreground py-8 text-sm">{received.isLoading ? 'Loading…' : 'Nothing received in this period.'}</p>}
            />
          )}
        </CardContent>
      </Card>

      {/* Sale payments: status and reconciliation */}
      <Card>
        <CardHeader>
          <CardTitle>Sale payments to reconcile</CardTitle>
          <CardDescription>
            Payments recorded against a sale. Mark pending ones completed once the money is confirmed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveTable
            columns={paymentColumns}
            data={filteredPayments}
            rowKey={(p) => p.id}
            mobileSubtitle={(p) => p.sale.customer_name || 'N/A'}
            emptyState={<p className="text-center text-muted-foreground py-8 text-sm">No payments found.</p>}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default Payments;