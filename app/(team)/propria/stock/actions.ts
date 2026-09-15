'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { normalizeFormData as clean, optionalUuid } from '@/lib/validators/zod-helpers';
import { logPropriaAudit, computeAuditDiff } from '@/lib/propria/audit';

// ─── Consommables ───────────────────────────────────────────────────────────

const consumableSchema = z.object({
  reference: z.string().optional().nullable(), // auto-générée si vide
  name: z.string().min(2),
  category: z.string().min(2),
  unit: z.string().min(1),
  unit_price_mad: z.coerce.number().positive(),
  min_threshold: z.coerce.number().nonnegative(),
  default_order_qty: z.coerce.number().positive(),
  supplier: z.string().min(1),
  initial_stock: z.coerce.number().nonnegative(),
  notes: z.string().optional().nullable(),
});

// Map catégorie → préfixe référence (3 lettres majuscules)
const CATEGORY_PREFIXES: Record<string, string> = {
  Cuisine: 'CUI',
  Linge: 'LIN',
  Toilettes: 'TOI',
  'Salle de bain': 'SDB',
  Ménage: 'MEN',
  Décoration: 'DEC',
  Mobilier: 'MOB',
  Électroménager: 'ELE',
  Vaisselle: 'VAI',
  'Petit-déjeuner': 'PDJ',
  Hygiène: 'HYG',
  Autre: 'AUT',
};

export async function createConsumableAction(formData: FormData) {
  const user = await assertRole(['ceo','assistante','propria']);
  const data = consumableSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();

  // Génère automatiquement la référence si non fournie
  let reference = data.reference;
  if (!reference || reference.trim() === '') {
    const prefix = CATEGORY_PREFIXES[data.category] ?? data.category.slice(0, 3).toUpperCase();
    // Cherche la plus grande référence existante avec ce préfixe pour incrémenter
    const { data: existing } = await supabase
      .from('propria_consumables')
      .select('reference')
      .like('reference', `${prefix}-%`)
      .order('reference', { ascending: false })
      .limit(1);
    let nextNum = 1;
    if (existing && existing.length > 0) {
      const m = String(existing[0].reference).match(/-(\d+)$/);
      if (m) nextNum = parseInt(m[1], 10) + 1;
    }
    reference = `${prefix}-${String(nextNum).padStart(3, '0')}`;
  }

  const { data: row, error } = await supabase
    .from('propria_consumables')
    .insert({ ...data, reference } as any)
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  await logPropriaAudit({
    supabase, table: 'propria_consumables', recordId: row.id,
    actorId: user.id, action: 'create',
    label: `Ajout article « ${data.name} » (${reference})`,
    payload: { name: data.name, reference, category: data.category },
  });

  revalidatePath('/propria/stock');
}

export async function updateConsumableAction(id: string, formData: FormData) {
  // CEO 2026-06-10 : ouvert au rôle propria.
  const user = await assertRole(['ceo','assistante','propria']);
  const data = consumableSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { data: before } = await supabase.from('propria_consumables').select('*').eq('id', id).single();
  const { error } = await supabase.from('propria_consumables').update(data as any).eq('id', id);
  if (error) throw new Error(error.message);

  const diff = computeAuditDiff(before as any, data as any);
  if (Object.keys(diff).length > 0) {
    await logPropriaAudit({
      supabase, table: 'propria_consumables', recordId: id,
      actorId: user.id, action: 'update',
      label: `Modification article « ${(before as any)?.name ?? '?'} »`,
      payload: diff,
    });
  }
  revalidatePath('/propria/stock');
}

export async function toggleConsumableActiveAction(id: string, isActive: boolean) {
  // CEO 2026-06-10 : ouvert au rôle propria.
  const user = await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase.from('propria_consumables').update({ is_active: isActive } as any).eq('id', id);
  if (error) throw new Error(error.message);

  await logPropriaAudit({
    supabase, table: 'propria_consumables', recordId: id,
    actorId: user.id, action: isActive ? 'restore' : 'delete',
    label: isActive ? `Activation de l'article` : `Désactivation de l'article`,
    payload: { is_active: isActive },
  });
  revalidatePath('/propria/stock');
}

// ─── Édition inline d'un champ (pour le tableau stock) ───────────────────

const PATCHABLE_FIELDS = [
  'name', 'category', 'unit', 'supplier',
  'unit_price_mad', 'min_threshold', 'default_order_qty', 'notes',
] as const;
type PatchableField = typeof PATCHABLE_FIELDS[number];

const NUMERIC_FIELDS: PatchableField[] = ['unit_price_mad', 'min_threshold', 'default_order_qty'];

export type PatchConsumableResult = { ok: true } | { ok: false; error: string };

export async function patchConsumableFieldAction(input: {
  id: string;
  field: string;
  value: string | null;
}): Promise<PatchConsumableResult> {
  try {
    await assertRole(['ceo', 'assistante', 'propria']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }
  if (!PATCHABLE_FIELDS.includes(input.field as PatchableField)) {
    return { ok: false, error: 'Champ non modifiable' };
  }

  let parsed: any = input.value;
  if (NUMERIC_FIELDS.includes(input.field as PatchableField)) {
    if (input.value === '' || input.value == null) {
      return { ok: false, error: 'Valeur requise' };
    }
    const n = Number(input.value);
    if (Number.isNaN(n) || n < 0) {
      return { ok: false, error: 'Nombre invalide (≥ 0)' };
    }
    parsed = n;
  } else {
    if (input.value && input.value.trim().length === 0) parsed = null;
    else if (input.value) parsed = input.value.trim();
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('propria_consumables')
    .update({ [input.field]: parsed } as any)
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/propria/stock');
  return { ok: true };
}

// ─── Ajustement direct du stock (crée un mouvement d'ajustement) ─────────

export type AdjustStockResult = { ok: true } | { ok: false; error: string };

export async function adjustStockAction(input: {
  consumable_id: string;
  new_stock: string;
  notes?: string | null;
}): Promise<AdjustStockResult> {
  let me;
  try {
    me = await assertRole(['ceo', 'assistante', 'propria']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }

  const target = Number(input.new_stock);
  if (Number.isNaN(target) || target < 0) {
    return { ok: false, error: 'Stock cible invalide' };
  }

  const supabase = createClient();

  // Récupère le stock courant via la vue
  const { data: status } = await supabase
    .from('propria_stock_status')
    .select('current_stock')
    .eq('id', input.consumable_id)
    .maybeSingle();

  const current = Number(status?.current_stock ?? 0);
  const delta = target - current;
  if (Math.abs(delta) < 0.001) return { ok: true };

  // Crée un mouvement d'ajustement : type 'ajustement' avec quantité = abs(delta)
  // movement_type='entree' si delta>0, 'sortie' si delta<0
  const movementType = delta > 0 ? 'entree' : 'sortie';
  const quantity = Math.abs(delta);

  const { error } = await supabase
    .from('propria_stock_movements')
    .insert({
      consumable_id: input.consumable_id,
      movement_type: movementType,
      movement_date: new Date().toISOString().slice(0, 10),
      quantity,
      notes: input.notes ?? `Ajustement direct (${current} → ${target})`,
      responsible_id: me.id,
    } as any);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/propria/stock');
  revalidatePath('/propria/stock/mouvements');
  return { ok: true };
}

// ─── Suppression d'un consommable (soft : passe is_active=false) ─────────

export async function archiveConsumableAction(id: string): Promise<PatchConsumableResult> {
  try {
    await assertRole(['ceo', 'assistante', 'propria']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_consumables')
    .update({ is_active: false } as any)
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/propria/stock');
  return { ok: true };
}

// ─── Mouvements ─────────────────────────────────────────────────────────────

const movementSchema = z.object({
  consumable_id: z.string().uuid(),
  movement_type: z.enum(['entree','sortie','ajustement']),
  movement_date: z.string(),
  quantity: z.coerce.number().positive(),
  unit_price_mad: z.coerce.number().optional().nullable(),
  source_destination: z.string().optional().nullable(),
  propria_unit_id: optionalUuid,
  notes: z.string().optional().nullable(),
});

export async function createMovementAction(formData: FormData) {
  const user = await assertRole(['ceo','assistante','propria']);
  const data = movementSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();

  // Règles métier sur le prix :
  // - Sortie / Ajustement : pas de prix saisi (valorisation auto depuis la fiche produit)
  // - Entrée : si l'utilisateur n'a rien saisi, on retombe sur le prix catalogue
  let unitPrice = data.unit_price_mad;
  if (data.movement_type !== 'entree') {
    unitPrice = null;
  } else if (unitPrice == null) {
    const { data: cons } = await supabase
      .from('propria_consumables')
      .select('unit_price_mad')
      .eq('id', data.consumable_id)
      .single();
    unitPrice = cons?.unit_price_mad ?? null;
  }

  const { error } = await supabase
    .from('propria_stock_movements')
    .insert({ ...data, unit_price_mad: unitPrice, responsible_id: user.id } as any);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/stock');
  revalidatePath('/propria/stock/mouvements');
}
