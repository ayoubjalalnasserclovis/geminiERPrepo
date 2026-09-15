import { adminClient } from '../helpers/supabase';
import type { TestRun } from '../helpers/test-run';
import { createTestClient, deleteClientsForRun, type TestClient } from './clients';
import { deletePropertiesForRun } from './properties';

/**
 * Fixtures PROJETS — création + nettoyage de projets de test.
 *
 * Un projet est taggé via sa `reference` (STZTEST-<run>-NNN). Il est toujours
 * rattaché à un client de test (créé à la volée si non fourni).
 */

export type TestProjectOverrides = {
  /** Réutiliser un client existant ; sinon un client de test est créé. */
  client_id?: string;
  /** Rattacher un bien comme bien final du projet. */
  property_id?: string;
  status?: 'actif' | 'pause' | 'termine' | 'perdu';
  current_phase?: string;
  travaux_budget?: number;
};

export type TestProject = {
  id: string;
  reference: string;
  client_id: string;
};

// Compteur de référence par run : garantit une reference unique même quand un
// test crée plusieurs projets (la reference reste taggée → cleanup OK).
const refSeq = new Map<string, number>();
function nextRef(run: TestRun): string {
  const seq = (refSeq.get(run.id) ?? 0) + 1;
  refSeq.set(run.id, seq);
  return run.projectRef(seq);
}

/**
 * Crée un projet de test (et son client si besoin) et le renvoie.
 * `reference` est forcée (taggée) : le trigger d'auto-numérotation ne s'applique
 * que si la référence est vide, on garde donc la maîtrise du tag.
 */
export async function createTestProject(
  run: TestRun,
  overrides: TestProjectOverrides = {}
): Promise<TestProject & { client: TestClient | null }> {
  const db = adminClient();

  let clientId = overrides.client_id;
  let client: TestClient | null = null;
  if (!clientId) {
    client = await createTestClient(run);
    clientId = client.id;
  }

  const row = {
    reference: nextRef(run),
    client_id: clientId,
    status: overrides.status ?? 'actif',
    ...(overrides.property_id ? { property_id: overrides.property_id } : {}),
    ...(overrides.current_phase ? { current_phase: overrides.current_phase } : {}),
    ...(overrides.travaux_budget != null ? { travaux_budget: overrides.travaux_budget } : {}),
  };

  const { data, error } = await db
    .from('projects')
    .insert(row)
    .select('id, reference, client_id')
    .single();

  if (error) {
    throw new Error(`[fixtures] createTestProject a échoué : ${error.message}`);
  }
  return { ...(data as TestProject), client };
}

/**
 * Nettoyage COMPLET d'un run de test. À appeler en afterEach.
 *
 * Ordre important (contraintes FK) :
 *   1. projets   → project_phases_history part en CASCADE, libère properties/clients
 *   2. biens     → référencés par projects.property_id (pas de cascade)
 *   3. clients   → référencés par projects.client_id (pas de cascade)
 *
 * Garantie : tout ce qui porte le test_run_id disparaît, même si le test a
 * planté en cours de route.
 */
export async function cleanupTestData(run: TestRun): Promise<void> {
  const db = adminClient();

  const { error: projErr } = await db
    .from('projects')
    .delete()
    .like('reference', run.projectRefLike());
  if (projErr) {
    throw new Error(`[fixtures] cleanup projects a échoué : ${projErr.message}`);
  }

  await deletePropertiesForRun(run);
  await deleteClientsForRun(run);

  refSeq.delete(run.id);
}
