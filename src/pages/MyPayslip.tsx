import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet, Eye, Printer, ChevronRight } from "lucide-react";
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
  commission?: number | null;
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
  const latestRecord = records[0];

  const periodLabel = (r: PayrollRecord) =>
    `${format(new Date(r.period_start), "d MMM")} – ${format(new Date(r.period_end), "d MMM yyyy")}`;
  const grossOf = (r: PayrollRecord) =>
    Number(r.basic_salary) + Number(r.allowances) + Number(r.commission ?? 0);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-44 rounded-2xl" />
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

  const latestGross = latestRecord ? grossOf(latestRecord) : 0;
  const keptPct = latestRecord && latestGross > 0
    ? Math.round((Number(latestRecord.net_pay) / latestGross) * 100)
    : null;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header — the phone's top bar already says where you are. */}
      <div className="max-lg:hidden">
        <h1 className="font-display text-[1.75rem] font-bold leading-tight sm:text-[2rem]">My payslips</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {staffProfile.full_name} · {(staffProfile as any).departments?.name || "—"} · {staffProfile.position?.replace(/_/g, " ")}
        </p>
      </div>

      {/* The latest payslip leads: what landed, when, and what was kept. */}
      {latestRecord && (
        <section className="rounded-3xl bg-stone-900 p-5 text-white dark:bg-card dark:text-foreground dark:border sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-orange-300">
            Take-home · {periodLabel(latestRecord)}
          </p>
          <p className="mt-1.5 font-display text-[2.5rem] font-bold leading-none tabular-nums">
            {formatNairaCompact(Number(latestRecord.net_pay))}
          </p>
          <p className="mt-3 flex items-center gap-2 text-sm text-stone-300 dark:text-muted-foreground">
            <span aria-hidden className={`h-2 w-2 rounded-full ${latestRecord.status === "paid" ? "bg-emerald-400" : "bg-amber-400"}`} />
            {latestRecord.status === "paid"
              ? `Paid${latestRecord.paid_at ? ` ${format(new Date(latestRecord.paid_at), "d MMM yyyy")}` : ""}${latestRecord.bank_name ? ` to ${latestRecord.bank_name}${latestRecord.account_number ? ` ••${latestRecord.account_number.slice(-4)}` : ""}` : ""}`
              : "Not paid yet"}
          </p>
          {keptPct !== null && (
            <>
              <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/15 dark:bg-muted" role="presentation">
                <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, keptPct)}%` }} />
              </div>
              <p className="mt-2 flex justify-between text-[12.5px] tabular-nums text-stone-300 dark:text-muted-foreground">
                <span><b className="text-orange-300">{keptPct}%</b> kept of {formatNairaCompact(latestGross)}</span>
                <span>{formatNairaCompact(Number(latestRecord.deductions))} deducted</span>
              </p>
            </>
          )}
          <Button onClick={() => setSelected(latestRecord)}
            className="mt-5 h-11 w-full bg-white text-stone-900 hover:bg-stone-100 dark:bg-primary dark:text-primary-foreground sm:w-auto">
            <Eye className="h-4 w-4" aria-hidden />View payslip
          </Button>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-4 sm:pt-5">
            <p className="text-xs font-semibold text-muted-foreground">Earned (paid)</p>
            <p className="mt-1 font-display text-xl font-bold tabular-nums sm:text-2xl">{formatNairaCompact(totalEarned)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:pt-5">
            <p className="text-xs font-semibold text-muted-foreground">Payslips</p>
            <p className="mt-1 font-display text-xl font-bold tabular-nums sm:text-2xl">{records.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Payslip List */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent className="px-2 sm:px-6">
          {records.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Wallet className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No payslips yet</p>
              <p className="text-sm">Your payslips will appear here once payroll is generated by HR or Admin.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {records.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(r)}
                    className="flex min-h-[64px] w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/40 active:bg-muted/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{periodLabel(r)}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        <span className="uppercase">{r.salary_period}</span>
                        {` · gross ${formatNairaCompact(grossOf(r))}`}
                        {Number(r.deductions) > 0 && ` · −${formatNairaCompact(Number(r.deductions))}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-bold tabular-nums">{formatNairaCompact(Number(r.net_pay))}</span>
                      <Badge
                        variant={r.status === "paid" ? "default" : "secondary"}
                        className={`text-[10px] ${r.status === "paid" ? "bg-green-600 hover:bg-green-700" : ""}`}
                      >
                        {r.status === "paid" ? "Paid" : "Pending"}
                      </Badge>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Payslip detail: the printable template on a wide screen; a readable
          breakdown on a phone, where an A5 landscape page would need panning.
          The template stays in the DOM either way because Print copies it. */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="max-w-[230mm] p-0 sm:p-0 overflow-hidden max-sm:overflow-y-auto">
          <DialogTitle className="sr-only">Payslip{selected ? `, ${periodLabel(selected)}` : ""}</DialogTitle>
          <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-3 max-sm:pt-7 sm:px-6">
            <p className="text-sm font-semibold">Payslip — {selected?.staff_name}</p>
            <Button variant="outline" size="sm" onClick={handlePrint} className="max-sm:hidden">
              <Printer className="h-3.5 w-3.5 mr-1.5" />
              Print
            </Button>
          </div>
          {selected && (
            <div className="space-y-4 px-5 pb-2 pt-4 sm:hidden">
              <div>
                <p className="text-xs font-semibold text-muted-foreground">{periodLabel(selected)} · take-home</p>
                <p className="font-display text-3xl font-bold tabular-nums">{formatNairaCompact(Number(selected.net_pay))}</p>
              </div>
              <dl className="divide-y rounded-2xl border">
                {[
                  ["Basic salary", Number(selected.basic_salary)],
                  ["Allowances", Number(selected.allowances)],
                  ["Commission", Number(selected.commission ?? 0)],
                ].filter(([, v]) => (v as number) > 0).map(([k, v]) => (
                  <div key={k as string} className="flex justify-between gap-3 px-4 py-3 text-sm">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-semibold tabular-nums">{formatNairaCompact(v as number)}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 px-4 py-3 text-sm">
                  <dt className="font-semibold">Gross</dt>
                  <dd className="font-bold tabular-nums">{formatNairaCompact(grossOf(selected))}</dd>
                </div>
                <div className="flex justify-between gap-3 px-4 py-3 text-sm">
                  <dt className="text-muted-foreground">Deductions (tax, pension, other)</dt>
                  <dd className="font-semibold tabular-nums text-red-700 dark:text-red-400">−{formatNairaCompact(Number(selected.deductions))}</dd>
                </div>
                <div className="flex justify-between gap-3 bg-muted/40 px-4 py-3">
                  <dt className="font-bold">Net pay</dt>
                  <dd className="font-display text-lg font-bold tabular-nums">{formatNairaCompact(Number(selected.net_pay))}</dd>
                </div>
              </dl>
              {selected.notes && <p className="text-sm text-muted-foreground">{selected.notes}</p>}
              <DialogFooter>
                <Button onClick={handlePrint}><Printer className="h-4 w-4" aria-hidden />Print or save as PDF</Button>
              </DialogFooter>
            </div>
          )}
          <div ref={printRef} className="overflow-auto max-sm:hidden">
            {selected && <PayslipTemplate record={selected} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyPayslip;
