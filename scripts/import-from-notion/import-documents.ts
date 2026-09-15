/**
 * Import des documents (PDFs / images) depuis Notion CLIENTS files fields
 * vers Supabase Storage + INSERT dans la table `documents`.
 *
 * USAGE :
 *   npx tsx scripts/import-from-notion/import-documents.ts --dry-run
 *   npx tsx scripts/import-from-notion/import-documents.ts --limit=3
 *   npx tsx scripts/import-from-notion/import-documents.ts
 *
 * Pré-requis : import-clients-projects.ts terminé (les projets doivent
 * exister avec leur notion_page_id pour qu'on puisse résoudre project_id).
 *
 * Bucket : "documents" (à créer dans Supabase Dashboard > Storage si
 * absent). Le script vérifie l'existence et échoue tôt si absent.
 *
 * Idempotence : skip si un document avec le même storage_path existe déjà.
 * Le storage_path est déterministe (basé sur project_id + type + filename).
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { fetchAllRows } from './notion-client';
import {
  buildSupabaseAdmin,
  lookupIdByNotionPageId,
  documentExistsAtPath,
  uploadFileFromUrl,
} from './supabase-client';
import type { SupabaseAdmin } from './supabase-client';
import { notionTitle, notionFiles } from './transform-helpers';
import type { NotionFile } from './transform-helpers';
import { NOTION_DB_IDS } from './notion-mapping';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;

const STORAGE_BUCKET = 'documents';

// Mapping champ Notion → type document Supabase
// Note : le compteur eau/électricité Notion est un champ unique mais devrait
// idéalement créer 2 documents (eau ET électricité). Pour simplifier, on le
// classe en `contrat_eau` (l'équipe pourra dupliquer si besoin).
const NOTION_FILE_FIELDS: Array<{ notion: string; docType: string }> = [
  { notion: 'Pièce d\'identité',            docType: 'piece_identite' },
  { notion: 'CIN',                           docType: 'cin' },
  { notion: 'Contrat ',                      docType: 'contrat_mission' },
  { notion: 'Compromis ',                    docType: 'compromis' },
  { notion: 'Titre foncier',                 docType: 'titre_foncier' },
  { notion: 'Autorisation travaux',          docType: 'autorisation_travaux' },
  { notion: 'Dossier Architecture',          docType: 'dossier_architecture' },
  { notion: 'Scan procuration',              docType: 'procuration' },
  { notion: 'demande de permis',             docType: 'permis_travaux' },
  { notion: 'Compteurs eau et electricité ', docType: 'contrat_eau' },
];

/**
 * Nettoie un nom de fichier pour le rendre safe pour Supabase Storage.
 * - Retire les caractères non ASCII problématiques
 * - Remplace les espaces par des underscores
 * - Garde l'extension
 */
function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire accents
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 200);
}

/**
 * Récupère l'ID du CEO (premier super-admin actif) à utiliser comme
 * `uploaded_by` pour les documents importés.
 */
async function getCeoProfileId(admin: SupabaseAdmin): Promise<string | null> {
  const url = `${admin.url}/rest/v1/profiles?is_super_admin=eq.true&is_active=eq.true&select=id&order=created_at.asc&limit=1`;
  const response = await fetch(url, {
    headers: { apikey: admin.key, Authorization: `Bearer ${admin.key}` },
  });
  if (!response.ok) return null;
  const arr = await response.json();
  return Array.isArray(arr) && arr[0]?.id ? arr[0].id : null;
}

/**
 * Insère une row dans documents avec storage_path et metadata.
 */
async function insertDocumentRow(
  admin: SupabaseAdmin,
  projectId: string,
  docType: string,
  filename: string,
  storagePath: string,
  uploadedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const payload = {
    project_id:       projectId,
    type:             docType,
    name:             filename,
    storage_path:     storagePath,
    is_internal:      false,           // visible côté client (prep migration column)
    uploaded_by:      uploadedBy,
    uploaded_by_role: 'stoniz',        // NOT NULL : 'stoniz' ou 'client'
  };
  const url = `${admin.url}/rest/v1/documents`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey':        admin.key,
      'Authorization': `Bearer ${admin.key}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    return { ok: false, error: `INSERT documents ${response.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

async function main() {
  console.log(`[import-documents] start ${isDryRun ? '(DRY-RUN)' : '(LIVE)'}${limit ? ` limit=${limit}` : ''}`);

  const admin = buildSupabaseAdmin();

  // Récupère l'ID du CEO pour uploaded_by (column NOT NULL)
  const ceoProfileId = isDryRun ? 'dry-run-placeholder' : await getCeoProfileId(admin);
  if (!ceoProfileId) {
    throw new Error('Aucun super-admin actif trouvé dans profiles — impossible de remplir uploaded_by');
  }
  if (!isDryRun) {
    console.log(`[import-documents] uploaded_by = ${ceoProfileId} (CEO)`);
  }

  const rows = await fetchAllRows(NOTION_DB_IDS.clients, { maxRows: limit });
  console.log(`[import-documents] ${rows.length} rows lus depuis Notion`);

  let docsUploaded = 0;
  let docsSkippedExisting = 0;
  let docsDownloadFailed = 0;
  let docsUploadFailed = 0;
  let docsInsertFailed = 0;
  let rowsProcessed = 0;
  let rowsSkippedNoProject = 0;
  let rowsSkippedNoFiles = 0;
  let totalBytesUploaded = 0;
  const warnings: string[] = [];

  for (const row of rows) {
    const fullName = notionTitle(row, 'Name') ?? '(sans nom)';

    // Résoudre project_id via notion_page_id de la row CLIENTS
    const projectId = await lookupIdByNotionPageId(admin, 'projects', row.id);
    if (!projectId) {
      rowsSkippedNoProject++;
      continue;
    }

    // Collecte tous les fichiers de cette row
    type FileWithMeta = { file: NotionFile; docType: string };
    const allFiles: FileWithMeta[] = [];
    for (const { notion: fieldName, docType } of NOTION_FILE_FIELDS) {
      const files = notionFiles(row, fieldName);
      for (const f of files) {
        allFiles.push({ file: f, docType });
      }
    }

    if (allFiles.length === 0) {
      rowsSkippedNoFiles++;
      continue;
    }

    rowsProcessed++;
    console.log(`[doc] ${fullName} (project=${projectId.slice(0, 8)}) : ${allFiles.length} fichiers détectés`);

    for (const { file, docType } of allFiles) {
      const safeName = sanitizeFilename(file.name);
      const storagePath = `${projectId}/${docType}_${safeName}`;

      // Idempotence : skip si déjà uploadé
      if (!isDryRun) {
        const exists = await documentExistsAtPath(admin, storagePath);
        if (exists) {
          docsSkippedExisting++;
          continue;
        }
      }

      if (isDryRun) {
        console.log(`  [DRY] ${docType} : ${safeName} → ${storagePath}`);
        docsUploaded++;
        continue;
      }

      // Upload
      const uploadResult = await uploadFileFromUrl(admin, STORAGE_BUCKET, storagePath, file.url);
      if (!uploadResult.ok) {
        if (uploadResult.error.startsWith('download')) {
          docsDownloadFailed++;
        } else {
          docsUploadFailed++;
        }
        warnings.push(`${fullName} / ${docType} / ${safeName} : ${uploadResult.error}`);
        continue;
      }
      totalBytesUploaded += uploadResult.size;

      // INSERT row
      const insertResult = await insertDocumentRow(admin, projectId, docType, file.name, storagePath, ceoProfileId);
      if (!insertResult.ok) {
        docsInsertFailed++;
        warnings.push(`${fullName} / ${docType} / ${safeName} : ${insertResult.error}`);
        continue;
      }

      docsUploaded++;
    }
  }

  const summary = {
    db: 'documents',
    mode: isDryRun ? 'dry-run' : 'live',
    rows_read: rows.length,
    rows_processed: rowsProcessed,
    rows_skipped_no_project: rowsSkippedNoProject,
    rows_skipped_no_files: rowsSkippedNoFiles,
    docs_uploaded: docsUploaded,
    docs_skipped_existing: docsSkippedExisting,
    docs_download_failed: docsDownloadFailed,
    docs_upload_failed: docsUploadFailed,
    docs_insert_failed: docsInsertFailed,
    total_mb_uploaded: Math.round((totalBytesUploaded / (1024 * 1024)) * 10) / 10,
    warnings: warnings.slice(0, 30),
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error('[import-documents] FATAL:', err);
  process.exit(1);
});
