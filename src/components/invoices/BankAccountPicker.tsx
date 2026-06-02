import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Landmark, Loader2 } from "lucide-react";

export interface BankAccount {
  id: string;
  bank_name: string;
  account_number: string;
  account_name: string;
}

interface Props {
  value: string; // selected id
  onChange: (account: BankAccount | null) => void;
  disabled?: boolean;
}

export default function BankAccountPicker({ value, onChange, disabled }: Props) {
  const { data: accounts = [], isLoading } = useQuery<BankAccount[]>({
    queryKey: ["bank-accounts-active"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("bank_accounts")
        .select("id, bank_name, account_number, account_name")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const handleChange = (id: string) => {
    if (id === "__none__") {
      onChange(null);
      return;
    }
    const found = accounts.find((a) => a.id === id);
    onChange(found ?? null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 h-10 px-3 text-sm text-muted-foreground border rounded-md bg-muted/20">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading accounts…
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="flex items-center gap-2 h-10 px-3 text-sm text-muted-foreground border rounded-md border-dashed">
        <Landmark className="h-4 w-4" />
        No bank accounts configured — ask an admin to add one.
      </div>
    );
  }

  return (
    <Select value={value || "__none__"} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger className="h-10">
        <SelectValue placeholder="Select a bank account…" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">
          <span className="text-muted-foreground">— No account (fill manually) —</span>
        </SelectItem>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{a.bank_name}</span>
              <span className="text-xs text-muted-foreground font-mono">
                {a.account_number} · {a.account_name}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
