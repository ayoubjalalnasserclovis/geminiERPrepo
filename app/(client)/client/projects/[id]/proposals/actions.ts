'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { proposalResponseSchema } from '@/lib/validators/schemas';
import { sendProposalResponseToTeam } from '@/lib/email/templates';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function respondToProposalAction(input: unknown) {
  await assertRole(['client']);
  const parsed = proposalResponseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data, error } = await supabase.rpc('respond_to_proposal', {
    p_proposal_id: parsed.data.proposal_id,
    p_response: parsed.data.response,
    p_refusal_reason: parsed.data.refusal_reason ?? null,
    p_message: parsed.data.message ?? null,
  });

  if (error) return { ok: false, error: error.message };

  // Email à l'équipe
  try {
    const admin = createAdminClient();
    const { data: prop } = await admin.from('property_proposals')
      .select('project_id, property:properties(name), project:projects(reference, assigned_chef_projet, client:clients(full_name))')
      .eq('id', parsed.data.proposal_id).single();
    const proj: any = (prop as any)?.project;
    const recipients: { email: string; full_name: string }[] = [];
    if (proj?.assigned_chef_projet) {
      const { data: chef } = await admin.from('profiles')
        .select('email, full_name').eq('id', proj.assigned_chef_projet).single();
      if (chef?.email) recipients.push(chef);
    }
    const { data: ceos } = await admin.from('profiles')
      .select('email, full_name').eq('role', 'ceo').eq('is_active', true);
    (ceos ?? []).forEach((c: any) => {
      if (!recipients.find(r => r.email === c.email)) recipients.push(c);
    });
    for (const r of recipients) {
      await sendProposalResponseToTeam({
        to: r.email, chef_name: r.full_name,
        client_name: proj?.client?.full_name ?? '',
        property_name: (prop as any)?.property?.name ?? '',
        response: parsed.data.response as any,
        message: parsed.data.message ?? null,
        project_url: `${APP_URL}/projects/${(prop as any)?.project_id}/proposals`,
        project_id: (prop as any)?.project_id,
      });
    }
  } catch (e) { console.warn('[email-proposal-response] echec', e); }

  revalidatePath('/client', 'layout');
  return { ok: true, data };
}

export async function markProposalViewedAction(proposalId: string) {
  await assertRole(['client']);
  const supabase = createClient();
  await supabase.from('property_proposals')
    .update({ viewed_at: new Date().toISOString() })
    .eq('id', proposalId)
    .is('viewed_at', null);
  return { ok: true };
}

/**
 * Récupère les médias du bien lié à une proposition + URLs signées 1h.
 * RLS : la table property_media autorise le SELECT au client si le bien
 * lui a été proposé. Storage RLS idem. Donc l'utilisation du client serveur
 * (héritant des credentials du user) est suffisante.
 */
export async function getProposalMedia(proposalId: string) {
  const supabase = createClient();

  const { data: proposal } = await supabase
    .from('property_proposals')
    .select('property_id')
    .eq('id', proposalId)
    .single();

  if (!proposal) return [];

  const { data: media } = await supabase
    .from('property_media')
    .select('id, type, storage_path, is_cover, display_order')
    .eq('property_id', proposal.property_id)
    .order('display_order');

  if (!media || media.length === 0) return [];

  // ── Batch des URLs signées en UNE seule requête (vs une par fichier)
  const paths = media.map(m => m.storage_path);
  const { data: signed } = await supabase.storage
    .from('property-media')
    .createSignedUrls(paths, 3600);

  const urlByPath = new Map<string, string>();
  (signed ?? []).forEach(s => {
    if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
  });

  return media.map(m => ({
    ...m,
    url: urlByPath.get(m.storage_path) ?? null,
  }));
}
