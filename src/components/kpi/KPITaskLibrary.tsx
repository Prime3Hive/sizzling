import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Plus, Loader2, Tag, Trash2 } from "lucide-react";

interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string;
}

const blank = { name: "", description: "", color: "#6366f1" };

export default function KPITaskLibrary() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Category | null>(null);

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ["kpi-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("kpi_categories")
        .select("*")
        .order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const upsert = useMutation({
    mutationFn: async (payload: Partial<Category>) => {
      if (editing) {
        const { error } = await supabase.from("kpi_categories").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("kpi_categories").insert({ ...payload, created_by: user?.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-categories"] });
      toast({ title: editing ? "Category updated" : "Category created" });
      setOpen(false); setEditing(null); setForm(blank);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("kpi_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kpi-categories"] });
      toast({ title: "Category deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleEdit = (c: Category) => {
    setEditing(c);
    setForm({ name: c.name, description: c.description || "", color: c.color });
    setOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Task Categories</h2>
          <p className="text-sm text-muted-foreground">Define KPI categories used when assigning tasks.</p>
        </div>
        <Button onClick={() => { setEditing(null); setForm(blank); setOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" /> Add Category
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat) => (
            <Card key={cat.id} className="group hover:shadow-md transition-shadow">
              <CardContent className="pt-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full flex-shrink-0 mt-0.5"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span className="font-semibold text-sm">{cat.name}</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(cat)}>
                      <Tag className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      onClick={() => remove.mutate(cat.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {cat.description && (
                  <p className="text-xs text-muted-foreground">{cat.description}</p>
                )}
                <div className="h-1.5 rounded-full w-full" style={{ backgroundColor: cat.color + "30" }}>
                  <div className="h-full w-3/5 rounded-full" style={{ backgroundColor: cat.color }} />
                </div>
              </CardContent>
            </Card>
          ))}
          {categories.length === 0 && (
            <div className="col-span-full">
              <Card>
                <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
                  <Tag className="h-10 w-10 text-muted-foreground/50" />
                  <p className="text-muted-foreground">No categories yet. Add one to get started.</p>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Category" : "Add Category"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input placeholder="e.g. Quality" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea rows={2} placeholder="Optional description…" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label>Colour</Label>
              <div className="flex items-center gap-3">
                <input type="color" value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  className="h-9 w-14 cursor-pointer rounded border border-input bg-background" />
                <span className="text-sm text-muted-foreground">{form.color}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => upsert.mutate(form)} disabled={upsert.isPending || !form.name}>
              {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
