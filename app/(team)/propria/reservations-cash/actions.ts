'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { normalizeFormData as clean, optionalUuid } from '@/lib/validators/zod-helpers';

const schema = z.object({
  propria_unit_id: z.string().uuid(),
  voyageur_name: z.string().optional().nullable(),
  arrival_date: z.string().optional().nullable(),
  departure_date: z.string().optional().nullable(),
  nb_nights: z.coerce.number().int().optional().nullable(),
  amount_mad: z.coerce.number().positive(),
  assistant_id: optionalUuid,
  observations: z.string().optional().nullable(),
});

export async function createCashReservationAction(formData: FormData) {
  await assertRole(['ceo','assistante','propria']);
  const data = schema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_cash_reservations')
    .insert({ ...data, property_id: null } as any);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/reservations-cash');
}

export async function markRecoveredAction(id: string) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { data: resa } = await supabase
    .from('propria_cash_reservations')
    .select('id, recovered, remitted_to_ceo')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!resa) throw new Error('Réservation cash introuvable.');
  if (resa.remitted_to_ceo) {
    throw new Error('Impossible de modifier : le cash a déjà été remis au CEO.');
  }
  const { error } = await supabase
    .from('propria_cash_reservations')
    .update({
      recovered: true,
      recovered_at: new Date().toISOString().slice(0, 10),
    } as any)
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/reservations-cash');
}

// ─── Résas directes hors OTA (chantier 14, décision A3) ─────────────────────
// Hostaway reste unidirectionnel : ces résas vivent dans
// propria_direct_reservations (auto-remontée interne). Le reste à encaisser
// est TOUJOURS dérivé (total_price_mad − collected_mad) — convention n°1.

const directSchema = z.object({
  propria_unit_id: z.string().uuid('Choisissez un lot'),
  guest_name: z.string().min(1, 'Nom voyageur requis'),
  guest_contact: z.string().optional().nullable(),
  arrival_date: z.string().min(1, 'Date d’arrivée requise'),
  departure_date: z.string().min(1, 'Date de départ requise'),
  total_price_mad: z.coerce.number().min(0, 'Le prix ne peut pas être négatif'),
  notes: z.string().optional().nullable(),
});

export async function createDirectReservationAction(formData: FormData) {
  const user = await assertRole(['ceo', 'assistante', 'propria']);
  const data = directSchema.parse(clean(Object.fromEntries(formData)));
  if (data.departure_date <= data.arrival_date) {
    throw new Error('La date de départ doit être après la date d’arrivée.');
  }
  const supabase = createClient();
  // reservation_code généré côté BDD (DEFAULT 'DIR-' + 6 hex)
  const { error } = await supabase
    .from('propria_direct_reservations')
    .insert({ ...data, created_by: user.id } as any);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/reservations-cash');
}

/**
 * Encaisse un montant sur une résa directe : on incrémente collected_mad
 * (source = cumul des encaissements). Garde-fou : pas d'encaissement
 * au-delà du prix total.
 */
export async function collectDirectReservationAction(id: string, amountMad: number) {
  await assertRole(['ceo', 'assistante', 'propria']);
  if (!Number.isFinite(amountMad) || amountMad <= 0) {
    throw new Error('Montant encaissé invalide.');
  }
  const supabase = createClient();
  const { data: resa, error: readErr } = await supabase
    .from('propria_direct_reservations')
    .select('id, total_price_mad, collected_mad')
    .eq('id', id).is('deleted_at', null).single();
  if (readErr || !resa) throw new Error('Résa directe introuvable.');
  const total = Number((resa as any).total_price_mad ?? 0);
  const collected = Number((resa as any).collected_mad ?? 0);
  const reste = total - collected; // dérivé, jamais stocké
  if (amountMad > reste + 0.001) {
    throw new Error(`Encaissement supérieur au reste dû (${reste.toFixed(0)} MAD).`);
  }
  const { error } = await supabase
    .from('propria_direct_reservations')
    .update({ collected_mad: collected + amountMad } as any)
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/reservations-cash');
}

// ─── Tâche terrain de collecte cash (chantier 14, point 2) ──────────────────
// Crée une propria_interventions kind='tache' avec le code résa propagé dans
// hostaway_ref. Anti-doublon : une tâche de collecte OUVERTE par résa max.

/** Statuts considérés « ouverts » pour la déduplication. */
const OPEN_TASK_STATUSES = ['a_traiter', 'en_cours', 'a_valider', 'refusee'];

const collectTaskSchema = z.object({
  source: z.enum(['cash', 'direct']),
  reservation_id: z.string().uuid(),
  assigned_to_id: optionalUuid,
  due_date: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export async function createCollectTaskAction(input: unknown) {
  const user = await assertRole(['ceo', 'assistante', 'propria']);
  const parsed = collectTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const { source, reservation_id, assigned_to_id, due_date, note } = parsed.data;
  const supabase = createClient();

  // 1) Charge la résa source + calcule le montant à collecter (dérivé)
  let ref: string;
  let montant: number;
  let voyageur: string | null;
  let unitId: string | null;
  if (source === 'cash') {
    const { data: r } = await supabase
      .from('propria_cash_reservations')
      .select('id, amount_mad, voyageur_name, propria_unit_id, recovered')
      .eq('id', reservation_id).is('deleted_at', null).single();
    if (!r) return { ok: false as const, error: 'Réservation cash introuvable.' };
    if ((r as any).recovered) {
      return { ok: false as const, error: 'Cash déjà récupéré sur cette résa.' };
    }
    ref = `CASH-${reservation_id.slice(0, 8).toUpperCase()}`;
    montant = Number((r as any).amount_mad ?? 0);
    voyageur = (r as any).voyageur_name ?? null;
    unitId = (r as any).propria_unit_id ?? null;
  } else {
    const { data: r } = await supabase
      .from('propria_direct_reservations')
      .select('id, reservation_code, guest_name, total_price_mad, collected_mad, propria_unit_id')
      .eq('id', reservation_id).is('deleted_at', null).single();
    if (!r) return { ok: false as const, error: 'Résa directe introuvable.' };
    const reste = Number((r as any).total_price_mad ?? 0) - Number((r as any).collected_mad ?? 0);
    if (reste <= 0) return { ok: false as const, error: 'Rien à encaisser sur cette résa.' };
    ref = (r as any).reservation_code as string;
    montant = reste;
    voyageur = (r as any).guest_name ?? null;
    unitId = (r as any).propria_unit_id ?? null;
  }

  // 2) Anti-doublon : tâche de collecte ouverte déjà liée à cette résa ?
  const { data: existing } = await supabase
    .from('propria_interventions')
    .select('id')
    .eq('kind', 'tache')
    .eq('hostaway_ref', ref)
    .in('status', OPEN_TASK_STATUSES)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return { ok: true as const, already: true as const, interventionId: (existing as any).id as string };
  }

  // 3) Création de la tâche terrain (Option B : propria_unit_id seul, jamais
  // les deux FK — contrainte scope_check de propria_interventions).
  if (!unitId) {
    return { ok: false as const, error: 'Cette résa n’est liée à aucun lot — impossible de créer la tâche.' };
  }
  const fmtMontant = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(montant);
  const description =
    `Collecte cash ${fmtMontant} MAD — résa ${ref} — ${voyageur ?? 'Voyageur'}` +
    (note ? `\n${note}` : '');
  const { data: task, error: insErr } = await supabase
    .from('propria_interventions')
    .insert({
      property_id: null,
      propria_unit_id: unitId,
      kind: 'tache',
      description,
      urgency: 'normale',
      status: 'a_traiter',
      occurred_at: new Date().toISOString().slice(0, 10),
      due_date: due_date || null,
      assigned_to_id: assigned_to_id ?? null,
      hostaway_ref: ref,
      hostaway_integrated: false,
      created_by: user.id,
    } as any)
    .select('id').single();
  if (insErr) return { ok: false as const, error: insErr.message };

  revalidatePath('/propria/reservations-cash');
  revalidatePath('/propria/interventions');
  return { ok: true as const, already: false as const, interventionId: (task as any).id as string };
}

/**
 * SEUL le CEO peut marquer le cash comme remis.
 * Sécurité : on vérifie le rôle.
 */
export async function markRemittedToCeoAction(id: string) {
  const user = await assertRole(['ceo']);
  const supabase = createClient();
  const { data: resa } = await supabase
    .from('propria_cash_reservations')
    .select('id, recovered, remitted_to_ceo')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!resa) throw new Error('Réservation cash introuvable.');
  if (resa.remitted_to_ceo) {
    throw new Error('Cette réservation a déjà été remise au CEO.');
  }
  if (!resa.recovered) {
    throw new Error('Le cash doit d\'abord être marqué comme récupéré auprès du voyageur.');
  }
  const { error } = await supabase
    .from('propria_cash_reservations')
    .update({
      remitted_to_ceo: true,
      remitted_at: new Date().toISOString().slice(0, 10),
      remitted_confirmed_by: user.id,
    } as any)
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/reservations-cash');
}
