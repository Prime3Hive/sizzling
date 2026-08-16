import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Scale, BookOpen, ListTree, Plus, Trash2, Loader2, CheckCircle2, AlertTriangle, TrendingUp, Landmark, Receipt, Banknote } from "lucide-react";
import { formatNairaCompact } from "@/lib/currency";
import { safeFormat } from "@/lib/safeDate";

interface Account {
  id: string; code: string; name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  normal_balance: "debit" | "credit"; is_active: boolean; sort_order: number;
}
interface JournalLine { id: string; entry_id: string; account_id: string; debit: number; credit: number; description: string | null; reconciled_at?: string | null; }
interface LineWithMeta extends JournalLine { entry_date: string; memo?: string | null; chart_of_accounts: { code: string; name: string; type: string; normal_balance: string } | null; }
interface JournalEntry { id: string; entry_no: number; entry_date: string; memo: string | null; source_type: string; }

const typeLabels: Record<string, string> = {
  asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses",
};
const typeOrder = ["asset", "liability", "equity", "income", "expense"];

const BLANK_LINE = () => ({ account_id: "", debit: "", credit: "", description: "" });

// Liability accounts tracked in the Remittances register, with the party each
// balance is owed to and its deadline (statutory where applicable).
const REMITTANCE_ACCOUNTS: { code: string; agency: string; deadline: string }[] = [
  { code: "2000", agency: "Trade suppliers (goods received)", deadline: "Per supplier terms" },
  { code: "2100", agency: "FIRS (VAT)", deadline: "21st of the following month" },
  { code: "2300", agency: "State IRS (PAYE)", deadline: "10th of the following month" },
  { code: "2310", agency: "Staff PFAs (Pension)", deadline: "7 working days after payday" },
  { code: "2320", agency: "Federal Mortgage Bank (NHF)", deadline: "Monthly" },
  { code: "2340", agency: "Per agreement (other deductions)", deadline: "—" },
];

export default function Accounting() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const today = new Date().toISOString().split("T")[0];
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const [asOf, setAsOf] = useState(today);
  const [isFrom, setIsFrom] = useState(yearStart);
  const [isTo, setIsTo] = useState(today);
  const [bsAsOf, setBsAsOf] = useState(today);
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split("T")[0]);
  const [entryMemo, setEntryMemo] = useState("");
  const [lines, setLines] = useState([BLANK_LINE(), BLANK_LINE()]);
  const [saving, setSaving] = useState(false);

  // ── Queries ──
  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ["coa"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("chart_of_accounts").select("*").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  // All posted lines (with account + date) — the three statements derive from this
  const { data: allLines = [], isLoading: tbLoading } = useQuery<LineWithMeta[]>({
    queryKey: ["journal-all-lines"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("journal_lines")
        .select("id, entry_id, account_id, debit, credit, description, reconciled_at, journal_entries!inner(entry_date, memo), chart_of_accounts(code, name, type, normal_balance)")
        .limit(10000);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, entry_date: r.journal_entries?.entry_date, memo: r.journal_entries?.memo }));
    },
  });

  const { data: entries = [], isLoading: entriesLoading } = useQuery<any[]>({
    queryKey: ["journal-entries"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("journal_entries")
        .select("id, entry_no, entry_date, memo, source_type, journal_lines(id, debit, credit, description, chart_of_accounts(code, name))")
        .order("entry_date", { ascending: false })
        .order("entry_no", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Aggregate lines into per-account {debit, credit}, with an optional date window
  const aggregate = (from: string | null, to: string) => {
    const byAccount: Record<string, { account: any; debit: number; credit: number }> = {};
    for (const l of allLines) {
      const acc = l.chart_of_accounts;
      if (!acc || !l.entry_date) continue;
      if (l.entry_date > to) continue;
      if (from && l.entry_date < from) continue;
      const key = l.account_id;
      if (!byAccount[key]) byAccount[key] = { account: acc, debit: 0, credit: 0 };
      byAccount[key].debit += Number(l.debit);
      byAccount[key].credit += Number(l.credit);
    }
    return byAccount;
  };

  // ── Trial balance (as of date) ──
  const trialBalance = useMemo(() => {
    const byAccount = aggregate(null, asOf);
    const rows = Object.values(byAccount).map((r) => {
      const net = r.debit - r.credit;
      return { ...r, balanceDebit: net > 0 ? net : 0, balanceCredit: net < 0 ? -net : 0 };
    }).filter((r) => r.balanceDebit > 0.005 || r.balanceCredit > 0.005);
    rows.sort((a, b) => a.account.code.localeCompare(b.account.code));
    const totalDebit = rows.reduce((s, r) => s + r.balanceDebit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.balanceCredit, 0);
    return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
  }, [allLines, asOf]);

  // ── Income statement (period) ──
  const incomeStatement = useMemo(() => {
    const byAccount = aggregate(isFrom, isTo);
    const income: any[] = [], expense: any[] = [];
    for (const r of Object.values(byAccount)) {
      if (r.account.type === "income") {
        const bal = r.credit - r.debit; // credit-normal
        if (Math.abs(bal) > 0.005) income.push({ ...r, balance: bal });
      } else if (r.account.type === "expense") {
        const bal = r.debit - r.credit; // debit-normal
        if (Math.abs(bal) > 0.005) expense.push({ ...r, balance: bal });
      }
    }
    income.sort((a, b) => a.account.code.localeCompare(b.account.code));
    expense.sort((a, b) => a.account.code.localeCompare(b.account.code));
    const totalIncome = income.reduce((s, r) => s + r.balance, 0);
    const totalExpense = expense.reduce((s, r) => s + r.balance, 0);
    return { income, expense, totalIncome, totalExpense, netIncome: totalIncome - totalExpense };
  }, [allLines, isFrom, isTo]);

  // ── Balance sheet (as of date) ──
  const balanceSheet = useMemo(() => {
    const byAccount = aggregate(null, bsAsOf);
    const assets: any[] = [], liabilities: any[] = [], equity: any[] = [];
    let incomeToDate = 0, expenseToDate = 0;
    for (const r of Object.values(byAccount)) {
      const t = r.account.type;
      if (t === "asset") {
        const bal = r.debit - r.credit;
        if (Math.abs(bal) > 0.005) assets.push({ ...r, balance: bal });
      } else if (t === "liability") {
        const bal = r.credit - r.debit;
        if (Math.abs(bal) > 0.005) liabilities.push({ ...r, balance: bal });
      } else if (t === "equity") {
        const bal = r.credit - r.debit;
        if (Math.abs(bal) > 0.005) equity.push({ ...r, balance: bal });
      } else if (t === "income") {
        incomeToDate += r.credit - r.debit;
      } else if (t === "expense") {
        expenseToDate += r.debit - r.credit;
      }
    }
    [assets, liabilities, equity].forEach((g) => g.sort((a, b) => a.account.code.localeCompare(b.account.code)));
    const retainedEarnings = incomeToDate - expenseToDate; // cumulative net profit to date
    const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
    const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
    const totalEquityPosted = equity.reduce((s, r) => s + r.balance, 0);
    const totalEquity = totalEquityPosted + retainedEarnings;
    const totalLiabEquity = totalLiabilities + totalEquity;
    return {
      assets, liabilities, equity, retainedEarnings,
      totalAssets, totalLiabilities, totalEquity, totalLiabEquity,
      balanced: Math.abs(totalAssets - totalLiabEquity) < 0.01,
    };
  }, [allLines, bsAsOf]);

  // ── New entry helpers ──
  const lineTotals = useMemo(() => {
    const d = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
    const c = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
    return { d, c, balanced: Math.abs(d - c) < 0.01 && d > 0 };
  }, [lines]);

  const resetEntry = () => {
    setEntryDate(new Date().toISOString().split("T")[0]);
    setEntryMemo("");
    setLines([BLANK_LINE(), BLANK_LINE()]);
  };

  const saveEntry = useMutation({
    mutationFn: async () => {
      const validLines = lines.filter((l) => l.account_id && ((parseFloat(l.debit) || 0) > 0 || (parseFloat(l.credit) || 0) > 0));
      if (validLines.length < 2) throw new Error("Add at least two lines");
      if (!lineTotals.balanced) throw new Error("Entry must balance (debits = credits)");

      const { data: entry, error: eErr } = await (supabase as any)
        .from("journal_entries")
        .insert({ entry_date: entryDate, memo: entryMemo.trim() || null, source_type: "manual", created_by: user?.id })
        .select("id").single();
      if (eErr) throw eErr;

      const rows = validLines.map((l) => ({
        entry_id: entry.id,
        account_id: l.account_id,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        description: l.description.trim() || null,
      }));
      const { error: lErr } = await (supabase as any).from("journal_lines").insert(rows);
      if (lErr) throw lErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      qc.invalidateQueries({ queryKey: ["tb-lines"] });
      toast({ title: "Journal entry posted" });
      setEntryOpen(false);
      resetEntry();
    },
    onError: (e: any) => toast({ title: "Could not post entry", description: e.message, variant: "destructive" }),
  });

  const setLine = (i: number, field: string, value: string) =>
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  const addLine = () => setLines((prev) => [...prev, BLANK_LINE()]);
  const removeLine = (i: number) => setLines((prev) => prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev);

  // ── Statutory remittances ────────────────────────────────────────────────────
  // Outstanding balance per statutory liability account (2100 VAT, 2300 PAYE,
  // 2310 Pension, 2320 NHF, 2340 Other) as of today, straight from the ledger.
  const remittanceRows = useMemo(() => {
    const byAccount = aggregate(null, today);
    return REMITTANCE_ACCOUNTS.map((meta) => {
      const entry = Object.entries(byAccount).find(([, r]) => (r.account as any)?.code === meta.code);
      const accountId = entry?.[0] ?? accounts.find((a) => a.code === meta.code)?.id ?? null;
      const r = entry?.[1];
      const balance = r ? r.credit - r.debit : 0; // credit-normal liability
      const name = (r?.account as any)?.name ?? accounts.find((a) => a.code === meta.code)?.name ?? meta.code;
      return { ...meta, accountId, name, balance };
    });
  }, [allLines, accounts, today]);

  const [remitOpen, setRemitOpen] = useState(false);
  const [remitTarget, setRemitTarget] = useState<{ code: string; name: string; accountId: string | null; balance: number } | null>(null);
  const [remitAmount, setRemitAmount] = useState("");
  const [remitDate, setRemitDate] = useState(today);
  const [remitRef, setRemitRef] = useState("");

  const bankAccountId = accounts.find((a) => a.code === "1010")?.id ?? null;

  // ── Books Check: GL vs operational reports ───────────────────────────────────
  // The operational pages (Finance, P&L, Dashboard) aggregate raw tables; the
  // statements here derive from the journal. This check compares the two so any
  // drift between the books is surfaced instead of silently diverging.
  const [bcFrom, setBcFrom] = useState(yearStart);
  const [bcTo, setBcTo] = useState(today);

  const { data: bcInvoices = [] } = useQuery<any[]>({
    queryKey: ["bc-invoices", bcFrom, bcTo],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("invoices")
        .select("total_amount, tax_amount, issue_date")
        .eq("status", "invoice")
        .gte("issue_date", bcFrom).lte("issue_date", bcTo);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: bcSales = [] } = useQuery<any[]>({
    queryKey: ["bc-sales", bcFrom, bcTo],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sales")
        .select("total_amount, vat_amount, sale_date")
        .neq("status", "cancelled")
        .gte("sale_date", bcFrom).lte("sale_date", bcTo);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: bcExpenses = [] } = useQuery<any[]>({
    queryKey: ["bc-expenses", bcFrom, bcTo],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("expenses")
        .select("amount, date")
        .eq("status", "approved")
        .gte("date", bcFrom).lte("date", bcTo);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: bcPayroll = [] } = useQuery<any[]>({
    queryKey: ["bc-payroll", bcFrom, bcTo],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payroll_records")
        .select("basic_salary, allowances, pension_employer, net_pay")
        .eq("status", "paid")
        .gte("period_start", bcFrom).lte("period_start", bcTo);
      if (error) throw error;
      return data ?? [];
    },
  });

  const booksCheck = useMemo(() => {
    const byAccount = aggregate(bcFrom, bcTo);
    let glRevenue = 0, glExpense = 0;
    for (const r of Object.values(byAccount)) {
      if ((r.account as any).type === "income") glRevenue += r.credit - r.debit;
      if ((r.account as any).type === "expense") glExpense += r.debit - r.credit;
    }

    const opsRevenue =
      bcInvoices.reduce((s, i) => s + Number(i.total_amount) - Number(i.tax_amount ?? 0), 0) +
      bcSales.reduce((s, x) => s + Number(x.total_amount) - Number(x.vat_amount ?? 0), 0);
    const opsExpenses = bcExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const opsPayrollGross = bcPayroll.reduce(
      (s, p) => s + Number(p.basic_salary) + Number(p.allowances) + Number(p.pension_employer ?? 0), 0);
    const opsCosts = opsExpenses + opsPayrollGross;

    return {
      glRevenue, glExpense,
      glNet: glRevenue - glExpense,
      opsRevenue, opsCosts,
      opsNet: opsRevenue - opsCosts,
      revDelta: glRevenue - opsRevenue,
      expDelta: glExpense - opsCosts,
    };
  }, [allLines, bcFrom, bcTo, bcInvoices, bcSales, bcExpenses, bcPayroll]);

  // ── Bank reconciliation ──────────────────────────────────────────────────────
  const [recAccountCode, setRecAccountCode] = useState("1010");
  const [recTo, setRecTo] = useState(today);
  const [recStatementBal, setRecStatementBal] = useState("");

  const recAccount = accounts.find((a) => a.code === recAccountCode) ?? null;

  const recLines = useMemo(() => {
    if (!recAccount) return [];
    return allLines
      .filter((l) => l.account_id === recAccount.id && l.entry_date && l.entry_date <= recTo)
      .sort((a, b) => (a.entry_date < b.entry_date ? -1 : a.entry_date > b.entry_date ? 1 : 0));
  }, [allLines, recAccount, recTo]);

  const recTotals = useMemo(() => {
    const ledger = recLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    const reconciled = recLines
      .filter((l) => l.reconciled_at)
      .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
    const statement = parseFloat(recStatementBal);
    return {
      ledger,
      reconciled,
      unreconciledCount: recLines.filter((l) => !l.reconciled_at).length,
      statement: isNaN(statement) ? null : statement,
      difference: isNaN(statement) ? null : statement - reconciled,
    };
  }, [recLines, recStatementBal]);

  const toggleReconciled = useMutation({
    mutationFn: async (line: LineWithMeta) => {
      const { error } = await (supabase as any)
        .from("journal_lines")
        .update(line.reconciled_at
          ? { reconciled_at: null, reconciled_by: null }
          : { reconciled_at: new Date().toISOString(), reconciled_by: user?.id ?? null })
        .eq("id", line.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journal-all-lines"] }),
    onError: (e: any) => toast({ title: "Could not update line", description: e.message, variant: "destructive" }),
  });

  const saveRemittance = useMutation({
    mutationFn: async () => {
      if (!remitTarget?.accountId) throw new Error("Liability account not found in the chart of accounts");
      if (!bankAccountId) throw new Error("Bank account (1010) not found in the chart of accounts");
      const amt = parseFloat(remitAmount) || 0;
      if (amt <= 0) throw new Error("Enter the amount remitted");
      if (amt > remitTarget.balance + 0.005) {
        throw new Error(`Amount exceeds the outstanding balance of ${formatNairaCompact(remitTarget.balance)}`);
      }

      const memo = `Remittance — ${remitTarget.name}${remitRef.trim() ? ` (ref ${remitRef.trim()})` : ""}`;
      const { data: entry, error: eErr } = await (supabase as any)
        .from("journal_entries")
        .insert({ entry_date: remitDate, memo, source_type: "remittance", created_by: user?.id })
        .select("id").single();
      if (eErr) throw eErr;

      const { error: lErr } = await (supabase as any).from("journal_lines").insert([
        { entry_id: entry.id, account_id: remitTarget.accountId, debit: amt, credit: 0, description: "Liability settled" },
        { entry_id: entry.id, account_id: bankAccountId, debit: 0, credit: amt, description: remitRef.trim() || "Bank remittance" },
      ]);
      if (lErr) throw lErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journal-all-lines"] });
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      toast({ title: "Remittance recorded", description: "The liability balance has been reduced." });
      setRemitOpen(false); setRemitTarget(null); setRemitAmount(""); setRemitRef("");
    },
    onError: (e: any) => toast({ title: "Could not record remittance", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6 p-0 sm:p-4 md:p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="h-6 w-6" /> Accounting</h1>
        <p className="text-sm text-muted-foreground mt-1">Double-entry ledger, trial balance and chart of accounts.</p>
      </div>

      <Tabs defaultValue="trial-balance" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="trial-balance" className="gap-2"><Scale className="h-4 w-4" /> Trial Balance</TabsTrigger>
          <TabsTrigger value="income" className="gap-2"><TrendingUp className="h-4 w-4" /> Income Statement</TabsTrigger>
          <TabsTrigger value="balance-sheet" className="gap-2"><Landmark className="h-4 w-4" /> Balance Sheet</TabsTrigger>
          <TabsTrigger value="remittances" className="gap-2"><Receipt className="h-4 w-4" /> Remittances</TabsTrigger>
          <TabsTrigger value="bank-rec" className="gap-2"><Banknote className="h-4 w-4" /> Bank Rec</TabsTrigger>
          <TabsTrigger value="books-check" className="gap-2"><CheckCircle2 className="h-4 w-4" /> Books Check</TabsTrigger>
          <TabsTrigger value="journal" className="gap-2"><BookOpen className="h-4 w-4" /> Journal</TabsTrigger>
          <TabsTrigger value="accounts" className="gap-2"><ListTree className="h-4 w-4" /> Chart of Accounts</TabsTrigger>
        </TabsList>

        {/* ── Trial Balance ── */}
        <TabsContent value="trial-balance" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base">Trial Balance</CardTitle>
                  <CardDescription>Account balances as of the selected date</CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">As of</Label>
                    <Input type="date" className="h-9 w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
                  </div>
                  <Badge variant="outline" className={trialBalance.balanced ? "bg-green-50 text-green-700 border-green-200 h-9 px-3" : "bg-red-50 text-red-700 border-red-200 h-9 px-3"}>
                    {trialBalance.balanced ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Balanced</> : <><AlertTriangle className="h-3.5 w-3.5 mr-1" /> Out of balance</>}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {tbLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : trialBalance.rows.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <Scale className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p>No journal activity yet. Post entries in the Journal tab.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Code</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trialBalance.rows.map((r) => (
                      <TableRow key={r.account.code}>
                        <TableCell className="font-mono text-xs">{r.account.code}</TableCell>
                        <TableCell className="font-medium">{r.account.name}</TableCell>
                        <TableCell><span className="text-xs capitalize text-muted-foreground">{r.account.type}</span></TableCell>
                        <TableCell className="text-right">{r.balanceDebit > 0 ? formatNairaCompact(r.balanceDebit) : "—"}</TableCell>
                        <TableCell className="text-right">{r.balanceCredit > 0 ? formatNairaCompact(r.balanceCredit) : "—"}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-bold">
                      <TableCell colSpan={3}>Total</TableCell>
                      <TableCell className="text-right">{formatNairaCompact(trialBalance.totalDebit)}</TableCell>
                      <TableCell className="text-right">{formatNairaCompact(trialBalance.totalCredit)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Income Statement ── */}
        <TabsContent value="income" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base">Income Statement</CardTitle>
                  <CardDescription>Revenue and expenses over the selected period</CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" className="h-9 w-36" value={isFrom} onChange={(e) => setIsFrom(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" className="h-9 w-36" value={isTo} onChange={(e) => setIsTo(e.target.value)} /></div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {tbLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-5 max-w-xl">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Revenue</p>
                    {incomeStatement.income.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No revenue in this period.</p>
                    ) : incomeStatement.income.map((r) => (
                      <div key={r.account.code} className="flex justify-between text-sm py-0.5">
                        <span className="text-muted-foreground">{r.account.name}</span>
                        <span>{formatNairaCompact(r.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t pt-1 mt-1 text-sm font-semibold">
                      <span>Total Revenue</span><span>{formatNairaCompact(incomeStatement.totalIncome)}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Expenses</p>
                    {incomeStatement.expense.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No expenses in this period.</p>
                    ) : incomeStatement.expense.map((r) => (
                      <div key={r.account.code} className="flex justify-between text-sm py-0.5">
                        <span className="text-muted-foreground">{r.account.name}</span>
                        <span className="text-destructive">−{formatNairaCompact(r.balance)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t pt-1 mt-1 text-sm font-semibold">
                      <span>Total Expenses</span><span className="text-destructive">−{formatNairaCompact(incomeStatement.totalExpense)}</span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted p-3 flex items-center justify-between font-bold">
                    <span>Net {incomeStatement.netIncome >= 0 ? "Profit" : "Loss"}</span>
                    <span className={incomeStatement.netIncome >= 0 ? "text-success" : "text-destructive"}>
                      {incomeStatement.netIncome < 0 ? "−" : ""}{formatNairaCompact(Math.abs(incomeStatement.netIncome))}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Net margin: {incomeStatement.totalIncome > 0 ? ((incomeStatement.netIncome / incomeStatement.totalIncome) * 100).toFixed(1) : "0.0"}%
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Balance Sheet ── */}
        <TabsContent value="balance-sheet" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base">Balance Sheet</CardTitle>
                  <CardDescription>Financial position as of the selected date</CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <div className="space-y-1"><Label className="text-xs">As of</Label><Input type="date" className="h-9 w-40" value={bsAsOf} onChange={(e) => setBsAsOf(e.target.value)} /></div>
                  <Badge variant="outline" className={balanceSheet.balanced ? "bg-green-50 text-green-700 border-green-200 h-9 px-3" : "bg-red-50 text-red-700 border-red-200 h-9 px-3"}>
                    {balanceSheet.balanced ? <><CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Balanced</> : <><AlertTriangle className="h-3.5 w-3.5 mr-1" /> Out of balance</>}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {tbLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Assets */}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Assets</p>
                    {balanceSheet.assets.map((r) => (
                      <div key={r.account.code} className="flex justify-between text-sm py-0.5">
                        <span className="text-muted-foreground">{r.account.name}</span>
                        <span>{formatNairaCompact(r.balance)}</span>
                      </div>
                    ))}
                    {balanceSheet.assets.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
                    <div className="flex justify-between border-t pt-1 mt-1 text-sm font-bold">
                      <span>Total Assets</span><span>{formatNairaCompact(balanceSheet.totalAssets)}</span>
                    </div>
                  </div>

                  {/* Liabilities + Equity */}
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Liabilities</p>
                      {balanceSheet.liabilities.map((r) => (
                        <div key={r.account.code} className="flex justify-between text-sm py-0.5">
                          <span className="text-muted-foreground">{r.account.name}</span>
                          <span>{formatNairaCompact(r.balance)}</span>
                        </div>
                      ))}
                      {balanceSheet.liabilities.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
                      <div className="flex justify-between border-t pt-1 mt-1 text-sm font-semibold">
                        <span>Total Liabilities</span><span>{formatNairaCompact(balanceSheet.totalLiabilities)}</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Equity</p>
                      {balanceSheet.equity.map((r) => (
                        <div key={r.account.code} className="flex justify-between text-sm py-0.5">
                          <span className="text-muted-foreground">{r.account.name}</span>
                          <span>{formatNairaCompact(r.balance)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-sm py-0.5">
                        <span className="text-muted-foreground">Retained Earnings</span>
                        <span>{balanceSheet.retainedEarnings < 0 ? "−" : ""}{formatNairaCompact(Math.abs(balanceSheet.retainedEarnings))}</span>
                      </div>
                      <div className="flex justify-between border-t pt-1 mt-1 text-sm font-semibold">
                        <span>Total Equity</span><span>{formatNairaCompact(balanceSheet.totalEquity)}</span>
                      </div>
                    </div>
                    <div className="rounded-lg bg-muted p-3 flex justify-between font-bold text-sm">
                      <span>Liabilities + Equity</span><span>{formatNairaCompact(balanceSheet.totalLiabEquity)}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Statutory Remittances ── */}
        <TabsContent value="remittances" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Liabilities &amp; Remittance Register</CardTitle>
              <CardDescription>
                Supplier payables and amounts withheld or collected on behalf of government agencies,
                straight from the ledger. Record each payment when it is made — the entry debits the
                liability and credits Bank.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tbLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Code</TableHead>
                      <TableHead>Liability</TableHead>
                      <TableHead>Remit to</TableHead>
                      <TableHead>Deadline</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                      <TableHead className="w-28" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {remittanceRows.map((r) => (
                      <TableRow key={r.code}>
                        <TableCell className="font-mono text-xs">{r.code}</TableCell>
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.agency}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.deadline}</TableCell>
                        <TableCell className="text-right font-semibold">
                          {r.balance > 0.005
                            ? <span className="text-amber-600">{formatNairaCompact(r.balance)}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm" variant="outline" disabled={r.balance <= 0.005}
                            onClick={() => {
                              setRemitTarget(r);
                              setRemitAmount(r.balance > 0 ? r.balance.toFixed(2) : "");
                              setRemitDate(today);
                              setRemitRef("");
                              setRemitOpen(true);
                            }}
                          >
                            Remit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                PAYE is due to the relevant State IRS by the 10th, VAT to FIRS by the 21st of the month
                following the deduction; pension contributions must reach the PFAs within 7 working days of
                salary payment. Late remittance attracts penalties and interest, and directors can be held
                personally liable for unremitted PAYE/VAT.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Books Check ── */}
        <TabsContent value="books-check" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base">Books Check — Ledger vs Operational Reports</CardTitle>
                  <CardDescription>
                    The general ledger is the book of record; Finance / P&amp;L aggregate the raw tables.
                    Differences beyond the known timing items below indicate drift worth investigating.
                  </CardDescription>
                </div>
                <div className="flex items-end gap-2">
                  <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" className="h-9 w-36" value={bcFrom} onChange={(e) => setBcFrom(e.target.value)} /></div>
                  <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" className="h-9 w-36" value={bcTo} onChange={(e) => setBcTo(e.target.value)} /></div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    <TableHead className="text-right">General Ledger</TableHead>
                    <TableHead className="text-right">Operational Reports</TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Revenue (net of VAT)</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNairaCompact(booksCheck.glRevenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNairaCompact(booksCheck.opsRevenue)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${Math.abs(booksCheck.revDelta) < 1 ? "text-green-600" : "text-amber-600"}`}>
                      {Math.abs(booksCheck.revDelta) < 1 ? "✓ agrees" : formatNairaCompact(booksCheck.revDelta)}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Expenses &amp; payroll</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNairaCompact(booksCheck.glExpense)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNairaCompact(booksCheck.opsCosts)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${Math.abs(booksCheck.expDelta) < 1 ? "text-green-600" : "text-amber-600"}`}>
                      {Math.abs(booksCheck.expDelta) < 1 ? "✓ agrees" : formatNairaCompact(booksCheck.expDelta)}
                    </TableCell>
                  </TableRow>
                  <TableRow className="border-t-2 font-bold">
                    <TableCell>Net profit</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNairaCompact(booksCheck.glNet)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNairaCompact(booksCheck.opsNet)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${Math.abs(booksCheck.glNet - booksCheck.opsNet) < 1 ? "text-green-600" : "text-amber-600"}`}>
                      {Math.abs(booksCheck.glNet - booksCheck.opsNet) < 1 ? "✓ agrees" : formatNairaCompact(booksCheck.glNet - booksCheck.opsNet)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <div className="text-xs text-muted-foreground mt-4 space-y-1">
                <p className="font-medium text-foreground">Known, expected differences:</p>
                <p>• COGS on tracked stock hits the ledger at invoice issue; operational reports carry purchase-typed expenses instead (timing/classification).</p>
                <p>• Payroll: the ledger books gross pay + employer pension; the comparison uses the same gross figure, but legacy pre-statutory records may differ by their deduction treatment.</p>
                <p>• Journal entries posted manually (or remittances) have no counterpart in the operational tables.</p>
                <p>• Cancelled documents in a locked period may be excluded on one side only.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Bank Reconciliation ── */}
        <TabsContent value="bank-rec" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="text-base">Bank Reconciliation</CardTitle>
                  <CardDescription>Tick each ledger line off against the bank/cash statement.</CardDescription>
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="space-y-1">
                    <Label className="text-xs">Account</Label>
                    <Select value={recAccountCode} onValueChange={setRecAccountCode}>
                      <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {accounts.filter((a) => a.code === "1000" || a.code === "1010").map((a) => (
                          <SelectItem key={a.code} value={a.code}>
                            <span className="font-mono text-xs mr-2">{a.code}</span>{a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Up to</Label>
                    <Input type="date" className="h-9 w-40" value={recTo} onChange={(e) => setRecTo(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Statement balance (₦)</Label>
                    <Input type="number" step="0.01" className="h-9 w-44" placeholder="From bank statement"
                      value={recStatementBal} onChange={(e) => setRecStatementBal(e.target.value)} />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Ledger balance</p>
                  <p className="font-bold">{formatNairaCompact(recTotals.ledger)}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Reconciled balance</p>
                  <p className="font-bold">{formatNairaCompact(recTotals.reconciled)}</p>
                </div>
                <div className="rounded-lg bg-muted p-3">
                  <p className="text-xs text-muted-foreground">Unreconciled lines</p>
                  <p className="font-bold">{recTotals.unreconciledCount}</p>
                </div>
                <div className={`rounded-lg p-3 ${recTotals.difference == null ? "bg-muted" : Math.abs(recTotals.difference) < 0.01 ? "bg-green-50 dark:bg-green-950/30" : "bg-red-50 dark:bg-red-950/30"}`}>
                  <p className="text-xs text-muted-foreground">Statement vs reconciled</p>
                  <p className={`font-bold ${recTotals.difference == null ? "" : Math.abs(recTotals.difference) < 0.01 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                    {recTotals.difference == null ? "—" : Math.abs(recTotals.difference) < 0.01 ? "Reconciled ✓" : formatNairaCompact(recTotals.difference)}
                  </p>
                </div>
              </div>

              {tbLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : recLines.length === 0 ? (
                <p className="py-8 text-center text-muted-foreground text-sm">No ledger activity on this account up to the selected date.</p>
              ) : (
                <div className="rounded-md border divide-y max-h-[28rem] overflow-y-auto">
                  {recLines.map((l) => (
                    <label key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={!!l.reconciled_at}
                        onChange={() => toggleReconciled.mutate(l)}
                        disabled={toggleReconciled.isPending}
                      />
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">{safeFormat(l.entry_date, "dd MMM yyyy")}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {l.memo || l.description || "—"}
                        {l.description && l.memo && <span className="text-muted-foreground"> · {l.description}</span>}
                      </span>
                      <span className="shrink-0 tabular-nums font-medium">
                        {Number(l.debit) > 0
                          ? <span className="text-emerald-600">+{formatNairaCompact(Number(l.debit))}</span>
                          : <span className="text-destructive">−{formatNairaCompact(Number(l.credit))}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                A clean reconciliation means the reconciled balance equals the bank statement balance and every
                statement line has a matching ledger line. Unreconciled ledger lines are un-cleared items;
                statement lines with no ledger match indicate unrecorded transactions.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Journal ── */}
        <TabsContent value="journal" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{entries.length} most recent entries</p>
            <Button size="sm" className="gap-2" onClick={() => { resetEntry(); setEntryOpen(true); }}>
              <Plus className="h-4 w-4" /> New Entry
            </Button>
          </div>

          {entriesLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : entries.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-40" /><p>No journal entries yet.</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {entries.map((en: any) => {
                const total = (en.journal_lines ?? []).reduce((s: number, l: any) => s + Number(l.debit), 0);
                return (
                  <Card key={en.id}>
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-[10px]">#{en.entry_no}</Badge>
                          <span className="text-sm text-muted-foreground">{safeFormat(en.entry_date, "dd MMM yyyy")}</span>
                          {en.memo && <span className="text-sm font-medium">{en.memo}</span>}
                          {en.source_type !== "manual" && <Badge variant="secondary" className="text-[10px] capitalize">{en.source_type}</Badge>}
                        </div>
                        <span className="text-sm font-semibold">{formatNairaCompact(total)}</span>
                      </div>
                      <div className="rounded-md border divide-y text-sm">
                        {(en.journal_lines ?? []).map((l: any) => (
                          <div key={l.id} className="flex items-center justify-between px-3 py-1.5 gap-2">
                            <span className="min-w-0 truncate">
                              <span className="font-mono text-xs text-muted-foreground mr-2">{l.chart_of_accounts?.code}</span>
                              {l.chart_of_accounts?.name}
                              {l.description && <span className="text-muted-foreground"> · {l.description}</span>}
                            </span>
                            <span className="shrink-0 tabular-nums">
                              {Number(l.debit) > 0
                                ? <span className="text-foreground">Dr {formatNairaCompact(Number(l.debit))}</span>
                                : <span className="text-muted-foreground">Cr {formatNairaCompact(Number(l.credit))}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Chart of Accounts ── */}
        <TabsContent value="accounts" className="space-y-4">
          {typeOrder.map((t) => {
            const group = accounts.filter((a) => a.type === t);
            if (group.length === 0) return null;
            return (
              <Card key={t}>
                <CardHeader className="pb-2"><CardTitle className="text-sm">{typeLabels[t]}</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableBody>
                      {group.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-xs w-20">{a.code}</TableCell>
                          <TableCell className="font-medium">{a.name}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className="text-[10px] capitalize">{a.normal_balance}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      {/* ── Record Remittance dialog ── */}
      <Dialog open={remitOpen} onOpenChange={(o) => { setRemitOpen(o); if (!o) setRemitTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Remittance — {remitTarget?.name}</DialogTitle>
            <DialogDescription>
              Outstanding: {formatNairaCompact(remitTarget?.balance ?? 0)}. Posts Dr {remitTarget?.code} / Cr 1010 Bank.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Amount remitted (₦)</Label>
                <Input type="number" min="0" step="0.01" className="h-9" value={remitAmount} onChange={(e) => setRemitAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date paid</Label>
                <Input type="date" className="h-9" value={remitDate} onChange={(e) => setRemitDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Receipt / reference number</Label>
              <Input className="h-9" placeholder="e.g. FIRS receipt no., PFA schedule ref" value={remitRef} onChange={(e) => setRemitRef(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemitOpen(false)}>Cancel</Button>
            <Button onClick={() => saveRemittance.mutate()} disabled={saveRemittance.isPending}>
              {saveRemittance.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Record Remittance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Journal Entry dialog ── */}
      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Journal Entry</DialogTitle>
            <DialogDescription>Every entry must balance — total debits equal total credits.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input type="date" className="h-9" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Memo</Label>
                <Input className="h-9" placeholder="e.g. Owner capital injection" value={entryMemo} onChange={(e) => setEntryMemo(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <Select value={l.account_id} onValueChange={(v) => setLine(i, "account_id", v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Account" /></SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            <span className="font-mono text-xs mr-2">{a.code}</span>{a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    className="col-span-3 h-8 text-xs text-right" type="number" min="0" step="0.01" placeholder="Debit"
                    value={l.debit} onChange={(e) => { setLine(i, "debit", e.target.value); if (e.target.value) setLine(i, "credit", ""); }}
                  />
                  <Input
                    className="col-span-3 h-8 text-xs text-right" type="number" min="0" step="0.01" placeholder="Credit"
                    value={l.credit} onChange={(e) => { setLine(i, "credit", e.target.value); if (e.target.value) setLine(i, "debit", ""); }}
                  />
                  <Button variant="ghost" size="icon" className="col-span-1 h-9 w-9 md:h-8 md:w-8 text-destructive" onClick={() => removeLine(i)} disabled={lines.length <= 2}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" /> Add line
              </Button>
            </div>

            <div className="rounded-lg bg-muted p-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Totals</span>
              <div className="flex items-center gap-4">
                <span>Dr <span className="font-semibold tabular-nums">{formatNairaCompact(lineTotals.d)}</span></span>
                <span>Cr <span className="font-semibold tabular-nums">{formatNairaCompact(lineTotals.c)}</span></span>
                {lineTotals.balanced
                  ? <Badge className="bg-green-100 text-green-700">Balanced</Badge>
                  : <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Δ {formatNairaCompact(Math.abs(lineTotals.d - lineTotals.c))}</Badge>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryOpen(false)}>Cancel</Button>
            <Button onClick={() => { setSaving(true); saveEntry.mutate(undefined, { onSettled: () => setSaving(false) }); }} disabled={!lineTotals.balanced || saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Post Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
