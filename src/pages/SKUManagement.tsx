import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Package, Search, Filter, Edit2, Trash2, ShoppingCart, TrendingDown, ArrowRightLeft, BarChart3, ClipboardCheck, History, LineChart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { toast } from "sonner";
import { formatNairaCompact } from "@/lib/currency";
import { INVENTORY_CATEGORIES, UNITS_OF_MEASURE, getCategoryColor, getCategoryLabel } from "@/lib/inventoryConstants";
import { InventoryKPICards } from "@/components/inventory/InventoryKPICards";
import { LowStockAlerts } from "@/components/inventory/LowStockAlerts";
import { CategoryBreakdown } from "@/components/inventory/CategoryBreakdown";
import { StockReconciliation } from "@/components/inventory/StockReconciliation";
import { TransactionHistory } from "@/components/inventory/TransactionHistory";
import { UsageAnalytics } from "@/components/inventory/UsageAnalytics";

interface SKU {
  id: string;
  name: string;
  category: string;
  unit_of_measure: string;
  stock_quantity: number;
  reorder_level: number;
  cost_per_unit: number;
  notes?: string;
}

interface Transaction {
  id: string;
  transaction_type: string;
  sku_id: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  notes: string | null;
  created_at: string;
  skus: {
    name: string;
    unit_of_measure: string;
    category: string;
  };
}

interface StockTake {
  id: string;
  take_date: string;
  status: string;
  notes: string | null;
  total_items_counted: number;
  total_variance_value: number;
  completed_at: string | null;
  created_at: string;
}

interface UnitConversion {
  id: string;
  from_unit: string;
  to_unit: string;
  conversion_factor: number;
}

export default function SKUManagement() {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const [skus, setSKUs] = useState<SKU[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stockTakes, setStockTakes] = useState<StockTake[]>([]);
  const [unitConversions, setUnitConversions] = useState<UnitConversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [operationLoading, setOperationLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showConversionDialog, setShowConversionDialog] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingSKU, setEditingSKU] = useState<SKU | null>(null);

  // Initial state for new SKU
  const [newSKU, setNewSKU] = useState({
    name: '',
    category: 'proteins',
    unit_of_measure: 'kg',
    stock_quantity: 0,
    reorder_level: 0,
    cost_per_unit: 0,
    notes: ''
  });

  // Purchase form
  const [purchaseForm, setPurchaseForm] = useState({
    sku_id: '',
    quantity: 0,
    unit_price: 0,
    notes: ''
  });

  // Usage form  
  const [usageForm, setUsageForm] = useState({
    sku_id: '',
    quantity: 0,
    notes: ''
  });

  const [newConversion, setNewConversion] = useState({
    from_unit: '',
    to_unit: '',
    conversion_factor: 1
  });

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch SKUs
      const { data: skusData, error: skusError } = await supabase
        .from('skus')
        .select('*')
        .order('name');

      if (skusError) throw skusError;
      setSKUs((skusData || []) as SKU[]);

      // Fetch transactions (more for history)
      const { data: transactionsData, error: transactionsError } = await supabase
        .from('transactions')
        .select(`
          *,
          skus(name, unit_of_measure, category)
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (transactionsError) throw transactionsError;
      setTransactions((transactionsData || []) as Transaction[]);

      // Fetch stock takes
      const { data: stockTakesData, error: stockTakesError } = await supabase
        .from('stock_takes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (!stockTakesError) {
        setStockTakes((stockTakesData || []) as StockTake[]);
      }

      // Fetch unit conversions
      const { data: conversionsData, error: conversionsError } = await supabase
        .from('unit_conversions')
        .select('*');

      if (conversionsError) throw conversionsError;
      setUnitConversions((conversionsData || []) as UnitConversion[]);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const handleAddSKU = async () => {
    if (!newSKU.name.trim()) {
      toast.error('Please enter an item name');
      return;
    }

    try {
      const { error } = await supabase
        .from('skus')
        .insert({
          ...newSKU,
          sku_code: `${newSKU.category.toUpperCase().slice(0, 3)}-${Date.now()}`,
          user_id: user!.id,
          created_by: user!.id
        });

      if (error) throw error;

      toast.success('Item added successfully');
      setShowAddDialog(false);
      resetForm();
      fetchData();
    } catch (error) {
      console.error('Error adding SKU:', error);
      toast.error('Failed to add item');
    }
  };

  const handleUpdateSKU = async () => {
    if (!editingSKU) return;
    
    try {
      const { error } = await supabase
        .from('skus')
        .update({
          name: editingSKU.name,
          category: editingSKU.category,
          unit_of_measure: editingSKU.unit_of_measure,
          stock_quantity: editingSKU.stock_quantity,
          reorder_level: editingSKU.reorder_level,
          cost_per_unit: editingSKU.cost_per_unit,
          notes: editingSKU.notes
        })
        .eq('id', editingSKU.id);

      if (error) throw error;

      toast.success('Item updated successfully');
      setEditingSKU(null);
      fetchData();
    } catch (error) {
      console.error('Error updating SKU:', error);
      toast.error('Failed to update item');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from('skus')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Item deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting SKU:', error);
      toast.error('Failed to delete item');
    }
  };

  const handlePurchase = async () => {
    if (!purchaseForm.sku_id || purchaseForm.quantity <= 0) {
      toast.error('Please select an item and enter a valid quantity');
      return;
    }

    try {
      setOperationLoading(true);

      const selectedSKU = skus.find(s => s.id === purchaseForm.sku_id);
      if (!selectedSKU) {
        toast.error('Item not found');
        return;
      }

      const newStockQuantity = selectedSKU.stock_quantity + purchaseForm.quantity;

      // Update stock quantity
      const { error: updateError } = await supabase
        .from('skus')
        .update({ stock_quantity: newStockQuantity })
        .eq('id', purchaseForm.sku_id);

      if (updateError) throw updateError;

      // Record transaction
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          transaction_type: 'PURCHASE',
          sku_id: purchaseForm.sku_id,
          quantity: purchaseForm.quantity,
          unit_price: purchaseForm.unit_price || 0,
          total_amount: purchaseForm.quantity * (purchaseForm.unit_price || 0),
          notes: purchaseForm.notes || '',
          user_id: user!.id,
          created_by: user!.id
        });

      if (transactionError) throw transactionError;

      toast.success('Purchase recorded successfully');
      setPurchaseForm({ sku_id: '', quantity: 0, unit_price: 0, notes: '' });
      fetchData();
    } catch (error) {
      console.error('Purchase operation failed:', error);
      toast.error('Failed to record purchase');
    } finally {
      setOperationLoading(false);
    }
  };

  const handleUsage = async () => {
    if (!usageForm.sku_id || usageForm.quantity <= 0) {
      toast.error('Please select an item and enter a valid quantity');
      return;
    }

    try {
      setOperationLoading(true);

      const selectedSKU = skus.find(s => s.id === usageForm.sku_id);
      if (!selectedSKU) {
        toast.error('Item not found');
        return;
      }

      if (usageForm.quantity > selectedSKU.stock_quantity) {
        toast.error('Insufficient stock for this usage');
        return;
      }

      const newStockQuantity = selectedSKU.stock_quantity - usageForm.quantity;

      // Update stock quantity
      const { error: updateError } = await supabase
        .from('skus')
        .update({ stock_quantity: newStockQuantity })
        .eq('id', usageForm.sku_id);

      if (updateError) throw updateError;

      // Record transaction
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          transaction_type: 'SALE',
          sku_id: usageForm.sku_id,
          quantity: -usageForm.quantity,
          unit_price: selectedSKU.cost_per_unit,
          total_amount: usageForm.quantity * selectedSKU.cost_per_unit,
          notes: usageForm.notes || 'Usage/Consumption',
          user_id: user!.id,
          created_by: user!.id
        });

      if (transactionError) throw transactionError;

      toast.success('Usage recorded successfully');
      setUsageForm({ sku_id: '', quantity: 0, notes: '' });
      fetchData();
    } catch (error) {
      console.error('Usage operation failed:', error);
      toast.error('Failed to record usage');
    } finally {
      setOperationLoading(false);
    }
  };

  const handleAddConversion = async () => {
    if (!newConversion.from_unit || !newConversion.to_unit || newConversion.conversion_factor <= 0) {
      toast.error('Please fill all fields with valid values');
      return;
    }

    try {
      const { error } = await supabase
        .from('unit_conversions')
        .insert({
          ...newConversion,
          user_id: user!.id
        });

      if (error) throw error;

      toast.success('Unit conversion added successfully');
      setNewConversion({ from_unit: '', to_unit: '', conversion_factor: 1 });
      fetchData();
    } catch (error) {
      console.error('Error adding conversion:', error);
      toast.error('Failed to add unit conversion');
    }
  };

  const handleReorder = (sku: SKU) => {
    setPurchaseForm({
      sku_id: sku.id,
      quantity: sku.reorder_level * 2 - sku.stock_quantity,
      unit_price: sku.cost_per_unit,
      notes: `Reorder for ${sku.name}`
    });
  };

  const resetForm = () => {
    setNewSKU({
      name: '',
      category: 'proteins',
      unit_of_measure: 'kg',
      stock_quantity: 0,
      reorder_level: 0,
      cost_per_unit: 0,
      notes: ''
    });
  };

  const filteredSKUs = skus.filter(sku => {
    const matchesSearch = sku.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         sku.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || sku.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const categories = [...new Set(skus.map(sku => sku.category))];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Inventory Portal</h1>
          <p className="text-muted-foreground">Track stock levels, manage purchases, and monitor usage</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Dialog open={showConversionDialog} onOpenChange={setShowConversionDialog}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <ArrowRightLeft className="h-4 w-4 mr-2" />
                  Units
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Unit Conversions</DialogTitle>
                  <DialogDescription>Set up conversion rates between different units</DialogDescription>
                </DialogHeader>
                <div className="space-y-6">
                  <div className="grid grid-cols-4 gap-4 items-end">
                    <div>
                      <Label>From Unit</Label>
                      <Select value={newConversion.from_unit} onValueChange={(value) => setNewConversion({...newConversion, from_unit: value})}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {UNITS_OF_MEASURE.map(unit => (
                            <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>To Unit</Label>
                      <Select value={newConversion.to_unit} onValueChange={(value) => setNewConversion({...newConversion, to_unit: value})}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {UNITS_OF_MEASURE.map(unit => (
                            <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Factor</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={newConversion.conversion_factor}
                        onChange={(e) => setNewConversion({...newConversion, conversion_factor: Number(e.target.value)})}
                      />
                    </div>
                    <Button onClick={handleAddConversion}>Add</Button>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm">Existing Conversions</h4>
                    {unitConversions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No conversions set up yet</p>
                    ) : (
                      <div className="space-y-2">
                        {unitConversions.map(conversion => (
                          <div key={conversion.id} className="flex items-center justify-between p-2 border rounded">
                            <span className="text-sm">
                              1 {conversion.from_unit} = {conversion.conversion_factor} {conversion.to_unit}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Button>
          </div>
        )}
      </div>

      {/* KPI Dashboard */}
      <InventoryKPICards skus={skus} transactions={transactions} />

      {/* Alerts and Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <LowStockAlerts skus={skus} onReorder={isAdmin ? handleReorder : undefined} />
        </div>
        <div>
          <CategoryBreakdown skus={skus} />
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="items" className="space-y-6">
        <TabsList className={`grid w-full ${isAdmin ? 'grid-cols-6' : 'grid-cols-3'}`}>
          <TabsTrigger value="items" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Items
          </TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="purchase" className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Purchase
              </TabsTrigger>
              <TabsTrigger value="usage" className="flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                Usage
              </TabsTrigger>
              <TabsTrigger value="reconciliation" className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4" />
                Stock Take
              </TabsTrigger>
            </>
          )}
          <TabsTrigger value="analytics" className="flex items-center gap-2">
            <LineChart className="h-4 w-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            History
          </TabsTrigger>
        </TabsList>

        {/* Items Tab */}
        <TabsContent value="items" className="space-y-6">
          {/* Filters */}
          <div className="flex gap-4 items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-48">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {INVENTORY_CATEGORIES.map(category => (
                  <SelectItem key={category.value} value={category.value}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Inventory Items ({filteredSKUs.length})</CardTitle>
              <CardDescription>All tracked inventory items</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Reorder</TableHead>
                    <TableHead className="text-right">Cost/Unit</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Status</TableHead>
                    {isAdmin && <TableHead>Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSKUs.map((sku) => {
                    const colors = getCategoryColor(sku.category);
                    const stockValue = sku.stock_quantity * sku.cost_per_unit;
                    
                    return (
                      <TableRow key={sku.id}>
                        <TableCell className="font-medium">{sku.name}</TableCell>
                        <TableCell>
                          <Badge className={`${colors.bg} ${colors.text} text-xs`}>
                            {getCategoryLabel(sku.category)}
                          </Badge>
                        </TableCell>
                        <TableCell>{sku.unit_of_measure}</TableCell>
                        <TableCell className="text-right font-medium">{sku.stock_quantity}</TableCell>
                        <TableCell className="text-right">{sku.reorder_level}</TableCell>
                        <TableCell className="text-right">{formatNairaCompact(sku.cost_per_unit)}</TableCell>
                        <TableCell className="text-right">{formatNairaCompact(stockValue)}</TableCell>
                        <TableCell>
                          {sku.stock_quantity <= 0 ? (
                            <Badge variant="destructive">Out of Stock</Badge>
                          ) : sku.stock_quantity <= sku.reorder_level ? (
                            <Badge className="bg-orange-100 text-orange-700">Low Stock</Badge>
                          ) : (
                            <Badge variant="secondary">In Stock</Badge>
                          )}
                        </TableCell>
                        {isAdmin && (
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => setEditingSKU(sku)}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button 
                                variant="destructive" 
                                size="sm"
                                onClick={() => handleDelete(sku.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Purchase Tab */}
        {isAdmin && (
          <TabsContent value="purchase" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Record Purchase
                </CardTitle>
                <CardDescription>Add items to inventory from suppliers</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Item</Label>
                    <Select 
                      value={purchaseForm.sku_id} 
                      onValueChange={(value) => setPurchaseForm({...purchaseForm, sku_id: value})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select item" />
                      </SelectTrigger>
                      <SelectContent>
                        {skus.map(sku => (
                          <SelectItem key={sku.id} value={sku.id}>
                            {sku.name} - {sku.stock_quantity} {sku.unit_of_measure}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={purchaseForm.quantity}
                      onChange={(e) => setPurchaseForm({...purchaseForm, quantity: Number(e.target.value)})}
                    />
                  </div>
                  <div>
                    <Label>Unit Price (₦)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={purchaseForm.unit_price}
                      onChange={(e) => setPurchaseForm({...purchaseForm, unit_price: Number(e.target.value)})}
                    />
                  </div>
                  <div className="flex items-end">
                    <div className="text-lg font-semibold">
                      Total: {formatNairaCompact(purchaseForm.quantity * purchaseForm.unit_price)}
                    </div>
                  </div>
                </div>
                <div>
                  <Label>Notes (Supplier, Invoice #, etc.)</Label>
                  <Textarea
                    value={purchaseForm.notes}
                    onChange={(e) => setPurchaseForm({...purchaseForm, notes: e.target.value})}
                    placeholder="Optional notes..."
                  />
                </div>
                <Button onClick={handlePurchase} disabled={operationLoading} className="w-full">
                  {operationLoading ? 'Processing...' : 'Record Purchase'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Usage Tab */}
        {isAdmin && (
          <TabsContent value="usage" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5" />
                  Record Usage / Consumption
                </CardTitle>
                <CardDescription>Track items used in production or events</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Item</Label>
                    <Select 
                      value={usageForm.sku_id} 
                      onValueChange={(value) => setUsageForm({...usageForm, sku_id: value})}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select item" />
                      </SelectTrigger>
                      <SelectContent>
                        {skus.filter(sku => sku.stock_quantity > 0).map(sku => (
                          <SelectItem key={sku.id} value={sku.id}>
                            {sku.name} - {sku.stock_quantity} {sku.unit_of_measure} available
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Quantity Used</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={usageForm.quantity}
                      onChange={(e) => setUsageForm({...usageForm, quantity: Number(e.target.value)})}
                    />
                  </div>
                </div>
                <div>
                  <Label>Notes (Event, reason, etc.)</Label>
                  <Textarea
                    value={usageForm.notes}
                    onChange={(e) => setUsageForm({...usageForm, notes: e.target.value})}
                    placeholder="What was this used for..."
                  />
                </div>
                <Button onClick={handleUsage} disabled={operationLoading} className="w-full">
                  {operationLoading ? 'Processing...' : 'Record Usage'}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Stock Take Tab */}
        {isAdmin && (
          <TabsContent value="reconciliation" className="space-y-6">
            <StockReconciliation 
              skus={skus} 
              stockTakes={stockTakes} 
              onComplete={fetchData} 
            />
          </TabsContent>
        )}

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <UsageAnalytics transactions={transactions} skus={skus} />
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history" className="space-y-6">
          <TransactionHistory transactions={transactions} />
        </TabsContent>
      </Tabs>

      {/* Add Item Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Item</DialogTitle>
            <DialogDescription>Create a new inventory item</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Item Name</Label>
              <Input
                id="name"
                value={newSKU.name}
                onChange={(e) => setNewSKU({...newSKU, name: e.target.value})}
                placeholder="Enter item name"
              />
            </div>
            <div>
              <Label htmlFor="category">Category</Label>
              <Select value={newSKU.category} onValueChange={(value) => setNewSKU({...newSKU, category: value})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVENTORY_CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <div className="flex flex-col">
                        <span>{cat.label}</span>
                        <span className="text-xs text-muted-foreground">{cat.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="unit_of_measure">Unit</Label>
              <Select value={newSKU.unit_of_measure} onValueChange={(value) => setNewSKU({...newSKU, unit_of_measure: value})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS_OF_MEASURE.map(unit => (
                    <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="reorder_level">Reorder Level</Label>
                <Input
                  id="reorder_level"
                  type="number"
                  value={newSKU.reorder_level}
                  onChange={(e) => setNewSKU({...newSKU, reorder_level: Number(e.target.value)})}
                />
              </div>
              <div>
                <Label htmlFor="cost_per_unit">Cost per Unit (₦)</Label>
                <Input
                  id="cost_per_unit"
                  type="number"
                  step="0.01"
                  value={newSKU.cost_per_unit}
                  onChange={(e) => setNewSKU({...newSKU, cost_per_unit: Number(e.target.value)})}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Input
                id="notes"
                value={newSKU.notes}
                onChange={(e) => setNewSKU({...newSKU, notes: e.target.value})}
                placeholder="Additional notes"
              />
            </div>
            <Button onClick={handleAddSKU} className="w-full">Add Item</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Item Dialog */}
      {editingSKU && (
        <Dialog open={!!editingSKU} onOpenChange={() => setEditingSKU(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Item</DialogTitle>
              <DialogDescription>Update item details</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit_name">Item Name</Label>
                <Input
                  id="edit_name"
                  value={editingSKU.name}
                  onChange={(e) => setEditingSKU({...editingSKU, name: e.target.value})}
                />
              </div>
              <div>
                <Label htmlFor="edit_category">Category</Label>
                <Select value={editingSKU.category} onValueChange={(value) => setEditingSKU({...editingSKU, category: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVENTORY_CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="edit_unit_of_measure">Unit</Label>
                <Select value={editingSKU.unit_of_measure} onValueChange={(value) => setEditingSKU({...editingSKU, unit_of_measure: value})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS_OF_MEASURE.map(unit => (
                      <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="edit_stock_quantity">Current Stock</Label>
                  <Input
                    id="edit_stock_quantity"
                    type="number"
                    value={editingSKU.stock_quantity}
                    onChange={(e) => setEditingSKU({...editingSKU, stock_quantity: Number(e.target.value)})}
                  />
                </div>
                <div>
                  <Label htmlFor="edit_reorder_level">Reorder Level</Label>
                  <Input
                    id="edit_reorder_level"
                    type="number"
                    value={editingSKU.reorder_level}
                    onChange={(e) => setEditingSKU({...editingSKU, reorder_level: Number(e.target.value)})}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="edit_cost_per_unit">Cost per Unit (₦)</Label>
                <Input
                  id="edit_cost_per_unit"
                  type="number"
                  step="0.01"
                  value={editingSKU.cost_per_unit}
                  onChange={(e) => setEditingSKU({...editingSKU, cost_per_unit: Number(e.target.value)})}
                />
              </div>
              <div>
                <Label htmlFor="edit_notes">Notes (Optional)</Label>
                <Input
                  id="edit_notes"
                  value={editingSKU.notes || ''}
                  onChange={(e) => setEditingSKU({...editingSKU, notes: e.target.value})}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingSKU(null)}>Cancel</Button>
              <Button onClick={handleUpdateSKU}>Update Item</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
