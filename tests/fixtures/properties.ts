import { adminClient } from '../helpers/supabase';
import type { TestRun } from '../helpers/test-run';

/**
 * Fixtures BIENS (properties) — création + nettoyage.
 * Taggé via le nom ([STZTEST <run>] …) pour un cleanup crash-safe.
 */

export type TestPropertyOverrides = {
  name?: string;
  status?: 'sourcing' | 'disponible' | 'propose' | 'offre' | 'vendu' | 'perdu' | 'a_verifier';
  quartier?: string;
  type?: 'Appartement' | 'Riad' | 'Terrain' | 'Villa';
  price?: number;
};

export type TestProperty = {
  id: string;
  name: string;
  status: string;
};

export async function createTestProperty(
  run: TestRun,
  overrides: TestPropertyOverrides = {}
): Promise<TestProperty> {
  const db = adminClient();

  const row = {
    name: run.label('197m2 Majorelle'),
    status: overrides.status ?? 'disponible',
    ...overrides,
  };

  const { data, error } = await db
    .from('properties')
    .insert(row)
    .select('id, name, status')
    .single();

  if (error) {
    throw new Error(`[fixtures] createTestProperty a échoué : ${error.message}`);
  }
  return data as TestProperty;
}

/** Supprime tous les biens d'un run (par pattern de nom). */
export async function deletePropertiesForRun(run: TestRun): Promise<void> {
  const db = adminClient();
  const { error } = await db.from('properties').delete().like('name', run.labelLike());
  if (error) {
    throw new Error(`[fixtures] cleanup properties a échoué : ${error.message}`);
  }
}
