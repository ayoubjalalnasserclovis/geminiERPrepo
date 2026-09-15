'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

const schema = z.object({
  template_id: z.string().uuid().optional().nullable(),
  custom_notes: z.string().optional().nullable(),
  custom_inspirations: z.string().optional().nullable(), // CSV d'URLs
});

export async function saveMoodboardChoiceAction(projectId: string, input: unknown) {
  const me = await assertRole(['ceo','chef_projet']);
  const raw: any = { ...(input as any) };
  if (raw.template_id === '') raw.template_id = null;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const urls = (parsed.data.custom_inspirations ?? '')
    .split(/[\n,]/).map(s => s.trim()).filter(Boolean);

  const { data: existing } = await supabase.from('project_moodboard_choices')
    .select('id, status').eq('project_id', projectId).maybeSingle();

  if (existing) {
    if (existing.status === 'validated' && me.role !== 'ceo') {
      return { ok: false, error: 'Le moodboard est déjà validé par le client' };
    }
    await supabase.from('project_moodboard_choices').update({
      template_id: parsed.data.template_id,
      custom_notes: parsed.data.custom_notes,
      custom_inspirations_urls: urls,
      status: existing.status === 'sent_to_client' ? 'draft' : existing.status,
    }).eq('id', existing.id);
  } else {
    await supabase.from('project_moodboard_choices').insert({
      project_id: projectId,
      template_id: parsed.data.template_id,
      custom_notes: parsed.data.custom_notes,
      custom_inspirations_urls: urls,
      selected_by: me.id,
      status: 'draft',
    });
  }

  revalidatePath(`/projects/${projectId}/moodboard`);
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function sendMoodboardToClientAction(projectId: string) {
  const me = await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  const { error } = await supabase.from('project_moodboard_choices').update({
    status: 'sent_to_client',
  }).eq('project_id', projectId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/moodboard`);
  return { ok: true };
}

// ─── Client validation ───────────────────────────────────────────────────
export async function clientValidateMoodboardAction(projectId: string) {
  await assertRole(['client']);
  const supabase = createClient();
  const { error } = await supabase.from('project_moodboard_choices').update({
    status: 'validated',
    validated_by_client_at: new Date().toISOString(),
  }).eq('project_id', projectId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/client/projects/${projectId}/moodboard`);
  return { ok: true };
}

export async function clientRejectMoodboardAction(projectId: string, reason: string) {
  await assertRole(['client']);
  if (!reason || reason.trim().length < 5) {
    return { ok: false, error: 'Merci d\'indiquer ce que vous souhaitez modifier (5 caractères min)' };
  }
  const supabase = createClient();
  const { error } = await supabase.from('project_moodboard_choices').update({
    status: 'rejected',
    rejection_reason: reason.trim(),
  }).eq('project_id', projectId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/client/projects/${projectId}/moodboard`);
  return { ok: true };
}

// ─── Moodboard sélectionné = choix FINAL retenu (CEO 2026-08-19, session D) ─
// Avant : le choix final était noté en commentaire libre, introuvable.
// Désormais : champ structuré sur la fiche projet — un template du catalogue
// OU un libellé libre (mix de templates, brief WhatsApp…), avec qui/quand.
// Distinct des PRÉFÉRENCES client (client_moodboard_selections) qui restent
// affichées à côté : ici c'est ce que le studio EXÉCUTE.
const finalSchema = z.object({
  template_id: z.string().uuid().optional().nullable(),
  label: z.string().optional().nullable(),
});

export async function setMoodboardFinalAction(projectId: string, input: unknown) {
  const me = await assertRole(['ceo', 'chef_projet']);
  const raw: any = { ...(input as any) };
  if (raw.template_id === '') raw.template_id = null;
  if (typeof raw.label === 'string') raw.label = raw.label.trim() || null;
  const parsed = finalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  if (!parsed.data.template_id && !parsed.data.label) {
    return { ok: false as const, error: 'Choisis un moodboard du catalogue OU saisis un libellé libre.' };
  }

  const supabase = createClient();
  const { error } = await supabase.from('projects').update({
    moodboard_final_template_id: parsed.data.template_id ?? null,
    // Exclusifs : un template du catalogue OU un libellé libre
    moodboard_final_label: parsed.data.template_id ? null : parsed.data.label,
    moodboard_final_decided_at: new Date().toISOString(),
    moodboard_final_decided_by: me.id,
  }).eq('id', projectId);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/moodboard`);
  return { ok: true as const };
}

export async function clearMoodboardFinalAction(projectId: string) {
  await assertRole(['ceo', 'chef_projet']);
  const supabase = createClient();
  const { error } = await supabase.from('projects').update({
    moodboard_final_template_id: null,
    moodboard_final_label: null,
    moodboard_final_decided_at: null,
    moodboard_final_decided_by: null,
  }).eq('id', projectId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/moodboard`);
  return { ok: true as const };
}
