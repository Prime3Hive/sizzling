import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { CalendarRange, Plus, Play, Lock, Pencil, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface Period {
  id: string;
  name: string;
  period_type: string;
  start_date: string;
  end_date: string;
  status: "draft" | "active" | "closed";
  description: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  draft:  "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  closed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const blank = { name: "", period_type: "monthly", start_date: "", end_date: "", description: "" };

export default function KPIPeriods() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Period | null>(null);

  const { data: periods = [], isLoading } = useQuery<Period[]>({
    queryKey: ["kpi-periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_periods")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const upsert = useMutation({
    mutationFn: async (payload: Partial<Period>) => {
      if (editing) {
        const { error } = await supabase
          .from("kpi_periods")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("kpi_periods")
          .insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-periods"] });
      toast({ title: editing ? "Period updated" : "Period created" });
      setOpen(false);
      setEditing(null);
      setForm(blank);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("kpi_periods")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kpi-periods"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleEdit = (p: Period) => {
    setEditing(p);
    setForm({
      name: p.name,
      period_type: p.period_type,
      start_date: p.start_date,
      end_date: p.end_date,
      description: p.description || "",
    });
    setOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name || !form.start_date || !form.end_date) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    upsert.mutate(form);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Review Periods</h2>
          <p className="text-sm text-muted-foreground">Create and manage KPI evaluation periods.</p>
        </div>
        <Button
          onClick={() => { setEditing(null); setForm(blank); setOpen(true); }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" /> New Period
        </Button>
      </div>

      {/* Periods grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : periods.length === 0 ? (
        <Card>
          <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
            <CalendarRange className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground">No review periods yet. Create your first one!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {periods.map((p) => (
            <Card key={p.id} className="group hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-snug">{p.name}</CardTitle>
                  <Badge className={statusColors[p.status]}>
                    {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground capitalize">{p.period_type}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarRange className="h-3.5 w-3.5" />
                  <span>{format(new Date(p.start_date), "MMM d, yyyy")} – {format(new Date(p.end_date), "MMM d, yyyy")}</span>
                </div>
                {p.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                )}
                <div className="flex gap-2 pt-1">
                  {p.status === "draft" && (
                    <Button size="sm" variant="outline" className="gap-1 flex-1"
                      onClick={() => setStatus.mutate({ id: p.id, status: "active" })}>
                      <Play className="h-3 w-3" /> Activate
                    </Button>
                  )}
                  {p.status === "active" && (
                    <Button size="sm" variant="outline" className="gap-1 flex-1 text-destructive"
                      onClick={() => setStatus.mutate({ id: p.id, status: "closed" })}>
                      <Lock className="h-3 w-3" /> Close
                    </Button>
                  )}
                  {p.status !== "closed" && (
                    <Button size="sm" variant="ghost" className="gap-1"
                      onClick={() => handleEdit(p)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Period" : "Create Review Period"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="p-name">Period Name *</Label>
              <Input id="p-name" placeholder="e.g. Q2 2026 Performance Review"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Type *</Label>
              <Select value={form.period_type} onValueChange={(v) => setForm({ ...form, period_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="p-start">Start Date *</Label>
                <Input id="p-start" type="date" value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="p-end">End Date *</Label>
                <Input id="p-end" type="date" value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-desc">Description</Label>
              <Textarea id="p-desc" rows={2} placeholder="Optional description…"
                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={upsert.isPending}>
              {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editing ? "Save Changes" : "Create Period"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
