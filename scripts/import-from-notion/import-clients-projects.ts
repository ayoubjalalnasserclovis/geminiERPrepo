/**
 * Import couplé clients + projects depuis Notion CLIENTS.
 *
 * Un row Notion CLIENTS génère 2 records Supabase :
 *   1. clients (full_name, email, phone, prefs, nationality, etc.)
 *   2. projects (is_preparation=true, client_id, property_id, dates, fees)
 *
 * Puis appel à advance_project_phase pour positionner chaque projet à sa
 * phase courante (mapping Status Notion → phase Supabase). Comme tous les
 * projets sont en is_preparation=true, le bypass de gates kicke et la
 * transition passe quelle que soit la complétude des données.
 *
 * USAGE :
 *   npx tsx scripts/import-from-notion/import-clients-projects.ts --dry-run
 *   npx tsx scripts/import-from-notion/import-clients-projects.ts --limit=3
 *   npx tsx scripts/import-from-notion/import-clients-projects.ts
 *
 * Pré-requis : import-properties.ts terminé (pour résoudre Bien sélectionné).
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { fetchAllRows } from './notion-client';
import { buildSupabaseAdmin, upsertByNotionPageId, lookupIdByNotionPageId, lookupIdByColumn } from './supabase-client';
import type { SupabaseAdmin } from './supabase-client';
import {
  notionTitle, notionRichText, notionSelect, notionMultiSelect,
  notionNumber, notionCheckbox, notionDate, notionEmail, notionPhone,
  notionRelationIds, mapEnum,
} from './transform-helpers';
import {
  NOTION_DB_IDS,
  NOTION_STATUS_TO_PHASE,
  NOTION_SIGNATURE_MODE,
  NOTION_CREDIT_TYPE,
} from './notion-mapping';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

const PHASE_ORDER = ['onboarding','sourcing','design','travaux','livraison','mise_en_location','termine'] as const;
type Phase = typeof PHASE_ORDER[number];

/**
 * Pour les projets en statut "Perdu" ou "En pause", on déduit la phase
 * la plus avancée atteinte avant la sortie en fonction des dates remplies.
 */
function deducePhaseFromDates(dates: {
  onboarding: string | null;
  compromis: string | null;
  acte: string | null;
  travaux_start: string | null;
  travaux_end: string | null;
  livraison: string | null;
}): Phase {
  if (dates.livraison) return 'livraison';
  if (dates.travaux_end) return 'livraison';
  if (dates.travaux_start) return 'travaux';
  if (dates.acte) return 'travaux';
  if (dates.compromis) return 'design';
  if (dates.onboarding) return 'sourcing';
  return 'onboarding';
}

/**
 * Renvoie l'index d'une phase dans l'ordre.
 */
function phaseIdx(p: string): number {
  return PHASE_ORDER.indexOf(p as Phase);
}

/**
 * Appelle la RPC advance_project_phase pour avancer un projet d'une phase.
 * Idempotent : si on essaie d'avancer vers une phase déjà atteinte, log et skip.
 */
async function advanceProjectPhase(
  admin: SupabaseAdmin,
  projectId: string,
  newPhase: Phase,
): Promise<{ ok: boolean; bypassed?: boolean; error?: string }> {
  const url = `${admin.url}/rest/v1/rpc/advance_project_phase`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': admin.key,
      'Authorization': `Bearer ${admin.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_project_id: projectId,
      p_new_phase: newPhase,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.message ?? j.error ?? text;
    } catch {}
    return { ok: false, error: msg };
  }
  let result: any = {};
  try { result = JSON.parse(text); } catch {}
  return { ok: true, bypassed: !!result?.bypassed };
}

/**
 * Avance un projet phase par phase jusqu'à atteindre la phase cible.
 */
async function advanceToPhase(
  admin: SupabaseAdmin,
  projectId: string,
  currentPhase: string,
  targetPhase: Phase,
): Promise<{ ok: boolean; jumps: number; errors: string[] }> {
  const errors: string[] = [];
  let jumps = 0;
  let phase = currentPhase;

  while (phaseIdx(phase) < phaseIdx(targetPhase)) {
    const next = PHASE_ORDER[phaseIdx(phase) + 1];
    const r = await advanceProjectPhase(admin, projectId, next);
    if (!r.ok) {
      errors.push(`${phase} → ${next} : ${r.error}`);
      return { ok: false, jumps, errors };
    }
    jumps++;
    phase = next;
  }
  return { ok: true, jumps, errors };
}

/**
 * Convertit la valeur Notion Budget (select texte) en (budget_min, budget_max).
 * Format probable : "200k-300k", "400 000 - 500 000", "Sup. à 500k", etc.
 * Si on ne sait pas parser, retourne null/null.
 */
function parseBudget(raw: string | null): { min: number | null; max: number | null } {
  if (!raw) return { min: null, max: null };
  const s = raw.replace(/\s+/g, '').replace(/[€$]/g, '').toLowerCase();
  // Pattern "XXXk-YYYk" ou "XXX-YYY"
  const range = s.match(/^(\d+)k?-(\d+)k?$/);
  if (range) {
    const a = parseInt(range[1], 10) * (s.includes('k') ? 1000 : 1);
    const b = parseInt(range[2], 10) * (s.includes('k') ? 1000 : 1);
    return { min: a, max: b };
  }
  // Pattern "Sup à XXXk" ou ">XXXk"
  const sup = s.match(/^(?:sup|sup\.|>)?[à>]?(\d+)k?$/);
  if (sup) {
    const v = parseInt(sup[1], 10) * (s.includes('k') ? 1000 : 1);
    return { min: v, max: null };
  }
  return { min: null, max: null };
}

async function main() {
  console.log(`[import-clients-projects] start ${isDryRun ? '(DRY-RUN)' : '(LIVE)'}${limit ? ` limit=${limit}` : ''}`);

  const admin = isDryRun ? null : buildSupabaseAdmin();

  const rows = await fetchAllRows(NOTION_DB_IDS.clients, { maxRows: limit });
  console.log(`[import-clients-projects] ${rows.length} rows lus depuis Notion`);

  let clientsCreated = 0;
  let clientsUpdated = 0;
  let projectsCreated = 0;
  let projectsUpdated = 0;
  let phaseAdvanced = 0;
  let phaseErrors = 0;
  let propertyResolved = 0;
  let propertyMissing = 0;
  let emailsGenerated = 0;
  let skipped = 0;
  let errors = 0;
  const warnings: string[] = [];

  for (const row of rows) {
    try {
      await processRow(row);
    } catch (err: any) {
      errors++;
      warnings.push(`Page ${row.id} : exception non gérée → ${err?.message ?? err}`);
    }
  }

  async function processRow(row: any) {
    const fullName = notionTitle(row, 'Name');
    if (!fullName) {
      skipped++;
      warnings.push(`Page ${row.id} ignorée : Name vide`);
      return;
    }

    // Skip explicite des entrées de test (Name contient "test" case-insensitive)
    if (/\btest\b/i.test(fullName)) {
      skipped++;
      warnings.push(`Page ${row.id} (${fullName}) ignorée : entrée de test`);
      return;
    }

    // ─── Données client ────────────────────────────────────────────────────
    const email           = notionEmail(row, 'Email');
    const phone           = notionPhone(row, 'Phone Number');
    const onboardingDate  = notionDate(row, 'Date d\'onboarding');
    const compromisDate   = notionDate(row, 'Signature compromis');
    const acteDate        = notionDate(row, 'Signature acte authentique');
    const livraisonDate   = notionDate(row, 'Livraison Chantier');
    const savings         = notionNumber(row, 'Épargne disponible');
    const feesService     = notionNumber(row, 'Frais de service');
    const reductionClient = notionNumber(row, 'Réduction client');
    const biensPresentes  = notionNumber(row, 'Biens présentés');
    const offres          = notionNumber(row, 'Offres ');
    const budgetRaw       = notionSelect(row, 'Budget');
    const typeBienPref    = notionSelect(row, 'Type de bien ');
    const locPrefs        = notionMultiSelect(row, 'Localisation');
    const specs           = notionRichText(row, 'Spécificités');
    const comments        = notionRichText(row, 'Commentaires');
    const creditRaw       = notionSelect(row, 'Crédit');
    const signModeRaw     = notionSelect(row, 'Mode de signature');
    const procuration     = notionSelect(row, 'Procuration');
    const procurationOK   = notionCheckbox(row, 'Procuration récupérée');
    const marocain        = notionSelect(row, 'Marocain');
    const statusRaw       = notionSelect(row, 'Status');

    const budget = parseBudget(budgetRaw);

    // Email manquant : on génère un placeholder reconnaissable et UNIQUE.
    // Le CEO le remplacera par le vrai email au moment de l'activation client.
    // Pattern : import-<uuid sans tirets>@no-email.stoniz.local
    // On utilise le notion_page_id complet pour garantir l'unicité (les 8
    // premiers chars d'une page Notion sont souvent partagés entre pages).
    let effectiveEmail = email;
    let emailWasGenerated = false;
    if (!effectiveEmail) {
      const uniqueId = row.id.replace(/-/g, '');
      effectiveEmail = `import-${uniqueId}@no-email.stoniz.local`;
      emailWasGenerated = true;
    }

    const clientPayload = {
      notion_page_id:                row.id,
      full_name:                     fullName,
      email:                         effectiveEmail,
      phone:                         phone,
      nationality:                   marocain === 'Marocain' ? 'MA' : null,
      budget_min:                    budget.min,
      budget_max:                    budget.max,
      available_savings:             savings,
      credit_type:                   mapEnum(creditRaw, NOTION_CREDIT_TYPE, null, `clients.credit_type (page=${row.id})`),
      has_procuration:               !!procurationOK,
      signature_mode:                mapEnum(signModeRaw, NOTION_SIGNATURE_MODE, null, `clients.signature_mode (page=${row.id})`),
      location_preferences:          locPrefs,
      property_type_preferences:     typeBienPref ? [typeBienPref] : [],
      specificities:                 specs,
      comments:                      comments,
    };

    if (emailWasGenerated) {
      emailsGenerated++;
    }

    if (isDryRun) {
      console.log(`[DRY] ${fullName} | email=${effectiveEmail}${emailWasGenerated ? ' (PLACEHOLDER)' : ''} | status=${statusRaw} | bien=${notionRelationIds(row, 'Bien sélectionné').length > 0 ? 'oui' : 'non'}`);
      clientsCreated++;
      projectsCreated++;
      return;
    }

    // ─── INSERT/UPDATE client (avec résilience aux doublons email) ─────────
    let clientResult: { id: string; created: boolean } | null = null;
    try {
      clientResult = await upsertByNotionPageId(admin!, 'clients', clientPayload);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      // Cas typique : 2 rows Notion CLIENTS partagent le même email (même
      // client avec 2 projets). On retombe sur le client existant et on lie
      // le nouveau projet à lui.
      if (msg.includes('duplicate') && msg.toLowerCase().includes('email')) {
        const existingId = await lookupIdByColumn(admin!, 'clients', 'email', effectiveEmail);
        if (existingId) {
          clientResult = { id: existingId, created: false };
          clientsUpdated++;
          warnings.push(`Page ${row.id} (${fullName}) : email "${effectiveEmail}" déjà en BDD → liaison au client existant (multi-projets)`);
        } else {
          errors++;
          warnings.push(`Page ${row.id} (${fullName}) : duplicate email mais lookup échoué → row skip`);
          return;
        }
      } else {
        errors++;
        warnings.push(`Page ${row.id} (${fullName}) : erreur INSERT client → ${msg}`);
        return;
      }
    }
    if (!clientResult) {
      errors++;
      return;
    }
    // Compteurs (le multi-projets a déjà comptabilisé clientsUpdated++ ci-dessus)
    if (clientResult.created) {
      clientsCreated++;
    } else if (!(warnings[warnings.length - 1] ?? '').includes('multi-projets')) {
      // évite le double-comptage du compteur multi-projets
      clientsUpdated++;
    }

    // ─── Résolution property_id depuis Bien sélectionné ────────────────────
    let propertyId: string | null = null;
    const selectedPropNotionIds = notionRelationIds(row, 'Bien sélectionné');
    if (selectedPropNotionIds.length > 0) {
      propertyId = await lookupIdByNotionPageId(admin!, 'properties', selectedPropNotionIds[0]);
      if (propertyId) {
        propertyResolved++;
      } else {
        propertyMissing++;
        warnings.push(`Page ${row.id} (${fullName}) : Bien sélectionné Notion "${selectedPropNotionIds[0]}" introuvable côté Supabase`);
      }
    }

    // ─── Mapping Status Notion → (phase, status) ───────────────────────────
    const phaseInfo = statusRaw ? NOTION_STATUS_TO_PHASE[statusRaw] : undefined;
    if (statusRaw && !phaseInfo) {
      warnings.push(`Page ${row.id} (${fullName}) : status Notion "${statusRaw}" inconnu → onboarding/actif par défaut`);
    }

    let targetPhase: Phase = phaseInfo?.phase ?? 'onboarding';
    const targetStatus = phaseInfo?.status ?? 'actif';

    // Si statut = perdu ou pause, la phase Supabase = phase la plus avancée
    // atteinte selon les dates remplies (Notion a perdu cette info)
    if (phaseInfo?.deduceFromDates) {
      targetPhase = deducePhaseFromDates({
        onboarding:    onboardingDate,
        compromis:     compromisDate,
        acte:          acteDate,
        travaux_start: null,
        travaux_end:   livraisonDate,
        livraison:     null,
      });
    }

    // ─── INSERT/UPDATE project (commence toujours en onboarding) ───────────
    const projectPayload = {
      notion_page_id:               row.id, // même notion_page_id que le client (page Notion source unique)
      client_id:                    clientResult.id,
      property_id:                  propertyId,
      is_preparation:               true,
      onboarding_date:              onboardingDate,
      compromis_date:               compromisDate,
      acte_authentique_date:        acteDate,
      // Livraison Chantier Notion = fin des travaux côté Supabase
      travaux_end_date:             livraisonDate,
      stoniz_fees_manual_override:  feesService,
      // stoniz_fees_reduction n'existe pas sur projects — Réduction client
      // Notion non migrée. À ressaisir manuellement par projet si besoin.
      nb_properties_presented:      biensPresentes ?? 0,
      nb_properties_accepted:       offres ?? 0,
      status:                       targetStatus,
      prepared_at:                  new Date().toISOString(),
    };

    const projectResult = await upsertByNotionPageId(admin!, 'projects', projectPayload);
    if (!projectResult) {
      errors++;
      return;
    }
    if (projectResult.created) projectsCreated++; else projectsUpdated++;

    // ─── Avance le projet à la phase cible via la RPC bypass ───────────────
    // Sur ré-exécution, le projet peut être déjà à la phase cible (ou au-delà).
    // On lit l'état actuel pour partir du bon endroit.
    const currentRes = await fetch(
      `${admin!.url}/rest/v1/projects?id=eq.${projectResult.id}&select=current_phase&limit=1`,
      { headers: { apikey: admin!.key, Authorization: `Bearer ${admin!.key}` } },
    );
    const currentArr = await currentRes.json();
    const currentPhase = (Array.isArray(currentArr) && currentArr[0]?.current_phase) || 'onboarding';
    if (phaseIdx(currentPhase) < phaseIdx(targetPhase)) {
      const r = await advanceToPhase(admin!, projectResult.id, currentPhase, targetPhase);
      if (r.ok) {
        phaseAdvanced += r.jumps;
      } else {
        phaseErrors++;
        warnings.push(`Page ${row.id} (${fullName}) : échec avancement phase ${currentPhase}→${targetPhase} → ${r.errors.join(' | ')}`);
      }
    }
  }

  const summary = {
    db: 'clients+projects',
    mode: isDryRun ? 'dry-run' : 'live',
    total_read: rows.length,
    clients_created: clientsCreated,
    clients_updated: clientsUpdated,
    projects_created: projectsCreated,
    projects_updated: projectsUpdated,
    phase_advanced_jumps: phaseAdvanced,
    phase_errors: phaseErrors,
    property_resolved: propertyResolved,
    property_missing: propertyMissing,
    emails_generated_placeholder: emailsGenerated,
    skipped,
    errors,
    warnings: warnings.slice(0, 30),
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[import-clients-projects] FATAL:', err);
  process.exit(1);
});
