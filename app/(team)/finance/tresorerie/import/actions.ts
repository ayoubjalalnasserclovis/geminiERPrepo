'use server';

import { revalidatePath } from 'next/cache';
import { createHash } from 'crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import {
  parseChaabiXLSX,
  parseChaabiCSV,
  computeDedupHash,
  type ChaabiRawRow,
} from '@/lib/finance/bank-chaabi-parser';
import {
  categorize,
  CATEGORY_LABELS,
  type CategorizationResult,
  type SavedMapping,
} from '@/lib/finance/bank-categorizer';
import { logFinanceAudit, logFinanceAuditBulk } from '@/lib/finance/audit';

/**
 * Server Actions du module d'import bancaire (Chantier 2).
 *
 * Flux :
 *   1. Upload XLSX/CSV → `dryRunImport()` parse + categorize + check doublons
 *      → renvoie un résumé (sans écrire en BDD)
 *   2. CEO/Finance valide ou ajuste les catégorisations
 *   3. `confirmImport()` insère les transactions définitivement +
 *      crée éventuellement un nouveau snapshot de solde
 */

export type DryRunPreview = {
  total_lines: number;
  total_credits_mad: number;
  total_debits_mad: number;
  net_mad: number;
  date_min: string | null;
  date_max: string | null;
  // Détail par ligne
  rows: Array<{
    operation_date: string;
    value_date: string | null;
    label: string;
    reference: string | null;
    debit_mad: number | null;
    credit_mad: number | null;
    is_pending: boolean;
    categorization: CategorizationResult;
    is_duplicate: boolean;     // déjà présente dans bank_transactions
    dedup_hash: string;
  }>;
  // Stats catégorisation
  by_category: Array<{ category: string; count: number; total_mad: number }>;
  unknowns_count: number;
  duplicates_count: number;
  errors: string[];
  // Cohérence
  expected_balance_after?: number | null;  // si solde initial fourni
  // Pour la confirmation
  account_id: string;
  account_label: string;
};

const dryRunSchema = z.object({
  account_id: z.string().uuid(),
  initial_balance: z.string().optional().nullable(),
});

export type DryRunResult =
  | { ok: true; data: DryRunPreview }
  | { ok: false; error: string };

function isNextRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'digest' in e
    && typeof (e as any).digest === 'string'
    && (e as any).digest.startsWith('NEXT_REDIRECT');
}

/**
 * CEO 2026-07-13 : ancienne signature `Promise<DryRunPreview>` avec throw brut
 * remontait en prod comme "An error occurred in the Server Components render"
 * (message stripped). Nabil ne voyait ni la vraie cause ni comment se
 * débloquer. On passe au pattern défensif `{ok, error}` — le composant client
 * affiche le message métier tel quel.
 */
export async function dryRunImport(formData: FormData): Promise<DryRunResult> {
  try {
    await assertRole(['ceo', 'finance']);
    const supabase = createClient();

    const raw: Record<string, any> = {};
    for (const [k, v] of formData.entries()) {
      if (k !== 'file') raw[k] = v === '' ? null : v;
    }
    const meta = dryRunSchema.parse(raw);

    const file = formData.get('file') as File | null;
    if (!file || file.size === 0) {
      return { ok: false, error: 'Aucun fichier reçu. Choisis un fichier XLSX ou CSV.' };
    }
    if (file.size > 10 * 1024 * 1024) {
      return { ok: false, error: 'Fichier trop volumineux (max 10 Mo).' };
    }

    // Récupère le compte cible
    const { data: account, error: accErr } = await supabase
      .from('bank_accounts')
      .select('id, account_label, bank_code, deleted_at')
      .eq('id', meta.account_id)
      .single();

    if (accErr || !account || account.deleted_at) {
      return { ok: false, error: 'Compte cible introuvable ou désactivé.' };
    }

    // Parse le fichier
    const buffer = await file.arrayBuffer();
    const filename = file.name.toLowerCase();

    let parseResult;
    if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      parseResult = parseChaabiXLSX(buffer);
    } else if (filename.endsWith('.csv')) {
      // Tenter UTF-8 d'abord, puis Latin-1 en fallback (encoding Chaabi typique)
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        text = new TextDecoder('iso-8859-1').decode(buffer);
      }
      // Détection automatique : si on voit des caractères ANSI typiques mal décodés en UTF-8, retry en latin1
      if (/d['']op�ration|R�f�rence/i.test(text)) {
        text = new TextDecoder('iso-8859-1').decode(buffer);
      }
      parseResult = parseChaabiCSV(text);
    } else {
      return { ok: false, error: `Format non supporté (${file.name}). Utilise XLSX ou CSV.` };
    }

    if (parseResult.rows.length === 0) {
      return {
        ok: false,
        error: `Aucune ligne exploitable détectée dans "${file.name}". ` +
          `Erreurs de parsing : ${parseResult.errors.slice(0, 3).join(' ; ')}` +
          (parseResult.errors.length > 3 ? ` (+${parseResult.errors.length - 3} autres)` : ''),
      };
    }

  // Récupère les mappings sauvegardés pour la catégorisation
  const { data: mappings } = await supabase
    .from('bank_category_mappings')
    .select('bank_label_match, match_type, category_code, allocation_type')
    .is('deleted_at', null);

  const savedMappings: SavedMapping[] = (mappings ?? []).map((m: any) => ({
    bank_label_match: m.bank_label_match,
    match_type: m.match_type,
    category_code: m.category_code,
    allocation_type: m.allocation_type,
  }));

  // Récupère les hashes existants pour ce compte (anti-doublons)
  const { data: existingHashes } = await supabase
    .from('bank_transactions')
    .select('dedup_hash')
    .eq('account_id', account.id)
    .is('deleted_at', null);

  const knownHashes = new Set((existingHashes ?? []).map((r: any) => r.dedup_hash));

  // Construit le résumé
  let total_credits = 0;
  let total_debits = 0;
  let date_min: string | null = null;
  let date_max: string | null = null;
  let duplicates_count = 0;
  let unknowns_count = 0;
  const categoryStats = new Map<string, { count: number; total: number }>();

  const previewRows = parseResult.rows.map((row: ChaabiRawRow) => {
    const amount = Math.abs(row.debit_mad ?? row.credit_mad ?? 0);
    const is_debit = (row.debit_mad ?? 0) !== 0;
    const dedup_hash = computeDedupHash({
      account_id: account.id,
      operation_date: row.operation_date!,
      reference: row.reference,
      amount,
      is_debit,
      label: row.label,
    });

    const categorization = categorize(row, savedMappings);
    const is_duplicate = knownHashes.has(dedup_hash);

    // Stats (lignes non-pending et non-doublon uniquement)
    if (!row.is_pending && !is_duplicate) {
      if (row.credit_mad) total_credits += row.credit_mad;
      if (row.debit_mad && row.debit_mad > 0) total_debits += row.debit_mad;

      if (date_min == null || row.operation_date! < date_min) date_min = row.operation_date;
      if (date_max == null || row.operation_date! > date_max) date_max = row.operation_date;
    }

    if (is_duplicate) duplicates_count++;
    if (categorization.confidence === 'unknown') unknowns_count++;

    const catKey = CATEGORY_LABELS[categorization.category_code] ?? categorization.category_code;
    const stat = categoryStats.get(catKey) ?? { count: 0, total: 0 };
    stat.count++;
    stat.total += amount;
    categoryStats.set(catKey, stat);

    return {
      operation_date: row.operation_date!,
      value_date: row.value_date,
      label: row.label,
      reference: row.reference,
      debit_mad: row.debit_mad,
      credit_mad: row.credit_mad,
      is_pending: row.is_pending,
      categorization,
      is_duplicate,
      dedup_hash,
    };
  });

  const by_category = Array.from(categoryStats.entries())
    .map(([category, s]) => ({ category, count: s.count, total_mad: Math.round(s.total) }))
    .sort((a, b) => b.total_mad - a.total_mad);

  let expected_balance_after: number | null = null;
  if (meta.initial_balance) {
    const initial = Number(meta.initial_balance);
    if (Number.isFinite(initial)) {
      expected_balance_after = initial + total_credits - total_debits;
    }
  }

    return {
      ok: true as const,
      data: {
        total_lines: parseResult.rows.length,
        total_credits_mad: Math.round(total_credits),
        total_debits_mad: Math.round(total_debits),
        net_mad: Math.round(total_credits - total_debits),
        date_min,
        date_max,
        rows: previewRows,
        by_category,
        unknowns_count,
        duplicates_count,
        errors: parseResult.errors,
        expected_balance_after,
        account_id: account.id,
        account_label: account.account_label,
      },
    };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    // Log serveur pour debug côté ops (les runtime logs Vercel les voient).
    console.error('[dryRunImport] erreur inattendue :', e);
    return {
      ok: false,
      error: e instanceof Error
        ? `Erreur inattendue : ${e.message}`
        : 'Erreur inattendue lors de l\'analyse du fichier.',
    };
  }
}

// ─── Confirmation de l'import ─────────────────────────────────────────────

const confirmSchema = z.object({
  account_id: z.string().uuid(),
  // JSON sérialisé des lignes du dry-run que le CEO/Finance a validées
  rows_json: z.string(),
  // Si l'utilisateur a saisi un solde de référence, on crée un snapshot
  record_balance: z.enum(['yes', 'no']).default('no'),
  balance_date: z.string().optional().nullable(),
  balance_amount: z.string().optional().nullable(),
});

type RowToImport = {
  operation_date: string;
  value_date: string | null;
  label: string;
  reference: string | null;
  debit_mad: number | null;
  credit_mad: number | null;
  is_pending: boolean;
  dedup_hash: string;
  category_code: string;
  allocation_type: string;
  beneficiary: string | null;
};

export type ConfirmImportResult =
  | {
      ok: true;
      inserted: number;
      skipped_duplicates: number;
      skipped_internal_duplicates: number;
      auto_allocated?: number;
      /** Nombre de pending fusionnés en validés (CEO 2026-06-17) */
      pending_promoted?: number;
    }
  | { ok: false; error: string };

export async function confirmImport(formData: FormData): Promise<ConfirmImportResult> {
  let me;
  try {
    me = await assertRole(['ceo', 'finance']);
  } catch {
    return { ok: false, error: 'Permission refusée — connexion expirée ?' };
  }
  const supabase = createClient();

  let data: z.infer<typeof confirmSchema>;
  try {
    const raw: Record<string, any> = {};
    for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
    data = confirmSchema.parse(raw);
  } catch (e: any) {
    return { ok: false, error: `Données invalides : ${e?.message ?? e}` };
  }

  let rows: RowToImport[];
  try {
    rows = JSON.parse(data.rows_json);
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, error: 'Aucune ligne à importer' };
    }
  } catch {
    return { ok: false, error: 'Format des lignes invalide' };
  }

  // 1) Dédoublonnage INTERNE au fichier : 2 lignes Chaabi peuvent partager
  // le même dedup_hash (ex : 2 commissions identiques le même jour avec
  // la même référence). On ne garde que la 1ère occurrence.
  const seenHashes = new Set<string>();
  const internalUniqRows = rows.filter((r) => {
    if (seenHashes.has(r.dedup_hash)) return false;
    seenHashes.add(r.dedup_hash);
    return true;
  });
  const skipped_internal_duplicates = rows.length - internalUniqRows.length;

  // 2) Dédoublonnage EXTERNE : transactions déjà importées sur ce compte.
  // On chunk la requête IN(...) par 100 hashes pour ne pas dépasser la
  // limite de longueur d'URL de PostgREST (~16 KB). À 64 chars/hash,
  // 100 hashes = ~7 KB, ça passe largement.
  const allHashes = internalUniqRows.map((r) => r.dedup_hash);
  const knownHashes = new Set<string>();
  const CHUNK_SELECT = 100;
  for (let i = 0; i < allHashes.length; i += CHUNK_SELECT) {
    const chunk = allHashes.slice(i, i + CHUNK_SELECT);
    const { data: existing, error: selError } = await supabase
      .from('bank_transactions')
      .select('dedup_hash')
      .eq('account_id', data.account_id)
      .in('dedup_hash', chunk)
      .is('deleted_at', null);
    if (selError) {
      return {
        ok: false,
        error: `Vérification doublons (batch ${Math.floor(i / CHUNK_SELECT) + 1}) : ${selError.message}`,
      };
    }
    (existing ?? []).forEach((r: any) => knownHashes.add(r.dedup_hash));
  }

  const freshRaw = internalUniqRows.filter((r) => !knownHashes.has(r.dedup_hash));

  // ─── PROMOTION PENDING → VALIDÉE (CEO 2026-06-17) ────────────────────
  // Pour chaque ligne validée (non-pending) qui paraît "nouvelle", on
  // cherche en BDD une pending qui correspond au même mouvement réel
  // (même fingerprint card sans ref). Si trouvée → on UPDATE la pending
  // avec les valeurs validées, au lieu de créer une 2e ligne.
  let pending_promoted = 0;
  const promotedIds: string[] = []; // pour audit
  const stillFresh: typeof freshRaw = [];

  // Helper local : recalcule un "hash sans ref" pour matcher contre une pending
  // (les pendings n'ont pas de ref, donc leur hash est sans `#refnorm` après le card).
  function cardOnlyHash(r: typeof freshRaw[number]): string | null {
    // On reproduit la 1ère branche de computeDedupHash en oubliant la ref
    const m = r.label.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[-_.,;:'"()/\\>*]/g, ' ').replace(/\s+/g, ' ').trim();
    const validated = m.match(/^achat par carte de paiement chez\s+(.+)$/);
    const pending = m.match(/^achat par carte\s+(.+)$/);
    const fp = (validated?.[1] ?? pending?.[1])?.slice(0, 15).trim();
    if (!fp) return null;
    const yearMonth = r.operation_date.slice(0, 7);
    const amount = Math.abs(Number(r.debit_mad ?? r.credit_mad ?? 0));
    const is_debit = r.debit_mad != null && Number(r.debit_mad) !== 0;
    const key = [
      data.account_id, yearMonth, amount.toFixed(2), is_debit ? 'D' : 'C', `card:${fp}`,
    ].join('|');
    return createHash('sha256').update(key).digest('hex');
  }

  for (const r of freshRaw) {
    // Seuls les achats carte validés (non pending) sont candidats à promotion
    if (r.is_pending) { stillFresh.push(r); continue; }
    const pendingHash = cardOnlyHash(r);
    if (!pendingHash) { stillFresh.push(r); continue; }
    // Cherche une pending avec ce hash en BDD
    const { data: existing } = await supabase
      .from('bank_transactions')
      .select('id, is_pending')
      .eq('account_id', data.account_id)
      .eq('dedup_hash', pendingHash)
      .eq('is_pending', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (existing) {
      // UPDATE la pending avec les valeurs validées
      const { error: upErr } = await supabase
        .from('bank_transactions')
        .update({
          is_pending: false,
          operation_date: r.operation_date,
          value_date: r.value_date,
          label: r.label,
          reference: r.reference,
          debit_mad: r.debit_mad,
          credit_mad: r.credit_mad,
          category_code: r.category_code,
          beneficiary: r.beneficiary,
          dedup_hash: r.dedup_hash, // nouveau hash (avec ref si présente)
        } as any)
        .eq('id', (existing as any).id);
      if (!upErr) {
        pending_promoted++;
        promotedIds.push((existing as any).id);
        continue; // pas d'INSERT, on a fusionné
      }
    }
    stillFresh.push(r);
  }
  const fresh = stillFresh;
  const skipped_duplicates = internalUniqRows.length - freshRaw.length;

  if (fresh.length === 0 && pending_promoted === 0) {
    return { ok: true, inserted: 0, skipped_duplicates, skipped_internal_duplicates, pending_promoted };
  }

  // 3) Insertion par batchs de 500 lignes pour ne pas dépasser la taille
  // de payload Supabase. Si un batch échoue (rare maintenant qu'on a dédupé),
  // on retourne l'erreur claire.
  const inserts = fresh.map((r) => ({
    account_id: data.account_id,
    operation_date: r.operation_date,
    value_date: r.value_date,
    label: r.label,
    reference: r.reference,
    debit_mad: r.debit_mad,
    credit_mad: r.credit_mad,
    category_code: r.category_code,
    beneficiary: r.beneficiary,
    is_pending: r.is_pending,
    dedup_hash: r.dedup_hash,
    imported_by: me.id,
  }));

  const CHUNK_INSERT = 500;
  let totalInserted = 0;
  // hash → id pour les lignes fraîchement insérées (utilisé pour audit + auto-alloc)
  const insertedHashToId = new Map<string, string>();
  for (let i = 0; i < inserts.length; i += CHUNK_INSERT) {
    const chunk = inserts.slice(i, i + CHUNK_INSERT);
    const { data: insertedRows, error: insertError } = await supabase
      .from('bank_transactions')
      .insert(chunk as any)
      .select('id, dedup_hash');
    if (insertError) {
      return {
        ok: false,
        error: `Échec import au batch ${Math.floor(i / CHUNK_INSERT) + 1} (${totalInserted} déjà insérées) : ${insertError.message}`,
      };
    }
    for (const r of (insertedRows ?? []) as any[]) {
      insertedHashToId.set(r.dedup_hash, r.id);
    }
    totalInserted += chunk.length;
  }

  // ─── Auto-allocation des charges récurrentes connues ────────────────────
  // Pour les bénéficiaires déjà mappés (salaires, loyer, DGI, etc.), on crée
  // automatiquement l'allocation à l'import. Évite à l'utilisateur de devoir
  // bulk-allouer chaque mois ce qu'il a déjà appris au système.
  const AUTO_ALLOC_TYPES = new Set([
    'cabinet_charge','cabinet_fiscal','cabinet_social','frais_bancaire','intercompany',
  ]);
  const autoAllocatableRows = fresh.filter(
    (r) => r.allocation_type && AUTO_ALLOC_TYPES.has(r.allocation_type)
  );
  let auto_allocated = 0;
  // tx_id → { allocation_id, allocation_type, amount } pour audit
  const autoAllocAudit: Array<{ tx_id: string; allocation_id: string; allocation_type: string; amount: number }> = [];
  if (autoAllocatableRows.length > 0) {
    const allocsToInsert = autoAllocatableRows
      .map((r) => {
        const txId = insertedHashToId.get(r.dedup_hash);
        if (!txId) return null;
        const amount = Math.abs(Number(r.debit_mad ?? r.credit_mad ?? 0));
        if (amount < 0.01) return null;
        return {
          transaction_id: txId,
          project_id: null,
          allocation_type: r.allocation_type,
          amount_mad: amount,
          notes: 'Auto-alloué (mapping bénéficiaire appris)',
          allocated_by: me.id,
        };
      })
      .filter(Boolean) as any[];

    if (allocsToInsert.length > 0) {
      const CHUNK_ALLOC = 500;
      for (let i = 0; i < allocsToInsert.length; i += CHUNK_ALLOC) {
        const chunk = allocsToInsert.slice(i, i + CHUNK_ALLOC);
        const { data: insAllocs, error: allocErr } = await supabase
          .from('bank_transaction_allocations')
          .insert(chunk as any)
          .select('id, transaction_id, allocation_type, amount_mad');
        if (!allocErr) {
          auto_allocated += chunk.length;
          for (const a of (insAllocs ?? []) as any[]) {
            autoAllocAudit.push({
              tx_id: a.transaction_id,
              allocation_id: a.id,
              allocation_type: a.allocation_type,
              amount: Number(a.amount_mad),
            });
          }
        }
      }
    }
  }

  // Si l'utilisateur a saisi un solde de référence, on crée un snapshot
  let balanceSnapshotId: string | null = null;
  if (data.record_balance === 'yes' && data.balance_date && data.balance_amount) {
    const { data: acc } = await supabase
      .from('bank_accounts')
      .select('currency')
      .eq('id', data.account_id)
      .single();

    if (acc) {
      const { data: snap } = await supabase
        .from('bank_balances')
        .insert({
          account_id: data.account_id,
          balance_date: data.balance_date,
          balance_amount: data.balance_amount,
          currency: acc.currency,
          source: 'import_xlsx',
          notes: `Snapshot saisi à l'import (${fresh.length} lignes)`,
          recorded_by: me.id,
        } as any)
        .select('id')
        .single();
      if (snap) balanceSnapshotId = (snap as any).id;
    }
  }

  // ─── Audit log (best-effort, après tous les commits) ────────────────────
  // 1) Résumé bulk : 1 event groupé sur le 1er id inséré OU sur l'account
  //    si rien n'a été inséré (cas où seules des pendings ont été promues).
  // 2) Détail par tx : 1 event light "create" pour chaque tx fraîche
  // 3) Promotion pending→validée : 1 event par tx promue
  // 4) Auto-allocation : 1 event par allocation créée
  // 5) Snapshot solde : 1 event create sur la nouvelle ligne bank_balances
  const insertedIds = Array.from(insertedHashToId.values());
  const summaryRecordId = insertedIds[0] ?? promotedIds[0] ?? data.account_id;
  const periodHint = fresh.length > 0
    ? {
        date_min: fresh.reduce((m, r) => (!m || r.operation_date < m ? r.operation_date : m), '' as string) || null,
        date_max: fresh.reduce((m, r) => (!m || r.operation_date > m ? r.operation_date : m), '' as string) || null,
      }
    : { date_min: null, date_max: null };

  await logFinanceAudit({
    table: 'bank_transactions',
    recordId: summaryRecordId,
    action: 'bulk_update',
    actorId: me.id,
    label: `Import XLSX : ${totalInserted} ligne(s) créée(s)${pending_promoted ? `, ${pending_promoted} pending promue(s)` : ''}${auto_allocated ? `, ${auto_allocated} auto-allouée(s)` : ''}`,
    payload: {
      count_inserted: totalInserted,
      count_pending_promoted: pending_promoted,
      count_auto_allocated: auto_allocated,
      count_skipped_duplicates: skipped_duplicates,
      count_skipped_internal_duplicates: skipped_internal_duplicates,
      account_id: data.account_id,
      period: periodHint,
    },
  });

  // 2) 1 event light par tx insérée
  const createEntries = fresh
    .map((r) => {
      const id = insertedHashToId.get(r.dedup_hash);
      if (!id) return null;
      return {
        table: 'bank_transactions' as const,
        recordId: id,
        action: 'create' as const,
        actorId: me.id,
        label: 'Créée via import XLSX',
        payload: {
          operation_date: r.operation_date,
          account_id: data.account_id,
        },
      };
    })
    .filter(Boolean) as Parameters<typeof logFinanceAuditBulk>[0];

  // 3) 1 event par promotion pending → validée
  const promoteEntries = promotedIds.map((id) => ({
    table: 'bank_transactions' as const,
    recordId: id,
    action: 'pending_merge' as const,
    actorId: me.id,
    label: 'Promotion pending → validée',
    payload: { account_id: data.account_id },
  }));

  // 4) 1 event par auto-allocation
  const allocEntries = autoAllocAudit.map((a) => ({
    table: 'bank_transactions' as const,
    recordId: a.tx_id,
    action: 'allocate' as const,
    actorId: me.id,
    label: 'Auto-allocation via import',
    payload: {
      allocation_id: a.allocation_id,
      allocation_type: a.allocation_type,
      amount: a.amount,
    },
  }));

  await logFinanceAuditBulk([
    ...createEntries,
    ...promoteEntries,
    ...allocEntries,
  ]);

  // 5) Snapshot solde
  if (balanceSnapshotId) {
    await logFinanceAudit({
      table: 'bank_balances',
      recordId: balanceSnapshotId,
      action: 'create',
      actorId: me.id,
      label: 'Solde mis à jour via import',
      payload: {
        account_id: data.account_id,
        balance_date: data.balance_date,
        balance_amount: data.balance_amount,
        source: 'import_xlsx',
      },
    });
  }

  revalidatePath('/finance/tresorerie');
  revalidatePath('/finance/tresorerie/import');
  return {
    ok: true,
    inserted: totalInserted,
    skipped_duplicates,
    skipped_internal_duplicates,
    auto_allocated,
  };
}

// ─── Qualification d'un libellé inconnu (mémorisation) ────────────────────

const saveMappingSchema = z.object({
  bank_label_match: z.string().min(2),
  match_type: z.enum(['contains', 'exact', 'regex']).default('contains'),
  category_code: z.string().min(2),
  allocation_type: z.string().optional().nullable(),
  linked_profile_id: z.string().uuid().optional().nullable(),
  linked_artisan_id: z.string().uuid().optional().nullable(),
  linked_project_id: z.string().uuid().optional().nullable(),
});

export async function saveCategoryMapping(formData: FormData) {
  const me = await assertRole(['ceo', 'finance']);
  const supabase = createClient();

  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
  const data = saveMappingSchema.parse(raw);

  // Lecture du before pour distinguer create vs update
  const { data: before } = await supabase
    .from('bank_category_mappings')
    .select('id, category_code, allocation_type')
    .eq('bank_label_match', data.bank_label_match)
    .eq('match_type', data.match_type)
    .maybeSingle();

  const { data: upserted, error } = await supabase
    .from('bank_category_mappings')
    .upsert({
      bank_label_match: data.bank_label_match,
      match_type: data.match_type,
      category_code: data.category_code,
      allocation_type: data.allocation_type ?? null,
      linked_profile_id: data.linked_profile_id ?? null,
      linked_artisan_id: data.linked_artisan_id ?? null,
      linked_project_id: data.linked_project_id ?? null,
      created_by: me.id,
    } as any, { onConflict: 'bank_label_match,match_type' })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Impossible de sauvegarder la qualification : ${error.message}`);
  }

  // Audit log (best-effort)
  if (upserted) {
    const wasCreate = before == null;
    await logFinanceAudit({
      table: 'bank_category_mappings',
      recordId: (upserted as any).id,
      action: wasCreate ? 'create' : 'update',
      actorId: me.id,
      label: wasCreate ? 'Mapping catégorie créé' : 'Mapping catégorie mis à jour',
      payload: {
        bank_label_match: data.bank_label_match,
        match_type: data.match_type,
        category_code: data.category_code,
        allocation_type: data.allocation_type ?? null,
        ...(wasCreate
          ? {}
          : {
              before: {
                category_code: (before as any).category_code,
                allocation_type: (before as any).allocation_type,
              },
            }),
      },
    });
  }

  revalidatePath('/finance/tresorerie/import');
}
