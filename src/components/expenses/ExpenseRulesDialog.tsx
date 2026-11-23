import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormSheet, Field } from '@/components/ui/form-sheet';
import { MoneyInput } from '@/components/ui/money-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { parseMoney, isMoneyError } from '@/lib/money';

// ─────────────────────────────────────────────────────────────────────────────
// The owner's expense rules. These are decisions, not code:
//   • above what amount a second person must approve an expense
//   • whether going over a budget only warns or stops the entry
// The database enforces both (fn_expense_rules, fn_expense_budget_guard).
// ─────────────────────────────────────────────────────────────────────────────

const db = supabase as any;

interface Settings {
  self_approval_limit_minor: number | null;
  budget_over_policy?: 'warn' | 'block';
}

export function useExpenseSettings() {
  return useQuery<Settings | null>({
    queryKey: ['expense-settings'],
    queryFn: async () => {
      const { data, error } = await db.from('expense_settings').select('*').limit(1).maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: 5 * 60_000,
  });
}

const toTyped = (minor: number | null | undefined) =>
  minor == null ? '' : (minor / 100).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export default function ExpenseRulesDialog() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: settings } = useExpenseSettings();

  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState('');
  const [policy, setPolicy] = useState<'warn' | 'block'>('warn');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Before migration 20261123100000 there is no budget policy to set.
  const hasPolicy = settings ? 'budget_over_policy' in settings : false;

  useEffect(() => {
    if (!open || !settings) return;
    setLimit(toTyped(settings.self_approval_limit_minor));
    setPolicy(settings.budget_over_policy ?? 'warn');
    setError(null);
  }, [open, settings]);

  const save = async () => {
    let limitMinor: number | null = null;
    if (limit.trim() !== '') {
      const parsed = parseMoney(limit, { allowZero: true, label: 'limit' });
      if (isMoneyError(parsed)) { setError(parsed.error); return; }
      limitMinor = Number(parsed.minor);
    }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        self_approval_limit_minor: limitMinor,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      };
      if (hasPolicy) patch.budget_over_policy = policy;
      const { error: e } = await db.from('expense_settings').update(patch).eq('id', true);
      if (e) throw e;
      await qc.invalidateQueries({ queryKey: ['expense-settings'] });
      toast({ title: 'Expense rules saved' });
      setOpen(false);
    } catch (e: any) {
      toast({ title: 'Could not save', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="h-11" onClick={() => setOpen(true)}>
        <Settings2 className="mr-2 h-4 w-4" aria-hidden />
        Rules
      </Button>

      <FormSheet
        open={open}
        onOpenChange={setOpen}
        title="Expense rules"
        description="Who has to approve, and what happens at the budget."
        footer={
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <Button variant="outline" className="h-11 sm:flex-1" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="h-11 sm:flex-1" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rules'}</Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field
            id="rule-limit"
            label="Second approval above"
            error={error}
            hint="An expense above this amount waits as pending until someone other than the person who recorded it approves it. Leave blank to switch this off. Enter 0 to require a second person on every expense."
          >
            <MoneyInput
              id="rule-limit"
              value={limit}
              onChange={(v) => { setLimit(v); setError(null); }}
              parseOptions={{ allowZero: true, label: 'limit' }}
              showPreview={false}
              error={error}
            />
          </Field>

          <Field
            id="rule-budget"
            label="When an expense takes a budget over"
            hint={hasPolicy
              ? 'Either way the form warns at 80% and at 100% of the budget.'
              : 'Apply database migration 20261123100000_fix_list_nov23 to choose this.'}
          >
            <Select value={policy} onValueChange={(v) => setPolicy(v as 'warn' | 'block')} disabled={!hasPolicy}>
              <SelectTrigger id="rule-budget" className="h-11 text-base"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warn">Warn, and let it be saved</SelectItem>
                <SelectItem value="block">Block it until the budget is raised</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <p className="text-xs text-muted-foreground">
            With only one admin on the system, a second-approval limit means large expenses wait until another
            person with approval rights signs them off.
          </p>
        </div>
      </FormSheet>
    </>
  );
}
