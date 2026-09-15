'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

/**
 * Server actions pour l'activité commerciale d'un projet :
 *   - createPropertyVisit / deletePropertyVisit
 *   - createProjectOffer / updateProjectOfferStatus / deleteProjectOffer
 *
 * Rôles autorisés : ceo, chef_projet, sourcing, developer
 */

const ALLOWED_ROLES = ['ceo', 'chef_projet', 'sourcing', 'developer'] as const;

// ─── Visites ──────────────────────────────────────────────────────────────

export async function createPropertyVisitAction(input: {
  project_id: string;
  property_id: string;
  visited_at: string;       // YYYY-MM-DD
  notes?: string;
  visited_by_user_id?: string;
}) {
  await assertRole([...ALLOWED_ROLES]);
  if (!input.project_id || !input.property_id || !input.visited_at) {
    return { ok: false, error: 'Projet, bien et date sont obligatoires.' };
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('property_visits')
    .insert({
      project_id: input.project_id,
      property_id: input.property_id,
      visited_at: input.visited_at,
      notes: input.notes ?? null,
      visited_by_user_id: input.visited_by_user_id ?? user?.id ?? null,
      created_by: user?.id ?? null,
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${input.project_id}`);
  revalidatePath(`/properties/${input.property_id}`);
  revalidatePath('/dashboard/sourcing/performance');
  return { ok: true, id: data.id };
}

export async function deletePropertyVisitAction(visit_id: string) {
  await assertRole([...ALLOWED_ROLES]);
  const supabase = createClient();
  const { data: v } = await supabase.from('property_visits')
    .select('project_id, property_id').eq('id', visit_id).single();
  const { error } = await supabase.from('property_visits')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', visit_id);
  if (error) return { ok: false, error: error.message };
  if (v?.project_id) revalidatePath(`/projects/${v.project_id}`);
  if (v?.property_id) revalidatePath(`/properties/${v.property_id}`);
  revalidatePath('/dashboard/sourcing/performance');
  return { ok: true };
}

// ─── Offres ───────────────────────────────────────────────────────────────

const OFFER_STATUSES = ['pending', 'accepted', 'rejected', 'counter'] as const;

export async function createProjectOfferAction(input: {
  project_id: string;
  property_id: string;
  offer_date: string;       // YYYY-MM-DD
  offer_amount: number;
  status?: typeof OFFER_STATUSES[number];
  counter_amount?: number | null;
  notes?: string;
}) {
  await assertRole([...ALLOWED_ROLES]);
  if (!input.project_id || !input.property_id || !input.offer_date || input.offer_amount == null) {
    return { ok: false, error: 'Projet, bien, date et montant sont obligatoires.' };
  }
  if (input.offer_amount < 0) {
    return { ok: false, error: 'Le montant doit être ≥ 0.' };
  }
  const status = input.status ?? 'pending';
  if (!OFFER_STATUSES.includes(status)) {
    return { ok: false, error: 'Statut invalide.' };
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('project_offers')
    .insert({
      project_id: input.project_id,
      property_id: input.property_id,
      offer_date: input.offer_date,
      offer_amount: input.offer_amount,
      status,
      counter_amount: input.counter_amount ?? null,
      notes: input.notes ?? null,
      created_by: user?.id ?? null,
    })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${input.project_id}`);
  revalidatePath(`/properties/${input.property_id}`);
  revalidatePath('/dashboard/sourcing/performance');
  return { ok: true, id: data.id };
}

export async function updateProjectOfferStatusAction(
  offer_id: string,
  status: typeof OFFER_STATUSES[number],
  counter_amount?: number | null,
) {
  await assertRole([...ALLOWED_ROLES]);
  if (!OFFER_STATUSES.includes(status)) {
    return { ok: false, error: 'Statut invalide.' };
  }
  const supabase = createClient();
  const { data: o } = await supabase.from('project_offers')
    .select('project_id, property_id').eq('id', offer_id).single();
  const { error } = await supabase
    .from('project_offers')
    .update({
      status,
      counter_amount: counter_amount ?? null,
    })
    .eq('id', offer_id);
  if (error) return { ok: false, error: error.message };
  if (o?.project_id) revalidatePath(`/projects/${o.project_id}`);
  if (o?.property_id) revalidatePath(`/properties/${o.property_id}`);
  revalidatePath('/dashboard/sourcing/performance');
  return { ok: true };
}

export async function deleteProjectOfferAction(offer_id: string) {
  await assertRole([...ALLOWED_ROLES]);
  const supabase = createClient();
  const { data: o } = await supabase.from('project_offers')
    .select('project_id, property_id').eq('id', offer_id).single();
  const { error } = await supabase.from('project_offers')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', offer_id);
  if (error) return { ok: false, error: error.message };
  if (o?.project_id) revalidatePath(`/projects/${o.project_id}`);
  if (o?.property_id) revalidatePath(`/properties/${o.property_id}`);
  revalidatePath('/dashboard/sourcing/performance');
  return { ok: true };
}

// NB : compromis_date est géré dans components/projects/project-dates-card.tsx
// (avec toutes les autres dates du projet : sourcing, onboarding, compromis,
// acte authentique, travaux, livraison). Une seule source de vérité, pas de
// double porte d'entrée.
