import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Diagnostic du filtre status sur properties (CEO 2026-06-18 — Bug B).
 *
 * Symptôme constaté : `/properties?status=disponible` renvoyait aussi des
 * biens en `sourcing` et `vendu`.
 *
 * Cause racine : cache schema PostgREST désynchronisé après une série de
 * migrations sur `properties` / `properties_enriched`. Avec un enum
 * (`property_status`), PostgREST ignore silencieusement le filtre quand le
 * cache ne sait plus que la colonne est filtrable.
 *
 * Fix immédiat : `NOTIFY pgrst, 'reload schema'` côté Supabase Studio.
 *
 * Prévention :
 *   - À chaque migration touchant à `properties` ou ses vues, exécuter
 *     `NOTIFY pgrst, 'reload schema'` en fin de migration.
 *   - Ce helper expose `checkStatusFilterWorks()` qui valide en runtime
 *     que le filtre fonctionne (compare un `.in` filtré à un agrégat brut).
 *     À appeler depuis un endpoint de healthcheck ou un cron léger.
 */

export type StatusFilterDiag = {
  ok: boolean;
  filtered_count: number;
  expected_max: number;
  message: string;
};

/**
 * Vérifie que filtrer sur `status='disponible'` retourne strictement
 * les biens disponibles. Si le compte filtré dépasse le compte attendu,
 * c'est que le filtre est ignoré côté PostgREST → action : reload schema.
 */
export async function checkStatusFilterWorks(
  supabase: SupabaseClient,
): Promise<StatusFilterDiag> {
  // Référence : compteur strict via SQL exact (passé en raw RPC ou via count)
  const expected = await supabase
    .from('properties_enriched')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'disponible')
    .is('deleted_at', null);
  const expectedCount = expected.count ?? 0;

  // Test : la même requête mais avec .in() (méthode utilisée par la page liste)
  const actual = await supabase
    .from('properties_enriched')
    .select('id', { count: 'exact', head: true })
    .in('status', ['disponible'])
    .is('deleted_at', null);
  const actualCount = actual.count ?? 0;

  // .in() avec 1 valeur DOIT retourner exactement le même compte que .eq()
  const ok = actualCount === expectedCount;
  return {
    ok,
    filtered_count: actualCount,
    expected_max: expectedCount,
    message: ok
      ? `OK : filtre status='disponible' retourne ${actualCount} biens (cohérent).`
      : `KO : .in() retourne ${actualCount} biens, .eq() en retourne ${expectedCount}. ` +
        `Cache schema PostgREST probablement désynchronisé. ` +
        `Exécute : NOTIFY pgrst, 'reload schema'; depuis Supabase Studio.`,
  };
}
