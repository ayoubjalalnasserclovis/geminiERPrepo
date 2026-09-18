'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { normalizeFormData as clean, optionalUuid } from '@/lib/validators/zod-helpers';
import { logFinanceAudit, computeFinanceDiff } from '@/lib/finance/audit';

// NOTE: `stoniz_wallet_expenses` n'est pas (encore) dans l'union FinanceAuditTable
// déclarée dans lib/finance/audit.ts. On caste en `as any` au call site pour
// éviter de modifier le helper depuis ce chantier (zone hors scope sub-agent B).
// TODO: étendre FinanceAuditTable avec 'stoniz_wallet_expenses' lors d'un futur chantier audit.
const AUDIT_TABLE = 'stoniz_wallet_expenses' as any;

// ─── Helpers défensifs (session expirée) — pattern aligné sur Propria ──────

function isNextRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'digest' in e
    && typeof (e as any).digest === 'string'
    && (e as any).digest.startsWith('NEXT_REDIRECT');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

type ActionResult = { ok: true } | { ok: false; error: string };

const ALLOWED_RECEIPT_MIME = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
];
const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;

// ─── Wallets ────────────────────────────────────────────────────────────────

const walletSchema = z.object({
  profile_id: z.string().uuid(),
  label: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function createStonizWalletAction(formData: FormData) {
  await assertRole(['ceo','chef_projet','finance','sourcing']);
  const data = walletSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { data: row, error } = await supabase
    .from('stoniz_wallets')
    .insert(data as any)
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath('/caisse-stoniz');
  redirect(`/caisse-stoniz/${row.id}`);
}

export async function closeStonizWalletAction(walletId: string) {
  await assertRole(['ceo','chef_projet','finance','sourcing']);
  const supabase = createClient();
  const { error } = await supabase
    .from('stoniz_wallets')
    .update({ is_active: false, closed_at: new Date().toISOString().slice(0, 10) } as any)
    .eq('id', walletId);
  if (error) throw new Error(error.message);
  revalidatePath('/caisse-stoniz');
  revalidatePath(`/caisse-stoniz/${walletId}`);
}

/**
 * Réouverture d'une caisse clôturée. Exact inverse de closeStonizWalletAction :
 * remet is_active à true et efface closed_at.
 *
 * Ajoutée le 14/09/2026 : la clôture était un aller simple dans l'ERP, la seule
 * façon de revenir en arrière était une requête SQL en base (cas réel : caisse
 * de Zineb clôturée le 09/09 alors qu'elle contenait encore 15 652 MAD).
 *
 * Mêmes rôles que la clôture — si on peut fermer, on peut rouvrir.
 */
export async function reopenStonizWalletAction(walletId: string) {
  await assertRole(['ceo','chef_projet','finance','sourcing']);
  const supabase = createClient();
  const { error } = await supabase
    .from('stoniz_wallets')
    .update({ is_active: true, closed_at: null } as any)
    .eq('id', walletId);
  if (error) throw new Error(error.message);
  revalidatePath('/caisse-stoniz');
  revalidatePath(`/caisse-stoniz/${walletId}`);
}

async function assertStonizWalletActive(supabase: ReturnType<typeof createClient>, walletId: string) {
  const { data: wallet } = await supabase
    .from('stoniz_wallets')
    .select('id, is_active')
    .eq('id', walletId)
    .maybeSingle();
  if (!wallet) throw new Error('Caisse introuvable.');
  if (wallet.is_active === false) {
    throw new Error('Cette caisse est clôturée et ne peut plus enregistrer d\'opérations.');
  }
}

// ─── Dotations ──────────────────────────────────────────────────────────────

const dotationSchema = z.object({
  wallet_id: z.string().uuid(),
  given_at: z.string(),
  amount_mad: z.coerce.number().positive(),
  type: z.enum(['dotation','rechargement']),
  note: z.string().optional().nullable(),
});

export async function createStonizDotationAction(formData: FormData) {
  // Dotations réservées au CEO (idem Propria)
  const user = await assertRole(['ceo']);
  const data = dotationSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  await assertStonizWalletActive(supabase, data.wallet_id);

  const { error } = await supabase
    .from('stoniz_wallet_dotations')
    .insert({ ...data, given_by: user.id } as any);
  if (error) throw new Error(error.message);
  revalidatePath(`/caisse-stoniz/${data.wallet_id}`);
  revalidatePath('/caisse-stoniz');
}

// ─── Dépenses ───────────────────────────────────────────────────────────────

// Rôles autorisés à saisir/éditer leurs propres dépenses caisse Stoniz.
// Aligné sur la matrice RLS (migration 20260622400000_caisse_stoniz_extend.sql) :
// ceo + chef_projet + finance + achats + sourcing (ajouté CEO 2026-07-02).
// `assistante` retirée (pas dans la cible métier), `developer` exclu (lecture seule).
const EXPENSE_WRITE_ROLES = ['ceo','chef_projet','finance','achats','sourcing'] as const;

const expenseSchema = z.object({
  wallet_id: z.string().uuid(),
  spent_at: z.string().min(1, 'Date requise'),
  project_id: optionalUuid,
  expense_type: z.enum(['achat','travaux','autre']),
  category: z.string().nullable().optional(),
  description: z.string().min(2),
  amount_mad: z.coerce.number().positive(),
  observations: z.string().nullable().optional(),
});

export async function createStonizExpenseAction(formData: FormData) {
  // Matrice RLS étendue (migration 20260622400000) : ceo/chef_projet/finance/achats.
  const user = await assertRole([...EXPENSE_WRITE_ROLES]);

  const receiptFile = formData.get('receipt_file') as File | null;
  formData.delete('receipt_file');

  const data = expenseSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  await assertStonizWalletActive(supabase, data.wallet_id);

  // 1) Insert la dépense pour obtenir son id
  //    created_by est OBLIGATOIRE (WITH CHECK created_by = auth.uid()).
  const { data: row, error } = await supabase
    .from('stoniz_wallet_expenses')
    .insert({ ...data, created_by: user.id } as any)
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // 2) Si justificatif fourni, on l'upload et on update receipt_path
  if (receiptFile && receiptFile.size > 0) {
    if (receiptFile.size > MAX_RECEIPT_SIZE) {
      throw new Error('Justificatif trop volumineux (max 10 MB)');
    }
    if (!ALLOWED_RECEIPT_MIME.includes(receiptFile.type)) {
      throw new Error(`Type de justificatif non supporté : ${receiptFile.type}`);
    }
    const ext = (receiptFile.name.split('.').pop() ?? 'bin').toLowerCase();
    const path = `stoniz/wallets/${data.wallet_id}/expenses/${row.id}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(path, receiptFile, { contentType: receiptFile.type, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { error: dbErr } = await supabase
      .from('stoniz_wallet_expenses')
      .update({ receipt_path: path, updated_by: user.id } as any)
      .eq('id', row.id);
    if (dbErr) {
      await supabase.storage.from('documents').remove([path]);
      throw new Error(dbErr.message);
    }
  }

  // 3) Audit
  await logFinanceAudit({
    table: AUDIT_TABLE,
    recordId: row.id,
    action: 'create',
    actorId: user.id,
    label: `Dépense ${data.amount_mad.toFixed(2)} MAD — ${data.description}`,
    payload: {
      wallet_id: data.wallet_id,
      spent_at: data.spent_at,
      project_id: data.project_id ?? null,
      expense_type: data.expense_type,
      category: data.category ?? null,
      amount_mad: data.amount_mad,
      has_receipt: !!(receiptFile && receiptFile.size > 0),
    },
  });

  revalidatePath(`/caisse-stoniz/${data.wallet_id}`);
  revalidatePath('/caisse-stoniz');
}

// ─── Édition (UPDATE) ─────────────────────────────────────────────────────

const updateExpenseSchema = z.object({
  amount_mad: z.coerce.number().positive().optional(),
  description: z.string().min(2).optional(),
  expense_type: z.enum(['achat','travaux','autre']).optional(),
  category: z.string().nullable().optional(),
  project_id: optionalUuid.optional(),
  observations: z.string().nullable().optional(),
});

export type UpdateStonizExpenseInput = z.infer<typeof updateExpenseSchema>;

/**
 * Édite une dépense existante.
 * - Champs éditables : amount_mad, description, expense_type, category, project_id, observations.
 * - Champs IMMUTABLES côté action : wallet_id, spent_at, created_by, receipt_path
 *   (upload séparé via uploadStonizExpenseReceiptAction).
 * - Règle métier : non-CEO ne peut éditer que les lignes qu'il a créées (vérif
 *   en double pour message clair côté UI ; la RLS bloque aussi côté DB).
 */
export async function updateStonizExpenseAction(
  id: string,
  fields: UpdateStonizExpenseInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await assertRole([...EXPENSE_WRITE_ROLES]);

  const parsed = updateExpenseSchema.safeParse(fields ?? {});
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? 'Champs invalides' };
  }
  // Au moins un champ doit être fourni
  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, error: 'Aucune modification à appliquer.' };
  }

  const supabase = createClient();

  // Charger l'existant (avant + vérif owner)
  const { data: existing, error: loadErr } = await supabase
    .from('stoniz_wallet_expenses')
    .select('id, wallet_id, created_by, deleted_at, is_validated, amount_mad, description, expense_type, category, project_id, observations')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!existing) return { ok: false, error: 'Dépense introuvable.' };
  if ((existing as any).deleted_at) {
    return { ok: false, error: 'Cette dépense a été supprimée. Restaurez-la avant d\'éditer.' };
  }

  // Si la dépense est déjà validée par le CEO, seul le CEO peut la modifier
  if ((existing as any).is_validated && user.role !== 'ceo') {
    return { ok: false, error: 'Cette dépense a été validée par le CEO. Seul le CEO peut la modifier.' };
  }

  // Garde owner pour non-CEO (la RLS bloque aussi, mais on veut un message clair)
  if (user.role !== 'ceo' && (existing as any).created_by !== user.id) {
    return { ok: false, error: 'Tu ne peux modifier que les opérations que tu as créées toi-même.' };
  }

  const after = {
    ...parsed.data,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };

  const { error: upErr } = await supabase
    .from('stoniz_wallet_expenses')
    .update(after as any)
    .eq('id', id);
  if (upErr) return { ok: false, error: upErr.message };

  // Diff structuré pour audit
  const diff = computeFinanceDiff(
    existing as any,
    parsed.data,
    ['amount_mad','description','expense_type','category','project_id','observations'],
  );
  if (Object.keys(diff).length > 0) {
    await logFinanceAudit({
      table: AUDIT_TABLE,
      recordId: id,
      action: 'update',
      actorId: user.id,
      label: `Dépense modifiée (${Object.keys(diff).join(', ')})`,
      payload: diff,
    });
  }

  revalidatePath(`/caisse-stoniz/${(existing as any).wallet_id}`);
  revalidatePath('/caisse-stoniz');
  return { ok: true };
}

// ─── Soft-delete ──────────────────────────────────────────────────────────

/**
 * Soft-delete (UPDATE deleted_at/deleted_by). Pas de DELETE physique.
 * - Non-CEO : uniquement ses propres lignes.
 * - Tracé dans finance_audit_log (action='delete').
 */
export async function softDeleteStonizExpenseAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await assertRole([...EXPENSE_WRITE_ROLES]);
  const supabase = createClient();

  const { data: existing, error: loadErr } = await supabase
    .from('stoniz_wallet_expenses')
    .select('id, wallet_id, created_by, deleted_at, is_validated, amount_mad, description, category, expense_type')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!existing) return { ok: false, error: 'Dépense introuvable.' };
  if ((existing as any).deleted_at) {
    return { ok: false, error: 'Cette dépense est déjà supprimée.' };
  }
  if ((existing as any).is_validated && user.role !== 'ceo') {
    return { ok: false, error: 'Cette dépense a été validée par le CEO. Seul le CEO peut la supprimer.' };
  }
  if (user.role !== 'ceo' && (existing as any).created_by !== user.id) {
    return { ok: false, error: 'Tu ne peux supprimer que les opérations que tu as créées toi-même.' };
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await supabase
    .from('stoniz_wallet_expenses')
    .update({ deleted_at: nowIso, deleted_by: user.id, updated_by: user.id } as any)
    .eq('id', id);
  if (upErr) return { ok: false, error: upErr.message };

  await logFinanceAudit({
    table: AUDIT_TABLE,
    recordId: id,
    action: 'delete',
    actorId: user.id,
    label: `Dépense supprimée (${Number((existing as any).amount_mad ?? 0).toFixed(2)} MAD)`,
    payload: {
      amount_mad: (existing as any).amount_mad,
      description: (existing as any).description,
      category: (existing as any).category,
      expense_type: (existing as any).expense_type,
      original_created_by: (existing as any).created_by,
    },
  });

  revalidatePath(`/caisse-stoniz/${(existing as any).wallet_id}`);
  revalidatePath('/caisse-stoniz');
  return { ok: true };
}

/**
 * Restaure une dépense soft-supprimée. CEO uniquement (annulation d'erreur).
 * Note : l'enum FinanceAuditAction ne contient pas 'restore' → on utilise
 * 'update' avec payload `{ restored: true }`.
 */
export async function restoreStonizExpenseAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await assertRole(['ceo']);
  const supabase = createClient();

  const { data: existing, error: loadErr } = await supabase
    .from('stoniz_wallet_expenses')
    .select('id, wallet_id, deleted_at, amount_mad, description')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!existing) return { ok: false, error: 'Dépense introuvable.' };
  if (!(existing as any).deleted_at) {
    return { ok: false, error: 'Cette dépense n\'est pas supprimée.' };
  }

  const { error: upErr } = await supabase
    .from('stoniz_wallet_expenses')
    .update({ deleted_at: null, deleted_by: null, updated_by: user.id } as any)
    .eq('id', id);
  if (upErr) return { ok: false, error: upErr.message };

  await logFinanceAudit({
    table: AUDIT_TABLE,
    recordId: id,
    action: 'update',
    actorId: user.id,
    label: `Dépense restaurée (${Number((existing as any).amount_mad ?? 0).toFixed(2)} MAD)`,
    payload: { restored: true, description: (existing as any).description },
  });

  revalidatePath(`/caisse-stoniz/${(existing as any).wallet_id}`);
  revalidatePath('/caisse-stoniz');
  return { ok: true };
}

// ─── Validation (CEO) ─────────────────────────────────────────────────────

export async function validateStonizExpenseAction(expenseId: string, walletId: string) {
  const user = await assertRole(['ceo']);
  const supabase = createClient();
  const { data: exp } = await supabase
    .from('stoniz_wallet_expenses')
    .select('id, receipt_path, amount_mad, description')
    .eq('id', expenseId)
    // TODO: drop ce filtre quand les vues stoniz_wallet_balances et stoniz_project_cash_pl seront patchées
    .is('deleted_at', null)
    .single();
  if (!exp) throw new Error('Dépense introuvable');
  if (!exp.receipt_path) {
    throw new Error('Impossible de valider sans justificatif (PJ requise).');
  }
  const { error } = await supabase
    .from('stoniz_wallet_expenses')
    .update({
      is_validated: true,
      validated_at: new Date().toISOString(),
      validated_by: user.id,
    } as any)
    .eq('id', expenseId);
  if (error) throw new Error(error.message);

  await logFinanceAudit({
    table: AUDIT_TABLE,
    recordId: expenseId,
    action: 'validate',
    actorId: user.id,
    label: `Dépense validée (${Number((exp as any).amount_mad ?? 0).toFixed(2)} MAD)`,
    payload: { description: (exp as any).description },
  });

  revalidatePath(`/caisse-stoniz/${walletId}`);
}

export async function validateAllStonizExpensesForWalletAction(walletId: string) {
  const user = await assertRole(['ceo']);
  const supabase = createClient();
  const { data: candidates } = await supabase
    .from('stoniz_wallet_expenses')
    .select('id, receipt_path')
    .eq('wallet_id', walletId)
    .eq('is_validated', false)
    // TODO: drop ce filtre quand les vues stoniz_wallet_balances et stoniz_project_cash_pl seront patchées
    .is('deleted_at', null);
  const withReceipt = (candidates ?? []).filter(c => c.receipt_path);
  if (withReceipt.length > 0) {
    const { error } = await supabase
      .from('stoniz_wallet_expenses')
      .update({
        is_validated: true,
        validated_at: new Date().toISOString(),
        validated_by: user.id,
      } as any)
      .in('id', withReceipt.map(c => c.id));
    if (error) throw new Error(error.message);

    // Un seul log de bulk (le détail par ligne est trop bruité ici).
    await logFinanceAudit({
      table: AUDIT_TABLE,
      recordId: walletId, // pas l'id d'une dépense — wallet_id pour grouper le bulk
      action: 'bulk_update',
      actorId: user.id,
      label: `Validation en masse · ${withReceipt.length} dépense(s)`,
      payload: { wallet_id: walletId, count: withReceipt.length, expense_ids: withReceipt.map(c => c.id) },
    });
  }
  revalidatePath(`/caisse-stoniz/${walletId}`);
}

// ─── Upload justificatif sur dépense existante ─────────────────────────────
//
// CEO 2026-07-10 : historiquement on bloquait un rôle non-CEO qui essayait
// d'attacher une PJ sur une dépense dont il n'était pas l'auteur (`created_by`).
// Problème : la majorité des dépenses de la caisse ont été importées de Notion
// avec `created_by = NULL` → chef_projet/finance/achats ne pouvaient rien
// attacher, et le throw brut apparaissait comme "Erreur Server Component" en
// prod (message métier stripped).
// Décision : aligner sur Propria — tout rôle avec accès écriture peut attacher
// une PJ à n'importe quelle dépense non-supprimée. Le CEO valide ensuite.

export async function uploadStonizExpenseReceiptAction(formData: FormData): Promise<ActionResult> {
  try {
    const user = await assertRole([...EXPENSE_WRITE_ROLES]);
    const supabase = createClient();

    const file = formData.get('file') as File | null;
    const expenseId = String(formData.get('expense_id') ?? '');
    const walletId = String(formData.get('wallet_id') ?? '');

    if (!file || !file.size) throw new Error('Fichier requis');
    if (file.size > MAX_RECEIPT_SIZE) throw new Error('Fichier trop volumineux (max 10 MB)');
    if (!ALLOWED_RECEIPT_MIME.includes(file.type)) {
      throw new Error(`Type non supporté : ${file.type}`);
    }

    // Garde-fou : dépense doit exister et ne pas être supprimée. La RLS bloque
    // aussi côté DB si l'utilisateur n'a pas les droits.
    const { data: existing } = await supabase
      .from('stoniz_wallet_expenses')
      .select('id, deleted_at')
      .eq('id', expenseId)
      .maybeSingle();
    if (!existing) throw new Error('Dépense introuvable');
    if ((existing as any).deleted_at) {
      throw new Error("Impossible d'attacher un justificatif à une dépense supprimée.");
    }

    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
    const path = `stoniz/wallets/${walletId}/expenses/${expenseId}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { error: dbErr } = await supabase
      .from('stoniz_wallet_expenses')
      .update({ receipt_path: path, updated_by: user.id } as any)
      .eq('id', expenseId);
    if (dbErr) {
      await supabase.storage.from('documents').remove([path]);
      throw new Error(dbErr.message);
    }

    await logFinanceAudit({
      table: AUDIT_TABLE,
      recordId: expenseId,
      action: 'attach_doc',
      actorId: user.id,
      label: 'Justificatif attaché',
      payload: { receipt_path: path, mime: file.type, size: file.size },
    });

    revalidatePath(`/caisse-stoniz/${walletId}`);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}
