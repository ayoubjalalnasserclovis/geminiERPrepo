'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { normalizeFormData as clean } from '@/lib/validators/zod-helpers';

const invSchema = z.object({
  propria_unit_id: z.string().uuid(),
  inventory_date: z.string(),
  type: z.enum(['general','entree','sortie','controle']),
  notes: z.string().optional().nullable(),
});

export async function createInventoryAction(formData: FormData) {
  const user = await assertRole(['ceo','assistante','propria']);
  const data = invSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { data: row, error } = await supabase
    .from('propria_inventories')
    .insert({ ...data, performed_by: user.id } as any)
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // 🌱 Auto-seed les items du template (checklist par catégorie)
  // L'équipe terrain n'a plus à réfléchir à QUOI inventorier — tout est pré-rempli.
  await seedInventoryFromTemplate(row.id);

  revalidatePath('/propria/inventaires');
  redirect(`/propria/inventaires/${row.id}`);
}

/**
 * Pré-remplit un inventaire vide avec tous les items standards du catalogue.
 * Appelée auto à la création, ou à la demande via re-seed.
 */
async function seedInventoryFromTemplate(inventoryId: string) {
  const supabase = createClient();
  const { data: templates } = await supabase
    .from('propria_inventory_template_items')
    .select('id, category, name, default_quantity, display_order')
    .eq('is_active', true)
    .order('display_order');

  if (!templates || templates.length === 0) return;

  const rows = templates.map((t: any) => ({
    inventory_id: inventoryId,
    template_item_id: t.id,
    category: t.category,
    name: t.name,
    quantity_expected: t.default_quantity,
    quantity_found: null,
    condition: null,
  }));

  const { error } = await supabase.from('propria_inventory_items').insert(rows as any);
  if (error) throw new Error(`Échec seeding inventaire : ${error.message}`);
}

/**
 * Re-applique le seeding sur un inventaire existant.
 * N'ajoute QUE les items du template qui ne sont pas déjà présents.
 */
export async function reseedInventoryAction(inventoryId: string) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();

  const [tplRes, existingRes] = await Promise.all([
    supabase.from('propria_inventory_template_items')
      .select('id, category, name, default_quantity').eq('is_active', true).order('display_order'),
    supabase.from('propria_inventory_items')
      .select('template_item_id').eq('inventory_id', inventoryId),
  ]);

  const existingIds = new Set(
    (existingRes.data ?? [])
      .map((r: any) => r.template_item_id)
      .filter(Boolean),
  );

  const missing = (tplRes.data ?? []).filter((t: any) => !existingIds.has(t.id));
  if (missing.length === 0) return;

  const rows = missing.map((t: any) => ({
    inventory_id: inventoryId,
    template_item_id: t.id,
    category: t.category,
    name: t.name,
    quantity_expected: t.default_quantity,
  }));

  const { error } = await supabase.from('propria_inventory_items').insert(rows as any);
  if (error) throw new Error(error.message);
  revalidatePath(`/propria/inventaires/${inventoryId}`);
}

/**
 * Mise à jour rapide d'un item (quantité trouvée, état, observation).
 * Utilisée par les lignes de la checklist (auto-save sur changement).
 */
const updateItemSchema = z.object({
  item_id: z.string().uuid(),
  inventory_id: z.string().uuid(),
  quantity_found: z.coerce.number().int().optional().nullable(),
  condition: z.enum(['neuf','bon','usage','endommage','manquant']).optional().nullable(),
  observations: z.string().optional().nullable(),
});

export async function updateInventoryItemAction(formData: FormData) {
  await assertRole(['ceo','assistante','propria']);
  const data = updateItemSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_inventory_items')
    .update({
      quantity_found: data.quantity_found,
      condition: data.condition,
      observations: data.observations,
    } as any)
    .eq('id', data.item_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/propria/inventaires/${data.inventory_id}`);
}

/**
 * Marque toute une catégorie comme "absente" en un clic.
 * Utile pour les biens sans terrasse / sans 2e chambre / etc.
 */
export async function markCategoryAbsentAction(inventoryId: string, category: string) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_inventory_items')
    .update({ quantity_found: 0, condition: 'manquant' } as any)
    .eq('inventory_id', inventoryId)
    .eq('category', category);
  if (error) throw new Error(error.message);
  revalidatePath(`/propria/inventaires/${inventoryId}`);
}

export async function completeInventoryAction(id: string) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_inventories')
    .update({ status: 'termine' } as any)
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/propria/inventaires/${id}`);
  revalidatePath('/propria/inventaires');
}

const itemSchema = z.object({
  inventory_id: z.string().uuid(),
  category: z.string().optional().nullable(),
  name: z.string().min(1),
  quantity_expected: z.coerce.number().int().default(1),
  quantity_found: z.coerce.number().int().optional().nullable(),
  condition: z.enum(['neuf','bon','usage','endommage','manquant']).optional().nullable(),
  observations: z.string().optional().nullable(),
});

export async function addInventoryItemAction(formData: FormData) {
  await assertRole(['ceo','assistante','propria']);
  const data = itemSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase.from('propria_inventory_items').insert(data as any);
  if (error) throw new Error(error.message);
  revalidatePath(`/propria/inventaires/${data.inventory_id}`);
}

export async function deleteInventoryItemAction(itemId: string, inventoryId: string) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase.from('propria_inventory_items').delete().eq('id', itemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/propria/inventaires/${inventoryId}`);
}
