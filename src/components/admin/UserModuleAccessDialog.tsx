import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck } from "lucide-react";
import { MODULES } from "@/config/modules";

type Action = "view" | "create" | "update" | "delete";
const ACTIONS: Action[] = ["view", "create", "update", "delete"];

interface ModuleState {
  override: boolean;
  can_view: boolean; can_create: boolean; can_update: boolean; can_delete: boolean;
}

const blankState = (): Record<string, ModuleState> => {
  const s: Record<string, ModuleState> = {};
  MODULES.forEach((m) => { s[m] = { override: false, can_view: false, can_create: false, can_update: false, can_delete: false }; });
  return s;
};

interface Props {
  userId: string;
  userName: string;
}

export default function UserModuleAccessDialog({ userId, userName }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<Record<string, ModuleState>>(blankState());

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("user_permissions")
        .select("module_name, can_view, can_create, can_update, can_delete")
        .eq("user_id", userId);
      if (error) throw error;
      const next = blankState();
      (data ?? []).forEach((r: any) => {
        if (next[r.module_name]) {
          next[r.module_name] = {
            override: true,
            can_view: r.can_view, can_create: r.can_create, can_update: r.can_update, can_delete: r.can_delete,
          };
        }
      });
      setState(next);
    } catch (e: any) {
      toast({ title: "Could not load access", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) load();
  };

  const setOverride = (mod: string, override: boolean) =>
    setState((p) => ({ ...p, [mod]: { ...p[mod], override, ...(override ? { can_view: p[mod].can_view || true } : {}) } }));

  const setAction = (mod: string, action: Action, val: boolean) =>
    setState((p) => ({ ...p, [mod]: { ...p[mod], [`can_${action}`]: val } }));

  const save = async () => {
    setSaving(true);
    try {
      const toUpsert: any[] = [];
      const toClear: string[] = [];
      MODULES.forEach((m) => {
        const s = state[m];
        if (s.override) {
          toUpsert.push({
            user_id: userId, module_name: m,
            can_view: s.can_view, can_create: s.can_create, can_update: s.can_update, can_delete: s.can_delete,
            created_by: user?.id, updated_at: new Date().toISOString(),
          });
        } else {
          toClear.push(m);
        }
      });

      if (toUpsert.length > 0) {
        const { error } = await (supabase as any)
          .from("user_permissions")
          .upsert(toUpsert, { onConflict: "user_id,module_name" });
        if (error) throw error;
      }
      if (toClear.length > 0) {
        const { error } = await (supabase as any)
          .from("user_permissions")
          .delete()
          .eq("user_id", userId)
          .in("module_name", toClear);
        if (error) throw error;
      }

      qc.invalidateQueries({ queryKey: ["user-role-data"] });
      toast({ title: "Module access updated", description: `Saved for ${userName}.` });
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const overrideCount = MODULES.filter((m) => state[m].override).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShieldCheck className="h-3 w-3 mr-1" /> Module Access
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Module Access — {userName}</DialogTitle>
          <DialogDescription>
            By default each module inherits this person's department access. Toggle a module to set a
            personal override (grant access their department lacks, or restrict it).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span className="col-span-5">Module</span>
              <span className="col-span-2 text-center">View</span>
              <span className="col-span-2 text-center">Create</span>
              <span className="col-span-1 text-center">Edit</span>
              <span className="col-span-2 text-center">Delete</span>
            </div>
            {MODULES.map((m) => {
              const s = state[m];
              return (
                <div key={m} className="grid grid-cols-12 gap-2 items-center rounded-lg border p-2.5">
                  <div className="col-span-5 flex items-center gap-2 min-w-0">
                    <Switch checked={s.override} onCheckedChange={(v) => setOverride(m, v)} />
                    <span className="text-sm font-medium capitalize truncate">{m}</span>
                    {!s.override && <Badge variant="secondary" className="text-[10px] shrink-0">Inherit</Badge>}
                  </div>
                  {ACTIONS.map((a, idx) => (
                    <div key={a} className={`flex justify-center ${a === "update" ? "col-span-1" : "col-span-2"}`}>
                      <Checkbox
                        checked={s.override ? (s as any)[`can_${a}`] : false}
                        disabled={!s.override}
                        onCheckedChange={(v) => setAction(m, a, !!v)}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground pt-1">
              {overrideCount === 0
                ? "No overrides — this user fully inherits their department's access."
                : `${overrideCount} module${overrideCount === 1 ? "" : "s"} overridden for this user.`}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
