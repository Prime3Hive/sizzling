import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Package, Search, Filter, ShoppingCart, TrendingUp, ArrowDown, ArrowUp } from "lucide-react";
import { format } from "date-fns";
import { formatNairaCompact } from "@/lib/currency";

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

interface TransactionHistoryProps {
  transactions: Transaction[];
}

export function TransactionHistory({ transactions }: TransactionHistoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showAll, setShowAll] = useState(false);

  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = t.skus?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.notes?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'all' || t.transaction_type === typeFilter;
    return matchesSearch && matchesType;
  });

  const displayedTransactions = showAll ? filteredTransactions : filteredTransactions.slice(0, 20);

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'PURCHASE':
        return <ArrowUp className="h-4 w-4 text-green-600" />;
      case 'SALE':
        return <ArrowDown className="h-4 w-4 text-blue-600" />;
      case 'ADJUSTMENT':
        return <Package className="h-4 w-4 text-orange-600" />;
      default:
        return <Package className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getTransactionBadge = (type: string) => {
    switch (type) {
      case 'PURCHASE':
        return <Badge className="bg-green-100 text-green-700 border-green-300">Purchase</Badge>;
      case 'SALE':
        return <Badge className="bg-blue-100 text-blue-700 border-blue-300">Usage</Badge>;
      case 'ADJUSTMENT':
        return <Badge className="bg-orange-100 text-orange-700 border-orange-300">Adjustment</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Transaction History</CardTitle>
            <CardDescription>Complete audit trail of inventory movements</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-48"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-32">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="PURCHASE">Purchases</SelectItem>
                <SelectItem value="SALE">Usage</SelectItem>
                <SelectItem value="ADJUSTMENT">Adjustments</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {displayedTransactions.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No transactions found
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedTransactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>
                      {getTransactionIcon(transaction.transaction_type)}
                    </TableCell>
                    <TableCell>
                      {getTransactionBadge(transaction.transaction_type)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {transaction.skus?.name || 'Unknown Item'}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${
                      transaction.quantity >= 0 ? 'text-green-600' : 'text-destructive'
                    }`}>
                      {transaction.quantity >= 0 ? '+' : ''}{transaction.quantity} {transaction.skus?.unit_of_measure}
                    </TableCell>
                    <TableCell className="text-right">
                      {transaction.total_amount > 0 ? formatNairaCompact(transaction.total_amount) : '-'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(transaction.created_at), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {transaction.notes || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {filteredTransactions.length > 20 && !showAll && (
              <div className="text-center pt-4">
                <Button variant="outline" onClick={() => setShowAll(true)}>
                  Show All ({filteredTransactions.length} transactions)
                </Button>
              </div>
            )}

            {showAll && filteredTransactions.length > 20 && (
              <div className="text-center pt-4">
                <Button variant="outline" onClick={() => setShowAll(false)}>
                  Show Less
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
