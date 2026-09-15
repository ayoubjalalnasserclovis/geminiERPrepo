import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { adminClient } from '../helpers/supabase';
import {
  newTestRun,
  createTestProject,
  cleanupTestData,
  type TestRun,
} from '../fixtures';

/**
 * Test d'INTÉGRATION — compte payeur des demandes de virement (CEO 2026-07-08).
 *
 * Vérifie sur une VRAIE base (Supabase local ou projet cloud de test) :
 *   1. Le CHECK constraint rejette toute valeur hors 'personnel' | 'stz_oj'.
 *   2. Une demande achats/travaux porte bien le compte payeur choisi.
 *   3. Le workflow Finance → CEO ne perd pas l'information.
 *   4. NULL reste toléré en BDD (honoraires Stoniz + demandes historiques) —
 *      l'obligation de choix est portée par la couche Zod des server actions,
 *      testée côté UI (le bouton refuse d'envoyer sans choix).
 *
 * Migration cible : 20260708100000_payment_approvals_payer_account.sql
 */
describe('Compte payeur des demandes de virement (payment_approvals.payer_account)', () => {
  let run: TestRun;
  const createdApprovalIds: string[] = [];

  beforeEach(() => {
    run = newTestRun();
  });

  afterEach(async () => {
    // Les payment_approvals de test sont rattachées à un projet de test :
    // on les supprime explicitement AVANT le cleanup projets (FK CASCADE
    // couvrirait, mais on reste explicite pour les demandes sans projet).
    if (createdApprovalIds.length > 0) {
      await adminClient()
        .from('payment_approvals')
        .delete()
        .in('id', createdApprovalIds);
      createdApprovalIds.length = 0;
    }
    await cleanupTestData(run);
  });

  it('rejette une valeur hors canon (CHECK constraint)', async () => {
    const project = await createTestProject(run);

    const { error } = await adminClient()
      .from('payment_approvals')
      .insert({
        payment_batch_id: crypto.randomUUID(),
        project_id: project.id,
        amount: 100,
        currency: 'MAD',
        beneficiary_name: `[${run.id}] Fournisseur test`,
        payer_account: 'compte_inconnu',
      });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/payer_account|check/i);
  });

  it.each(['personnel', 'stz_oj'] as const)(
    'accepte et conserve payer_account=%s sur tout le cycle Finance → CEO',
    async (account) => {
      const project = await createTestProject(run);
      const db = adminClient();

      const { data: created, error } = await db
        .from('payment_approvals')
        .insert({
          payment_batch_id: crypto.randomUUID(),
          project_id: project.id,
          amount: 25000,
          currency: 'MAD',
          beneficiary_name: `[${run.id}] Fournisseur test`,
          description: 'test intégration compte payeur',
          urgency: 'normal',
          payer_account: account,
        })
        .select('id, payer_account, final_status')
        .single();

      expect(error).toBeNull();
      createdApprovalIds.push(created!.id);
      expect(created!.payer_account).toBe(account);
      expect(created!.final_status).toBe('pending');

      // Workflow Finance → CEO : l'info ne doit pas se perdre
      await db.from('payment_approvals')
        .update({ finance_status: 'approved', finance_reviewed_at: new Date().toISOString() })
        .eq('id', created!.id);
      await db.from('payment_approvals')
        .update({ ceo_status: 'approved', ceo_reviewed_at: new Date().toISOString() })
        .eq('id', created!.id);

      const { data: after } = await db
        .from('payment_approvals')
        .select('payer_account, final_status')
        .eq('id', created!.id)
        .single();

      expect(after!.payer_account).toBe(account);
      expect(after!.final_status).toBe('approved');
    }
  );

  it('tolère NULL en BDD (honoraires Stoniz + demandes historiques)', async () => {
    const project = await createTestProject(run);

    const { data, error } = await adminClient()
      .from('payment_approvals')
      .insert({
        payment_batch_id: crypto.randomUUID(),
        project_id: project.id,
        amount: 5000,
        currency: 'EUR',
        beneficiary_name: `[${run.id}] Stoniz honoraires`,
      })
      .select('id, payer_account')
      .single();

    expect(error).toBeNull();
    createdApprovalIds.push(data!.id);
    expect(data!.payer_account).toBeNull();
  });
});
