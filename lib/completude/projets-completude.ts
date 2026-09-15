import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * COMPLÉTUDE DOSSIER PROJET — V1 stricte (CEO 2026-06-19)
 *
 * Vérifie pour chaque projet actif/pause (hors prep/legacy/perdu/terminé)
 * que tous les attendus de sa phase courante + phases antérieures sont présents
 * en BDD. La V1 ne propose AUCUN bouton "N/A" — tout manque est signalé.
 *
 * Périmètre (CEO) :
 *   - status IN ('actif','pause'), is_preparation=false, legacy_imported=false, deleted_at IS NULL
 *   - exclu 'perdu' et 'termine' (Stoniz s'arrête à livraison)
 *
 * Phases enum BDD réelles (vérifiées le 2026-06-19) :
 *   onboarding < sourcing < design < travaux < livraison < mise_en_location < termine
 *   ⚠ Pas de phase distincte "compromis", "acte_authentique", "design_3d",
 *   "lots_techniques", "chantier" — celles du référentiel CEO sont mappées
 *   sur les phases existantes via les CHAMPS de date (compromis_date,
 *   acte_authentique_date, travaux_start_date) et les docs uploadés.
 *
 * Adaptations vs référentiel CEO (signalées dans le rapport) :
 *   - "acte_authentique" doc : type 'titre_foncier' fait foi en BDD
 *     (pas de type doc 'acte_authentique' existant — 29 titres fonciers vs 0)
 *   - "moodboard" doc : table project_moodboard_choices (status='validated')
 *   - "pv_livraison" doc : table project_reception_pvs (statut signé)
 *   - "photos_chantier" doc : table project_photos
 *   - "shopping_list" et "lots_techniques" docs validés client
 *   - "bet" doc : type 'plan_bet' en BDD
 *   - "permis_travaux" : types 'permis_travaux' + 'autorisation_travaux' (équivalents)
 *   - "devis_travaux" : type 'devis_travaux' ou 'devis_artisan'
 *
 * ─────────────────────────────────────────────────────────────────────
 * CATALOGUE CANONIQUE des types de documents (table `documents`, colonne `type`)
 * Utilisé conjointement par cette source ET la fiche projet (voir
 * `components/documents/required-docs-checklist.tsx` REQUIRED_DOCS).
 * Toute incohérence entre ces deux listes = bug d'affichage admin vs fiche.
 *
 *   contrat_mission · piece_identite · cin · rib · procuration ·
 *   justificatif_financement · compromis · plans_3d · lots_techniques ·
 *   shopping_list · plan_bet · devis_travaux · devis_artisan · titre_foncier ·
 *   autorisation_travaux · permis_travaux · contrat_eau · contrat_electricite ·
 *   contrat_assurance · contrat_internet · pv_livraison · dossier_architecture ·
 *   cahier_des_charges · autre
 *
 * RÈGLE V1 PRÉSENCE (CEO 2026-06-23) — pour les docs marqués "validés client"
 * dans le référentiel (plans_3d, lots_techniques, shopping_list, devis_travaux) :
 *   - si `requires_client_validation=true` ET `client_validation_status!='validated'`
 *     → MANQUANT (validation explicitement attendue et pas encore signée)
 *   - sinon, PRÉSENCE du doc en BDD SUFFIT (sémantique alignée sur la fiche
 *     projet qui affiche "Reçu" dès qu'un doc du bon type est uploadé).
 *
 * Avant 2026-06-23, `plans_3d` exigeait soit `client_validation_status='validated'`
 * soit `moodboard_validé=true`. Bug constaté : 8/8 projets in-scope avec plans_3d
 * uploadés étaient signalés "3D manquants" alors que la fiche affichait "Reçu"
 * (en BDD: 15/19 docs plans_3d ont `client_validation_status=NULL` car non taggués
 * `requires_client_validation` à l'upload — pratique courante d'Othmane).
 * ─────────────────────────────────────────────────────────────────────
 */

/**
 * Helper canon — un doc "validable client" est considéré PRÉSENT (V1) si :
 *   - il existe (présent), ET
 *   - soit la validation n'est pas requise, soit elle est passée à 'validated'.
 *
 * @see REQUIRED_DOCS dans components/documents/required-docs-checklist.tsx
 *      (catalogue partagé fiche projet ↔ admin complétude)
 */
function isDocPresentAndUnblocked(
  type: string,
  docs: { typesPresent: Set<string>; typesValidatedByClient: Set<string>; typesRequiringValidation: Set<string> },
): boolean {
  if (!docs.typesPresent.has(type)) return false;
  // Si la validation n'a PAS été demandée → présence suffit (sémantique fiche projet).
  if (!docs.typesRequiringValidation.has(type)) return true;
  // Sinon, la validation client doit être passée.
  return docs.typesValidatedByClient.has(type);
}

type Phase = 'onboarding' | 'sourcing' | 'design' | 'travaux' | 'livraison'
  | 'mise_en_location' | 'termine';

const PHASE_ORDER: Record<Phase, number> = {
  onboarding: 0, sourcing: 1, design: 2, travaux: 3, livraison: 4,
  mise_en_location: 5, termine: 6,
};

export type RequirementKey =
  | 'cdc_validated'
  | 'property_selected'
  | 'property_simulation'
  | 'compromis_date_set'
  | 'compromis_doc'
  | 'acompte_stoniz_paid'
  | 'acte_authentique_date_set'
  | 'titre_foncier_doc'
  | 'plans_3d_validated'
  | 'moodboard_validated'
  | 'lots_techniques_validated'
  | 'bet_doc'
  | 'shopping_list_validated'
  | 'devis_travaux_validated'
  | 'permis_travaux_doc'
  | 'adresse_chantier'
  | 'travaux_lot_created'
  | 'water_contract_number'
  | 'electricity_contract_number'
  | 'pv_livraison_signed'
  | 'photos_chantier'
  | 'honoraires_compromis_paid'
  | 'honoraires_3d_paid'
  | 'honoraires_chantier_paid'
  | 'honoraires_livraison_paid';

export type Owner = 'chef_projet' | 'sourcing' | 'finance' | 'client' | 'assistante';

export type Requirement = {
  key: RequirementKey;
  label: string;
  phase: Phase;       // Phase à partir de laquelle l'attendu devient obligatoire
  owner: Owner;
  weight: number;     // 1-10
};

/**
 * Référentiel CEO — ordonné par phase puis criticité.
 * Tous les attendus restent obligatoires pour TOUTES les phases ultérieures.
 */
// CEO 2026-06-19 — Pondération en 3 niveaux pour faire ressortir les vraies
// catastrophes vs les détails admin :
//   15 = catastrophe (bloque l'avancement OU étape facturable client)
//   10 = important (structure le dossier, signature client, paiement)
//    5 = mineur (admin, nice-to-have, esthétique)
// Un projet sans PV livraison (15) doit avoir un score bien plus bas qu'un
// projet sans moodboard validé (5), même si "1 manque" dans les deux cas.
export const REQUIREMENTS: Requirement[] = [
  // ─── Onboarding / Sourcing ─────────────────────────────────────────
  // CEO 2026-06-19 : "cdc_validated" retiré car la plateforme n'est pas
  // encore lancée officiellement, donc les CDC n'existent pas pour les
  // dossiers actuels. À réintroduire après go-live officiel.
  { key: 'property_selected',    label: "Bien sélectionné (lié au projet)",   phase: 'sourcing',   owner: 'sourcing',    weight: 15 },
  { key: 'property_simulation',  label: "Simulation rendement sur le bien",   phase: 'sourcing',   owner: 'sourcing',    weight: 5 },

  // ─── Compromis (devient obligatoire dès la phase 'design') ──────────
  { key: 'compromis_date_set',     label: "Compromis signé (date saisie)",          phase: 'design', owner: 'chef_projet', weight: 15 },
  { key: 'compromis_doc',          label: "Document compromis uploadé",             phase: 'design', owner: 'chef_projet', weight: 10 },
  { key: 'acompte_stoniz_paid',    label: "Acompte Stoniz reçu (5 000 €)",          phase: 'design', owner: 'finance',     weight: 15 },
  { key: 'honoraires_compromis_paid', label: "Honoraires compromis reçus (3 800 €)", phase: 'design', owner: 'finance',  weight: 10 },

  // ─── Acte authentique (obligatoire dès la phase 'travaux') ─────────
  { key: 'acte_authentique_date_set', label: "Acte authentique signé (date saisie)", phase: 'travaux', owner: 'chef_projet', weight: 15 },
  { key: 'titre_foncier_doc',         label: "Titre foncier uploadé",                phase: 'travaux', owner: 'chef_projet', weight: 10 },

  // ─── Design 3D + moodboard (obligatoire dès la phase 'travaux') ─────
  { key: 'plans_3d_validated',  label: "Plans 3D validés par le client",       phase: 'travaux', owner: 'chef_projet', weight: 10 },
  { key: 'moodboard_validated', label: "Moodboard validé par le client",       phase: 'travaux', owner: 'chef_projet', weight: 5 },
  { key: 'honoraires_3d_paid',  label: "Honoraires design 3D reçus (3 800 €)", phase: 'travaux', owner: 'finance',     weight: 10 },

  // ─── Lots techniques + BET + shopping list (obligatoire dès 'travaux') ─
  { key: 'lots_techniques_validated', label: "Lots techniques validés client",         phase: 'travaux', owner: 'chef_projet', weight: 10 },
  { key: 'bet_doc',                   label: "BET (Bureau d'études techniques) fourni", phase: 'travaux', owner: 'chef_projet', weight: 10 },
  { key: 'shopping_list_validated',   label: "Shopping list validée client",            phase: 'travaux', owner: 'chef_projet', weight: 5 },

  // ─── Chantier (obligatoire dès 'travaux') ──────────────────────────
  { key: 'devis_travaux_validated', label: "Devis travaux validé client",  phase: 'travaux', owner: 'chef_projet', weight: 15 },
  { key: 'permis_travaux_doc',      label: "Autorisation/permis travaux",  phase: 'travaux', owner: 'chef_projet', weight: 10 },
  { key: 'adresse_chantier',        label: "Adresse chantier saisie",      phase: 'travaux', owner: 'chef_projet', weight: 5 },
  { key: 'travaux_lot_created',     label: "Au moins 1 lot travaux créé",  phase: 'travaux', owner: 'chef_projet', weight: 15 },
  { key: 'water_contract_number',       label: "N° contrat eau saisi",         phase: 'travaux', owner: 'assistante',  weight: 5 },
  { key: 'electricity_contract_number', label: "N° contrat électricité saisi", phase: 'travaux', owner: 'assistante',  weight: 5 },
  { key: 'honoraires_chantier_paid',    label: "Honoraires chantier reçus (4 200 €)", phase: 'travaux', owner: 'finance', weight: 10 },

  // ─── Livraison ─────────────────────────────────────────────────────
  { key: 'pv_livraison_signed',  label: "PV de livraison signé client",          phase: 'livraison', owner: 'chef_projet', weight: 15 },
  { key: 'photos_chantier',      label: "Photos chantier finalisé (≥1)",         phase: 'livraison', owner: 'chef_projet', weight: 5 },
  { key: 'honoraires_livraison_paid', label: "Honoraires livraison reçus (4 200 €)", phase: 'livraison', owner: 'finance', weight: 15 },
];

export type Criticality = 'rouge' | 'orange' | 'vert';

export type MissingItem = {
  key: RequirementKey;
  label: string;
  owner: Owner;
  weight: number;
};

export type ProjectCompleteness = {
  project_id: string;
  reference: string;
  code: string | null;
  client_name: string;
  current_phase: Phase;
  chef_name: string | null;
  missing: MissingItem[];
  total_required: number;
  total_present: number;
  weight_required: number;
  weight_present: number;
  score: number;        // 0-100 pondéré par weight
  criticality: Criticality;
};

function criticalityFromScore(score: number): Criticality {
  if (score >= 80) return 'vert';
  if (score >= 50) return 'orange';
  return 'rouge';
}

/** Renvoie la liste des Requirements applicables à un projet selon sa phase. */
export function applicableRequirements(phase: Phase): Requirement[] {
  const cur = PHASE_ORDER[phase];
  return REQUIREMENTS.filter(r => PHASE_ORDER[r.phase] <= cur);
}

type ProjectRow = {
  id: string;
  reference: string;
  code: string | null;
  current_phase: Phase;
  status: string;
  is_preparation: boolean | null;
  legacy_imported: boolean | null;
  compromis_date: string | null;
  acte_authentique_date: string | null;
  travaux_adresse_chantier: string | null;
  water_contract_number: string | null;
  electricity_contract_number: string | null;
  property_id: string | null;
  assigned_chef_projet: string | null;
  client: { id: string; full_name: string | null } | null;
  property: { id: string; estimated_rent: number | null } | null;
};

/**
 * Calcule la complétude pour TOUS les projets in-scope (ou pour un projet
 * spécifique si projectId est fourni). Conçu pour zéro N+1 : ~7 SELECT
 * batch quelle que soit la volumétrie.
 *
 * @param projectId — si fourni, calcule uniquement pour ce projet
 * @param includeHistorical — CEO 2026-06-19 : si true, inclut aussi les phases
 *   `mise_en_location` et `termine` (utile pour vérifier la complétude
 *   rétroactive des dossiers livrés / en gestion).
 */
export async function computeProjectCompleteness(
  projectId?: string,
  includeHistorical: boolean = false,
): Promise<ProjectCompleteness[]> {
  const supabase = createClient();

  // Phases à inclure dans le scope
  const phasesInScope = includeHistorical
    ? ['onboarding', 'sourcing', 'design', 'travaux', 'livraison', 'mise_en_location', 'termine']
    : ['onboarding', 'sourcing', 'design', 'travaux', 'livraison'];

  // ── 1) Projets in-scope + relations client/property ──────────────────
  let q = supabase.from('projects').select(`
    id, reference, code, current_phase, status, is_preparation, legacy_imported,
    compromis_date, acte_authentique_date, travaux_adresse_chantier,
    water_contract_number, electricity_contract_number, property_id, assigned_chef_projet,
    client:clients(id, full_name),
    property:properties(id, estimated_rent)
  `)
    .is('deleted_at', null)
    .in('status', ['actif', 'pause'])
    .eq('is_preparation', false)
    .eq('legacy_imported', false)
    .in('current_phase', phasesInScope);

  if (projectId) q = q.eq('id', projectId);

  const { data: projectsRaw } = await q;
  const projects = (projectsRaw ?? []) as unknown as ProjectRow[];
  if (projects.length === 0) return [];

  const ids = projects.map(p => p.id);
  const chefIds = Array.from(new Set(projects.map(p => p.assigned_chef_projet).filter(Boolean) as string[]));

  // ── 2) Chefs de projet (profiles) ────────────────────────────────────
  const chefName = new Map<string, string>();
  if (chefIds.length > 0) {
    const { data: chefs } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', chefIds);
    for (const c of (chefs ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (c.full_name) chefName.set(c.id, c.full_name);
    }
  }

  // ── 3) Documents agrégés par project_id + type + validation ──────────
  const { data: docs } = await supabase
    .from('documents')
    .select('project_id, type, client_validation_status, status, requires_client_validation')
    .in('project_id', ids)
    .is('deleted_at', null);

  type DocAgg = {
    typesPresent: Set<string>;
    typesValidatedByClient: Set<string>;
    typesRequiringValidation: Set<string>;
  };
  const docByProject = new Map<string, DocAgg>();
  for (const d of (docs ?? []) as Array<{ project_id: string; type: string; client_validation_status: string | null; status: string | null; requires_client_validation: boolean | null }>) {
    let agg = docByProject.get(d.project_id);
    if (!agg) { agg = { typesPresent: new Set(), typesValidatedByClient: new Set(), typesRequiringValidation: new Set() }; docByProject.set(d.project_id, agg); }
    agg.typesPresent.add(d.type);
    if (d.client_validation_status === 'validated') agg.typesValidatedByClient.add(d.type);
    if (d.requires_client_validation === true) agg.typesRequiringValidation.add(d.type);
  }

  // ── 4) Paiements (honoraires & acompte) par project_id + type + status ─
  const { data: pays } = await supabase
    .from('payments')
    .select('project_id, type, status')
    .in('project_id', ids)
    .is('deleted_at', null);
  const paidTypes = new Map<string, Set<string>>();
  for (const p of (pays ?? []) as Array<{ project_id: string; type: string; status: string }>) {
    if (p.status !== 'paid') continue;
    let set = paidTypes.get(p.project_id);
    if (!set) { set = new Set(); paidTypes.set(p.project_id, set); }
    set.add(p.type);
  }

  // ── 5) Lots travaux (≥1) par project_id ──────────────────────────────
  const { data: lots } = await supabase
    .from('travaux_lots')
    .select('project_id')
    .in('project_id', ids)
    .is('deleted_at', null);
  const hasLot = new Set<string>();
  for (const l of (lots ?? []) as Array<{ project_id: string }>) hasLot.add(l.project_id);

  // ── 6) Briefs (cahier des charges) validés ───────────────────────────
  const { data: briefs } = await supabase
    .from('project_briefs')
    .select('project_id, status')
    .in('project_id', ids);
  const cdcValidated = new Set<string>();
  for (const b of (briefs ?? []) as Array<{ project_id: string; status: string | null }>) {
    if (b.status === 'validated' || b.status === 'sent_to_client') cdcValidated.add(b.project_id);
  }

  // ── 7) Moodboard choices validés ─────────────────────────────────────
  const { data: mbs } = await supabase
    .from('project_moodboard_choices')
    .select('project_id, status, validated_by_client_at')
    .in('project_id', ids);
  const moodboardOk = new Set<string>();
  for (const m of (mbs ?? []) as Array<{ project_id: string; status: string | null; validated_by_client_at: string | null }>) {
    if (m.validated_by_client_at || m.status === 'validated') moodboardOk.add(m.project_id);
  }

  // ── 8) PV de livraison signés ────────────────────────────────────────
  // La table project_reception_pvs existe ; on considère qu'un PV est OK
  // dès qu'au moins un PV non-deleted existe pour le projet (la signature
  // client est tracée via les items individuels — pour V1 stricte on prend
  // l'existence du PV comme proxy minimal).
  const { data: pvs } = await supabase
    .from('project_reception_pvs')
    .select('project_id')
    .in('project_id', ids);
  const pvOk = new Set<string>();
  for (const p of (pvs ?? []) as Array<{ project_id: string }>) pvOk.add(p.project_id);

  // ── 9) Photos chantier (≥1) ──────────────────────────────────────────
  const { data: photos } = await supabase
    .from('project_photos')
    .select('project_id')
    .in('project_id', ids);
  const hasPhoto = new Set<string>();
  for (const ph of (photos ?? []) as Array<{ project_id: string }>) hasPhoto.add(ph.project_id);

  // ── Évaluation ───────────────────────────────────────────────────────
  const results: ProjectCompleteness[] = [];

  for (const p of projects) {
    const reqs = applicableRequirements(p.current_phase);
    const docs = docByProject.get(p.id) ?? {
      typesPresent: new Set<string>(),
      typesValidatedByClient: new Set<string>(),
      typesRequiringValidation: new Set<string>(),
    };
    const paid = paidTypes.get(p.id) ?? new Set<string>();

    const missing: MissingItem[] = [];
    let weight_required = 0;
    let weight_present = 0;
    let total_present = 0;

    for (const r of reqs) {
      weight_required += r.weight;
      const ok = checkRequirement(r.key, p, { docs, paid, hasLot, cdcValidated, moodboardOk, pvOk, hasPhoto });
      if (ok) {
        weight_present += r.weight;
        total_present += 1;
      } else {
        missing.push({ key: r.key, label: r.label, owner: r.owner, weight: r.weight });
      }
    }

    const score = weight_required === 0 ? 100 : Math.round((weight_present / weight_required) * 100);
    results.push({
      project_id: p.id,
      reference: p.reference,
      code: p.code,
      client_name: p.client?.full_name ?? '(client inconnu)',
      current_phase: p.current_phase,
      chef_name: p.assigned_chef_projet ? (chefName.get(p.assigned_chef_projet) ?? null) : null,
      missing,
      total_required: reqs.length,
      total_present,
      weight_required,
      weight_present,
      score,
      criticality: criticalityFromScore(score),
    });
  }

  return results.sort((a, b) => {
    const order = { rouge: 0, orange: 1, vert: 2 } as const;
    if (order[a.criticality] !== order[b.criticality]) return order[a.criticality] - order[b.criticality];
    return a.score - b.score;
  });
}

type CheckContext = {
  docs: {
    typesPresent: Set<string>;
    typesValidatedByClient: Set<string>;
    typesRequiringValidation: Set<string>;
  };
  paid: Set<string>;
  hasLot: Set<string>;
  cdcValidated: Set<string>;
  moodboardOk: Set<string>;
  pvOk: Set<string>;
  hasPhoto: Set<string>;
};

function checkRequirement(
  key: RequirementKey,
  p: ProjectRow,
  ctx: CheckContext,
): boolean {
  const { docs, paid } = ctx;
  switch (key) {
    case 'cdc_validated':
      return ctx.cdcValidated.has(p.id);
    case 'property_selected':
      return Boolean(p.property_id);
    case 'property_simulation':
      // Proxy : le bien lié doit avoir estimated_rent renseigné
      return Boolean(p.property?.estimated_rent && p.property.estimated_rent > 0);

    // Compromis
    case 'compromis_date_set':
      return Boolean(p.compromis_date);
    case 'compromis_doc':
      return docs.typesPresent.has('compromis');
    case 'acompte_stoniz_paid':
      return paid.has('acompte_stoniz');
    case 'honoraires_compromis_paid':
      return paid.has('honoraires_compromis');

    // Acte authentique
    case 'acte_authentique_date_set':
      return Boolean(p.acte_authentique_date);
    case 'titre_foncier_doc':
      return docs.typesPresent.has('titre_foncier');

    // Design
    // CEO 2026-06-23 — Bug Mamoun Zidouh : alignement V1 sur la fiche projet.
    // Pour les docs "validables client", on considère le doc présent dès qu'il
    // est uploadé, SAUF si validation explicitement requise et non encore signée.
    // Avant : exigeait validated OR (présent ET moodboard validé) → 8 faux négatifs.
    case 'plans_3d_validated':
      return isDocPresentAndUnblocked('plans_3d', docs);
    case 'moodboard_validated':
      return ctx.moodboardOk.has(p.id);
    case 'honoraires_3d_paid':
      return paid.has('honoraires_3d');

    // Lots techniques + BET + shopping list
    case 'lots_techniques_validated':
      return isDocPresentAndUnblocked('lots_techniques', docs);
    case 'bet_doc':
      return docs.typesPresent.has('plan_bet'); // type BDD = 'plan_bet'
    case 'shopping_list_validated':
      return isDocPresentAndUnblocked('shopping_list', docs);

    // Chantier
    case 'devis_travaux_validated':
      return isDocPresentAndUnblocked('devis_travaux', docs)
        || docs.typesPresent.has('devis_artisan');
    case 'permis_travaux_doc':
      return docs.typesPresent.has('permis_travaux') || docs.typesPresent.has('autorisation_travaux');
    case 'adresse_chantier':
      return Boolean(p.travaux_adresse_chantier && p.travaux_adresse_chantier.trim().length > 0);
    case 'travaux_lot_created':
      return ctx.hasLot.has(p.id);
    case 'water_contract_number':
      return Boolean(p.water_contract_number && p.water_contract_number.trim().length > 0)
        || docs.typesPresent.has('contrat_eau');
    case 'electricity_contract_number':
      return Boolean(p.electricity_contract_number && p.electricity_contract_number.trim().length > 0)
        || docs.typesPresent.has('contrat_electricite');
    case 'honoraires_chantier_paid':
      return paid.has('honoraires_chantier');

    // Livraison
    case 'pv_livraison_signed':
      return ctx.pvOk.has(p.id);
    case 'photos_chantier':
      return ctx.hasPhoto.has(p.id);
    case 'honoraires_livraison_paid':
      return paid.has('honoraires_livraison');
  }
}

// ─── Helpers d'agrégation ──────────────────────────────────────────────

export function aggregateByOwner(rows: ProjectCompleteness[]): Record<Owner, number> {
  const out: Record<Owner, number> = { chef_projet: 0, sourcing: 0, finance: 0, client: 0, assistante: 0 };
  for (const r of rows) {
    for (const m of r.missing) out[m.owner] = (out[m.owner] ?? 0) + 1;
  }
  return out;
}

export function topMissingItems(
  rows: ProjectCompleteness[],
  topN: number,
): Array<{ key: RequirementKey; label: string; count: number }> {
  const map = new Map<RequirementKey, { label: string; count: number }>();
  for (const r of rows) {
    for (const m of r.missing) {
      const cur = map.get(m.key);
      if (cur) cur.count += 1;
      else map.set(m.key, { label: m.label, count: 1 });
    }
  }
  return Array.from(map.entries())
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export function topChefsWithDebt(
  rows: ProjectCompleteness[],
  topN: number,
): Array<{ chef: string; missingTotal: number; projectsCount: number }> {
  const map = new Map<string, { missingTotal: number; projectsCount: number }>();
  for (const r of rows) {
    const chef = r.chef_name ?? '(non assigné)';
    const cur = map.get(chef) ?? { missingTotal: 0, projectsCount: 0 };
    cur.missingTotal += r.missing.length;
    cur.projectsCount += 1;
    map.set(chef, cur);
  }
  return Array.from(map.entries())
    .map(([chef, v]) => ({ chef, ...v }))
    .sort((a, b) => b.missingTotal - a.missingTotal)
    .slice(0, topN);
}

export function topPhasesWithDebt(
  rows: ProjectCompleteness[],
): Array<{ phase: Phase; missingTotal: number; projectsCount: number; avgScore: number }> {
  const map = new Map<Phase, { missingTotal: number; projectsCount: number; scoreSum: number }>();
  for (const r of rows) {
    const cur = map.get(r.current_phase) ?? { missingTotal: 0, projectsCount: 0, scoreSum: 0 };
    cur.missingTotal += r.missing.length;
    cur.projectsCount += 1;
    cur.scoreSum += r.score;
    map.set(r.current_phase, cur);
  }
  return Array.from(map.entries())
    .map(([phase, v]) => ({
      phase,
      missingTotal: v.missingTotal,
      projectsCount: v.projectsCount,
      avgScore: v.projectsCount > 0 ? Math.round(v.scoreSum / v.projectsCount) : 0,
    }))
    .sort((a, b) => b.missingTotal - a.missingTotal);
}

export const OWNER_LABELS: Record<Owner, string> = {
  chef_projet: 'Chef de projet',
  sourcing: 'Sourcing',
  finance: 'Finance',
  client: 'Client',
  assistante: 'Assistante',
};

export const PHASE_LABELS: Record<Phase, string> = {
  onboarding: 'Onboarding',
  sourcing: 'Sourcing',
  design: 'Design 3D',
  travaux: 'Travaux',
  livraison: 'Livraison',
  mise_en_location: 'Mise en location',
  termine: 'Terminé',
};

export type { Phase };
