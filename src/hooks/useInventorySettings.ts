import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface InventorySettings {
  id: string | null;
  allow_negative_stock: boolean;
  notify_on_negative: boolean;
  /** Units an admin added to the standard list. */
  custom_units: string[];
}

// Until migration 20261016100000 is applied there is no settings row; the
// page then behaves as it always did (no negative stock, alerts on).
const DEFAULTS: InventorySettings = { id: null, allow_negative_stock: false, notify_on_negative: true, custom_units: [] };

export function useInventorySettings() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<InventorySettings>({
    queryKey: ['inventory-settings'],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('inventory_settings')
        .select('*')
        .maybeSingle();
      if (error || !data) return DEFAULTS;
      return { ...DEFAULTS, ...data, custom_units: data.custom_units ?? [] } as InventorySettings;
    },
  });

  const update = useMutation({
    mutationFn: async (patch: Partial<Omit<InventorySettings, 'id'>>) => {
      const id = query.data?.id;
      if (!id) throw new Error('Inventory setup is not available yet — apply the latest database migration.');
      const { error } = await (supabase as any)
        .from('inventory_settings')
        .update({ ...patch, updated_by: user?.id, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-settings'] }),
  });

  return { settings: query.data ?? DEFAULTS, isLoading: query.isLoading, update };
}
