import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { usePayees, payeeOptions } from '@/hooks/useExpenseReference';

// ─────────────────────────────────────────────────────────────────────────────
// Who was paid. Choose a supplier, or type a name and either keep it as a
// one-off or save it as a supplier on the spot, so "Market" stops being the
// answer to every purchase.
// ─────────────────────────────────────────────────────────────────────────────

const db = supabase as any;

/** Sentinel for "not on the list: I am typing the name". */
export const ONE_OFF = '__one_off__';

interface PayeeFieldProps {
  id: string;
  /** A payee id, ONE_OFF, or '' when nothing is chosen. */
  value: string;
  /** The typed name, used when value is ONE_OFF. */
  name: string;
  onChange: (value: string, name: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
  placeholder?: string;
  /** Shown as the first option and clears the value (e.g. "Same as the batch"). */
  emptyOptionLabel?: string;
  required?: boolean;
}

export default function PayeeField({
  id, value, name, onChange, onBlur, invalid, placeholder = 'Choose a supplier', emptyOptionLabel, required,
}: PayeeFieldProps) {
  const { data: payees = [] } = usePayees();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const options = [
    { value: ONE_OFF, label: 'Not on the list: type a name' },
    ...payeeOptions(payees),
  ];

  const typed = name.trim();
  const existing = payees.find((p) => p.name.trim().toLowerCase() === typed.toLowerCase());

  const saveSupplier = async () => {
    if (typed.length < 2) return;
    if (existing) { onChange(existing.id, ''); return; }
    setSaving(true);
    try {
      // fn_payee_for finds the supplier case-insensitively or creates it.
      const made = await db.rpc('fn_payee_for', { p_name: typed, p_kind: 'supplier' });
      let newId = made.data;
      if (made.error || !newId) {
        const ins = await db.from('payees').insert({ name: typed, kind: 'supplier' }).select('id').single();
        if (ins.error) throw ins.error;
        newId = ins.data.id;
      }
      await qc.invalidateQueries({ queryKey: ['payees'] });
      onChange(String(newId), '');
      toast({ title: 'Supplier saved', description: `${typed} is now on the supplier list.` });
    } catch (e: any) {
      toast({ title: 'Could not save the supplier', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SearchableSelect
        id={id}
        options={options}
        value={value}
        onChange={(v) => onChange(v, v === ONE_OFF ? name : '')}
        placeholder={placeholder}
        title="Who was paid?"
        required={required}
        invalid={invalid}
        emptyOptionLabel={emptyOptionLabel}
      />
      {value === ONE_OFF && (
        <div className="mt-2 flex gap-2">
          <Input
            aria-label="Name of the person or business paid"
            placeholder="Name of the person or business paid"
            value={name}
            onChange={(e) => onChange(ONE_OFF, e.target.value)}
            onBlur={onBlur}
            className="h-11 text-base min-w-0"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            disabled={saving || typed.length < 2}
            onClick={saveSupplier}
            title="Add this name to the supplier list so it can be chosen next time"
          >
            {saving
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <UserPlus className="h-4 w-4 sm:mr-2" aria-hidden />}
            <span className="hidden sm:inline">{existing ? 'Use supplier' : 'Save as supplier'}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
