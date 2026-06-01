import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronsUpDown, User, UserPlus, ShoppingBag, FileText, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CustomerRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  source: "walkin" | "invoice" | "sale";
}

export const WALK_IN: CustomerRecord = {
  id: "__walkin__",
  name: "Walk-in Customer",
  email: "",
  phone: "",
  address: "",
  source: "walkin",
};

interface Props {
  value: CustomerRecord;
  onChange: (customer: CustomerRecord) => void;
  disabled?: boolean;
}

function normalizeKey(name: string, email: string): string {
  const e = email?.trim().toLowerCase();
  return e || name.trim().toLowerCase();
}

export default function CustomerPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Fetch distinct customers from both invoices and sales
  const { data: invoiceCustomers = [] } = useQuery({
    queryKey: ["customer-picker-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("customer_name, customer_email, customer_phone, customer_address")
        .not("customer_name", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        name: r.customer_name as string,
        email: (r.customer_email ?? "") as string,
        phone: (r.customer_phone ?? "") as string,
        address: (r.customer_address ?? "") as string,
        source: "invoice" as const,
      }));
    },
  });

  const { data: saleCustomers = [] } = useQuery({
    queryKey: ["customer-picker-sales"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("customer_name, customer_email")
        .not("customer_name", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        name: r.customer_name as string,
        email: (r.customer_email ?? "") as string,
        phone: "",
        address: "",
        source: "sale" as const,
      }));
    },
  });

  // Merge and deduplicate: prefer invoice records (have more fields) over sale records
  const allCustomers = useMemo<CustomerRecord[]>(() => {
    const seen = new Map<string, CustomerRecord>();

    // Process invoices first — they carry more complete data
    for (const c of invoiceCustomers) {
      const name = c.name.trim();
      if (!name || name.toLowerCase() === "walk-in customer") continue;
      const key = normalizeKey(name, c.email);
      if (!seen.has(key)) {
        seen.set(key, { id: key, ...c });
      }
    }

    // Merge sales customers only if not already represented by an invoice record
    for (const c of saleCustomers) {
      const name = c.name.trim();
      if (!name || name.toLowerCase() === "walk-in customer") continue;
      const key = normalizeKey(name, c.email);
      if (!seen.has(key)) {
        seen.set(key, { id: key, ...c });
      }
    }

    return Array.from(seen.values());
  }, [invoiceCustomers, saleCustomers]);

  // Filter by search term
  const filtered = useMemo(() => {
    if (!search.trim()) return allCustomers;
    const q = search.toLowerCase();
    return allCustomers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q)
    );
  }, [allCustomers, search]);

  const isWalkIn = value.id === "__walkin__";

  const handleSelect = (customer: CustomerRecord) => {
    onChange(customer);
    setOpen(false);
    setSearch("");
  };

  const handleNewCustomer = () => {
    onChange({ id: "__new__", name: "", email: "", phone: "", address: "", source: "walkin" });
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between h-auto min-h-[2.5rem] py-2 px-3",
            isWalkIn && "text-muted-foreground"
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            {isWalkIn ? (
              <>
                <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm">Walk-in Customer</span>
                <Badge variant="secondary" className="text-[10px] shrink-0">Default</Badge>
              </>
            ) : value.id === "__new__" ? (
              <>
                <UserPlus className="h-4 w-4 shrink-0 text-blue-500" />
                <span className="text-sm font-medium">New customer</span>
              </>
            ) : (
              <div className="flex items-start gap-2 min-w-0">
                <User className="h-4 w-4 shrink-0 mt-0.5 text-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-left truncate">{value.name}</p>
                  {value.email && (
                    <p className="text-xs text-muted-foreground text-left truncate">{value.email}</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search by name, email or phone…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              <div className="py-3 px-2 text-center space-y-2">
                <p className="text-sm text-muted-foreground">No matching customers found</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleNewCustomer}>
                  <UserPlus className="h-3.5 w-3.5" /> Enter new customer details
                </Button>
              </div>
            </CommandEmpty>

            {/* Walk-in — always visible */}
            <CommandGroup heading="Quick select">
              <CommandItem
                value="walk-in-customer"
                onSelect={() => handleSelect(WALK_IN)}
                className="gap-2"
              >
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Walk-in Customer</p>
                  <p className="text-xs text-muted-foreground">No customer details recorded</p>
                </div>
                {isWalkIn && <Check className="h-4 w-4 text-primary shrink-0" />}
              </CommandItem>
              <CommandItem
                value="__new_customer__"
                onSelect={handleNewCustomer}
                className="gap-2"
              >
                <UserPlus className="h-4 w-4 text-blue-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">New customer</p>
                  <p className="text-xs text-muted-foreground">Enter customer details manually</p>
                </div>
              </CommandItem>
            </CommandGroup>

            {filtered.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={`Previous customers (${filtered.length})`}>
                  {filtered.map((c) => (
                    <CommandItem
                      key={c.id}
                      value={`${c.name} ${c.email} ${c.phone}`}
                      onSelect={() => handleSelect(c)}
                      className="gap-2 items-start"
                    >
                      {c.source === "invoice" ? (
                        <FileText className="h-4 w-4 shrink-0 mt-0.5 text-green-600" />
                      ) : (
                        <ShoppingBag className="h-4 w-4 shrink-0 mt-0.5 text-blue-500" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[c.email, c.phone].filter(Boolean).join(" · ") || "No contact details"}
                        </p>
                        {c.address && (
                          <p className="text-xs text-muted-foreground truncate">{c.address}</p>
                        )}
                      </div>
                      {value.id === c.id && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
