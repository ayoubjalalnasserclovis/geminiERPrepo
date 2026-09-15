import { adminClient } from '../helpers/supabase';
import { TEST_TAG, TEST_EMAIL_DOMAIN, newTestRun, type TestRun } from '../helpers/test-run';

export { newTestRun, type TestRun } from '../helpers/test-run';
export * from './clients';
export * from './properties';
export * from './projects';

/**
 * Filet de sécurité : supprime TOUTES les données de test orphelines, tous runs
 * confondus (utile au démarrage d'une suite, ou pour rattraper un crash ancien).
 *
 * Identifie le test par les tags universels (référence STZTEST-*, email @stoniz.test).
 * Ne touche JAMAIS aux vraies données.
 */
export async function cleanupAllTestData(): Promise<void> {
  const db = adminClient();
  await db.from('projects').delete().like('reference', `${TEST_TAG}-%`);
  await db.from('properties').delete().like('name', `[${TEST_TAG} %`);
  await db.from('clients').delete().like('email', `%@${TEST_EMAIL_DOMAIN}`);
}

/**
 * Sucre pour un test auto-nettoyé : exécute `fn` avec un run frais puis nettoie,
 * que `fn` réussisse ou échoue.
 *
 * Préférer le couple beforeEach/afterEach quand on veut partager le run entre
 * plusieurs `it` ; withTestRun est pratique pour un test isolé.
 */
export async function withTestRun<T>(fn: (run: TestRun) => Promise<T>): Promise<T> {
  const run = newTestRun();
  const { cleanupTestData } = await import('./projects');
  try {
    return await fn(run);
  } finally {
    await cleanupTestData(run);
  }
}
