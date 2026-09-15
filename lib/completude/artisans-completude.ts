import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { checkArtisanCompleteness, MISSING_LABELS } from '@/lib/artisans/specialities';
import { getAllArtisansAttestationStatus } from '@/lib/artisans/attestation-status';

/**
 * COMPLÉTUDE FICHES ARTISANS — V1 (CEO 2026-06-24)
 *
 * 2 modes :
 *   - 'strict'   : reproduit /artisans/incomplets (4 critères bloquants paiement
 *                  via checkArtisanCompleteness + fraîcheur < 6 mois sur
 *                  l'attestation de régularité fiscale).
 *   - 'weighted' : score 0-100 pondéré (15 bloquant / 10 important / 5 mineur)
 *                  pour mesurer la qualité globale des fiches sans se cantonner
 *                  aux 4 critères bancaires.
 *
 * Périmètre : artisans.status='actif' AND deleted_at IS NULL.
 *
 * Sources réutilisées (NE PAS dupliquer) :
 *   - lib/artisans/specialities.ts → checkArtisanCompleteness() pour la règle
 *     stricte 4 critères + détection auto-entrepreneur / personne_physique.
 *   - lib/artisans/attestation-status.ts → getAllArtisansAttestationStatus()
 *     pour la fraîcheur 6 mois de l'attestation fiscale (statut 'valid' ou
 *     'expiring_soon' = présent ; 'expired' ou 'missing' = absent).
 *
 * Pondération mode weighted :
 *   - 15 (bloquant paiement) : bank_name, rib, doc attestation_rib,
 *     attestation fiscale FRAÎCHE.
 *   - 10 (important société)  : ice / if_number / cnss / rc — applicables
 *     uniquement aux entités non auto-entrepreneur / personne_physique.
 *   - 10 (important contact)  : contact_name, phone, email.
 *   - 5  (mineur)             : whatsapp, address, city, speciality,
 *     evaluation, bank_account_holder.
 *
 * Score = 100 * sum(weights_present) / sum(weights_applicable).
 * Criticality : >=90 vert | >=75 gris | >=50 orange | <50 rouge.
 *
 * topMissing : le 1er manque par poids décroissant (puis ordre déclaratif).
 * topMissingAggregated : top 5 des manques les plus fréquents.
 */

export type ArtisanCompletudeMode = 'strict' | 'weighted';

export type ArtisanRequirementKey =
  // bloquants paiement
  | 'bank_name'
  | 'rib'
  | 'attestation_rib'
  | 'attestation_regularite_fiscale'
  // société (skipped si auto_entrepreneur / personne_physique)
  | 'ice'
  | 'if_number'
  | 'cnss'
  | 'rc'
  // contact
  | 'contact_name'
  | 'phone'
  | 'email'
  // mineurs
  | 'whatsapp'
  | 'address'
  | 'city'
  | 'speciality'
  | 'evaluation'
  | 'bank_account_holder';

export type ArtisanRequirement = {
  key: ArtisanRequirementKey;
  label: string;
  weight: 5 | 10 | 15;
  isPresent: boolean;
  societyOnly?: boolean;
};

export type ArtisanCompletudeRow = {
  id: string;
  name: string;
  businessScope: 'travaux' | 'deco' | 'both' | null;
  type: string | null;
  legalForm: string | null;
  isIndep: boolean;
  scoreWeighted: number;
  scoreStrict: 'ok' | 'blocked';
  criticality: 'red' | 'orange' | 'gray' | 'green';
  missing: string[];
  blockedReasons: string[];
  topMissing: string;
  requirements: ArtisanRequirement[];
};

export type ArtisanCompletudeStats = {
  total: number;
  green: number;
  gray: number;
  orange: number;
  red: number;
  avgScoreWeighted: number;
  blockedStrict: number;
  topMissingAggregated: Array<{ label: string; count: number }>;
};

const LABELS: Record<ArtisanRequirementKey, string> = {
  bank_name: MISSING_LABELS.bank_name ?? 'Nom de la banque',
  rib: MISSING_LABELS.rib ?? 'RIB',
  attestation_rib: MISSING_LABELS.attestation_rib ?? 'Attestation RIB',
  attestation_regularite_fiscale:
    MISSING_LABELS.attestation_regularite_fiscale ?? 'Attestation de régularité fiscale',
  ice: 'ICE (Identifiant Commun de l\'Entreprise)',
  if_number: 'Identifiant fiscal (IF)',
  cnss: 'N° CNSS',
  rc: 'Registre de commerce (RC)',
  contact_name: 'Nom du contact',
  phone: 'Téléphone',
  email: 'Email',
  whatsapp: 'WhatsApp',
  address: 'Adresse',
  city: 'Ville',
  speciality: 'Spécialité',
  evaluation: 'Évaluation',
  bank_account_holder: 'Titulaire du compte bancaire',
};

// Ordre déclaratif → priorité aux poids les plus élevés en premier.
const WEIGHT: Record<ArtisanRequirementKey, 5 | 10 | 15> = {
  bank_name: 15,
  rib: 15,
  attestation_rib: 15,
  attestation_regularite_fiscale: 15,
  ice: 10,
  if_number: 10,
  cnss: 10,
  rc: 10,
  contact_name: 10,
  phone: 10,
  email: 10,
  whatsapp: 5,
  address: 5,
  city: 5,
  speciality: 5,
  evaluation: 5,
  bank_account_holder: 5,
};

const SOCIETY_ONLY: Partial<Record<ArtisanRequirementKey, boolean>> = {
  ice: true,
  if_number: true,
  cnss: true,
  rc: true,
};

function isNonEmpty(v: unknown): boolean {
  return typeof v === 'string' ? v.trim().length > 0 : v != null;
}

function criticalityFromScore(score: number): 'red' | 'orange' | 'gray' | 'green' {
  if (score >= 90) return 'green';
  if (score >= 75) return 'gray';
  if (score >= 50) return 'orange';
  return 'red';
}

type ArtisanRow = {
  id: string;
  name: string;
  legal_form: string | null;
  type: string | null;
  business_scope: 'travaux' | 'deco' | 'both' | null;
  speciality: string | null;
  ice: string | null;
  if_number: string | null;
  cnss: string | null;
  rc: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  address: string | null;
  city: string | null;
  bank_name: string | null;
  rib: string | null;
  bank_account_holder: string | null;
  evaluation: number | null;
};

export async function computeArtisansCompletude(opts?: {
  mode?: ArtisanCompletudeMode;
  businessScope?: 'travaux' | 'deco' | 'both' | 'all';
}): Promise<{ rows: ArtisanCompletudeRow[]; stats: ArtisanCompletudeStats }> {
  const supabase = createClient();
  const scope = opts?.businessScope ?? 'all';

  // ── 1) Artisans actifs ──────────────────────────────────────────────
  let q = supabase
    .from('artisans')
    .select(
      [
        'id', 'name', 'legal_form', 'type', 'business_scope', 'speciality',
        'ice', 'if_number', 'cnss', 'rc',
        'contact_name', 'phone', 'email', 'whatsapp',
        'address', 'city',
        'bank_name', 'rib', 'bank_account_holder',
        'evaluation',
      ].join(','),
    )
    .eq('status', 'actif')
    .is('deleted_at', null);

  if (scope !== 'all') q = q.eq('business_scope', scope);

  const { data: artisansRaw } = await q;
  const artisans = (artisansRaw ?? []) as unknown as ArtisanRow[];
  if (artisans.length === 0) {
    return {
      rows: [],
      stats: {
        total: 0, green: 0, gray: 0, orange: 0, red: 0,
        avgScoreWeighted: 0, blockedStrict: 0,
        topMissingAggregated: [],
      },
    };
  }

  const ids = artisans.map((a) => a.id);

  // ── 2) Docs attestation_rib présents par artisan ────────────────────
  const { data: docs } = await supabase
    .from('documents')
    .select('artisan_id, type')
    .in('artisan_id', ids)
    .eq('type', 'attestation_rib')
    .is('deleted_at', null);
  const hasAttestationRib = new Set<string>();
  for (const d of (docs ?? []) as Array<{ artisan_id: string }>) {
    hasAttestationRib.add(d.artisan_id);
  }

  // ── 3) Fraîcheur attestation fiscale (helper canon) ─────────────────
  const attestationRows = await getAllArtisansAttestationStatus(supabase, 'all');
  const freshFiscale = new Set<string>();
  for (const r of attestationRows) {
    if (r.status === 'valid' || r.status === 'expiring_soon') {
      freshFiscale.add(r.artisan_id);
    }
  }

  // ── 4) Évaluation par artisan ──────────────────────────────────────
  const rows: ArtisanCompletudeRow[] = [];
  const missingAgg = new Map<string, number>();
  let blockedStrictCount = 0;

  for (const a of artisans) {
    const hasRibDoc = hasAttestationRib.has(a.id);
    const hasFiscaleFresh = freshFiscale.has(a.id);

    // Mode strict (canon /artisans/incomplets)
    const strict = checkArtisanCompleteness({
      legal_form: a.legal_form,
      bank_name: a.bank_name,
      rib: a.rib,
      has_attestation_rib: hasRibDoc,
      // CEO 2026-06-24 : fraîcheur 6 mois (sinon = manquant pour V1 stricte)
      has_attestation_regularite_fiscale: hasFiscaleFresh,
    });
    const scoreStrict: 'ok' | 'blocked' = strict.is_complete_for_payment ? 'ok' : 'blocked';
    if (scoreStrict === 'blocked') blockedStrictCount += 1;
    const blockedReasons = strict.missing.map((m) => MISSING_LABELS[m] ?? m);

    // Mode pondéré
    const isIndep = strict.is_indep;
    const presence: Record<ArtisanRequirementKey, boolean> = {
      bank_name: isNonEmpty(a.bank_name),
      rib: isNonEmpty(a.rib),
      attestation_rib: hasRibDoc,
      attestation_regularite_fiscale: hasFiscaleFresh,
      ice: isNonEmpty(a.ice),
      if_number: isNonEmpty(a.if_number),
      cnss: isNonEmpty(a.cnss),
      rc: isNonEmpty(a.rc),
      contact_name: isNonEmpty(a.contact_name),
      phone: isNonEmpty(a.phone),
      email: isNonEmpty(a.email),
      whatsapp: isNonEmpty(a.whatsapp),
      address: isNonEmpty(a.address),
      city: isNonEmpty(a.city),
      speciality: isNonEmpty(a.speciality),
      evaluation: a.evaluation != null && a.evaluation > 0,
      bank_account_holder: isNonEmpty(a.bank_account_holder),
    };

    const requirements: ArtisanRequirement[] = [];
    let weightRequired = 0;
    let weightPresent = 0;
    const missingLabels: string[] = [];
    let topMissingKey: ArtisanRequirementKey | null = null;
    let topMissingWeight = -1;

    (Object.keys(WEIGHT) as ArtisanRequirementKey[]).forEach((key) => {
      const societyOnly = SOCIETY_ONLY[key] === true;
      if (societyOnly && isIndep) return; // pas applicable
      const w = WEIGHT[key];
      const present = presence[key];
      weightRequired += w;
      if (present) {
        weightPresent += w;
      } else {
        missingLabels.push(LABELS[key]);
        if (w > topMissingWeight) {
          topMissingWeight = w;
          topMissingKey = key;
        }
        missingAgg.set(LABELS[key], (missingAgg.get(LABELS[key]) ?? 0) + 1);
      }
      requirements.push({
        key,
        label: LABELS[key],
        weight: w,
        isPresent: present,
        societyOnly,
      });
    });

    const scoreWeighted = weightRequired === 0
      ? 100
      : Math.round((weightPresent / weightRequired) * 100);
    const criticality = criticalityFromScore(scoreWeighted);
    const topMissing = topMissingKey ? LABELS[topMissingKey] : '—';

    rows.push({
      id: a.id,
      name: a.name,
      businessScope: a.business_scope,
      type: a.type,
      legalForm: a.legal_form,
      isIndep,
      scoreWeighted,
      scoreStrict,
      criticality,
      missing: missingLabels,
      blockedReasons,
      topMissing,
      requirements,
    });
  }

  // ── 5) Stats agrégées ──────────────────────────────────────────────
  const total = rows.length;
  const green = rows.filter((r) => r.criticality === 'green').length;
  const gray = rows.filter((r) => r.criticality === 'gray').length;
  const orange = rows.filter((r) => r.criticality === 'orange').length;
  const red = rows.filter((r) => r.criticality === 'red').length;
  const avgScoreWeighted = total === 0
    ? 0
    : Math.round(rows.reduce((s, r) => s + r.scoreWeighted, 0) / total);

  const topMissingAggregated = Array.from(missingAgg.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Tri : criticité d'abord, puis score croissant.
  const order = { red: 0, orange: 1, gray: 2, green: 3 } as const;
  rows.sort((a, b) => {
    if (order[a.criticality] !== order[b.criticality]) {
      return order[a.criticality] - order[b.criticality];
    }
    return a.scoreWeighted - b.scoreWeighted;
  });

  return {
    rows,
    stats: {
      total,
      green,
      gray,
      orange,
      red,
      avgScoreWeighted,
      blockedStrict: blockedStrictCount,
      topMissingAggregated,
    },
  };
}
