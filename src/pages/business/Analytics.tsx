import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { UsageAnalytics } from "@/components/inventory/UsageAnalytics";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const Analytics = () => {
  const navigate = useNavigate();

  const { data: skus = [] } = useQuery({
    queryKey: ['skus-analytics'],
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
    queryKey: ['transactions-analytics'],
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
          <h1 className="text-3xl font-bold text-foreground">Analytics & Reports</h1>
          <p className="text-muted-foreground mt-1">
            Real-time insights and performance dashboards
          </p>
        </div>
      </div>

      <UsageAnalytics transactions={transactions} skus={skus} />
    </div>
  );
};

export default Analytics;
