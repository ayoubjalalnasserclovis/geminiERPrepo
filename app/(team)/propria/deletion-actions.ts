'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { DELETABLE_TABLES, DELETER_ROLES } from '@/lib/propria/deletable-tables';

// ============================================================================
// Suppression contrôlée des lignes Propria (soft-delete + validation CEO).
// Mécanisme central réutilisé par tous les modules.
// Liste blanche des tables : lib/propria/deletable-tables.ts
// ============================================================================

function revalidateFor(table: string) {
  const paths = DELETABLE_TABLES[table]?.paths ?? [];
  for (const p of paths) revalidatePath(p);
  revalidatePath('/propria/suppressions');
}

/**
 * Suppression immédiate (soft-delete = deleted_at) + journalisation.
 * - CEO : suppression directement confirmée.
 * - Back office / terrain : suppression en attente de validation CEO.
 */
export async function softDeletePropriaRowAction(input: {
  table: string;
  id: string;
  reason?: string | null;
}) {
  try {
    const user = await assertRole([...DELETER_ROLES]);
    const { table, id } = input;
    if (!DELETABLE_TABLES[table]) return { ok: false as const, error: 'Table non autorisée' };
    if (!id) return { ok: false as const, error: 'Ligne manquante' };

    const supabase = createClient();
    const now = new Date().toISOString();

    // 1. Soft-delete de la ligne cible (RLS de la table gouverne le droit réel).
    const { error: delErr } = await supabase
      .from(table)
      .update({ deleted_at: now } as any)
      .eq('id', id)
      .is('deleted_at', null);
    if (delErr) return { ok: false as const, error: delErr.message };

    // 2. Journalisation (+ statut selon le rôle).
    const isCeo = user.role === 'ceo';
    const { error: logErr } = await supabase.from('propria_deletions').insert({
      entity_table: table,
      entity_id: id,
      reason: input.reason?.trim() || null,
      status: isCeo ? 'confirmed' : 'pending',
      deleted_by: user.id,
      resolved_by: isCeo ? user.id : null,
      resolved_at: isCeo ? now : null,
    } as any);
    if (logErr) {
      // Rollback du soft-delete si le journal échoue (cohérence).
      await supabase.from(table).update({ deleted_at: null } as any).eq('id', id);
      return { ok: false as const, error: logErr.message };
    }

    revalidateFor(table);
    return { ok: true as const, pending: !isCeo };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'Erreur serveur' };
  }
}

/**
 * Suppression EN LOT. Reçoit la table + la liste d'ids cochés.
 * Chaque ligne est soft-deletée et journalisée (en attente de validation CEO,
 * ou confirmée si CEO).
 */
export async function bulkSoftDeletePropriaAction(input: { table: string; ids: string[] }) {
  try {
    const user = await assertRole([...DELETER_ROLES]);
    const { table } = input;
    if (!DELETABLE_TABLES[table]) return { ok: false as const, error: 'Table non autorisée' };

    const ids = (input.ids ?? []).filter(Boolean);
    if (ids.length === 0) return { ok: false as const, error: 'Aucune ligne sélectionnée' };

    const supabase = createClient();
    const now = new Date().toISOString();

    // 1. Soft-delete de toutes les lignes sélectionnées (RLS gouverne le droit réel).
    const { error: delErr } = await supabase
      .from(table)
      .update({ deleted_at: now } as any)
      .in('id', ids)
      .is('deleted_at', null);
    if (delErr) return { ok: false as const, error: delErr.message };

    // 2. Journalisation d'une entrée par ligne.
    const isCeo = user.role === 'ceo';
    const rows = ids.map((id) => ({
      entity_table: table,
      entity_id: id,
      reason: null,
      status: isCeo ? 'confirmed' : 'pending',
      deleted_by: user.id,
      resolved_by: isCeo ? user.id : null,
      resolved_at: isCeo ? now : null,
    }));
    const { error: logErr } = await supabase.from('propria_deletions').insert(rows as any);
    if (logErr) return { ok: false as const, error: logErr.message };

    revalidateFor(table);
    return { ok: true as const, count: ids.length, pending: !isCeo };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'Erreur serveur' };
  }
}

/** Confirme une suppression en attente (CEO uniquement). La ligne reste supprimée. */
export async function confirmDeletionAction(deletionId: string) {
  const user = await assertRole(['ceo']);
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_deletions')
    .update({ status: 'confirmed', resolved_by: user.id, resolved_at: new Date().toISOString() } as any)
    .eq('id', deletionId)
    .eq('status', 'pending');
  if (error) throw new Error(error.message);
  revalidatePath('/propria/suppressions');
}

/** Restaure une ligne supprimée (CEO uniquement) : deleted_at remis à NULL. */
export async function restoreDeletionAction(deletionId: string) {
  const user = await assertRole(['ceo']);
  const supabase = createClient();

  const { data: del, error: readErr } = await supabase
    .from('propria_deletions')
    .select('entity_table, entity_id, status')
    .eq('id', deletionId)
    .single();
  if (readErr || !del) throw new Error('Demande introuvable');
  if (!DELETABLE_TABLES[del.entity_table]) throw new Error('Table non autorisée');

  // Restaure la ligne cible.
  const { error: restoreErr } = await supabase
    .from(del.entity_table)
    .update({ deleted_at: null } as any)
    .eq('id', del.entity_id);
  if (restoreErr) throw new Error(restoreErr.message);

  const { error: logErr } = await supabase
    .from('propria_deletions')
    .update({ status: 'restored', resolved_by: user.id, resolved_at: new Date().toISOString() } as any)
    .eq('id', deletionId);
  if (logErr) throw new Error(logErr.message);

  revalidateFor(del.entity_table);
}
