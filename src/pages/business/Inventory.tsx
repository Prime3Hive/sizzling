import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Package, AlertTriangle, TrendingDown, Search, Filter, ClipboardList, Pencil, Download } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { useToast } from "@/hooks/use-toast";
import { formatNairaCompact } from "@/lib/currency";
import InventoryDailyReport from "@/components/inventory/InventoryDailyReport";

interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  item_type?: "sellable" | "non_sellable";
  uom?: string;
  price: number;
  sku: string;
  created_at: string;
}

interface Warehouse {
  id: string;
  name: string;
  location: string;
}

interface Inventory {
  id: string;
  product_id: string;
  warehouse_id: string;
  quantity: number;
  reorder_level: number;
  products: Product;
  warehouses: Warehouse;
}

interface InventoryRequest {
  id: string;
  product_id: string;
  warehouse_id: string;
  requested_quantity: number;
  status: string;
  products: Product;
  warehouses: Warehouse;
}

const Inventory = () => {
  const { user } = useAuth();
  const { isAdmin } = useRoles();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [pendingRequests, setPendingRequests] = useState<InventoryRequest[]>([]);
  const [stockUsed, setStockUsed] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddWarehouse, setShowAddWarehouse] = useState(false);
  const [showEditInventory, setShowEditInventory] = useState(false);
  const [editingItem, setEditingItem] = useState<Inventory | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    try {
      // Fetch inventory with product and warehouse details
      const { data: inventoryData, error: inventoryError } = await supabase
        .from('inventory')
        .select(`
          *,
          products!inventory_product_id_fkey(*),
          warehouses!inventory_warehouse_id_fkey(*)
        `);

      if (inventoryError) throw inventoryError;

      // Fetch products
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('*');

      if (productsError) throw productsError;

      // Fetch warehouses
      const { data: warehousesData, error: warehousesError } = await supabase
        .from('warehouses')
        .select('*');

      if (warehousesError) throw warehousesError;

      // Fetch pending inventory requests
      const { data: requestsData, error: requestsError } = await supabase
        .from('inventory_requests')
        .select(`
          *,
          products!inventory_requests_product_id_fkey(*),
          warehouses!inventory_requests_warehouse_id_fkey(*)
        `)
        .eq('status', 'pending')
        .limit(5);

      if (requestsError) throw requestsError;

      // Stock used (cumulative outflow) per product — from the movements ledger view
      const { data: usedData } = await (supabase as any)
        .from('product_stock_used')
        .select('product_id, stock_used');
      const usedMap: Record<string, number> = {};
      (usedData || []).forEach((r: any) => { usedMap[r.product_id] = Number(r.stock_used) || 0; });

      setInventory(inventoryData || []);
      setProducts(productsData || []);
      setWarehouses(warehousesData || []);
      setPendingRequests((requestsData as unknown as InventoryRequest[]) || []);
      setStockUsed(usedMap);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast({
        title: "Error",
        description: "Failed to fetch inventory data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const addProduct = async (formData: FormData) => {
    const productData = {
      user_id: user.id,
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      category: formData.get('category') as string,
      item_type: (formData.get('item_type') as string) || 'sellable',
      uom: (formData.get('uom') as string) || 'pcs',
      price: parseFloat(formData.get('price') as string),
      sku: formData.get('sku') as string,
    };

    const { data: product, error } = await supabase
      .from('products')
      .insert([productData])
      .select()
      .single();

    if (error) {
      toast({
        title: "Error",
        description: "Failed to add product",
        variant: "destructive",
      });
    } else if (product) {
      // Create inventory records for all existing warehouses
      const inventoryRecords = warehouses.map(warehouse => ({
        product_id: product.id,
        warehouse_id: warehouse.id,
        quantity: 0,
        reorder_level: 10
      }));

      if (inventoryRecords.length > 0) {
        await supabase
          .from('inventory')
          .insert(inventoryRecords);
      }

      toast({
        title: "Success",
        description: "Product added successfully",
      });
      setShowAddProduct(false);
      fetchData();
    }
  };

  const addWarehouse = async (formData: FormData) => {
    const warehouseData = {
      user_id: user.id,
      name: formData.get('name') as string,
      location: formData.get('location') as string,
    };

    const { data: warehouse, error } = await supabase
      .from('warehouses')
      .insert([warehouseData])
      .select()
      .single();

    if (error) {
      toast({
        title: "Error",
        description: "Failed to add warehouse",
        variant: "destructive",
      });
    } else if (warehouse) {
      // Create inventory records for all existing products
      const inventoryRecords = products.map(product => ({
        product_id: product.id,
        warehouse_id: warehouse.id,
        quantity: 0,
        reorder_level: 10
      }));

      if (inventoryRecords.length > 0) {
        await supabase
          .from('inventory')
          .insert(inventoryRecords);
      }

      toast({
        title: "Success",
        description: "Warehouse added successfully",
      });
      setShowAddWarehouse(false);
      fetchData();
    }
  };

  const updateInventoryItem = async (formData: FormData) => {
    if (!editingItem) return;

    // Update inventory quantity and reorder level
    const inventoryUpdateData = {
      quantity: parseInt(formData.get('quantity') as string),
      reorder_level: parseInt(formData.get('reorder_level') as string),
    };

    const { error: inventoryError } = await supabase
      .from('inventory')
      .update(inventoryUpdateData)
      .eq('id', editingItem.id);

    if (inventoryError) {
      toast({
        title: "Error",
        description: "Failed to update inventory item",
        variant: "destructive",
      });
      return;
    }

    // Update product name if changed
    const newName = formData.get('name') as string;
    if (newName && newName !== editingItem.products.name) {
      const { error: productError } = await supabase
        .from('products')
        .update({ name: newName })
        .eq('id', editingItem.product_id);

      if (productError) {
        toast({
          title: "Error",
          description: "Failed to update product name",
          variant: "destructive",
        });
        return;
      }
    }

    toast({
      title: "Success",
      description: "Inventory item updated successfully",
    });
    setShowEditInventory(false);
    setEditingItem(null);
    fetchData();
  };

  const openEditDialog = (item: Inventory) => {
    setEditingItem(item);
    setShowEditInventory(true);
  };

  const filteredInventory = inventory.filter(item => {
    // Add null checks to prevent undefined errors
    if (!item.products || !item.warehouses) return false;
    
    const matchesSearch = item.products.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.products.sku?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "all" || item.products.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const categories = [...new Set(products.map(p => p.category))];
  const lowStockItems = inventory.filter(item => item.products && item.quantity <= item.reorder_level);

  // ── Inventory report export ──
  const exportInventoryReport = () => {
    const totalUnits = inventory.reduce((s, it) => s + Number(it.quantity), 0);
    const totalValue = inventory.reduce((s, it) => s + Number(it.quantity) * Number(it.products?.price || 0), 0);

    const lines: string[] = [];
    lines.push("Inventory Report");
    lines.push(`Generated,${format(new Date(), "yyyy-MM-dd HH:mm")}`);
    lines.push("");
    lines.push("Summary,Value");
    lines.push(`Distinct Stock Lines,${inventory.length}`);
    lines.push(`Total Units,${totalUnits}`);
    lines.push(`Total Stock Value (NGN),${totalValue.toFixed(2)}`);
    lines.push(`Low Stock Items,${lowStockItems.length}`);
    lines.push("");
    lines.push("SKU,Product,Category,Warehouse,Quantity,Reorder Level,Unit Price,Stock Value,Status");
    inventory.forEach((it) => {
      const price = Number(it.products?.price || 0);
      const value = Number(it.quantity) * price;
      const status = it.quantity <= it.reorder_level ? "LOW STOCK" : "OK";
      const cells = [
        it.products?.sku ?? "",
        it.products?.name ?? "",
        it.products?.category ?? "",
        it.warehouses?.name ?? "",
        String(it.quantity),
        String(it.reorder_level),
        price.toFixed(2),
        value.toFixed(2),
        status,
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-report-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    toast({ title: "Inventory report exported", description: `${inventory.length} stock lines · value ${formatNairaCompact(totalValue)}` });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Inventory Management</h1>
          <p className="text-muted-foreground mt-1">
            Track stock levels, manage products, and monitor warehouse locations
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <InventoryDailyReport />
          <Button variant="outline" onClick={exportInventoryReport}>
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('/business/inventory-requests')}
          >
            <ClipboardList className="h-4 w-4 mr-2" />
            View Requests
          </Button>
          {isAdmin && (
            <>
              <Dialog open={showAddWarehouse} onOpenChange={setShowAddWarehouse}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Warehouse
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    addWarehouse(new FormData(e.currentTarget));
                  }}>
                    <DialogHeader>
                      <DialogTitle>Add New Warehouse</DialogTitle>
                      <DialogDescription>
                        Add a new warehouse location for inventory tracking
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="name">Warehouse Name</Label>
                        <Input id="name" name="name" required />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="location">Location</Label>
                        <Input id="location" name="location" required />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="submit">Add Warehouse</Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
              <Dialog open={showAddProduct} onOpenChange={setShowAddProduct}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Product
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    addProduct(new FormData(e.currentTarget));
                  }}>
                    <DialogHeader>
                      <DialogTitle>Add New Product</DialogTitle>
                      <DialogDescription>
                        Add a new product to your inventory
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="name">Product Name</Label>
                        <Input id="name" name="name" required />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="sku">SKU</Label>
                        <Input id="sku" name="sku" required />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                          <Label htmlFor="item_type">Item Type</Label>
                          <Select name="item_type" defaultValue="sellable">
                            <SelectTrigger id="item_type"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="sellable">Sellable (invoiceable)</SelectItem>
                              <SelectItem value="non_sellable">Non-sellable</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="uom">Unit of Measure</Label>
                          <Input id="uom" name="uom" placeholder="e.g. pcs, kg, plate" defaultValue="pcs" />
                        </div>
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="category">Category</Label>
                        <Input id="category" name="category" placeholder="e.g. Drinks, Spices, Packaging" required />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="price">Price (₦)</Label>
                        <Input id="price" name="price" type="number" step="0.01" required />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="description">Description</Label>
                        <Textarea id="description" name="description" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="submit">Add Product</Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{products.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Warehouses</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{warehouses.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Items</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{lowStockItems.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Stock Value</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNairaCompact(inventory.reduce((total, item) => {
                if (!item.products) return total;
                return total + (item.quantity * item.products.price);
              }, 0))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
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
            {categories.map(category => (
              <SelectItem key={category} value={category}>{category}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Pending Requests Section */}
      {pendingRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Pending Requests</CardTitle>
            <CardDescription>
              Latest inventory requests awaiting fulfillment
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingRequests.map((request) => {
                // Add safety check for request data
                if (!request.products || !request.warehouses) return null;
                
                return (
                  <div key={request.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{request.products.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {request.warehouses.name} • Qty: {request.requested_quantity}
                        </p>
                      </div>
                    </div>
                    <Badge variant="secondary">Pending</Badge>
                  </div>
                );
              })}
              <Button 
                variant="outline" 
                className="w-full mt-3"
                onClick={() => navigate('/business/inventory-requests')}
              >
                View All Requests
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inventory Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Requests</CardTitle>
            <ClipboardList className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{pendingRequests.length}</div>
          </CardContent>
        </Card>
        <Card>
        <CardHeader>
          <CardTitle>Inventory Items</CardTitle>
          <CardDescription>
            Monitor stock levels and manage your inventory
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>UoM</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">Stock at Hand</TableHead>
                <TableHead className="text-right">Stock Used</TableHead>
                <TableHead className="text-right">Reorder</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Value</TableHead>
                {isAdmin && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInventory.map((item) => {
                // Add safety check before rendering
                if (!item.products || !item.warehouses) return null;
                
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.products.name}</TableCell>
                    <TableCell>{item.products.sku}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={item.products.item_type === 'non_sellable'
                        ? 'bg-slate-50 text-slate-600 border-slate-200'
                        : 'bg-green-50 text-green-700 border-green-200'}>
                        {item.products.item_type === 'non_sellable' ? 'Non-sellable' : 'Sellable'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.products.uom || 'pcs'}</TableCell>
                    <TableCell>{item.warehouses.name}</TableCell>
                    <TableCell className="text-right font-medium">{item.quantity}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{stockUsed[item.product_id] ?? 0}</TableCell>
                    <TableCell className="text-right">{item.reorder_level}</TableCell>
                    <TableCell>
                      {item.quantity <= item.reorder_level ? (
                        <Badge variant="destructive">Low Stock</Badge>
                      ) : (
                        <Badge variant="secondary">In Stock</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{formatNairaCompact(item.quantity * item.products.price)}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Inventory Dialog */}
      <Dialog open={showEditInventory} onOpenChange={setShowEditInventory}>
        <DialogContent>
          <form onSubmit={(e) => {
            e.preventDefault();
            updateInventoryItem(new FormData(e.currentTarget));
          }}>
            <DialogHeader>
              <DialogTitle>Edit Inventory Item</DialogTitle>
              <DialogDescription>
                Update the product details, quantity and reorder level for {editingItem?.products?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Product Name</Label>
                <Input 
                  id="name" 
                  name="name" 
                  defaultValue={editingItem?.products?.name || ''}
                  required 
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="quantity">Current Quantity</Label>
                <Input 
                  id="quantity" 
                  name="quantity" 
                  type="number" 
                  defaultValue={editingItem?.quantity || 0}
                  required 
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reorder_level">Reorder Level</Label>
                <Input 
                  id="reorder_level" 
                  name="reorder_level" 
                  type="number" 
                  defaultValue={editingItem?.reorder_level || 0}
                  required 
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowEditInventory(false)}>
                Cancel
              </Button>
              <Button type="submit">Update Item</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Inventory;