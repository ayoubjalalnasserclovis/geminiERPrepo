import { adminClient } from '../helpers/supabase';
import type { TestRun } from '../helpers/test-run';

/**
 * Fixtures CLIENTS — création + nettoyage de clients de test.
 *
 * Chaque client est taggé via son email (domaine @stoniz.test + test_run_id) et
 * son nom (préfixe [STZTEST <run>]). Le tag rend le cleanup possible même après
 * un crash. Voir tests/helpers/test-run.ts.
 */

/** Sous-ensemble des colonnes `clients` qu'on accepte en override. */
export type TestClientOverrides = {
  full_name?: string;
  email?: string;
  phone?: string;
  nationality?: string;
  budget_min?: number;
  budget_max?: number;
  credit_type?: 'yes' | 'no' | 'islamic';
};

export type TestClient = {
  id: string;
  full_name: string;
  email: string;
};

/**
 * Crée un client de test en base et le renvoie.
 * Le nom par défaut est lisible et parlant (cf. règle "Test ID parlant").
 */
export async function createTestClient(
  run: TestRun,
  overrides: TestClientOverrides = {}
): Promise<TestClient> {
  const db = adminClient();

  const row = {
    full_name: run.label('Karim Zaidi'),
    email: run.email('client'),
    ...overrides,
  };

  const { data, error } = await db
    .from('clients')
    .insert(row)
    .select('id, full_name, email')
    .single();

  if (error) {
    throw new Error(`[fixtures] createTestClient a échoué : ${error.message}`);
  }
  return data as TestClient;
}

/**
 * Supprime tous les clients d'un run (par pattern email).
 * Suppression PHYSIQUE (pas soft-delete) : on ne laisse aucune trace de test.
 */
export async function deleteClientsForRun(run: TestRun): Promise<void> {
  const db = adminClient();
  const { error } = await db.from('clients').delete().like('email', run.emailLike());
  if (error) {
    throw new Error(`[fixtures] cleanup clients a échoué : ${error.message}`);
  }
}
