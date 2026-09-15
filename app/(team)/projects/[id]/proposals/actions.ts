'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { sendProposalSchema } from '@/lib/validators/schemas';
import { sendNewProposal, sendFinalPropertySelected } from '@/lib/email/templates';
import { logFinanceAudit } from '@/lib/finance/audit';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function sendProposalAction(input: unknown) {
  await assertRole(['ceo','chef_projet']);
  const parsed = sendProposalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data, error } = await supabase.rpc('send_proposal', {
    p_project_id: parsed.data.project_id,
    p_property_id: parsed.data.property_id,
  });
  if (error) return { ok: false, error: error.message };

  // Email client
  const { data: project } = await supabase.from('projects')
    .select('id, client:clients(email, full_name)')
    .eq('id', parsed.data.project_id).single();
  const { data: property } = await supabase.from('properties')
    .select('name').eq('id', parsed.data.property_id).single();

  if ((project as any)?.client?.email && property?.name) {
    await sendNewProposal({
      to: (project as any).client.email,
      client_name: (project as any).client.full_name,
      property_name: property.name,
      portal_url: `${process.env.NEXT_PUBLIC_APP_URL}/client/projects/${parsed.data.project_id}/proposals`,
      project_id: parsed.data.project_id,
    });
  }

  revalidatePath(`/projects/${parsed.data.project_id}`);
  revalidatePath(`/projects/${parsed.data.project_id}/proposals`);
  return { ok: true, proposal_id: (data as any)?.proposal_id };
}

// ─── Sélection définitive du bien du projet ─────────────────────────────
export async function selectFinalPropertyAction(input: { project_id: string; property_id: string }) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  const { error } = await supabase.rpc('select_final_property', {
    p_project_id: input.project_id,
    p_property_id: input.property_id,
  });
  if (error) return { ok: false, error: error.message };

  // Email au client
  try {
    const admin = createAdminClient();
    const { data: proj } = await admin.from('projects')
      .select('client:clients(email, full_name), property:properties(name, quartier)').eq('id', input.project_id).single();
    const client = (proj as any)?.client;
    const prop = (proj as any)?.property;
    if (client?.email && prop?.name) {
      await sendFinalPropertySelected({
        to: client.email, client_name: client.full_name,
        property_name: prop.name,
        property_quartier: prop.quartier ?? null,
        portal_url: `${APP_URL}/client/projects/${input.project_id}`,
        project_id: input.project_id,
      });
    }
  } catch (e) { console.warn('[email-final-property] echec', e); }

  revalidatePath(`/projects/${input.project_id}`);
  revalidatePath(`/projects/${input.project_id}/proposals`);
  return { ok: true };
}

// ─── Sélection définitive PAR PROCURATION (CEO 2026-08-31) ────────────────
// Quand le client est indisponible (vacances, no-show), le chef de projet peut
// valider un bien à sa place. Motif obligatoire (≥ 10 chars). Bannière ambre
// affichée sur la fiche projet + log dans finance_audit_log. L'email de
// félicitations reste envoyé au client (identique au flow normal).
export async function selectFinalPropertyOnBehalfAction(input: {
  project_id: string;
  property_id: string;
  reason: string;
}) {
  try {
    await assertRole(['ceo', 'chef_projet']);
    const reason = (input.reason ?? '').trim();
    if (reason.length < 10) {
      return { ok: false as const, error: 'Le motif doit contenir au moins 10 caractères.' };
    }
    const supabase = createClient();
    const { error } = await supabase.rpc('select_final_property_on_behalf', {
      p_project_id: input.project_id,
      p_property_id: input.property_id,
      p_reason: reason,
    });
    if (error) return { ok: false as const, error: error.message };

    // Email au client (identique au flow normal — le CEO l'a confirmé)
    try {
      const admin = createAdminClient();
      const { data: proj } = await admin.from('projects')
        .select('client:clients(email, full_name), property:properties(name, quartier)')
        .eq('id', input.project_id).single();
      const client = (proj as any)?.client;
      const prop = (proj as any)?.property;
      if (client?.email && prop?.name) {
        await sendFinalPropertySelected({
          to: client.email,
          client_name: client.full_name,
          property_name: prop.name,
          property_quartier: prop.quartier ?? null,
          portal_url: `${APP_URL}/client/projects/${input.project_id}`,
          project_id: input.project_id,
        });
      }
    } catch (e) { console.warn('[email-final-property-on-behalf] echec', e); }

    // Audit log — visible dans l'historique projet et la timeline finance_audit
    try {
      const { data: userData } = await createClient().auth.getUser();
      await logFinanceAudit({
        table: 'projects',
        recordId: input.project_id,
        action: 'update',
        actorId: userData.user?.id ?? null,
        label: `Bien validé par le chef de projet au nom du client`,
        payload: {
          on_behalf: true,
          property_id: input.property_id,
          reason,
        },
      });
    } catch (e) { console.warn('[audit-on-behalf] echec', e); }

    revalidatePath(`/projects/${input.project_id}`);
    revalidatePath(`/projects/${input.project_id}/proposals`);
    return { ok: true as const };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'Erreur inconnue' };
  }
}

export async function unselectFinalPropertyAction(projectId: string) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  const { error } = await supabase.rpc('unselect_final_property', { p_project_id: projectId });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/proposals`);
  return { ok: true };
}

// ─── Retirer une proposition (ou tout un batch) ─────────────────────────
export async function deleteProposalAction(proposalId: string, projectId: string) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  // Récupère le property_id pour remettre le bien à 'disponible' si besoin
  const { data: prop } = await supabase.from('property_proposals')
    .select('property_id').eq('id', proposalId).single();
  const { error } = await supabase.from('property_proposals').delete().eq('id', proposalId);
  if (error) return { ok: false, error: error.message };
  // Remet le bien en 'disponible' s'il était en 'propose' et n'a plus aucune proposition active
  if (prop?.property_id) {
    const { count } = await supabase.from('property_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', prop.property_id);
    if ((count ?? 0) === 0) {
      await supabase.from('properties').update({ status: 'disponible' })
        .eq('id', prop.property_id).eq('status', 'propose');
    }
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/proposals`);
  return { ok: true };
}

export async function deleteBatchAction(batchId: string, projectId: string) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  const { data: proposals } = await supabase.from('property_proposals')
    .select('id, property_id').eq('selection_batch_id', batchId);
  const { error } = await supabase.from('property_proposals')
    .delete().eq('selection_batch_id', batchId);
  if (error) return { ok: false, error: error.message };
  // Remettre les biens en 'disponible' si plus aucune proposition active
  for (const p of (proposals ?? [])) {
    const { count } = await supabase.from('property_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', p.property_id);
    if ((count ?? 0) === 0) {
      await supabase.from('properties').update({ status: 'disponible' })
        .eq('id', p.property_id).eq('status', 'propose');
    }
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/proposals`);
  return { ok: true };
}

// ─── Batch : envoyer une SÉLECTION de biens ──────────────────────────────
// Une sélection = N propositions partageant le même selection_batch_id,
// avec un selection_order (1=meilleur) et une team_note obligatoire (commune).
import { sendNewSelectionToClient } from '@/lib/email/templates';

export async function sendProposalsBatchAction(input: {
  project_id: string;
  ordered_property_ids: string[];  // dans l'ordre choisi (1er = meilleur)
  team_note: string;
}) {
  await assertRole(['ceo','chef_projet']);
  const { project_id, ordered_property_ids, team_note } = input;
  if (!project_id || !Array.isArray(ordered_property_ids) || ordered_property_ids.length === 0) {
    return { ok: false, error: 'Aucun bien sélectionné' };
  }
  if (!team_note || team_note.trim().length < 10) {
    return { ok: false, error: 'La note explicative est obligatoire (10 caractères minimum).' };
  }

  const supabase = createClient();
  const admin = createAdminClient();

  // Génère un batch id unique pour regrouper cette sélection
  const batch_id = crypto.randomUUID();

  const errors: { property_id: string; error: string }[] = [];
  const sent: { id: string; property_id: string; selection_order: number }[] = [];

  for (let i = 0; i < ordered_property_ids.length; i++) {
    const property_id = ordered_property_ids[i];
    const order = i + 1;
    const { data, error } = await supabase.rpc('send_proposal', {
      p_project_id: project_id, p_property_id: property_id,
    });
    if (error) {
      errors.push({ property_id, error: error.message });
      continue;
    }
    const proposal_id = (data as any)?.proposal_id;
    // Mise à jour de la proposition créée avec team_note + ordre + batch
    if (proposal_id) {
      await admin.from('property_proposals').update({
        team_note: team_note.trim(),
        selection_order: order,
        selection_batch_id: batch_id,
      }).eq('id', proposal_id);
      sent.push({ id: proposal_id, property_id, selection_order: order });
    }
  }

  // Un seul email "Nouvelle sélection" au client (au lieu d'un mail par bien)
  if (sent.length > 0) {
    try {
      const { data: project } = await supabase.from('projects')
        .select('id, client:clients(email, full_name)')
        .eq('id', project_id).single();
      const { data: props } = await supabase.from('properties')
        .select('id, name').in('id', sent.map(s => s.property_id));

      const propsByOrder = sent
        .map(s => ({
          order: s.selection_order,
          name: props?.find(p => p.id === s.property_id)?.name ?? '—',
        }))
        .sort((a, b) => a.order - b.order);

      const client = (project as any)?.client;
      if (client?.email) {
        await sendNewSelectionToClient({
          to: client.email,
          client_name: client.full_name,
          properties: propsByOrder,
          team_note: team_note.trim(),
          portal_url: `${APP_URL}/client/projects/${project_id}/proposals`,
          project_id,
          batch_id,
        });
      }
    } catch (e) { /* best effort */ }
  }

  revalidatePath(`/projects/${project_id}`);
  revalidatePath(`/projects/${project_id}/proposals`);
  return {
    ok: errors.length === 0,
    sent_count: sent.length,
    error_count: errors.length,
    errors,
  };
}
