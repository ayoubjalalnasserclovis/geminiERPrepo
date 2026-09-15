'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { sendBriefSentToClient } from '@/lib/email/templates';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

const briefSchema = z.object({
  property_types: z.array(z.string()).default([]),
  quartiers: z.array(z.string()).default([]),
  budget_total_max: z.coerce.number().min(0).optional().nullable(),
  budget_acquisition_max: z.coerce.number().min(0).optional().nullable(),
  budget_travaux_max: z.coerce.number().min(0).optional().nullable(),
  budget_deco_max: z.coerce.number().min(0).optional().nullable(),
  available_savings: z.coerce.number().min(0).optional().nullable(),
  financing_type: z.enum(['fonds_propres','banque_classique','banque_islamique','mixte']).optional().nullable(),
  superficie_min: z.coerce.number().min(0).optional().nullable(),
  superficie_max: z.coerce.number().min(0).optional().nullable(),
  nb_suites_min: z.coerce.number().int().min(0).optional().nullable(),
  floor_preference: z.string().optional().nullable(),
  needs_terrace: z.boolean().optional().nullable(),
  needs_elevator: z.boolean().optional().nullable(),
  needs_parking: z.boolean().optional().nullable(),
  needs_pool: z.boolean().optional().nullable(),
  needs_view: z.boolean().optional().nullable(),
  rental_strategy: z.enum(['courte_duree','moyenne_duree','longue_duree','mixte','indecis']).optional().nullable(),
  expected_rent_monthly: z.coerce.number().min(0).optional().nullable(),
  expected_gross_yield_pct: z.coerce.number().min(0).max(100).optional().nullable(),
  expected_net_yield_pct: z.coerce.number().min(0).max(100).optional().nullable(),
  accept_heavy_works: z.boolean().optional().nullable(),
  accept_division: z.boolean().optional().nullable(),
  delivery_deadline: z.string().optional().nullable(),
  specificities: z.string().optional().nullable(),
  exclusions: z.string().optional().nullable(),
  chef_notes: z.string().optional().nullable(),
});

function clean(raw: any) {
  const o: any = { ...raw };
  // Booleens depuis FormData ("on" / undefined)
  for (const k of ['needs_terrace','needs_elevator','needs_parking','needs_pool','needs_view',
                   'accept_heavy_works','accept_division']) {
    if (typeof o[k] === 'string') o[k] = o[k] === 'on' || o[k] === 'true';
    else if (o[k] === undefined) o[k] = null;
  }
  // Strings vides → null
  for (const k of ['floor_preference','financing_type','rental_strategy','specificities','exclusions','chef_notes','delivery_deadline']) {
    if (o[k] === '') o[k] = null;
  }
  // Nombres vides → null
  for (const k of ['budget_total_max','budget_acquisition_max','budget_travaux_max','budget_deco_max',
                   'available_savings','superficie_min','superficie_max','nb_suites_min',
                   'expected_rent_monthly','expected_gross_yield_pct','expected_net_yield_pct']) {
    if (o[k] === '' || o[k] == null) o[k] = null;
  }
  // Arrays multiples
  if (typeof o.property_types === 'string') o.property_types = [o.property_types];
  if (!Array.isArray(o.property_types)) o.property_types = [];
  if (typeof o.quartiers === 'string') o.quartiers = [o.quartiers];
  if (!Array.isArray(o.quartiers)) o.quartiers = [];
  return o;
}

export async function saveBriefAction(projectId: string, formData: FormData) {
  const me = await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  // Conversion FormData → objet, en récupérant les arrays
  const raw: any = {};
  for (const [k, v] of formData.entries()) {
    if (raw[k] !== undefined) {
      if (Array.isArray(raw[k])) raw[k].push(v);
      else raw[k] = [raw[k], v];
    } else {
      raw[k] = v;
    }
  }
  raw.property_types = formData.getAll('property_types');
  raw.quartiers = formData.getAll('quartiers');

  const parsed = briefSchema.safeParse(clean(raw));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  // Upsert : un seul brief par projet (UNIQUE constraint)
  const { data: existing } = await supabase.from('project_briefs')
    .select('id, status').eq('project_id', projectId).maybeSingle();

  if (existing) {
    // Si déjà validé, on n'autorise pas la modification (sauf CEO qui peut tout)
    if (existing.status === 'validated' && me.role !== 'ceo') {
      return { ok: false, error: 'Le cahier des charges est déjà validé. Contactez le CEO pour le rouvrir.' };
    }
    // Si en attente client, modifier = repasse en draft (le client devra re-valider)
    const { error } = await supabase.from('project_briefs').update({
      ...parsed.data,
      status: existing.status === 'sent_to_client' ? 'draft' : existing.status,
      sent_at: existing.status === 'sent_to_client' ? null : undefined,
    }).eq('id', existing.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase.from('project_briefs').insert({
      project_id: projectId,
      filled_by: me.id,
      status: 'draft',
      ...parsed.data,
    });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/projects/${projectId}/brief`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function sendBriefToClientAction(projectId: string) {
  const me = await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  const { data: brief } = await supabase.from('project_briefs')
    .select('id, status').eq('project_id', projectId).single();
  if (!brief) return { ok: false, error: 'Cahier des charges introuvable' };
  if (brief.status === 'validated') return { ok: false, error: 'Déjà validé' };
  if (brief.status === 'sent_to_client') return { ok: false, error: 'Déjà envoyé au client' };

  const { error } = await supabase.from('project_briefs').update({
    status: 'sent_to_client',
    sent_at: new Date().toISOString(),
    sent_by: me.id,
    rejected_at: null,
    rejection_reason: null,
  }).eq('id', brief.id);
  if (error) return { ok: false, error: error.message };

  // Email au client
  try {
    const admin = createAdminClient();
    const { data: proj } = await admin.from('projects')
      .select('client:clients(email, full_name)').eq('id', projectId).single();
    const client = (proj as any)?.client;
    if (client?.email) {
      await sendBriefSentToClient({
        to: client.email,
        client_name: client.full_name,
        portal_url: `${APP_URL}/client/projects/${projectId}/brief`,
        project_id: projectId,
      });
    }
  } catch (e) { console.warn('[email-brief-sent] echec', e); }

  revalidatePath(`/projects/${projectId}/brief`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function reopenBriefAction(projectId: string) {
  // Permet au CEO de rouvrir un brief validé (en cas de besoin)
  const me = await assertRole(['ceo']);
  const supabase = createClient();
  const { error } = await supabase.from('project_briefs').update({
    status: 'draft',
    validated_at: null,
    rejected_at: null,
    rejection_reason: null,
    sent_at: null,
  }).eq('project_id', projectId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/brief`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
