import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, ShoppingCart, DollarSign, BarChart3, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";

const BusinessManagement = () => {
  const navigate = useNavigate();

  const modules = [
    {
      title: "Inventory Management",
      description: "Track stock levels, manage products, and monitor warehouse locations",
      icon: Package,
      route: "/business/inventory",
      color: "from-blue-500 to-blue-600"
    },
    {
      title: "Sales Management",
      description: "Record sales transactions and manage customer orders",
      icon: ShoppingCart,
      route: "/business/sales",
      color: "from-green-500 to-green-600"
    },
    {
      title: "Payment Reconciliation",
      description: "Track payments, bank transactions, and reconcile accounts",
      icon: DollarSign,
      route: "/business/payments",
      color: "from-purple-500 to-purple-600"
    },
    {
      title: "Analytics & Reports",
      description: "Real-time insights and performance dashboards",
      icon: BarChart3,
      route: "/business/analytics",
      color: "from-indigo-500 to-indigo-600"
    },
    {
      title: "KPI Dashboard",
      description: "Monitor key performance indicators and trends",
      icon: TrendingUp,
      route: "/business/kpi",
      color: "from-pink-500 to-pink-600"
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Business Management</h1>
          <p className="text-muted-foreground mt-2">
            Comprehensive system for inventory, sales, and payment reconciliation
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {modules.map((module) => {
          const Icon = module.icon;
          return (
            <Card 
              key={module.title} 
              className="cursor-pointer transition-all duration-200 hover:shadow-lg hover:scale-105 border-border bg-card"
            >
              <CardHeader className="pb-4">
                <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${module.color} flex items-center justify-center mb-4`}>
                  <Icon className="h-6 w-6 text-white" />
                </div>
                <CardTitle className="text-lg text-card-foreground">{module.title}</CardTitle>
                <CardDescription className="text-sm">
                  {module.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button 
                  onClick={() => navigate(module.route)}
                  className="w-full"
                  variant="default"
                >
                  Open Module
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-8">
        <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
          <CardHeader>
            <CardTitle className="text-xl text-foreground">System Overview</CardTitle>
            <CardDescription>
              This business management system provides end-to-end automation for inventory tracking, 
              sales management, and financial reconciliation with real-time analytics and reporting.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div className="text-center p-4 rounded-lg bg-background/50">
                <h3 className="font-semibold text-foreground">Real-time Tracking</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Monitor inventory, sales, and payments in real-time
                </p>
              </div>
              <div className="text-center p-4 rounded-lg bg-background/50">
                <h3 className="font-semibold text-foreground">Automated Reconciliation</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Identify discrepancies and streamline operations
                </p>
              </div>
              <div className="text-center p-4 rounded-lg bg-background/50">
                <h3 className="font-semibold text-foreground">Advanced Analytics</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Generate insights and performance reports
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default BusinessManagement;