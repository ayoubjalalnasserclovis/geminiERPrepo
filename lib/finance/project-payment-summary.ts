import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  aggregatePaymentSummary,
  type ProjectPaymentSummary,
  type ProjectPaymentSummaryByType,
  type PaymentRowForSummary,
} from '@/lib/finance/project-payment-summary-pure';

/**
 * Source unique de vérité (côté serveur) pour la lecture des paiements honoraires
 * Stoniz d'un projet. Tout consommateur (fiche projet, page /payments, alerte de
 * retard, dashboard projet, dashboard financier…) DOIT passer par cette fonction
 * pour calculer "totalAttendu / totalEncaissé / restant à percevoir" et
 * l'éclatement par jalon.
 *
 * Les helpers PURS (`aggregatePaymentSummary`, types) vivent dans
 * `project-payment-summary-pure.ts` pour pouvoir être utilisés depuis les
 * composants client (StonizFeesCard, …).
 *
 * ----------------------------------------------------------------------------
 * RÉGRESSION HISTORIQUE — NE PLUS JAMAIS REPRODUIRE
 * ----------------------------------------------------------------------------
 * Projet Boutira (id `b90a9e3f-7f30-4fe2-8a42-4f9788ffc85d`, ref STZ-PROJ-008) :
 * la BDD contenait des doublons (deux lignes pour `acompte_stoniz` et deux pour
 * `honoraires_livraison`) car la RPC `advance_project_phase` faisait des INSERTs
 * répétés sans contrainte UNIQUE(project_id, type).
 *
 *   - La page `/projects/[id]/` (fiche projet) sommait honnêtement toutes les
 *     lignes `amount_expected` et affichait "+4200€ à percevoir" — chiffre
 *     vrai mais déroutant.
 *   - La page `/projects/[id]/payments` faisait `new Map(p.type, p)` qui
 *     écrasait silencieusement les doublons → affichait "10 000/10 000 encaissés".
 *
 * Les deux écrans donnaient des chiffres incohérents.
 *
 * Règle métier appliquée ici :
 *   - On AGRÈGE par SUM (amount_expected, amount_paid) par type.
 *   - Si un doublon subsiste en BDD (4200+1500), on affichera
 *     "5700€ attendus / 1500€ payés / 4200€ restant" au lieu de cacher la
 *     ligne. Mieux vaut afficher l'incohérence que la masquer.
 *   - `deleted_at IS NOT NULL` est exclu par défaut.
 *
 * Le data fix prod (soft-delete des 2 orphelins) a été appliqué le 2026-06-23.
 * Une migration SQL (contrainte UNIQUE + RPC réécrite via UPSERT) corrige la
 * racine du problème.
 *
 * Post data fix attendu sur Boutira :
 *   totalExpected = 10 000  totalPaid = 10 000  remaining = 0
 *   byType = 5 lignes toutes en status='paid'
 *
 * Yassine (id `a313063e-2774-4934-880c-a3f41b5477f4`) : schedule custom,
 * l'agrégation par SUM par type reste correcte quelles que soient les saisies.
 */

export type {
  ProjectPaymentSummary,
  ProjectPaymentSummaryByType,
} from '@/lib/finance/project-payment-summary-pure';

export { aggregatePaymentSummary } from '@/lib/finance/project-payment-summary-pure';

/**
 * Récupère et agrège les paiements Stoniz d'un projet.
 *
 * @param projectId — UUID du projet
 * @param opts.includeDeleted — par défaut false, exclut `deleted_at IS NOT NULL`
 */
export async function getProjectPaymentSummary(
  projectId: string,
  opts?: { includeDeleted?: boolean },
): Promise<ProjectPaymentSummary> {
  const supabase = createClient();

  let query = supabase
    .from('payments')
    .select('id, type, amount_expected, amount_paid, due_date, deleted_at')
    .eq('project_id', projectId);

  if (!opts?.includeDeleted) {
    query = query.is('deleted_at', null);
  }

  const { data } = await query;
  const rows: PaymentRowForSummary[] = (data ?? []).map((r: any) => ({
    id: r.id,
    type: r.type,
    amount_expected: r.amount_expected,
    amount_paid: r.amount_paid,
    due_date: r.due_date,
  }));

  return aggregatePaymentSummary(rows);
}
