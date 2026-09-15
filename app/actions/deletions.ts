'use server';

import { revalidatePath } from 'next/cache';
import { assertRole } from '@/lib/auth/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { restoreDeletion } from '@/lib/audit/deletion';

/**
 * Server actions pour la corbeille admin `/dashboard/suppressions`
 * (CEO 2026-06-16).
 *
 * - fetchDeletions : liste paginée + filtres (CEO + developer en lecture)
 * - restoreDeletionAction : restaure une ligne soft-deleted (CEO uniquement)
 */

export type DeletionRow = {
  id: string;
  table_name: string;
  record_id: string;
  record_label: string | null;
  snapshot: any;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  restored_at: string | null;
  restored_by: string | null;
  restored_by_name: string | null;
  restore_note: string | null;
};

export async function fetchDeletions(opts?: {
  tableName?: string | null;
  period?: '7d' | '30d' | '90d' | 'all';
  showRestored?: boolean;
  search?: string | null;
  limit?: number;
  offset?: number;
}): Promise<DeletionRow[]> {
  await assertRole(['ceo', 'developer']);
  const admin = createAdminClient();

  const limit = Math.min(opts?.limit ?? 100, 500);
  const offset = opts?.offset ?? 0;

  let query = admin
    .from('deletion_log')
    .select('id, table_name, record_id, record_label, snapshot, deleted_at, deleted_by, restored_at, restored_by, restore_note')
    .order('deleted_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts?.tableName) {
    query = query.eq('table_name', opts.tableName);
  }
  if (opts?.period && opts.period !== 'all') {
    const days = opts.period === '7d' ? 7 : opts.period === '30d' ? 30 : 90;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('deleted_at', from);
  }
  if (!opts?.showRestored) {
    query = query.is('restored_at', null);
  }
  if (opts?.search) {
    query = query.ilike('record_label', `%${opts.search}%`);
  }

  const { data: rows } = await query;
  const list = (rows ?? []) as any[];

  // Hydrate les noms des auteurs (deleted_by + restored_by)
  const actorIds = Array.from(
    new Set(
      list.flatMap((r) => [r.deleted_by, r.restored_by]).filter(Boolean)
    )
  );
  let nameMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, full_name')
      .in('id', actorIds);
    nameMap = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));
  }

  return list.map((r) => ({
    ...r,
    deleted_by_name: r.deleted_by ? nameMap.get(r.deleted_by) ?? null : null,
    restored_by_name: r.restored_by ? nameMap.get(r.restored_by) ?? null : null,
  })) as DeletionRow[];
}

/**
 * Stats agrégées pour le header de la page.
 */
export async function fetchDeletionStats(): Promise<{
  totalPending: number;
  total7d: number;
  total30d: number;
  byTable: Array<{ table_name: string; count: number }>;
}> {
  await assertRole(['ceo', 'developer']);
  const admin = createAdminClient();

  const now = Date.now();
  const d7 = new Date(now - 7 * 86400e3).toISOString();
  const d30 = new Date(now - 30 * 86400e3).toISOString();

  const [pendingRes, last7Res, last30Res, byTableRes] = await Promise.all([
    admin.from('deletion_log').select('id', { count: 'exact', head: true }).is('restored_at', null),
    admin.from('deletion_log').select('id', { count: 'exact', head: true }).gte('deleted_at', d7).is('restored_at', null),
    admin.from('deletion_log').select('id', { count: 'exact', head: true }).gte('deleted_at', d30).is('restored_at', null),
    admin.from('deletion_log').select('table_name').is('restored_at', null).gte('deleted_at', d30),
  ]);

  const counts = new Map<string, number>();
  for (const row of (byTableRes.data ?? []) as any[]) {
    counts.set(row.table_name, (counts.get(row.table_name) ?? 0) + 1);
  }
  const byTable = Array.from(counts.entries())
    .map(([table_name, count]) => ({ table_name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalPending: pendingRes.count ?? 0,
    total7d: last7Res.count ?? 0,
    total30d: last30Res.count ?? 0,
    byTable,
  };
}

/**
 * Restaure une ligne soft-deleted — CEO uniquement.
 */
export async function restoreDeletionAction(
  logId: string,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let user;
  try {
    user = await assertRole(['ceo']);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Permission refusée' };
  }
  const r = await restoreDeletion({ logId, actorId: user.id, note });
  if (!r.ok) return r;
  revalidatePath('/dashboard/suppressions');
  return { ok: true };
}
