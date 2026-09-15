/**
 * Import des partenaires depuis Notion PARTENAIRES → Supabase `partners`.
 *
 * USAGE :
 *   npx tsx scripts/import-from-notion/import-partners.ts --dry-run
 *   npx tsx scripts/import-from-notion/import-partners.ts --limit=3
 *   npx tsx scripts/import-from-notion/import-partners.ts        # import complet
 *
 * VARIABLES D'ENVIRONNEMENT REQUISES (mets-les dans .env.local) :
 *   NOTION_TOKEN
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Le script charge .env.local automatiquement via dotenv si présent.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { fetchAllRows } from './notion-client';
import { buildSupabaseAdmin, upsertByNotionPageId } from './supabase-client';
import {
  notionTitle, notionRichText, notionSelect, notionStatus,
  notionPhone, notionDate, notionCheckbox, mapEnum,
} from './transform-helpers';
import {
  NOTION_DB_IDS,
  NOTION_PARTNER_STATUS,
  NOTION_PARTNER_CONTRACT_SIGNED,
  NOTION_EVAL_TO_INT,
} from './notion-mapping';

// ─── Parse CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[import-partners] start ${isDryRun ? '(DRY-RUN)' : '(LIVE)'}${limit ? ` limit=${limit}` : ''}`);

  const admin  = isDryRun ? null : buildSupabaseAdmin();

  const rows = await fetchAllRows(NOTION_DB_IDS.partners, { maxRows: limit });
  console.log(`[import-partners] ${rows.length} rows lus depuis Notion`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const warnings: string[] = [];

  for (const row of rows) {
    const agencyName = notionTitle(row, 'Nom de l\'agence');
    if (!agencyName) {
      skipped++;
      warnings.push(`Page ${row.id} ignorée : Nom de l'agence vide`);
      continue;
    }

    const phone        = notionPhone(row, 'Téléphone');
    const contactName  = notionRichText(row, 'Contact principal');
    const statusRaw    = notionStatus(row, 'Statut');
    const evalRaw      = notionSelect(row, 'Evaluation interne');
    const hasWhatsapp  = notionCheckbox(row, 'Groupe créé');
    const lastContact  = notionDate(row, 'Dernier contact');

    // contract_signed PAS importé : flow de signature partenaire non géré
    // côté ERP, la valeur DB par défaut (false) s'applique. À gérer
    // manuellement plus tard si le flow est construit.
    const payload = {
      notion_page_id:    row.id,
      agency_name:       agencyName,
      phone:             phone,
      contact_name:      contactName,
      status:            mapEnum(statusRaw, NOTION_PARTNER_STATUS, 'prospect', `partners.status (page=${row.id})`),
      has_whatsapp_group: hasWhatsapp,
      evaluation:        evalRaw ? (NOTION_EVAL_TO_INT[evalRaw] ?? null) : null,
      last_contact_at:   lastContact,
      // assigned_to, address, quartiers_covered, email : pas dans Notion
    };

    if (isDryRun) {
      console.log(`[DRY] ${agencyName} → ${JSON.stringify(payload, null, 0)}`);
      created++;
      continue;
    }

    const result = await upsertByNotionPageId(admin!, 'partners', payload);
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
    db: 'partners',
    mode: isDryRun ? 'dry-run' : 'live',
    total_read: rows.length,
    created,
    updated,
    skipped,
    errors,
    warnings: warnings.slice(0, 20),
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[import-partners] FATAL:', err);
  process.exit(1);
});
