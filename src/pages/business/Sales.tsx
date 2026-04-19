import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, ShoppingCart, DollarSign, Calendar, TrendingUp, Search, Download, FileText, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { formatNairaCompact } from "@/lib/currency";
import Receipt from "@/components/Receipt";
import { generateReceiptPDF } from "@/lib/receiptGenerator";

interface Sale {
  id: string;
  sale_number: string;
  sale_date: string;
  customer_name: string;
  customer_email: string;
  total_amount: number;
  status: string;
  notes: string;
  created_at: string;
  invoiced_at: string | null;
  payment_date?: string | null;
}

interface SaleItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface Product {
  id: string;
  name: string;
  price: number;
  sku: string;
  category: string;
  available_quantity: number;
}

const Sales = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddSale, setShowAddSale] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [saleItems, setSaleItems] = useState<Array<{product_id: string, quantity: number, unit_price: number}>>([
    { product_id: "", quantity: 1, unit_price: 0 }
  ]);
  const [showReceipt, setShowReceipt] = useState(false);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [selectedSaleItems, setSelectedSaleItems] = useState<SaleItem[]>([]);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentSale, setPaymentSale] = useState<Sale | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      // Fetch sales data with payment info
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select(`
          *,
          payments (
            payment_date,
            status
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      // Transform sales to include latest payment date
      const salesWithPaymentDates = (salesData || []).map((sale: any) => {
        const completedPayments = sale.payments?.filter((p: any) => p.status === 'completed') || [];
        const latestPayment = completedPayments.sort((a: any, b: any) => 
          new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
        )[0];
        
        return {
          ...sale,
          payment_date: latestPayment?.payment_date || null,
        };
      });

      if (salesError) throw salesError;

      // Fetch products with inventory quantities, excluding raw materials
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('inventory')
        .select(`
          products!inventory_product_id_fkey(
            id,
            name,
            price,
            sku,
            category
          ),
          quantity
        `)
        .gt('quantity', 0) // Only products with stock
        .neq('products.category', 'raw-material'); // Exclude raw materials

      if (inventoryError) throw inventoryError;

      // Transform inventory data to products format with available quantities
      const availableProducts: Product[] = (inventoryData || [])
        .filter(item => item.products && item.products.category !== 'raw-material')
        .reduce((acc: Product[], item: any) => {
          if (!item.products) return acc;
          
          // Check if product already exists in accumulator
          const existingProduct = acc.find(p => p.id === item.products.id);
          if (existingProduct) {
            // Add quantity from this warehouse to existing product
            existingProduct.available_quantity += item.quantity;
          } else {
            // Add new product with quantity
            acc.push({
              id: item.products.id,
              name: item.products.name,
              price: item.products.price,
              sku: item.products.sku,
              category: item.products.category,
              available_quantity: item.quantity
            });
          }
          return acc;
        }, []);

      setSales(salesWithPaymentDates);
      setProducts(availableProducts);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error",
        description: "Failed to fetch sales data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const generateSaleNumber = () => {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    // Use crypto.randomUUID for collision-resistant IDs
    const uniqueId = crypto.randomUUID().slice(0, 8).toUpperCase();
    return `SALE-${year}${month}${day}-${uniqueId}`;
  };

  const handleDownloadReceipt = async () => {
    if (!receiptRef.current || !selectedSale) return;

    try {
      await generateReceiptPDF(receiptRef.current, selectedSale.sale_number);
      toast({
        title: "Success",
        description: "Receipt downloaded successfully",
      });
    } catch (error) {
      console.error('Error downloading receipt:', error);
      toast({
        title: "Error",
        description: "Failed to download receipt",
        variant: "destructive",
      });
    }
  };

  const handleViewReceipt = async (sale: Sale) => {
    try {
      // Fetch sale items with product details
      const { data: saleItemsData, error } = await supabase
        .from('sale_items')
        .select(`
          *,
          products (name)
        `)
        .eq('sale_id', sale.id);

      if (error) throw error;

      const formattedItems: SaleItem[] = saleItemsData.map(item => ({
        id: item.id,
        product_name: item.products?.name || 'Unknown Product',
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price
      }));

      setSelectedSale(sale);
      setSelectedSaleItems(formattedItems);
      setShowReceipt(true);
    } catch (error) {
      console.error('Error fetching sale items:', error);
      toast({
        title: "Error",
        description: "Failed to load receipt details",
        variant: "destructive",
      });
    }
  };

  const addSaleItem = () => {
    setSaleItems([...saleItems, { product_id: "", quantity: 1, unit_price: 0 }]);
  };

  const removeSaleItem = (index: number) => {
    if (saleItems.length > 1) {
      setSaleItems(saleItems.filter((_, i) => i !== index));
    }
  };

  const updateSaleItem = (index: number, field: string, value: any) => {
    const updated = [...saleItems];
    updated[index] = { ...updated[index], [field]: value };
    
    // Auto-populate unit price when product is selected
    if (field === 'product_id' && value) {
      const product = products.find(p => p.id === value);
      if (product) {
        updated[index].unit_price = product.price;
      }
    }
    
    setSaleItems(updated);
  };

  const addSale = async (formData: FormData) => {
    try {
      const totalAmount = saleItems.reduce((sum, item) => 
        sum + (item.quantity * item.unit_price), 0
      );

      const saleData = {
        user_id: user.id,
        created_by: user.id,
        sale_number: generateSaleNumber(),
        sale_date: formData.get('sale_date') as string,
        customer_name: formData.get('customer_name') as string,
        customer_email: formData.get('customer_email') as string,
        total_amount: totalAmount,
        status: formData.get('status') as string,
        notes: formData.get('notes') as string,
        invoiced_at: new Date().toISOString(), // Stamp the invoice date
      };

      const { data: saleResult, error: saleError } = await supabase
        .from('sales')
        .insert([saleData])
        .select()
        .single();

      if (saleError) throw saleError;

      // Insert sale items
      const saleItemsData = saleItems
        .filter(item => item.product_id && item.quantity > 0)
        .map(item => ({
          sale_id: saleResult.id,
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.quantity * item.unit_price
        }));

      if (saleItemsData.length > 0) {
        const { error: itemsError } = await supabase
          .from('sale_items')
          .insert(saleItemsData);

        if (itemsError) throw itemsError;
      }

      toast({
        title: "Success",
        description: "Sale created successfully",
      });
      setShowAddSale(false);
      setSaleItems([{ product_id: "", quantity: 1, unit_price: 0 }]);
      await fetchData();

      // Automatically open the invoice/receipt view for the newly created sale
      const formattedItems: SaleItem[] = saleItemsData.map((item, idx) => {
        const product = products.find(p => p.id === item.product_id);
        return {
          id: `new-${idx}`,
          product_name: product?.name || 'Unknown Product',
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price
        };
      });

      setSelectedSale({
        ...saleResult,
        payment_date: null,
      });
      setSelectedSaleItems(formattedItems);
      setShowReceipt(true);
    } catch (error) {
      console.error('Error creating sale:', error);
      toast({
        title: "Error",
        description: "Failed to create sale",
        variant: "destructive",
      });
    }
  };

  const recordPayment = async (formData: FormData) => {
    if (!paymentSale) return;

    try {
      const paymentAmount = parseFloat(formData.get('amount') as string);
      const invoicedAmount = paymentSale.total_amount;
      
      const paymentData = {
        sale_id: paymentSale.id,
        amount: paymentAmount,
        payment_method: formData.get('payment_method') as string,
        payment_date: formData.get('payment_date') as string,
        transaction_id: formData.get('transaction_id') as string,
        bank_reference: formData.get('bank_reference') as string,
        notes: formData.get('notes') as string,
        status: 'completed'
      };

      // Insert payment record
      const { error: paymentError } = await supabase
        .from('payments')
        .insert([paymentData]);

      if (paymentError) throw paymentError;

      // Determine new sale status based on payment amount
      const newStatus = paymentAmount >= invoicedAmount ? 'paid' : 'partially_paid';

      // Update sale status
      const { error: saleError } = await supabase
        .from('sales')
        .update({ status: newStatus })
        .eq('id', paymentSale.id);

      if (saleError) throw saleError;

      toast({
        title: "Success",
        description: paymentAmount >= invoicedAmount 
          ? "Full payment recorded successfully" 
          : "Partial payment recorded successfully",
      });
      
      setShowPaymentDialog(false);
      setPaymentSale(null);
      fetchData();
    } catch (error) {
      console.error('Error recording payment:', error);
      toast({
        title: "Error",
        description: "Failed to record payment",
        variant: "destructive",
      });
    }
  };

  const openPaymentDialog = (sale: Sale) => {
    setPaymentSale(sale);
    setShowPaymentDialog(true);
  };

  const filteredSales = sales.filter(sale => {
    const matchesSearch = sale.sale_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         sale.customer_name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || sale.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalSales = sales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const pendingSales = sales.filter(sale => sale.status === 'pending').length;
  const completedSales = sales.filter(sale => sale.status === 'completed' || sale.status === 'paid' || sale.status === 'partially_paid').length;

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

    return (
      <TooltipProvider>
        <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Sales Management</h1>
          <p className="text-muted-foreground mt-1">
            Record sales transactions and manage customer orders
          </p>
        </div>
        <Dialog open={showAddSale} onOpenChange={setShowAddSale}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Create Sale
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <form onSubmit={(e) => {
              e.preventDefault();
              addSale(new FormData(e.currentTarget));
            }}>
              <DialogHeader>
                <DialogTitle>Create New Sale</DialogTitle>
                <DialogDescription>
                  Record a new sales transaction
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="sale_date">Sale Date</Label>
                    <Input 
                      id="sale_date" 
                      name="sale_date" 
                      type="date" 
                      defaultValue={format(new Date(), 'yyyy-MM-dd')}
                      required 
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
                         <SelectItem value="paid">Paid</SelectItem>
                         <SelectItem value="partially_paid">Partially Paid</SelectItem>
                         <SelectItem value="cancelled">Cancelled</SelectItem>
                       </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="customer_name">Customer Name</Label>
                    <Input id="customer_name" name="customer_name" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="customer_email">Customer Email</Label>
                    <Input id="customer_email" name="customer_email" type="email" />
                  </div>
                </div>
                
                {/* Sale Items */}
                <div className="space-y-4">
                   <div className="flex justify-between items-center">
                     <Label>Sale Items</Label>
                     <Tooltip>
                       <TooltipTrigger asChild>
                         <Button type="button" onClick={addSaleItem} size="sm" variant="outline">
                           <Plus className="h-4 w-4 mr-1" />
                           Add Item
                         </Button>
                       </TooltipTrigger>
                       <TooltipContent>
                         <p>Add another item to this sale</p>
                       </TooltipContent>
                     </Tooltip>
                   </div>
                  {saleItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        <Select
                          value={item.product_id}
                          onValueChange={(value) => updateSaleItem(index, 'product_id', value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select product" />
                          </SelectTrigger>
                          <SelectContent>
                           {products.map(product => (
                               <SelectItem key={product.id} value={product.id}>
                                 {product.name} - {formatNairaCompact(product.price)} (Available: {product.available_quantity})
                               </SelectItem>
                             ))}
                          </SelectContent>
                        </Select>
                      </div>
                       <div className="col-span-2">
                         <Input
                           type="number"
                           placeholder="Qty"
                           value={item.quantity}
                           onChange={(e) => {
                             const maxQuantity = products.find(p => p.id === item.product_id)?.available_quantity || 0;
                             const requestedQty = parseInt(e.target.value) || 0;
                             const validQty = Math.min(requestedQty, maxQuantity);
                             updateSaleItem(index, 'quantity', validQty);
                           }}
                           min="1"
                           max={products.find(p => p.id === item.product_id)?.available_quantity || 0}
                         />
                       </div>
                      <div className="col-span-2">
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Price"
                          value={item.unit_price}
                          onChange={(e) => updateSaleItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                          min="0"
                        />
                      </div>
                       <div className="col-span-2">
                         <Input
                           value={formatNairaCompact(item.quantity * item.unit_price)}
                           disabled
                         />
                       </div>
                       <div className="col-span-1">
                         <Tooltip>
                           <TooltipTrigger asChild>
                             <Button
                               type="button"
                               onClick={() => removeSaleItem(index)}
                               size="sm"
                               variant="outline"
                               disabled={saleItems.length === 1}
                             >
                               ×
                             </Button>
                           </TooltipTrigger>
                           <TooltipContent>
                             <p>Remove this item from sale</p>
                           </TooltipContent>
                         </Tooltip>
                       </div>
                    </div>
                  ))}
                   <div className="text-right font-semibold">
                     Total: {formatNairaCompact(saleItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0))}
                   </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" name="notes" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit">Create Sale</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold">{formatNairaCompact(totalSales)}</div>
           </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed Sales</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedSales}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Sales</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingSales}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Sale</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold">
               {sales.length ? formatNairaCompact(totalSales / sales.length) : formatNairaCompact(0)}
             </div>
           </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search sales..."
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
             <SelectItem value="paid">Paid</SelectItem>
             <SelectItem value="partially_paid">Partially Paid</SelectItem>
             <SelectItem value="cancelled">Cancelled</SelectItem>
           </SelectContent>
        </Select>
      </div>

      {/* Sales Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Sales</CardTitle>
          <CardDescription>
            View and manage your sales transactions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sale Number</TableHead>
                <TableHead>Sale Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoiced At</TableHead>
                <TableHead>Payment Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSales.map((sale) => (
                <TableRow key={sale.id}>
                   <TableCell className="font-medium">{sale.sale_number}</TableCell>
                   <TableCell>{format(new Date(sale.sale_date), 'MMM dd, yyyy')}</TableCell>
                    <TableCell>{sale.customer_name || 'N/A'}</TableCell>
                    <TableCell>{formatNairaCompact(sale.total_amount)}</TableCell>
                    <TableCell>
                       <Badge variant={
                         sale.status === 'completed' || sale.status === 'paid' ? 'default' :
                         sale.status === 'partially_paid' ? 'outline' :
                         sale.status === 'pending' ? 'secondary' : 'destructive'
                       }>
                         {sale.status === 'partially_paid' ? 'Partially Paid' : sale.status}
                       </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {sale.invoiced_at 
                        ? format(new Date(sale.invoiced_at), 'MMM dd, yyyy h:mm a')
                        : 'N/A'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {sale.payment_date 
                        ? format(new Date(sale.payment_date), 'MMM dd, yyyy')
                        : <span className="text-muted-foreground/60">Not paid</span>}
                    </TableCell>
                   <TableCell>
                     <div className="flex gap-2">
                       <Tooltip>
                         <TooltipTrigger asChild>
                           <Button
                             size="sm"
                             variant="outline"
                             onClick={() => handleViewReceipt(sale)}
                           >
                             <FileText className="h-4 w-4" />
                           </Button>
                         </TooltipTrigger>
                         <TooltipContent>
                           <p>View and download receipt</p>
                         </TooltipContent>
                       </Tooltip>
                       {(sale.status === 'pending' || sale.status === 'partially_paid') && (
                         <Tooltip>
                           <TooltipTrigger asChild>
                             <Button
                               size="sm"
                               variant="default"
                               onClick={() => openPaymentDialog(sale)}
                             >
                               <CreditCard className="h-4 w-4" />
                             </Button>
                           </TooltipTrigger>
                           <TooltipContent>
                             <p>Record payment for this sale</p>
                           </TooltipContent>
                         </Tooltip>
                       )}
                     </div>
                   </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
         </CardContent>
       </Card>

       {/* Receipt Dialog */}
       <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
         <DialogContent className="max-w-md">
           <DialogHeader>
             <DialogTitle>Receipt - {selectedSale?.sale_number}</DialogTitle>
             <DialogDescription>
               Download or print this receipt
             </DialogDescription>
           </DialogHeader>
           <div ref={receiptRef}>
             {selectedSale && (
               <Receipt
                 saleNumber={selectedSale.sale_number}
                 saleDate={selectedSale.sale_date}
                 customerName={selectedSale.customer_name}
                 customerEmail={selectedSale.customer_email}
                 items={selectedSaleItems}
                 totalAmount={selectedSale.total_amount}
                 notes={selectedSale.notes}
               />
             )}
           </div>
            <DialogFooter>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    onClick={handleDownloadReceipt}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download PDF
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Download receipt as PDF</p>
                </TooltipContent>
              </Tooltip>
            </DialogFooter>
         </DialogContent>
        </Dialog>

        {/* Payment Recording Dialog */}
        <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
          <DialogContent className="max-w-md">
            <form onSubmit={(e) => {
              e.preventDefault();
              recordPayment(new FormData(e.currentTarget));
            }}>
              <DialogHeader>
                <DialogTitle>Record Payment</DialogTitle>
                <DialogDescription>
                  Record payment for Sale #{paymentSale?.sale_number}
                </DialogDescription>
              </DialogHeader>
               <div className="grid gap-4 py-4">
                 <div className="grid grid-cols-2 gap-4">
                   <div className="grid gap-2">
                     <Label htmlFor="invoiced_amount">Invoiced Amount</Label>
                     <Input 
                       id="invoiced_amount" 
                       type="number" 
                       step="0.01"
                       value={paymentSale?.total_amount}
                       disabled
                       className="bg-muted"
                     />
                   </div>
                   <div className="grid gap-2">
                     <Label htmlFor="amount">Payment Amount</Label>
                     <Input 
                       id="amount" 
                       name="amount" 
                       type="number" 
                       step="0.01"
                       defaultValue={paymentSale?.total_amount}
                       max={paymentSale?.total_amount}
                       required 
                     />
                   </div>
                 </div>
                <div className="grid gap-2">
                  <Label htmlFor="payment_method">Payment Method</Label>
                  <Select name="payment_method" defaultValue="cash">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="mobile_money">Mobile Money</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="payment_date">Payment Date</Label>
                  <Input 
                    id="payment_date" 
                    name="payment_date" 
                    type="date" 
                    defaultValue={format(new Date(), 'yyyy-MM-dd')}
                    required 
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="transaction_id">Transaction ID</Label>
                  <Input 
                    id="transaction_id" 
                    name="transaction_id" 
                    placeholder="Optional" 
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="bank_reference">Bank Reference</Label>
                  <Input 
                    id="bank_reference" 
                    name="bank_reference" 
                    placeholder="Optional" 
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea 
                    id="notes" 
                    name="notes" 
                    placeholder="Payment notes (optional)"
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowPaymentDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit">Record Payment</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </TooltipProvider>
    );
  };
  
  export default Sales;