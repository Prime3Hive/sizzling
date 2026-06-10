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
import { Scale, BookOpen, ListTree, Plus, Trash2, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { formatNairaCompact } from "@/lib/currency";
import { safeFormat } from "@/lib/safeDate";

interface Account {
  id: string; code: string; name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  normal_balance: "debit" | "credit"; is_active: boolean; sort_order: number;
}
interface JournalLine { id: string; entry_id: string; account_id: string; debit: number; credit: number; description: string | null; }
interface LineWithMeta extends JournalLine { entry_date: string; chart_of_accounts: { code: string; name: string; type: string; normal_balance: string } | null; }
interface JournalEntry { id: string; entry_no: number; entry_date: string; memo: string | null; source_type: string; }

const typeLabels: Record<string, string> = {
  asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses",
};
const typeOrder = ["asset", "liability", "equity", "income", "expense"];

const BLANK_LINE = () => ({ account_id: "", debit: "", credit: "", description: "" });

export default function Accounting() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [asOf, setAsOf] = useState(new Date().toISOString().split("T")[0]);
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

  const { data: tbLines = [], isLoading: tbLoading } = useQuery<LineWithMeta[]>({
    queryKey: ["tb-lines", asOf],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("journal_lines")
        .select("id, entry_id, account_id, debit, credit, description, journal_entries!inner(entry_date), chart_of_accounts(code, name, type, normal_balance)")
        .lte("journal_entries.entry_date", asOf);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ ...r, entry_date: r.journal_entries?.entry_date }));
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

  // ── Trial balance computation ──
  const trialBalance = useMemo(() => {
    const byAccount: Record<string, { account: any; debit: number; credit: number }> = {};
    for (const l of tbLines) {
      const acc = l.chart_of_accounts;
      if (!acc) continue;
      const key = l.account_id;
      if (!byAccount[key]) byAccount[key] = { account: acc, debit: 0, credit: 0 };
      byAccount[key].debit += Number(l.debit);
      byAccount[key].credit += Number(l.credit);
    }
    const rows = Object.values(byAccount).map((r) => {
      const net = r.debit - r.credit; // debit-positive
      return {
        ...r,
        balanceDebit: net > 0 ? net : 0,
        balanceCredit: net < 0 ? -net : 0,
      };
    }).filter((r) => r.balanceDebit > 0.005 || r.balanceCredit > 0.005);
    rows.sort((a, b) => a.account.code.localeCompare(b.account.code));
    const totalDebit = rows.reduce((s, r) => s + r.balanceDebit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.balanceCredit, 0);
    return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
  }, [tbLines]);

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

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Scale className="h-6 w-6" /> Accounting</h1>
        <p className="text-sm text-muted-foreground mt-1">Double-entry ledger, trial balance and chart of accounts.</p>
      </div>

      <Tabs defaultValue="trial-balance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trial-balance" className="gap-2"><Scale className="h-4 w-4" /> Trial Balance</TabsTrigger>
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

      {/* ── New Journal Entry dialog ── */}
      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Journal Entry</DialogTitle>
            <DialogDescription>Every entry must balance — total debits equal total credits.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
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
                  <Button variant="ghost" size="icon" className="col-span-1 h-8 w-8 text-destructive" onClick={() => removeLine(i)} disabled={lines.length <= 2}>
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
