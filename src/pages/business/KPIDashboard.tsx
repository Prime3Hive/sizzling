import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { InventoryKPICards } from "@/components/inventory/InventoryKPICards";
import { LowStockAlerts } from "@/components/inventory/LowStockAlerts";
import { CategoryBreakdown } from "@/components/inventory/CategoryBreakdown";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const KPIDashboard = () => {
  const navigate = useNavigate();

  const { data: skus = [] } = useQuery({
    queryKey: ['skus-kpi'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('skus')
        .select('*')
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['transactions-kpi'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/business")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-foreground">KPI Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Monitor key performance indicators and trends
          </p>
        </div>
      </div>

      <InventoryKPICards skus={skus} transactions={transactions} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LowStockAlerts skus={skus} />
        <CategoryBreakdown skus={skus} />
      </div>
    </div>
  );
};

export default KPIDashboard;
