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
import { Plus, Package, AlertTriangle, TrendingDown, Search, Filter, ClipboardList, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRoles } from "@/hooks/useRoles";
import { useToast } from "@/hooks/use-toast";
import { formatNairaCompact } from "@/lib/currency";

interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
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

      setInventory(inventoryData || []);
      setProducts(productsData || []);
      setWarehouses(warehousesData || []);
      setPendingRequests((requestsData as unknown as InventoryRequest[]) || []);
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
        <div className="flex gap-2">
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
                      <div className="grid gap-2">
                        <Label htmlFor="category">Category</Label>
                        <Input id="category" name="category" required />
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
                <TableHead>Category</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Reorder Level</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Value</TableHead>
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
                    <TableCell>{item.products.category}</TableCell>
                    <TableCell>{item.warehouses.name}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>{item.reorder_level}</TableCell>
                    <TableCell>
                      {item.quantity <= item.reorder_level ? (
                        <Badge variant="destructive">Low Stock</Badge>
                      ) : (
                        <Badge variant="secondary">In Stock</Badge>
                      )}
                    </TableCell>
                    <TableCell>{formatNairaCompact(item.quantity * item.products.price)}</TableCell>
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