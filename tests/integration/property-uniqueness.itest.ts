import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  newTestRun,
  createTestClient,
  createTestProperty,
  createTestProject,
  cleanupTestData,
  type TestRun,
} from '../fixtures';

/**
 * Règle métier : un bien ne peut être le bien final que d'UN SEUL projet vivant
 * (actif ou terminé) à la fois. C'est la règle demandée par le CEO :
 * « dès qu'un bien est retenu pour un client, il n'est plus dispo pour les autres ».
 *
 * On teste le COMPORTEMENT réel en base (l'index projects_property_active_uniq),
 * pas l'implémentation. Lancé par `npm run test:int`.
 */
describe('Unicité du bien retenu par projet (intégration)', () => {
  let run: TestRun;
  beforeEach(() => { run = newTestRun(); });
  afterEach(async () => { await cleanupTestData(run); });

  it('refuse le même bien pour deux projets actifs', async () => {
    const client = await createTestClient(run);
    const property = await createTestProperty(run, { status: 'disponible' });

    // 1er projet prend le bien → OK
    await createTestProject(run, { client_id: client.id, property_id: property.id });

    // 2e projet actif tente le même bien → la base doit refuser
    await expect(
      createTestProject(run, { client_id: client.id, property_id: property.id })
    ).rejects.toThrow(/projects_property_active_uniq|duplicate|unique/i);
  });

  it('libère le bien si l’autre projet est perdu (non vivant)', async () => {
    const client = await createTestClient(run);
    const property = await createTestProperty(run, { status: 'disponible' });

    // Un projet PERDU détient le bien : il ne compte pas comme "vivant"
    await createTestProject(run, {
      client_id: client.id,
      property_id: property.id,
      status: 'perdu',
    });

    // Un nouveau projet actif peut donc reprendre ce bien
    const repris = await createTestProject(run, {
      client_id: client.id,
      property_id: property.id,
      status: 'actif',
    });
    expect(repris.id).toBeTruthy();
  });
});
