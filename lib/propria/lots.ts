import 'server-only';
import { createClient } from '@/lib/supabase/server';

// ============================================================================
// Helpers centralisés pour les sélecteurs « par lot (listing) » des modules
// Propria. S'appuient sur la vue socle propria_units_enriched (héritage des
// infos du bien à la lecture).
// ============================================================================

export type LotOption = {
  id: string;          // propria_units.id
  label: string;       // ex "bennani-1 · AF (Hivernage)"
  property_id: string;
  bien_label: string;  // code/nom du bien, pour regrouper si besoin
};

/** Options de lots actifs des biens sous gestion Propria, triées par libellé. */
export async function getActiveLotOptions(): Promise<LotOption[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('propria_units_enriched')
    .select('unit_id, property_id, display_label, bien_code, bien_name')
    .eq('is_active', true)
    .not('propria_managed_at', 'is', null)
    .is('propria_refused_at', null)
    .order('display_label', { ascending: true });
  return (data ?? []).map((u: any) => ({
    id: u.unit_id,
    label: u.display_label,
    property_id: u.property_id,
    bien_label: u.bien_code ?? u.bien_name,
  }));
}

/** Map unit_id → libellé lisible, pour l'affichage des listes. */
export async function getLotLabelMap(): Promise<Map<string, string>> {
  const supabase = createClient();
  const { data } = await supabase
    .from('propria_units_enriched')
    .select('unit_id, display_label');
  return new Map((data ?? []).map((u: any) => [u.unit_id, u.display_label]));
}
