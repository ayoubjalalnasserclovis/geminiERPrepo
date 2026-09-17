'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { sendEmail } from '@/lib/email/send';
import { normalizeFormData as clean, optionalUuid } from '@/lib/validators/zod-helpers';

// ============================================================================
// VCT — Visite Contrôle Technique
// ============================================================================

/**
 * Crée la VCT pour un projet et pré-remplit les items depuis le template.
 * Appelable manuellement OU automatiquement à l'entrée en phase Livraison.
 */
export async function createVctAction(projectId: string) {
  const user = await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  // Vérifie qu'il n'y a pas déjà une VCT
  const { data: existing } = await supabase
    .from('project_vct')
    .select('id').eq('project_id', projectId).maybeSingle();
  if (existing) {
    revalidatePath(`/projects/${projectId}/reception`);
    redirect(`/projects/${projectId}/reception`);
  }

  // Crée la VCT
  const { data: vct, error } = await supabase
    .from('project_vct')
    .insert({
      project_id: projectId,
      status: 'draft',
      performed_by: user.id,
      performed_at: new Date().toISOString(),
    } as any)
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // Pré-remplit les items depuis le template
  const { data: templates } = await supabase
    .from('project_reception_template_items')
    .select('id, category, name, display_order')
    .eq('is_active', true)
    .order('display_order');

  if (templates && templates.length > 0) {
    const rows = templates.map((t: any) => ({
      vct_id: vct.id,
      template_item_id: t.id,
      category: t.category,
      name: t.name,
      display_order: t.display_order,
    }));
    const { error: itemsErr } = await supabase
      .from('project_vct_items')
      .insert(rows as any);
    if (itemsErr) throw new Error(itemsErr.message);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/reception`);
  redirect(`/projects/${projectId}/reception`);
}

const updateVctItemSchema = z.object({
  item_id: z.string().uuid(),
  vct_id: z.string().uuid(),
  project_id: z.string().uuid(),
  status: z.enum(['ok','defaut_mineur','defaut_bloquant']).optional().nullable(),
  observations: z.string().optional().nullable(),
});

export async function updateVctItemAction(formData: FormData) {
  await assertRole(['ceo','chef_projet']);
  const data = updateVctItemSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase
    .from('project_vct_items')
    .update({
      status: data.status,
      observations: data.observations,
      checked_at: new Date().toISOString(),
    } as any)
    .eq('id', data.item_id);
  if (error) throw new Error(error.message);

  // Recalcule le statut VCT après chaque coche d'item.
  // Source de vérité unique : si tous items cochés + zéro action ouverte → validated automatique
  await recomputeVctStatus(data.vct_id);

  revalidatePath(`/projects/${data.project_id}/reception`);
}

/**
 * Met à jour la note interne du chef projet sur la VCT.
 * Strictement interne, jamais visible côté client.
 */
const updateVctNotesSchema = z.object({
  vct_id: z.string().uuid(),
  project_id: z.string().uuid(),
  internal_notes: z.string().optional().nullable(),
});

export async function updateVctInternalNotesAction(formData: FormData) {
  await assertRole(['ceo','chef_projet']);
  const data = updateVctNotesSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase
    .from('project_vct')
    .update({ internal_notes: data.internal_notes } as any)
    .eq('id', data.vct_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${data.project_id}/reception`);
}

/**
 * Crée une action corrective sur un item KO de la VCT.
 * L'action est aussi visible dans l'encart actions de la fiche projet.
 */
const createActionSchema = z.object({
  vct_id: z.string().uuid(),
  project_id: z.string().uuid(),
  vct_item_id: optionalUuid,
  description: z.string().min(2),
  artisan_id: optionalUuid,
  responsible_role: z.enum(['stoniz','artisan']).optional().nullable(),
  deadline: z.string().optional().nullable(),
});

export async function createCorrectiveActionAction(formData: FormData) {
  await assertRole(['ceo','chef_projet']);
  const data = createActionSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase
    .from('project_vct_corrective_actions')
    .insert({
      vct_id: data.vct_id,
      project_id: data.project_id,
      vct_item_id: data.vct_item_id,
      description: data.description,
      artisan_id: data.artisan_id,
      responsible_role: data.responsible_role ?? null,
      deadline: data.deadline,
      status: 'open',
    } as any);
  if (error) throw new Error(error.message);

  // Recalcule le statut de la VCT
  await recomputeVctStatus(data.vct_id);

  revalidatePath(`/projects/${data.project_id}`);
  revalidatePath(`/projects/${data.project_id}/reception`);
}

/**
 * Marque qu'une notification a été envoyée à l'artisan (clic sur le bouton WhatsApp).
 */
export async function markActionNotifiedAction(actionId: string, projectId: string, channel = 'whatsapp') {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  const { error } = await supabase
    .from('project_vct_corrective_actions')
    .update({
      notified_at: new Date().toISOString(),
      notified_via: channel,
    } as any)
    .eq('id', actionId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/reception`);
}

/**
 * Workflow d'une action corrective :
 *   open → in_progress → resolved (par artisan ou chef projet) → verified (par chef projet)
 *   ou cancelled (annulation).
 */
export async function setActionStatusAction(
  actionId: string,
  projectId: string,
  newStatus: 'open' | 'in_progress' | 'resolved' | 'verified' | 'cancelled',
) {
  const user = await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  const updates: Record<string, any> = { status: newStatus };
  if (newStatus === 'resolved') updates.resolved_at = new Date().toISOString();
  if (newStatus === 'verified') {
    updates.verified_at = new Date().toISOString();
    updates.verified_by = user.id;
    // Si l'action est vérifiée sans passer par resolved, on fixe quand même la date
    if (!updates.resolved_at) updates.resolved_at = new Date().toISOString();
  }

  const { data: row, error } = await supabase
    .from('project_vct_corrective_actions')
    .update(updates)
    .eq('id', actionId)
    .select('vct_id')
    .single();
  if (error) throw new Error(error.message);

  if (row?.vct_id) {
    await recomputeVctStatus(row.vct_id);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/reception`);
}

/**
 * Upload une photo (preuve de correction) sur une action corrective.
 * Stockée dans le bucket `documents` au path : vct/{action_id}/{uuid}.{ext}
 */
const ALLOWED_PHOTO_MIME = ['image/png','image/jpeg','image/webp','image/heic','image/heif'];
const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10 MB

export async function uploadVctActionPhotoAction(formData: FormData) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  const file = formData.get('file') as File | null;
  const actionId = String(formData.get('action_id') ?? '');
  const projectId = String(formData.get('project_id') ?? '');

  if (!file || !file.size) throw new Error('Fichier requis');
  if (file.size > MAX_PHOTO_SIZE) throw new Error('Photo trop volumineuse (max 10 MB)');
  if (!ALLOWED_PHOTO_MIME.includes(file.type)) {
    throw new Error(`Type d'image non supporté : ${file.type}`);
  }

  // Charge l'action pour récupérer les photos existantes
  const { data: action } = await supabase
    .from('project_vct_corrective_actions')
    .select('photo_paths').eq('id', actionId).single();
  if (!action) throw new Error('Action introuvable');

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
  const path = `vct/${actionId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw new Error(upErr.message);

  // Append au tableau existant
  const newPaths = [...(action.photo_paths ?? []), path];
  const { error: dbErr } = await supabase
    .from('project_vct_corrective_actions')
    .update({ photo_paths: newPaths } as any)
    .eq('id', actionId);
  if (dbErr) {
    await supabase.storage.from('documents').remove([path]);
    throw new Error(dbErr.message);
  }

  revalidatePath(`/projects/${projectId}/reception`);
  revalidatePath(`/projects/${projectId}`);
}

export async function deleteVctActionPhotoAction(actionId: string, photoPath: string, projectId: string) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  const { data: action } = await supabase
    .from('project_vct_corrective_actions')
    .select('photo_paths').eq('id', actionId).single();
  if (!action) throw new Error('Action introuvable');

  const newPaths = (action.photo_paths ?? []).filter((p: string) => p !== photoPath);
  const { error: dbErr } = await supabase
    .from('project_vct_corrective_actions')
    .update({ photo_paths: newPaths } as any)
    .eq('id', actionId);
  if (dbErr) throw new Error(dbErr.message);

  // Best-effort : supprime aussi du storage (pas bloquant si échec)
  await supabase.storage.from('documents').remove([photoPath]);

  revalidatePath(`/projects/${projectId}/reception`);
}

/**
 * Convertit une action corrective en intervention Propria (avec coût traçable).
 * Utile quand la correction nécessite un artisan externe payant.
 */
export async function convertActionToInterventionAction(actionId: string, projectId: string) {
  const user = await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  // Récupère l'action + le projet pour avoir le property_id
  const { data: action } = await supabase
    .from('project_vct_corrective_actions')
    .select('id, description, artisan_id, deadline, project_id, intervention_id')
    .eq('id', actionId).single();
  if (!action) throw new Error('Action introuvable');
  if ((action as any).intervention_id) {
    throw new Error('Cette action corrective a déjà été convertie en intervention.');
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, property_id')
    .eq('id', action.project_id).single();
  if (!project?.property_id) {
    throw new Error('Ce projet n\'a pas de bien associé — impossible de créer une intervention.');
  }

  // Cherche un provider Propria lié à l'artisan (si possible)
  let providerId: string | null = null;
  if (action.artisan_id) {
    const { data: artisan } = await supabase
      .from('artisans')
      .select('id, name, speciality')
      .eq('id', action.artisan_id).single();
    if (artisan?.name) {
      const { data: provider } = await supabase
        .from('propria_providers')
        .select('id')
        .is('deleted_at', null)
        .ilike('name', artisan.name).limit(1).maybeSingle();
      providerId = provider?.id ?? null;
    }
  }

  // Crée l'intervention
  const { data: intervention, error } = await supabase
    .from('propria_interventions')
    .insert({
      property_id: project.property_id,
      type_label: 'Reprise VCT',
      description: action.description,
      occurred_at: new Date().toISOString().slice(0, 10),
      urgency: 'haute',
      status: 'a_traiter',
      responsable_id: user.id,
      provider_id: providerId,
      charge_to: 'propria',
    } as any)
    .select('id').single();
  if (error) throw new Error(error.message);

  // Lie l'intervention à l'action
  const { error: linkErr } = await supabase
    .from('project_vct_corrective_actions')
    .update({ intervention_id: intervention.id } as any)
    .eq('id', actionId);
  if (linkErr) throw new Error(linkErr.message);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/reception`);
  revalidatePath('/propria/interventions');
}

/**
 * Recalcule le statut de la VCT en fonction des items et des actions correctives.
 */
async function recomputeVctStatus(vctId: string) {
  const supabase = createClient();

  const [itemsRes, actionsRes] = await Promise.all([
    supabase.from('project_vct_items')
      .select('status').eq('vct_id', vctId),
    supabase.from('project_vct_corrective_actions')
      .select('status').eq('vct_id', vctId),
  ]);

  const items = (itemsRes.data ?? []) as any[];
  const actions = (actionsRes.data ?? []) as any[];

  const allItemsChecked = items.length > 0 && items.every(i => i.status != null);
  const openActions = actions.filter(a => !['verified','cancelled'].includes(a.status));

  let newStatus: string;
  if (items.length === 0 || items.every(i => i.status == null)) {
    newStatus = 'draft';
  } else if (!allItemsChecked) {
    newStatus = 'in_progress';
  } else if (openActions.length > 0) {
    newStatus = 'with_actions';
  } else {
    newStatus = 'validated';
  }

  const updates: Record<string, any> = { status: newStatus };
  if (newStatus === 'validated') {
    updates.validated_at = new Date().toISOString();
  }

  await supabase.from('project_vct').update(updates).eq('id', vctId);
}

/**
 * Validation manuelle de la VCT (le chef projet considère que c'est OK même si
 * pas toutes les actions sont fermées — cas rare mais possible).
 */
export async function validateVctAction(vctId: string, projectId: string) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  const { error } = await supabase
    .from('project_vct')
    .update({
      status: 'validated',
      validated_at: new Date().toISOString(),
    } as any)
    .eq('id', vctId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/reception`);
  revalidatePath(`/projects/${projectId}`);
}

// ============================================================================
// PV de réception
// ============================================================================

/**
 * Crée le PV de réception. Pré-rempli avec les items de la VCT :
 *   - VCT item.status='ok' → PV item.status='ok' (pré-coché)
 *   - VCT item.status='defaut_*' → PV item.status=null avec observation héritée
 */
export async function createReceptionPvAction(projectId: string) {
  const user = await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  // Vérifie qu'il n'y a pas déjà un PV
  const { data: existing } = await supabase
    .from('project_reception_pvs')
    .select('id').eq('project_id', projectId).maybeSingle();
  if (existing) {
    revalidatePath(`/projects/${projectId}/reception`);
    redirect(`/projects/${projectId}/reception?tab=pv`);
  }

  // Cherche la VCT (recommandée mais pas obligatoire)
  const { data: vct } = await supabase
    .from('project_vct')
    .select('id').eq('project_id', projectId).maybeSingle();

  const { data: pv, error } = await supabase
    .from('project_reception_pvs')
    .insert({
      project_id: projectId,
      vct_id: vct?.id ?? null,
      status: 'draft',
      reception_date: new Date().toISOString().slice(0, 10),
      prepared_by: user.id,
    } as any)
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // Hérite des items VCT si dispo, sinon depuis le template
  if (vct?.id) {
    const { data: vctItems } = await supabase
      .from('project_vct_items')
      .select('id, template_item_id, category, name, display_order, status, observations')
      .eq('vct_id', vct.id)
      .order('display_order');

    if (vctItems && vctItems.length > 0) {
      const rows = vctItems.map((it: any) => ({
        pv_id: pv.id,
        vct_item_id: it.id,
        template_item_id: it.template_item_id,
        category: it.category,
        name: it.name,
        display_order: it.display_order,
        // VCT 'ok' → PV pré-coché 'ok'
        // VCT défauts → PV à recocher par le client (status null), observation héritée
        status: it.status === 'ok' ? 'ok' : null,
        observations: it.observations,
      }));
      await supabase.from('project_reception_pv_items').insert(rows as any);
    }
  } else {
    // Pas de VCT → on prend directement le template
    const { data: templates } = await supabase
      .from('project_reception_template_items')
      .select('id, category, name, display_order')
      .eq('is_active', true)
      .order('display_order');
    if (templates && templates.length > 0) {
      const rows = templates.map((t: any) => ({
        pv_id: pv.id,
        template_item_id: t.id,
        category: t.category,
        name: t.name,
        display_order: t.display_order,
      }));
      await supabase.from('project_reception_pv_items').insert(rows as any);
    }
  }

  revalidatePath(`/projects/${projectId}/reception`);
  redirect(`/projects/${projectId}/reception?tab=pv`);
}

const updatePvSchema = z.object({
  pv_id: z.string().uuid(),
  project_id: z.string().uuid(),
  reception_date: z.string().optional().nullable(),
  parties_stoniz: z.string().optional().nullable(),
  parties_client: z.string().optional().nullable(),
  weather_conditions: z.string().optional().nullable(),
  general_observations: z.string().optional().nullable(),
  internal_notes: z.string().optional().nullable(),
  meter_electricity_reading: z.string().optional().nullable(),
  meter_water_reading: z.string().optional().nullable(),
  meter_gas_reading: z.string().optional().nullable(),
  keys_count: z.coerce.number().int().optional().nullable(),
  keys_details: z.string().optional().nullable(),
});

export async function updatePvHeaderAction(formData: FormData) {
  await assertRole(['ceo','chef_projet']);
  const data = updatePvSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { pv_id, project_id, ...rest } = data;
  const { error } = await supabase
    .from('project_reception_pvs')
    .update(rest as any)
    .eq('id', pv_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${project_id}/reception`);
}

const updatePvItemSchema = z.object({
  item_id: z.string().uuid(),
  pv_id: z.string().uuid(),
  project_id: z.string().uuid(),
  status: z.enum(['ok','reserve','refus']).optional().nullable(),
  observations: z.string().optional().nullable(),
});

export async function updatePvItemAction(formData: FormData) {
  await assertRole(['ceo','chef_projet']);
  const data = updatePvItemSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase
    .from('project_reception_pv_items')
    .update({
      status: data.status,
      observations: data.observations,
    } as any)
    .eq('id', data.item_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${data.project_id}/reception`);
}

/**
 * Ajoute une réserve au PV. Les réserves NE SONT PAS bloquantes pour le passage
 * en mise_en_location (décision métier), mais doivent être suivies jusqu'à levée.
 */
const addReserveSchema = z.object({
  pv_id: z.string().uuid(),
  project_id: z.string().uuid(),
  pv_item_id: optionalUuid,
  description: z.string().min(2),
  responsible_role: z.enum(['stoniz','artisan','client']).optional().nullable(),
  artisan_id: optionalUuid,
  deadline: z.string().optional().nullable(),
});

export async function addPvReserveAction(formData: FormData) {
  await assertRole(['ceo','chef_projet']);
  const data = addReserveSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase
    .from('project_reception_pv_reserves')
    .insert({
      pv_id: data.pv_id,
      pv_item_id: data.pv_item_id,
      description: data.description,
      responsible_role: data.responsible_role,
      artisan_id: data.artisan_id,
      deadline: data.deadline,
      status: 'open',
    } as any);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${data.project_id}/reception`);
}

export async function resolvePvReserveAction(reserveId: string, projectId: string) {
  const user = await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  const { error } = await supabase
    .from('project_reception_pv_reserves')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    } as any)
    .eq('id', reserveId);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${projectId}/reception`);
}

/**
 * Envoie le PV au client pour signature électronique.
 * Email auto avec lien vers le portail client.
 */
export async function sendPvToClientAction(pvId: string, projectId: string) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  const { data: currentPv } = await supabase
    .from('project_reception_pvs')
    .select('id, status')
    .eq('id', pvId)
    .single();
  if (!currentPv) throw new Error('PV introuvable');
  if (currentPv.status === 'validated') {
    throw new Error('Ce PV a déjà été validé et signé par le client.');
  }

  const { error } = await supabase
    .from('project_reception_pvs')
    .update({
      status: 'sent_to_client',
      sent_to_client_at: new Date().toISOString(),
    } as any)
    .eq('id', pvId);
  if (error) throw new Error(error.message);

  // Email au client avec lien vers le portail
  const admin = createAdminClient();
  const { data: project } = await admin
    .from('projects')
    .select('reference, client:clients(full_name, email)')
    .eq('id', projectId).single();
  const clientObj: any = (project as any)?.client;
  if (clientObj?.email) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://studio.stoniz.co';
    const link = `${siteUrl}/client/projects/${projectId}/reception`;
    const html = `
      <div style="font-family:Manrope,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
        <h1 style="font-size:22px;margin-bottom:8px;">📋 Votre PV de réception est prêt</h1>
        <p>Bonjour ${clientObj.full_name ?? ''},</p>
        <p>
          Votre chantier <strong>${(project as any).reference}</strong> est prêt pour la réception.
          Nous avons préparé votre procès-verbal de réception suite à notre visite contradictoire.
        </p>
        <p>
          Merci de bien vouloir le relire et le signer électroniquement à partir de votre espace client :
        </p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${link}" style="display:inline-block;background:#1a1a1a;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
            Consulter et signer le PV →
          </a>
        </p>
        <p style="font-size:13px;color:#666;">
          Une fois signé, le PV déclenchera les garanties (parfait achèvement) et la mise en location.
          Une courte enquête de satisfaction vous sera envoyée juste après.
        </p>
        <p style="font-size:13px;color:#666;margin-top:24px;">— L'équipe Stoniz</p>
      </div>
    `;
    try {
      await sendEmail({
        to: clientObj.email,
        template_id: 'reception_pv_ready_for_signature',
        subject: `[${(project as any).reference}] Votre PV de réception est prêt à signer`,
        html,
        project_id: projectId,
        idempotency_key: `pv_sent_${pvId}`,
      });
    } catch (e) {
      // On ne bloque pas si l'email échoue — le PV est quand même envoyé en DB
      console.error('[pv-email] échec envoi', e);
    }
  }

  revalidatePath(`/projects/${projectId}/reception`);
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Relance le client par email pour signer son PV.
 * Cooldown 24h pour éviter le spam. Compteur cumulatif `reminder_count`.
 */
export async function sendPvReminderToClientAction(pvId: string, projectId: string) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  // Vérifie l'état du PV
  const { data: pv } = await supabase
    .from('project_reception_pvs')
    .select('id, status, last_reminder_sent_at, reminder_count, sent_to_client_at')
    .eq('id', pvId).single();
  if (!pv) throw new Error('PV introuvable');
  if (pv.status !== 'sent_to_client') {
    throw new Error('Le PV doit être au statut "sent_to_client" pour pouvoir relancer.');
  }

  // Cooldown 24h
  if (pv.last_reminder_sent_at) {
    const last = new Date(pv.last_reminder_sent_at).getTime();
    const now = Date.now();
    const hours = (now - last) / (1000 * 60 * 60);
    if (hours < 24) {
      const remaining = Math.ceil(24 - hours);
      throw new Error(`Relance trop récente. Attends encore ${remaining}h avant la prochaine.`);
    }
  }

  // Envoi email
  const admin = createAdminClient();
  const { data: project } = await admin
    .from('projects')
    .select('reference, client:clients(full_name, email)')
    .eq('id', projectId).single();
  const clientObj: any = (project as any)?.client;
  if (!clientObj?.email) throw new Error('Email client manquant — impossible de relancer.');

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://studio.stoniz.co';
  const link = `${siteUrl}/client/projects/${projectId}/reception`;
  const daysSinceSent = pv.sent_to_client_at
    ? Math.floor((Date.now() - new Date(pv.sent_to_client_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const reminderNum = (pv.reminder_count ?? 0) + 1;
  const isUrgent = reminderNum >= 3 || daysSinceSent >= 7;

  const html = `
    <div style="font-family:Manrope,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <h1 style="font-size:22px;margin-bottom:8px;">
        ${isUrgent ? '🚨 Rappel important' : '📬 Petit rappel'} — Votre PV de réception
      </h1>
      <p>Bonjour ${clientObj.full_name ?? ''},</p>
      <p>
        ${reminderNum === 1
          ? `Nous vous avons envoyé votre PV de réception il y a ${daysSinceSent} jour${daysSinceSent > 1 ? 's' : ''} pour le projet <strong>${(project as any).reference}</strong>.`
          : `Cette relance n°${reminderNum} fait suite à nos précédents emails concernant votre PV de réception du projet <strong>${(project as any).reference}</strong>.`}
      </p>
      <p>
        ${isUrgent
          ? `<strong>Important :</strong> sans votre signature, nous ne pouvons pas finaliser la phase de livraison et passer votre bien en mise en location. Les garanties (parfait achèvement, biennale, décennale) ne pourront pas être activées.`
          : `Pour finaliser la livraison et déclencher les garanties contractuelles (parfait achèvement, biennale, décennale), nous avons besoin de votre signature électronique.`}
      </p>
      <p>
        La signature prend moins de 2 minutes et se fait depuis votre espace client :
      </p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${link}" style="display:inline-block;background:${isUrgent ? '#dc2626' : '#1a1a1a'};color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
          Signer mon PV maintenant →
        </a>
      </p>
      <p style="font-size:13px;color:#666;">
        Si vous avez la moindre question ou réserve à formuler, contactez directement votre chef de projet —
        nous sommes là pour échanger avant la signature si nécessaire.
      </p>
      <p style="font-size:13px;color:#666;margin-top:24px;">— L'équipe Stoniz</p>
    </div>
  `;

  try {
    await sendEmail({
      to: clientObj.email,
      template_id: 'reception_pv_reminder',
      subject: isUrgent
        ? `🚨 [${(project as any).reference}] Signature de votre PV requise (relance ${reminderNum})`
        : `📬 [${(project as any).reference}] Rappel — signature du PV de réception`,
      html,
      project_id: projectId,
      // Idempotence forte basée sur la date/heure : 1 relance max par minute
      idempotency_key: `pv_reminder_${pvId}_${Math.floor(Date.now() / 60000)}`,
    });
  } catch (e: any) {
    throw new Error(`Échec envoi email : ${e?.message ?? 'erreur inconnue'}`);
  }

  // Update tracking
  const { error: updateErr } = await supabase
    .from('project_reception_pvs')
    .update({
      last_reminder_sent_at: new Date().toISOString(),
      reminder_count: reminderNum,
    } as any)
    .eq('id', pvId);
  if (updateErr) throw new Error(updateErr.message);

  revalidatePath(`/projects/${projectId}/reception`);
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Le CLIENT signe électroniquement le PV depuis le portail client.
 * Capture l'IP + user-agent + nom du client pour valeur juridique.
 */
const signPvSchema = z.object({
  pv_id: z.string().uuid(),
  client_full_name: z.string().min(2),
  client_satisfaction_rating: z.coerce.number().int().min(1).max(5).optional().nullable(),
});

export async function clientSignPvAction(formData: FormData) {
  // Pas de assertRole staff : on accepte le client lui-même (RLS s'occupe de la sécurité)
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non authentifié');

  const data = signPvSchema.parse(clean(Object.fromEntries(formData)));

  // Vérifie l'état actuel du PV : doit être envoyé au client et non déjà validé
  const { data: currentPv } = await supabase
    .from('project_reception_pvs')
    .select('id, status, project_id')
    .eq('id', data.pv_id)
    .maybeSingle();
  if (!currentPv) throw new Error('PV introuvable');
  if (currentPv.status !== 'sent_to_client') {
    throw new Error('Le PV doit être au statut "sent_to_client" pour pouvoir être signé.');
  }

  // Capture IP + UA (best effort)
  const { headers } = await import('next/headers');
  const h = headers();
  const ip = h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? null;
  const ua = h.get('user-agent') ?? null;

  const { data: pv, error } = await supabase
    .from('project_reception_pvs')
    .update({
      status: 'validated',
      client_signed_at: new Date().toISOString(),
      client_signed_ip: ip,
      client_signed_user_agent: ua,
      client_signed_full_name: data.client_full_name,
      client_satisfaction_rating: data.client_satisfaction_rating,
    } as any)
    .eq('id', data.pv_id)
    .select('project_id').single();
  if (error) throw new Error(error.message);

  // ─── Trigger auto enquête de satisfaction (Vague 3) ─────────────────────
  // Le client vient de signer = moment émotionnel idéal pour la note de sat.
  await triggerSatisfactionSurvey(pv.project_id);

  revalidatePath(`/client/projects/${pv.project_id}/reception`);
  revalidatePath(`/projects/${pv.project_id}/reception`);
  revalidatePath(`/projects/${pv.project_id}`);
}

/**
 * Crée l'enquête de satisfaction "livraison" pour ce projet
 * (si pas déjà existante) et envoie l'email au client.
 *
 * Idempotent : aucun doublon si re-appelé.
 */
async function triggerSatisfactionSurvey(projectId: string) {
  const admin = createAdminClient();

  // Récupère projet + client
  const { data: project } = await admin
    .from('projects')
    .select('id, reference, client_id, client:clients(id, full_name, email)')
    .eq('id', projectId).single();
  if (!project) return;
  const clientObj: any = (project as any).client;

  // Idempotence : on ne crée qu'une seule enquête "livraison" par projet
  const { data: existing } = await admin
    .from('satisfaction_surveys')
    .select('id').eq('project_id', projectId).eq('trigger_phase', 'livraison').maybeSingle();
  if (existing) return; // déjà déclenchée

  const { data: survey, error } = await admin
    .from('satisfaction_surveys')
    .insert({
      project_id: projectId,
      client_id: project.client_id,
      trigger_phase: 'livraison',
      sent_at: new Date().toISOString(),
    } as any)
    .select('id').single();
  if (error) {
    console.error('[satisfaction-survey] échec création', error);
    return;
  }

  // Email d'invitation au client
  if (clientObj?.email) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://studio.stoniz.co';
    const link = `${siteUrl}/client/surveys/${survey.id}`;
    const html = `
      <div style="font-family:Manrope,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
        <h1 style="font-size:22px;margin-bottom:8px;">Merci ${clientObj.full_name ?? ''} 🎉</h1>
        <p>
          Votre PV de réception est signé. Bravo et merci de votre confiance tout au long de ce projet
          <strong>${project.reference}</strong>.
        </p>
        <p>
          Pour nous aider à toujours mieux accompagner nos prochains clients, pourriez-vous nous accorder
          <strong>2 minutes</strong> pour répondre à 6 questions sur votre expérience ?
        </p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${link}" style="display:inline-block;background:#1a1a1a;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">
            Donner mon avis →
          </a>
        </p>
        <p style="font-size:13px;color:#666;">
          Vos réponses nous aident à identifier ce qu'on fait bien et ce qu'on doit améliorer.
          Si vous avez quoi que ce soit à signaler, dites-le nous : on lit chaque retour.
        </p>
        <p style="font-size:13px;color:#666;margin-top:24px;">— L'équipe Stoniz</p>
      </div>
    `;
    try {
      await sendEmail({
        to: clientObj.email,
        template_id: 'satisfaction_survey_invitation',
        subject: `[${project.reference}] 2 minutes pour évaluer votre expérience Stoniz ?`,
        html,
        project_id: projectId,
        idempotency_key: `survey_invite_${survey.id}`,
      });
    } catch (e) {
      console.error('[satisfaction-email] échec envoi', e);
    }
  }
}
