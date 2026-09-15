'use server';

// ─── Chantier 1 marathon — actions Gestion des Clés ─────────────────────────
// Canon : on n'écrit JAMAIS un comptage ni current_location directement.
// Ajouter une clé = INSERT propria_keys (naît au bureau).
// Déplacer une clé = INSERT propria_key_movements (le trigger BDD met à jour
// l'emplacement courant). Les compteurs sont dérivés (vue propria_unit_keys_status).

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

type Result = { ok: true } | { ok: false; error: string };

const LOCATIONS = ['boite_voyageur', 'armoire_logement', 'bureau', 'externe', 'perdue'] as const;

function revalidateKeys(unitPropertyId?: string) {
  revalidatePath('/propria/cles');
  if (unitPropertyId) revalidatePath(`/propria/biens/${unitPropertyId}`);
}

// ─── Ajouter un jeu de clés (naît au bureau, mouvement initial implicite) ────
const addKeySchema = z.object({
  propria_unit_id: z.string().uuid(),
  property_id: z.string().uuid(),
  key_type: z.enum(['voyageur', 'reserve', 'securite']).default('reserve'),
  label: z.string().max(100).optional(),
});

export async function addKeyAction(formData: FormData): Promise<Result> {
  try {
    const me = await assertRole(['ceo', 'assistante', 'propria']);
    const input = addKeySchema.parse(Object.fromEntries(formData));
    const supabase = createClient();

    // Numéro = max + 1 parmi les jeux actifs du lot (pas de saisie manuelle)
    const { data: maxRow, error: maxErr } = await supabase
      .from('propria_keys')
      .select('key_number')
      .eq('propria_unit_id', input.propria_unit_id)
      .is('deleted_at', null)
      .order('key_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxErr) return { ok: false, error: maxErr.message };

    const { error } = await supabase.from('propria_keys').insert({
      propria_unit_id: input.propria_unit_id,
      key_number: (maxRow?.key_number ?? 0) + 1,
      key_type: input.key_type,
      label: input.label || null,
      created_by: me.id,
    });
    if (error) return { ok: false, error: error.message };

    revalidateKeys(input.property_id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}

// ─── Déplacer un jeu de clés ─────────────────────────────────────────────────
const moveKeySchema = z.object({
  key_id: z.string().uuid(),
  property_id: z.string().uuid(),
  to_location: z.enum(LOCATIONS),
  reason: z.string().max(200).optional(),
});

export async function moveKeyAction(formData: FormData): Promise<Result> {
  try {
    const me = await assertRole(['ceo', 'assistante', 'propria']);
    const input = moveKeySchema.parse(Object.fromEntries(formData));
    const supabase = createClient();

    const { error } = await supabase.from('propria_key_movements').insert({
      key_id: input.key_id,
      to_location: input.to_location,
      reason: input.reason || null,
      moved_by: me.id,
    });
    if (error) return { ok: false, error: error.message };

    revalidateKeys(input.property_id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}

// ─── Retirer un jeu (soft-delete, CEO uniquement) ────────────────────────────
const deleteKeySchema = z.object({
  key_id: z.string().uuid(),
  property_id: z.string().uuid(),
  reason: z.string().min(5, 'Raison requise (min 5 caractères)'),
});

export async function softDeleteKeyAction(formData: FormData): Promise<Result> {
  try {
    const me = await assertRole(['ceo']);
    const input = deleteKeySchema.parse(Object.fromEntries(formData));
    const supabase = createClient();

    const { error } = await supabase
      .from('propria_keys')
      .update({ deleted_at: new Date().toISOString(), notes: `Retiré : ${input.reason}` })
      .eq('id', input.key_id)
      .is('deleted_at', null);
    if (error) return { ok: false, error: error.message };

    const { error: auditErr } = await supabase.from('propria_audit_log').insert({
      table_name: 'propria_keys',
      record_id: input.key_id,
      actor_id: me.id,
      action: 'delete',
      label: 'Jeu de clés retiré',
      payload: { reason: input.reason },
    });
    if (auditErr) return { ok: false, error: auditErr.message };

    revalidateKeys(input.property_id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}

// ─── Clé sécurité : emplacement + code (historisé par trigger BDD) ──────────
const securitySchema = z.object({
  propria_unit_id: z.string().uuid(),
  property_id: z.string().uuid(),
  propria_security_key_location: z.string().max(200).optional(),
  propria_security_key_code: z.string().max(50).optional(),
});

export async function updateSecurityKeyAction(formData: FormData): Promise<Result> {
  try {
    await assertRole(['ceo', 'assistante', 'propria']);
    const input = securitySchema.parse(Object.fromEntries(formData));
    const supabase = createClient();

    const { error } = await supabase
      .from('propria_units')
      .update({
        propria_security_key_location: input.propria_security_key_location || null,
        propria_security_key_code: input.propria_security_key_code || null,
      })
      .eq('id', input.propria_unit_id)
      .is('deleted_at', null);
    if (error) return { ok: false, error: error.message };

    revalidateKeys(input.property_id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}
