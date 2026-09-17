/**
 * Rapprochement banque ↔ Stoniz (Chantier 3).
 *
 * Pour chaque transaction bancaire non-allouée, on cherche des "candidats" dans :
 *   - travaux_payments (artisans payés)
 *   - achats_payments (fournisseurs payés)
 *   - travaux_encaissements (encaissements client travaux)
 *   - achats_encaissements (encaissements client achats)
 *   - payments (honoraires Stoniz)
 *
 * Score 0-100 basé sur :
 *   - Montant exact / proche (+/- 0.5 MAD)        → +50
 *   - Date proche (+/- 3 jours)                    → +20
 *   - Date proche (+/- 7 jours)                    → +10
 *   - Bénéficiaire qui matche le libellé bancaire  → +30 si exact, +15 si partiel
 *
 * Seuil minimum pour suggérer : 50/100.
 * Score ≥ 80 : "match très probable" (vert)
 * Score 60-79 : "match probable" (orange)
 * Score 50-59 : "à vérifier" (gris)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isProjectLost } from '@/lib/projects/lost';

export type ReconcileCandidate = {
  source: 'travaux_payment' | 'achats_payment' | 'travaux_encaissement' | 'achats_encaissement' | 'honoraires_payment';
  id: string;
  project_id: string | null;
  project_reference: string | null;
  project_client: string | null;
  amount_mad: number;
  date: string | null;
  description: string;            // libellé court (ex: "Acompte 1 - BELISSAMA")
  beneficiary: string | null;     // artisan/fournisseur/client
  score: number;                  // 0-100
  match_amount: boolean;
  match_date_days: number | null;
  match_beneficiary: 'exact' | 'partial' | 'none';
  lot_id: string | null;
  lot_label: string | null;
};

export type BankTransactionForRecon = {
  id: string;
  account_id: string;
  operation_date: string;
  value_date: string | null;
  label: string;
  reference: string | null;
  debit_mad: number | null;
  credit_mad: number | null;
  category_code: string | null;
  beneficiary: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function dayDiff(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round(Math.abs(da - db) / 86_400_000);
}

function normalizeStr(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire accents
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Match nom artisan/fournisseur dans le libellé bancaire.
 * Compare token par token (au moins 1 token de 3+ caractères en commun = partiel).
 */
function matchBeneficiary(bankLabel: string, candidateName: string | null): 'exact' | 'partial' | 'none' {
  if (!candidateName) return 'none';
  const a = normalizeStr(bankLabel);
  const b = normalizeStr(candidateName);
  if (!b) return 'none';
  // Exact si le nom complet apparaît dans le libellé
  if (a.includes(b)) return 'exact';
  // Partiel si au moins 1 token long du nom est dans le libellé
  const tokens = b.split(/\s+/).filter(t => t.length >= 3);
  if (tokens.length === 0) return 'none';
  const hasMatch = tokens.some(t => a.includes(t));
  return hasMatch ? 'partial' : 'none';
}

function computeScore(opts: {
  matchAmount: boolean;
  dateDiff: number | null;
  matchBenef: 'exact' | 'partial' | 'none';
}): number {
  let score = 0;
  if (opts.matchAmount) score += 50;
  if (opts.dateDiff != null) {
    if (opts.dateDiff <= 3) score += 20;
    else if (opts.dateDiff <= 7) score += 10;
    else if (opts.dateDiff <= 14) score += 5;
  }
  if (opts.matchBenef === 'exact') score += 30;
  else if (opts.matchBenef === 'partial') score += 15;
  return Math.min(100, score);
}

// ─── Recherche des candidats ──────────────────────────────────────────────

/** Projet joint sur une ligne finance (pour le filtre perdus / supprimés). */
type JoinedProject = {
  reference?: string | null;
  status?: string | null;
  deleted_at?: string | null;
  client?: { full_name?: string | null } | null;
} | null;

/** Colonne FK de `bank_transaction_allocations` par source de candidat. */
const ALLOC_FK_BY_SOURCE: Record<ReconcileCandidate['source'], string> = {
  travaux_payment: 'travaux_payment_id',
  achats_payment: 'achats_payment_id',
  travaux_encaissement: 'travaux_encaissement_id',
  achats_encaissement: 'achats_encaissement_id',
  honoraires_payment: 'payment_id',
};

/**
 * Montant de référence d'une ligne de paiement (décaissement ou honoraires).
 *
 * Trois valeurs sont métier-plausibles selon le moment du cycle :
 *   - `remaining` = amount_total − amount_paid → échéance encore due (cas nominal :
 *     l'acompte est planifié dans l'ERP, le virement part, on rapproche) ;
 *   - `total`     → échéance jamais touchée (remaining == total) ;
 *   - `paid`      → échéance déjà saisie comme payée côté ERP, qu'on rapproche
 *     a posteriori avec le relevé bancaire (cas historique, seul supporté avant
 *     ce correctif).
 *
 * On retient celle qui colle le mieux au montant bancaire. C'est cette valeur
 * qui devient `amount_mad` du candidat, donc le montant proposé à l'allocation
 * (cf. AutoAttachButton → attachToStonizPaymentAction).
 */
function pickReferenceAmount(total: number, paid: number, bankAmount: number): number {
  const remaining = Math.max(0, total - paid);
  const options = [remaining, total, paid].filter((v) => v > 0);
  if (options.length === 0) return 0;
  return options.reduce((best, v) =>
    Math.abs(v - bankAmount) < Math.abs(best - bankAmount) ? v : best,
  );
}

/**
 * Retire les candidats DÉJÀ rapprochés (≥1 allocation bancaire active pointant
 * dessus).
 *
 * Sans ce filtre, l'écran proposerait des lignes que `attachToStonizPaymentAction`
 * refusera systématiquement : garde-fou applicatif anti-double-rattachement
 * (actions.ts, CEO 2026-07-02) + index UNIQUE partiels côté BDD pour les
 * encaissements et services_payments
 * (20260702120000_unique_alloc_encaissement.sql).
 *
 * Best-effort : si la requête échoue, on n'ampute pas les suggestions.
 */
async function dropAlreadyAllocated(
  candidates: ReconcileCandidate[],
  supabase: SupabaseClient,
): Promise<ReconcileCandidate[]> {
  if (candidates.length === 0) return candidates;

  const idsBySource = new Map<ReconcileCandidate['source'], string[]>();
  for (const c of candidates) {
    const arr = idsBySource.get(c.source) ?? [];
    arr.push(c.id);
    idsBySource.set(c.source, arr);
  }

  const taken = new Set<string>(); // clé `${source}:${id}`
  for (const [source, ids] of idsBySource) {
    const field = ALLOC_FK_BY_SOURCE[source];
    if (!field || ids.length === 0) continue;
    const { data, error } = await supabase
      .from('bank_transaction_allocations')
      .select(field)
      .is('deleted_at', null)
      .in(field, ids);
    if (error) continue;
    for (const row of (data ?? []) as any[]) {
      const v = row?.[field];
      if (v) taken.add(`${source}:${v}`);
    }
  }

  return candidates.filter((c) => !taken.has(`${c.source}:${c.id}`));
}

/**
 * Recherche tous les candidats Stoniz pour une transaction bancaire donnée.
 * Filtre côté SQL sur le montant (à 1 MAD près) pour limiter le volume,
 * puis scoring fin côté TS.
 *
 * Canon appliqué (aligné sur `lib/finance/reconciliation-pairs.ts`) :
 *   - projets `status = 'perdu'` ou `deleted_at != null` exclus (lib/projects/lost.ts) ;
 *   - lignes soft-deleted exclues ;
 *   - fenêtre de montant sur le montant ATTENDU (amount_total / amount_expected)
 *     ET sur amount_paid — pas sur amount_paid seul : un acompte en attente a
 *     `amount_paid = 0` et ne pouvait structurellement jamais être proposé ;
 *   - encaissements : `planifie` ET `recu` sont proposés (le rapprochement
 *     bascule lui-même planifie → recu, cf. actions.ts QA-BUG-034) ;
 *   - lignes déjà rapprochées retirées (cf. dropAlreadyAllocated).
 */
export async function findReconcileCandidates(
  tx: BankTransactionForRecon,
  supabase: SupabaseClient,
  options: { minScore?: number; maxResults?: number } = {},
): Promise<ReconcileCandidate[]> {
  const minScore = options.minScore ?? 50;
  const maxResults = options.maxResults ?? 10;

  const amount = Math.abs(Number(tx.debit_mad ?? tx.credit_mad ?? 0));
  if (amount < 1) return [];

  const isDebit = tx.debit_mad != null && tx.debit_mad !== 0;
  const candidates: ReconcileCandidate[] = [];

  // Fenêtre montant : +/- 1 MAD
  const amountMin = amount - 1;
  const amountMax = amount + 1;

  /**
   * Filtre PostgREST : montant attendu OU déjà payé dans la fenêtre.
   *
   * Limite connue et assumée : PostgREST ne sait pas filtrer sur une expression
   * inter-colonnes, donc le « restant dû » d'une échéance PARTIELLEMENT payée
   * (total 100k, payé 70k, restant 30k) n'est pas capté par la fenêtre SQL.
   * Le scoring TS le gère dès que la ligne est remontée ; les acomptes Stoniz
   * étant réglés ligne par ligne (1 ligne = 1 acompte), ce cas est marginal.
   */
  const amountOrFilter = (expectedCol: string) =>
    `and(${expectedCol}.gte.${amountMin},${expectedCol}.lte.${amountMax}),` +
    `and(amount_paid.gte.${amountMin},amount_paid.lte.${amountMax})`;

  if (isDebit) {
    // Débit bancaire = paiement émis → chercher dans :
    // - travaux_payments (paiement artisan)
    // - achats_payments (paiement fournisseur)

    // travaux_payments
    const { data: travauxPays } = await supabase
      .from('travaux_payments')
      .select(`
        id, project_id, lot_id, amount_total, amount_paid, paid_at, scheduled_date,
        lot:travaux_lots(id, category, artisan:artisans(name)),
        project:projects(reference, status, deleted_at, client:clients(full_name))
      `)
      .or(amountOrFilter('amount_total'))
      .is('deleted_at', null);

    for (const p of travauxPays ?? []) {
      const lotAny = (p as any).lot;
      const projAny = (p as any).project as JoinedProject;
      // Exclusion perdus / supprimés (canon lib/projects/lost.ts)
      if (isProjectLost(projAny)) continue;
      const date = (p as any).paid_at ?? (p as any).scheduled_date;
      const benef = lotAny?.artisan?.name ?? null;
      const refAmount = pickReferenceAmount(
        Number((p as any).amount_total ?? 0),
        Number((p as any).amount_paid ?? 0),
        amount,
      );
      const matchAmount = Math.abs(refAmount - amount) <= 1;
      const dateDiff = date ? dayDiff(tx.operation_date, date) : null;
      const matchBenef = matchBeneficiary(tx.label, benef);
      const score = computeScore({ matchAmount, dateDiff, matchBenef });
      if (score >= minScore) {
        candidates.push({
          source: 'travaux_payment',
          id: (p as any).id,
          project_id: (p as any).project_id,
          project_reference: projAny?.reference ?? null,
          project_client: projAny?.client?.full_name ?? null,
          amount_mad: refAmount,
          date,
          description: `Acompte travaux${benef ? ' · ' + benef : ''}`,
          beneficiary: benef,
          score,
          match_amount: matchAmount,
          match_date_days: dateDiff,
          match_beneficiary: matchBenef,
          lot_id: lotAny?.id ?? null,
          lot_label: lotAny?.category ?? null,
        });
      }
    }

    // achats_payments
    const { data: achatsPays } = await supabase
      .from('achats_payments')
      .select(`
        id, project_id, lot_id, amount_total, amount_paid, paid_at, scheduled_date,
        lot:achats_lots(id, category, supplier:artisans(name)),
        project:projects(reference, status, deleted_at, client:clients(full_name))
      `)
      .or(amountOrFilter('amount_total'))
      .is('deleted_at', null);

    for (const p of achatsPays ?? []) {
      const lotAny = (p as any).lot;
      const projAny = (p as any).project as JoinedProject;
      if (isProjectLost(projAny)) continue;
      const date = (p as any).paid_at ?? (p as any).scheduled_date;
      const benef = lotAny?.supplier?.name ?? null;
      const refAmount = pickReferenceAmount(
        Number((p as any).amount_total ?? 0),
        Number((p as any).amount_paid ?? 0),
        amount,
      );
      const matchAmount = Math.abs(refAmount - amount) <= 1;
      const dateDiff = date ? dayDiff(tx.operation_date, date) : null;
      const matchBenef = matchBeneficiary(tx.label, benef);
      const score = computeScore({ matchAmount, dateDiff, matchBenef });
      if (score >= minScore) {
        candidates.push({
          source: 'achats_payment',
          id: (p as any).id,
          project_id: (p as any).project_id,
          project_reference: projAny?.reference ?? null,
          project_client: projAny?.client?.full_name ?? null,
          amount_mad: refAmount,
          date,
          description: `Paiement fournisseur${benef ? ' · ' + benef : ''}`,
          beneficiary: benef,
          score,
          match_amount: matchAmount,
          match_date_days: dateDiff,
          match_beneficiary: matchBenef,
          lot_id: lotAny?.id ?? null,
          lot_label: lotAny?.category ?? null,
        });
      }
    }
  } else {
    // Crédit bancaire = encaissement → chercher dans :
    // - travaux_encaissements
    // - achats_encaissements
    // - payments (honoraires Stoniz reçus du client)

    // travaux_encaissements
    // `amount_mad` est bien le montant attendu (pas de notion de partiel ici).
    // `status` : on garde 'recu' ET 'planifie' — rapprocher un virement réel
    // avec un encaissement planifié est justement le geste qui le bascule en
    // 'recu' (actions.ts QA-BUG-034, décision CEO 2026-06-14).
    const { data: travauxEnc } = await supabase
      .from('travaux_encaissements')
      .select(`
        id, project_id, amount_mad, received_at, scheduled_date, status,
        project:projects(reference, status, deleted_at, client:clients(full_name))
      `)
      .gte('amount_mad', amountMin)
      .lte('amount_mad', amountMax)
      .is('deleted_at', null);

    for (const e of travauxEnc ?? []) {
      const projAny = (e as any).project as JoinedProject;
      if (isProjectLost(projAny)) continue;
      // Un planifié n'a pas de received_at (contrainte CHECK migration
      // 20260608110000) → on retombe sur scheduled_date, sinon le scoring
      // perdait les 20 points de proximité de date.
      const date = (e as any).received_at ?? (e as any).scheduled_date;
      const encStatus = (e as any).status ?? null;
      const clientName = projAny?.client?.full_name ?? null;
      const matchAmount = Math.abs(Number((e as any).amount_mad) - amount) <= 1;
      const dateDiff = date ? dayDiff(tx.operation_date, date) : null;
      const matchBenef = matchBeneficiary(tx.label, clientName);
      const score = computeScore({ matchAmount, dateDiff, matchBenef });
      if (score >= minScore) {
        candidates.push({
          source: 'travaux_encaissement',
          id: (e as any).id,
          project_id: (e as any).project_id,
          project_reference: projAny?.reference ?? null,
          project_client: clientName,
          amount_mad: Number((e as any).amount_mad),
          date,
          description: `Encaissement travaux client${encStatus === 'planifie' ? ' · planifié' : ''}`,
          beneficiary: clientName,
          score,
          match_amount: matchAmount,
          match_date_days: dateDiff,
          match_beneficiary: matchBenef,
          lot_id: null,
          lot_label: null,
        });
      }
    }

    // achats_encaissements
    const { data: achatsEnc } = await supabase
      .from('achats_encaissements')
      .select(`
        id, project_id, amount_mad, received_at, scheduled_date, status,
        project:projects(reference, status, deleted_at, client:clients(full_name))
      `)
      .gte('amount_mad', amountMin)
      .lte('amount_mad', amountMax)
      .is('deleted_at', null);

    for (const e of achatsEnc ?? []) {
      const projAny = (e as any).project as JoinedProject;
      if (isProjectLost(projAny)) continue;
      const date = (e as any).received_at ?? (e as any).scheduled_date;
      const encStatus = (e as any).status ?? null;
      const clientName = projAny?.client?.full_name ?? null;
      const matchAmount = Math.abs(Number((e as any).amount_mad) - amount) <= 1;
      const dateDiff = date ? dayDiff(tx.operation_date, date) : null;
      const matchBenef = matchBeneficiary(tx.label, clientName);
      const score = computeScore({ matchAmount, dateDiff, matchBenef });
      if (score >= minScore) {
        candidates.push({
          source: 'achats_encaissement',
          id: (e as any).id,
          project_id: (e as any).project_id,
          project_reference: projAny?.reference ?? null,
          project_client: clientName,
          amount_mad: Number((e as any).amount_mad),
          date,
          description: `Encaissement achats client${encStatus === 'planifie' ? ' · planifié' : ''}`,
          beneficiary: clientName,
          score,
          match_amount: matchAmount,
          match_date_days: dateDiff,
          match_beneficiary: matchBenef,
          lot_id: null,
          lot_label: null,
        });
      }
    }

    // honoraires (payments) — montant attendu = amount_expected
    const { data: hons } = await supabase
      .from('payments')
      .select(`
        id, project_id, type, amount_paid, amount_expected, paid_at, due_date, label,
        project:projects(reference, status, deleted_at, client:clients(full_name))
      `)
      .or(amountOrFilter('amount_expected'))
      .is('deleted_at', null);

    for (const h of hons ?? []) {
      const projAny = (h as any).project as JoinedProject;
      if (isProjectLost(projAny)) continue;
      const date = (h as any).paid_at ?? (h as any).due_date;
      const clientName = projAny?.client?.full_name ?? null;
      const refAmount = pickReferenceAmount(
        Number((h as any).amount_expected ?? 0),
        Number((h as any).amount_paid ?? 0),
        amount,
      );
      const matchAmount = Math.abs(refAmount - amount) <= 1;
      const dateDiff = date ? dayDiff(tx.operation_date, date) : null;
      const matchBenef = matchBeneficiary(tx.label, clientName);
      const score = computeScore({ matchAmount, dateDiff, matchBenef });
      if (score >= minScore) {
        candidates.push({
          source: 'honoraires_payment',
          id: (h as any).id,
          project_id: (h as any).project_id,
          project_reference: projAny?.reference ?? null,
          project_client: clientName,
          amount_mad: refAmount,
          date,
          description: `Honoraires Stoniz · ${(h as any).type ?? ''}${(h as any).label ? ' · ' + (h as any).label : ''}`,
          beneficiary: clientName,
          score,
          match_amount: matchAmount,
          match_date_days: dateDiff,
          match_beneficiary: matchBenef,
          lot_id: null,
          lot_label: null,
        });
      }
    }
  }

  // Retire ce qui est déjà rapproché (sinon rattachement refusé à la validation)
  const available = await dropAlreadyAllocated(candidates, supabase);

  // Tri par score décroissant
  available.sort((a, b) => b.score - a.score);
  return available.slice(0, maxResults);
}

/**
 * Niveau de confiance UI à partir du score.
 */
export function scoreToConfidence(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'Très probable', color: 'green' };
  if (score >= 60) return { label: 'Probable', color: 'orange' };
  if (score >= 50) return { label: 'À vérifier', color: 'gray' };
  return { label: 'Faible', color: 'gray' };
}
