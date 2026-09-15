import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { adminClient } from '../helpers/supabase';
import {
  newTestRun,
  createTestClient,
  createTestProject,
  cleanupTestData,
  type TestRun,
} from '../fixtures';

/**
 * Test d'INTÉGRATION exemple — touche une vraie base Supabase locale.
 *
 * Il sert de patron pour tout test DB : chaque test a son propre test_run_id,
 * crée ses fixtures, vérifie la DONNÉE RÉELLE en base (comportement, pas mock),
 * puis nettoie tout en afterEach — y compris si le test plante.
 *
 * Lancé par `npm run test:int` (PAS par `npm test`).
 */
describe('Fixtures clients & projets (intégration Supabase)', () => {
  let run: TestRun;

  beforeEach(() => {
    run = newTestRun();
  });

  afterEach(async () => {
    // Cleanup garanti, isolé par run : aucune dépendance entre tests.
    await cleanupTestData(run);
  });

  it('createTestClient · le client est réellement lisible en base', async () => {
    const created = await createTestClient(run);

    const { data, error } = await adminClient()
      .from('clients')
      .select('id, full_name, email')
      .eq('id', created.id)
      .single();

    expect(error).toBeNull();
    expect(data?.email).toBe(run.email('client'));
    expect(data?.full_name).toContain('Karim Zaidi');
  });

  it('createTestProject · le projet est rattaché à un client de test', async () => {
    const project = await createTestProject(run);

    const { data } = await adminClient()
      .from('projects')
      .select('id, reference, client_id')
      .eq('id', project.id)
      .single();

    expect(data?.reference).toBe(run.projectRef());
    expect(data?.client_id).toBe(project.client_id);
  });

  it('cleanupTestData · ne laisse aucune donnée du run en base', async () => {
    await createTestProject(run);
    await cleanupTestData(run);

    const { count: projects } = await adminClient()
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .like('reference', run.projectRefLike());
    const { count: clients } = await adminClient()
      .from('clients')
      .select('id', { count: 'exact', head: true })
      .like('email', run.emailLike());

    expect(projects).toBe(0);
    expect(clients).toBe(0);
  });
});
