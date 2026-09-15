/**
 * Import des biens depuis Notion BIENS → Supabase `properties`.
 *
 * NE GÈRE PAS les médias (vidéos / photos). Ils sont importés par
 * `import-property-media.ts` dans un second temps (L4b), car les uploads
 * Storage sont lents et il vaut mieux tester properties à part.
 *
 * USAGE :
 *   npx tsx scripts/import-from-notion/import-properties.ts --dry-run
 *   npx tsx scripts/import-from-notion/import-properties.ts --limit=3
 *   npx tsx scripts/import-from-notion/import-properties.ts        # import complet
 *
 * Pré-requis : L'import partners (L3) doit être terminé pour que les
 * relations Notion PARTENAIRES soient résolvables en partner_id.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { fetchAllRows } from './notion-client';
import { buildSupabaseAdmin, upsertByNotionPageId, lookupIdByNotionPageId } from './supabase-client';
import {
  notionTitle, notionRichText, notionSelect, notionMultiSelect,
  notionNumber, notionCheckbox, notionDate, notionUrl,
  notionRelationIds, mapEnum,
} from './transform-helpers';
import {
  NOTION_DB_IDS,
  NOTION_PROPERTY_TYPE,
  NOTION_EVAL_TO_INT,
} from './notion-mapping';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

async function main() {
  console.log(`[import-properties] start ${isDryRun ? '(DRY-RUN)' : '(LIVE)'}${limit ? ` limit=${limit}` : ''}`);

  const admin = isDryRun ? null : buildSupabaseAdmin();

  const rows = await fetchAllRows(NOTION_DB_IDS.properties, { maxRows: limit });
  console.log(`[import-properties] ${rows.length} rows lus depuis Notion`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let partnerResolved = 0;
  let partnerMissing = 0;
  const warnings: string[] = [];

  for (const row of rows) {
    const name = notionTitle(row, 'Name');
    if (!name) {
      skipped++;
      warnings.push(`Page ${row.id} ignorée : Name vide`);
      continue;
    }

    // Mapping basique
    const typeRaw       = notionSelect(row, 'Type');
    const quartier      = notionSelect(row, 'Quartier');
    const floor         = notionSelect(row, 'Étage du bien');
    const superficie    = notionNumber(row, 'Superficie');
    const nbSuites      = notionNumber(row, 'Nombre de suites');
    const nbLots        = notionNumber(row, 'Nb de lots dans la résidence');
    const yearBuilt     = notionNumber(row, 'Année de construction de l\'immeuble');
    const exposure      = notionMultiSelect(row, 'Exposition');
    const exterior      = notionMultiSelect(row, 'Exterieur ');
    const hasParking    = notionCheckbox(row, 'Parking');
    const hasElevator   = notionCheckbox(row, 'Ascenceur');
    const gpsUrl        = notionUrl(row, 'GPS');
    const driveUrl      = notionUrl(row, 'Drive');
    const price         = notionNumber(row, 'Prix du bien');
    const estimatedRent = notionNumber(row, 'Loyers');
    const evalRaw       = notionSelect(row, 'Évaluation');
    const reduction     = notionNumber(row, 'Réduction Frais STONIZ');
    const conditions    = notionRichText(row, 'Conditions de l\'offre');
    const lostDate      = notionDate(row, 'Date de la perte');

    // FK partner_id : résolution depuis la relation Notion PARTENAIRES
    let partnerId: string | null = null;
    if (!isDryRun) {
      const partnerNotionIds = notionRelationIds(row, 'PARTENAIRES');
      if (partnerNotionIds.length > 0) {
        // Prend le premier partenaire si plusieurs (la table properties n'en porte qu'un)
        partnerId = await lookupIdByNotionPageId(admin!, 'partners', partnerNotionIds[0]);
        if (partnerId) {
          partnerResolved++;
        } else {
          partnerMissing++;
          warnings.push(`Page ${row.id} (${name}) : partner_id Notion "${partnerNotionIds[0]}" introuvable côté Supabase`);
        }
      }
    }

    // Statut : si date de perte → 'perdu', sinon 'sourcing' (défaut)
    const status = lostDate ? 'perdu' : 'sourcing';

    const payload: Record<string, any> = {
      notion_page_id:           row.id,
      name:                     name,
      type:                     mapEnum(typeRaw, NOTION_PROPERTY_TYPE, null, `properties.type (page=${row.id})`),
      quartier:                 quartier,
      floor:                    floor,
      superficie:               superficie,
      nb_suites:                nbSuites,
      nb_lots_residence:        nbLots,
      year_built:               yearBuilt,
      exposure:                 exposure,
      exterior:                 exterior,
      has_parking:              hasParking,
      has_elevator:             hasElevator,
      google_maps_url:          gpsUrl,
      drive_url:                driveUrl,
      price:                    price,
      estimated_rent:           estimatedRent,
      evaluation:               evalRaw ? (NOTION_EVAL_TO_INT[evalRaw] ?? null) : null,
      stoniz_reduction:         reduction ?? 0,
      conditions_offre:         conditions,
      status:                   status,
      partner_id:               partnerId,
      // lost_at n'existe pas sur properties — la date de perte Notion n'est
      // pas migrée, seul le statut 'perdu' est conservé. La date originale
      // reste accessible côté Notion via notion_page_id si besoin.
    };

    if (isDryRun) {
      // En dry-run, partner_id n'est pas résolu (admin=null). On affiche juste.
      console.log(`[DRY] ${name} → type=${payload.type ?? 'null'} quartier=${quartier ?? 'null'} prix=${price ?? 'null'} statut=${status}`);
      created++;
      continue;
    }

    const result = await upsertByNotionPageId(admin!, 'properties', payload);
    if (!result) {
      errors++;
      continue;
    }
    if (result.created) {
      created++;
    } else {
      updated++;
    }
  }

  const summary = {
    db: 'properties',
    mode: isDryRun ? 'dry-run' : 'live',
    total_read: rows.length,
    created,
    updated,
    skipped,
    errors,
    partner_resolved: partnerResolved,
    partner_missing:  partnerMissing,
    warnings: warnings.slice(0, 20),
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[import-properties] FATAL:', err);
  process.exit(1);
});
