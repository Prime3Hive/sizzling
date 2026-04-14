import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, CreditCard, CheckCircle, Clock, XCircle, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { formatNairaCompact } from "@/lib/currency";

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
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      // Fetch payments with sale details
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select(`
          *,
          sale:sales(sale_number, customer_name, total_amount)
        `)
        .order('created_at', { ascending: false });

      if (paymentsError) throw paymentsError;

      // Fetch sales for payment creation (only unpaid or partially paid)
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('id, sale_number, customer_name, total_amount')
        .eq('user_id', user.id)
        .neq('status', 'cancelled');

      if (salesError) throw salesError;

      setPayments(paymentsData || []);
      setSales(salesData || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error",
        description: "Failed to fetch payments data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const addPayment = async (formData: FormData) => {
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
        description: "Failed to record payment",
        variant: "destructive",
      });
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

  const totalPayments = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const settledPayments = payments.filter(p => p.status === 'settled');
  const pendingPayments = payments.filter(p => p.status === 'pending');
  const failedPayments = payments.filter(p => p.status === 'failed');

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'settled':
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Payment Reconciliation</h1>
          <p className="text-muted-foreground mt-2">
            Track payments, bank transactions, and reconcile accounts
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
                <div className="grid grid-cols-2 gap-4">
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
                <div className="grid grid-cols-2 gap-4">
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
                        <SelectItem value="settled">Settled</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
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
                <Button type="submit">Record Payment</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Payments</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNairaCompact(totalPayments)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Settled</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{settledPayments.length}</div>
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
            <SelectItem value="settled">Settled</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Payments Table */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Transactions</CardTitle>
          <CardDescription>
            Monitor payment status and reconcile bank transactions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale Number</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Payment Method</TableHead>
                <TableHead>Sale Total</TableHead>
                <TableHead>Amount Paid</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Transaction ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPayments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="font-medium">{payment.sale.sale_number}</TableCell>
                  <TableCell>{payment.sale.customer_name || 'N/A'}</TableCell>
                  <TableCell className="capitalize">{payment.payment_method.replace('_', ' ')}</TableCell>
                  <TableCell>{formatNairaCompact(payment.sale.total_amount)}</TableCell>
                  <TableCell>{formatNairaCompact(payment.amount)}</TableCell>
                  <TableCell>
                    {payment.payment_date ? format(new Date(payment.payment_date), 'MMM dd, yyyy') : 'N/A'}
                  </TableCell>
                  <TableCell>{payment.transaction_id || 'N/A'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(payment.status)}
                      <Badge variant={
                        payment.status === 'settled' ? 'default' :
                        payment.status === 'pending' ? 'secondary' : 'destructive'
                      }>
                        {payment.status}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      {payment.status === 'pending' && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updatePaymentStatus(payment.id, 'settled')}
                          >
                            Mark Settled
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updatePaymentStatus(payment.id, 'failed')}
                          >
                            Mark Failed
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default Payments;