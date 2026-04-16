import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, Eye, Printer, CalendarRange, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { formatNairaCompact } from "@/lib/currency";
import PayslipTemplate from "@/components/PayslipTemplate";

interface PayrollRecord {
  id: string;
  staff_name: string;
  staff_id_number: string | null;
  department: string | null;
  position: string | null;
  salary_period: string;
  period_start: string;
  period_end: string;
  basic_salary: number;
  allowances: number;
  deductions: number;
  net_pay: number;
  bank_name: string | null;
  account_number: string | null;
  account_name: string | null;
  status: string;
  paid_at: string | null;
  notes: string | null;
}

const MyPayslip = () => {
  const { user } = useAuth();
  const [selected, setSelected] = useState<PayrollRecord | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  // First get the staff_profile_id linked to this user
  const { data: staffProfile } = useQuery({
    queryKey: ["my-staff-profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_profiles")
        .select("id, full_name, position, departments(name)")
        .eq("linked_user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch only this staff member's payroll records
  const { data: records = [], isLoading } = useQuery<PayrollRecord[]>({
    queryKey: ["my-payroll-records", staffProfile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_records")
        .select("*")
        .eq("staff_profile_id", staffProfile!.id)
        .order("period_start", { ascending: false });
      if (error) throw error;
      return (data || []) as PayrollRecord[];
    },
    enabled: !!staffProfile?.id,
  });

  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Payslip</title>
          <style>
            * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            body { margin: 0; padding: 0; background: #fff; }
            @page { size: A5 landscape; margin: 0; }
          </style>
        </head>
        <body>${el.innerHTML}</body>
      </html>
    `);
    win.document.close();
    win.print();
  };

  // Summary stats
  const totalEarned = records.filter(r => r.status === "paid").reduce((s, r) => s + Number(r.net_pay), 0);
  const pendingCount = records.filter(r => r.status === "pending").length;
  const latestRecord = records[0];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-4 md:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!staffProfile) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
        <Wallet className="h-14 w-14 text-muted-foreground opacity-40" />
        <h2 className="text-xl font-semibold">No Staff Profile Linked</h2>
        <p className="text-muted-foreground max-w-sm">
          Your account hasn't been linked to a staff profile yet. Contact HR or Admin to link your account.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-orange-100 rounded-lg">
          <Wallet className="h-6 w-6 text-orange-600" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">My Payslips</h1>
          <p className="text-muted-foreground text-sm">
            {staffProfile.full_name} · {(staffProfile as any).departments?.name || "—"} · {staffProfile.position?.replace(/_/g, " ")}
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg"><TrendingUp className="h-5 w-5 text-green-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Earned</p>
                <p className="text-2xl font-bold">{formatNairaCompact(totalEarned)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg"><CalendarRange className="h-5 w-5 text-blue-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Payslips</p>
                <p className="text-2xl font-bold">{records.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg"><Wallet className="h-5 w-5 text-orange-600" /></div>
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Latest Net Pay</p>
                <p className="text-2xl font-bold">
                  {latestRecord ? formatNairaCompact(Number(latestRecord.net_pay)) : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Payslip List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Payslip History</CardTitle>
        </CardHeader>
        <CardContent>
          {records.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Wallet className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No payslips yet</p>
              <p className="text-sm">Your payslips will appear here once payroll is generated by HR or Admin.</p>
            </div>
          ) : (
            <div className="divide-y">
              {records.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-4 hover:bg-muted/30 px-2 rounded-lg transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                      <Wallet className="h-5 w-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm">
                        {format(new Date(r.period_start), "dd MMM")} – {format(new Date(r.period_end), "dd MMM yyyy")}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] uppercase px-1.5">{r.salary_period}</Badge>
                        <span className="text-xs text-muted-foreground">
                          Basic: {formatNairaCompact(Number(r.basic_salary))}
                          {Number(r.allowances) > 0 && ` · +${formatNairaCompact(Number(r.allowances))} allowances`}
                          {Number(r.deductions) > 0 && ` · −${formatNairaCompact(Number(r.deductions))} deductions`}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="font-bold text-base">{formatNairaCompact(Number(r.net_pay))}</p>
                      <Badge
                        variant={r.status === "paid" ? "default" : "secondary"}
                        className={`text-[10px] ${r.status === "paid" ? "bg-green-600 hover:bg-green-700" : ""}`}
                      >
                        {r.status === "paid" ? "Paid" : "Pending"}
                      </Badge>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setSelected(r)}>
                      <Eye className="h-3.5 w-3.5 mr-1.5" />
                      View
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payslip Detail Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-[230mm] p-0 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-3 border-b bg-muted/30">
            <p className="font-semibold text-sm">Payslip — {selected?.staff_name}</p>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              Print
            </Button>
          </div>
          <div ref={printRef} className="overflow-auto">
            {selected && <PayslipTemplate record={selected} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyPayslip;
