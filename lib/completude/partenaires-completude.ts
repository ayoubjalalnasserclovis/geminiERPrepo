import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * COMPLÉTUDE FICHES PARTENAIRES — V1 (CEO 2026-06-24)
 *
 * Mode pondéré UNIQUEMENT (pas de mode strict — pas de bloquant paiement
 * comme pour les artisans car les commissions partenaires ne passent pas
 * par la même boucle de validation).
 *
 * Périmètre : partners.deleted_at IS NULL (tous statuts).
 *
 * Pondération par type (cf table dans le brief CEO) :
 *   Critères communs (tous types) :
 *     - partner_type (15)              ← le manque n°1 au launch
 *     - phone (15)
 *     - contract_signed=true (15)
 *     - contract_date (15)
 *     - doc contrat uploadé via vendor_documents.partner_id (15)
 *     - rib + bank_name (10)           ← couple : présent ssi LES DEUX
 *     - commission_rate_pct (10)
 *     - contact_name (10)
 *     - email (10)
 *     - last_contact_at < 6 mois (5)
 *     - evaluation (5)
 *     - address (5)
 *   Critères AGENCE / AUTRE (entreprises commerciales) :
 *     - ice (10)
 *     - rc (10)
 *     - if_number (10)
 *   Critères AGENCE / PARTICULIER (couverture géographique) :
 *     - quartiers_covered non vide (5)
 *
 * Score = 100 * sum(weights_present) / sum(weights_applicable).
 * Criticality : >=90 vert | >=75 gris | >=50 orange | <50 rouge.
 *
 * Note : vendor_documents stocke le contrat partenaire (doc_type='facture'
 * ou 'devis' pour l'instant — on relâche la contrainte de type et on
 * considère toute ligne non-deleted attachée au partner_id comme un doc
 * contractuel. À durcir en V2 quand on aura un doc_type='contrat').
 */

export type PartnerType = 'agence' | 'particulier' | 'notaire' | 'avocat' | 'autre';

export type PartnerRequirementKey =
  | 'partner_type'
  | 'phone'
  | 'contract_signed'
  | 'contract_date'
  | 'contract_doc'
  | 'ice'
  | 'rc'
  | 'if_number'
  | 'rib_bank'
  | 'commission_rate_pct'
  | 'contact_name'
  | 'email'
  | 'quartiers_covered'
  | 'last_contact_fresh'
  | 'evaluation'
  | 'address';

export type PartnerRequirement = {
  key: PartnerRequirementKey;
  label: string;
  weight: 5 | 10 | 15;
  isPresent: boolean;
  applicable: boolean;
};

export type PartnerCompletudeRow = {
  id: string;
  name: string;
  partnerType: PartnerType | null;
  status: string;
  scoreWeighted: number;
  criticality: 'red' | 'orange' | 'gray' | 'green';
  missing: string[];
  topMissing: string;
  requirements: PartnerRequirement[];
};

export type PartnerCompletudeStats = {
  total: number;
  green: number;
  gray: number;
  orange: number;
  red: number;
  avgScoreWeighted: number;
  withoutPartnerType: number;
  topMissingAggregated: Array<{ label: string; count: number }>;
};

const LABELS: Record<PartnerRequirementKey, string> = {
  partner_type: 'Type partenaire (agence/particulier/notaire/...)',
  phone: 'Téléphone',
  contract_signed: 'Contrat signé (case cochée)',
  contract_date: 'Date du contrat',
  contract_doc: 'Document contrat uploadé',
  ice: 'ICE',
  rc: 'Registre de commerce (RC)',
  if_number: 'Identifiant fiscal (IF)',
  rib_bank: 'RIB + banque',
  commission_rate_pct: 'Taux de commission',
  contact_name: 'Nom du contact',
  email: 'Email',
  quartiers_covered: 'Quartiers couverts',
  last_contact_fresh: 'Dernier contact (< 6 mois)',
  evaluation: 'Évaluation',
  address: 'Adresse',
};

const WEIGHT: Record<PartnerRequirementKey, 5 | 10 | 15> = {
  partner_type: 15,
  phone: 15,
  contract_signed: 15,
  contract_date: 15,
  contract_doc: 15,
  ice: 10,
  rc: 10,
  if_number: 10,
  rib_bank: 10,
  commission_rate_pct: 10,
  contact_name: 10,
  email: 10,
  quartiers_covered: 5,
  last_contact_fresh: 5,
  evaluation: 5,
  address: 5,
};

/**
 * Applicabilité par type. Si type est null, on applique TOUT (on signale
 * juste partner_type comme manquant — c'est l'item n°1 à corriger).
 */
function isApplicable(key: PartnerRequirementKey, type: PartnerType | null): boolean {
  if (type === null) return true;
  switch (key) {
    case 'ice':
    case 'rc':
    case 'if_number':
      return type === 'agence' || type === 'autre';
    case 'quartiers_covered':
      return type === 'agence' || type === 'particulier';
    default:
      return true;
  }
}

function isNonEmpty(v: unknown): boolean {
  return typeof v === 'string' ? v.trim().length > 0 : v != null;
}

function isArrayNonEmpty(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function isFreshDate(iso: string | null, months: number): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return d.getTime() >= cutoff.getTime();
}

function criticalityFromScore(score: number): 'red' | 'orange' | 'gray' | 'green' {
  if (score >= 90) return 'green';
  if (score >= 75) return 'gray';
  if (score >= 50) return 'orange';
  return 'red';
}

type PartnerRow = {
  id: string;
  agency_name: string;
  partner_type: PartnerType | null;
  status: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  quartiers_covered: string[] | null;
  contract_signed: boolean | null;
  contract_date: string | null;
  last_contact_at: string | null;
  evaluation: number | null;
  ice: string | null;
  rc: string | null;
  if_number: string | null;
  bank_name: string | null;
  rib: string | null;
  commission_rate_pct: number | null;
};

export async function computePartnersCompletude(opts?: {
  partnerType?: PartnerType | 'all';
}): Promise<{ rows: PartnerCompletudeRow[]; stats: PartnerCompletudeStats }> {
  const supabase = createClient();
  const filterType = opts?.partnerType ?? 'all';

  // ── 1) Partners non-supprimés ──────────────────────────────────────
  let q = supabase
    .from('partners')
    .select(
      [
        'id', 'agency_name', 'partner_type', 'status',
        'contact_name', 'phone', 'email', 'address',
        'quartiers_covered', 'contract_signed', 'contract_date',
        'last_contact_at', 'evaluation',
        'ice', 'rc', 'if_number',
        'bank_name', 'rib', 'commission_rate_pct',
      ].join(','),
    )
    .is('deleted_at', null);

  if (filterType !== 'all') q = q.eq('partner_type', filterType);

  const { data: partnersRaw } = await q;
  const partners = (partnersRaw ?? []) as unknown as PartnerRow[];
  if (partners.length === 0) {
    return {
      rows: [],
      stats: {
        total: 0, green: 0, gray: 0, orange: 0, red: 0,
        avgScoreWeighted: 0, withoutPartnerType: 0,
        topMissingAggregated: [],
      },
    };
  }

  const ids = partners.map((p) => p.id);

  // ── 2) Docs contrat par partner_id (via vendor_documents) ───────────
  const { data: vd } = await supabase
    .from('vendor_documents')
    .select('partner_id')
    .in('partner_id', ids)
    .is('deleted_at', null);
  const hasContractDoc = new Set<string>();
  for (const d of (vd ?? []) as Array<{ partner_id: string | null }>) {
    if (d.partner_id) hasContractDoc.add(d.partner_id);
  }

  // ── 3) Évaluation par partenaire ────────────────────────────────────
  const rows: PartnerCompletudeRow[] = [];
  const missingAgg = new Map<string, number>();

  for (const p of partners) {
    const type = p.partner_type;

    const presence: Record<PartnerRequirementKey, boolean> = {
      partner_type: type !== null,
      phone: isNonEmpty(p.phone),
      contract_signed: p.contract_signed === true,
      contract_date: isNonEmpty(p.contract_date),
      contract_doc: hasContractDoc.has(p.id),
      ice: isNonEmpty(p.ice),
      rc: isNonEmpty(p.rc),
      if_number: isNonEmpty(p.if_number),
      rib_bank: isNonEmpty(p.rib) && isNonEmpty(p.bank_name),
      commission_rate_pct: p.commission_rate_pct != null,
      contact_name: isNonEmpty(p.contact_name),
      email: isNonEmpty(p.email),
      quartiers_covered: isArrayNonEmpty(p.quartiers_covered),
      last_contact_fresh: isFreshDate(p.last_contact_at, 6),
      evaluation: p.evaluation != null && p.evaluation > 0,
      address: isNonEmpty(p.address),
    };

    const requirements: PartnerRequirement[] = [];
    let weightRequired = 0;
    let weightPresent = 0;
    const missingLabels: string[] = [];
    let topMissingKey: PartnerRequirementKey | null = null;
    let topMissingWeight = -1;

    (Object.keys(WEIGHT) as PartnerRequirementKey[]).forEach((key) => {
      const applicable = isApplicable(key, type);
      const w = WEIGHT[key];
      const present = presence[key];
      if (!applicable) {
        requirements.push({
          key, label: LABELS[key], weight: w,
          isPresent: present, applicable: false,
        });
        return;
      }
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
        key, label: LABELS[key], weight: w,
        isPresent: present, applicable: true,
      });
    });

    const scoreWeighted = weightRequired === 0
      ? 100
      : Math.round((weightPresent / weightRequired) * 100);
    const criticality = criticalityFromScore(scoreWeighted);
    const topMissing = topMissingKey ? LABELS[topMissingKey] : '—';

    rows.push({
      id: p.id,
      name: p.agency_name,
      partnerType: type,
      status: p.status,
      scoreWeighted,
      criticality,
      missing: missingLabels,
      topMissing,
      requirements,
    });
  }

  // ── 4) Stats agrégées ──────────────────────────────────────────────
  const total = rows.length;
  const green = rows.filter((r) => r.criticality === 'green').length;
  const gray = rows.filter((r) => r.criticality === 'gray').length;
  const orange = rows.filter((r) => r.criticality === 'orange').length;
  const red = rows.filter((r) => r.criticality === 'red').length;
  const avgScoreWeighted = total === 0
    ? 0
    : Math.round(rows.reduce((s, r) => s + r.scoreWeighted, 0) / total);
  const withoutPartnerType = rows.filter((r) => r.partnerType === null).length;

  const topMissingAggregated = Array.from(missingAgg.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

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
      withoutPartnerType,
      topMissingAggregated,
    },
  };
}
