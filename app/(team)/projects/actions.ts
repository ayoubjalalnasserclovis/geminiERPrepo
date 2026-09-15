'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { projectCreateSchema, advancePhaseSchema, projectRenameCodeSchema } from '@/lib/validators/schemas';
import { logDeletion } from '@/lib/audit/deletion';
import {
  sendWelcomePortal, sendProjectAssignedToChef,
  sendPhaseStart, sendProjectCompleted, sendSurveyToClient,
  sendActeAuthentiqueToClient,
} from '@/lib/email/templates';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const ACTE_AUTHENTIQUE_TASK_TITLE = 'Faire signer l\'acte authentique chez le notaire';

const PHASE_LABELS_FOR_CLIENT: Record<string, string> = {
  sourcing: 'Sourcing', design: 'Design',
  travaux: 'Travaux', livraison: 'Livraison',
  mise_en_location: 'Mise en location', termine: 'Terminé',
};
const SURVEY_TRIGGER_PHASE: Record<string, string> = {
  design: 'Sourcing',
  travaux: 'Design',
  mise_en_location: 'Livraison',
};

export async function createProjectAction(input: unknown) {
  await assertRole(['ceo','chef_projet','commercial']);

  // Normaliser les chaînes vides en null AVANT validation Zod
  const raw: any = { ...(input as any) };
  for (const k of ['assigned_chef_projet','travaux_budget','onboarding_date']) {
    if (raw[k] === '' || raw[k] === undefined) raw[k] = null;
  }

  // Date d'onboarding = date de création du projet dans l'ERP, par défaut.
  // Plus de saisie manuelle obligatoire : créer le projet = démarrer l'onboarding.
  // NB : ne concerne QUE la création native via l'ERP. L'import legacy (script Notion)
  // pose, lui, la vraie date historique d'onboarding — on ne l'écrase jamais ici.
  // Une correction reste possible après coup via la carte "Dates clés".
  if (!raw.onboarding_date) {
    raw.onboarding_date = new Date().toISOString().slice(0, 10);
  }

  const parsed = projectCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  // Honoraires par defaut : 8800 (acquisition) + 12200 (travaux) = 21 000 €
  // (correspond aux 5 jalons fixes : acompte 5000 + compromis 3800 + design 3800 + chantier 4200 + livraison 4200)
  const payload: any = {
    stoniz_fees_acquisition: 8800,
    stoniz_fees_travaux: 12200,
    ...parsed.data,
  };

  const { data, error } = await supabase.from('projects').insert(payload).select('id').single();
  if (error) return { ok: false, error: error.message };

  // ─── Acompte Stoniz : dû dès la création (contrat de mission signé en amont) ──
  try {
    const admin = createAdminClient();
    await admin.rpc('upsert_milestone_payment', {
      p_project_id: data.id,
      p_type: 'acompte_stoniz',
      p_amount: 5000,
      p_due_date: new Date().toISOString().slice(0, 10),
      p_due_at_phase: 'onboarding',
    });
  } catch (e) { console.warn('[acompte-stoniz-create] echec', e); }

  // ─── Auto-invitation du client au portail (si pas déjà invité) ───────────
  // Best-effort : on n'échoue pas la création du projet si l'invitation rate.
  try {
    await autoInviteClientForProject(parsed.data.client_id, data.id);
  } catch (e) {
    console.warn('[auto-invite] échec mais projet créé :', e);
  }

  // ─── Email au chef de projet assigné ────────────────────────────────────
  if (parsed.data.assigned_chef_projet) {
    try {
      const admin = createAdminClient();
      const [{ data: chef }, { data: proj }] = await Promise.all([
        admin.from('profiles').select('email, full_name').eq('id', parsed.data.assigned_chef_projet).single(),
        admin.from('projects').select('reference, client:clients(full_name)').eq('id', data.id).single(),
      ]);
      if (chef?.email) {
        await sendProjectAssignedToChef({
          to: chef.email, chef_name: chef.full_name,
          client_name: (proj as any)?.client?.full_name ?? '',
          project_reference: (proj as any)?.reference ?? '',
          project_url: `${APP_URL}/projects/${data.id}`,
          project_id: data.id,
        });
      }
    } catch (e) { console.warn('[email-chef-assigned] echec', e); }
  }

  revalidatePath('/projects');
  return { ok: true, id: data.id };
}

/**
 * Assigne (ou réassigne) un chef de projet à un projet existant.
 *
 * Si le chef change vraiment (≠ ancien chef), on envoie un email
 * d'assignation au nouveau (réutilise le template existant). Si la valeur
 * est identique ou null sans changement, pas d'email.
 *
 * Rôles : CEO + commercial (cohérent avec qui peut créer un projet).
 */
export async function updateProjectChefAction(input: { project_id: string; chef_id: string | null }) {
  await assertRole(['ceo', 'commercial']);

  const project_id = String(input?.project_id ?? '');
  const chef_id = input?.chef_id ? String(input.chef_id) : null;
  if (!project_id) return { ok: false as const, error: 'Projet manquant' };

  const supabase = createClient();

  // État actuel pour décider de l'email
  const { data: current } = await supabase
    .from('projects')
    .select('id, reference, assigned_chef_projet, client:clients(full_name)')
    .eq('id', project_id)
    .single();
  if (!current) return { ok: false as const, error: 'Projet introuvable' };

  if ((current as any).assigned_chef_projet === chef_id) {
    return { ok: true as const, unchanged: true };
  }

  const { error } = await supabase
    .from('projects')
    .update({ assigned_chef_projet: chef_id } as any)
    .eq('id', project_id);
  if (error) return { ok: false as const, error: error.message };

  // Email d'assignation au nouveau chef (best-effort, n'échoue pas l'action)
  if (chef_id) {
    try {
      const admin = createAdminClient();
      const { data: chef } = await admin
        .from('profiles')
        .select('email, full_name')
        .eq('id', chef_id)
        .single();
      if (chef?.email) {
        await sendProjectAssignedToChef({
          to: chef.email,
          chef_name: chef.full_name,
          client_name: (current as any)?.client?.full_name ?? '',
          project_reference: (current as any)?.reference ?? '',
          project_url: `${APP_URL}/projects/${project_id}`,
          project_id,
        });
      }
    } catch (e) {
      console.warn('[updateProjectChef] email assignation echec', e);
    }
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${project_id}`);
  return { ok: true as const };
}

/**
 * Renomme le code lisible d'un projet et le verrouille (code_locked = true).
 * Empêche le trigger de propagation de l'écraser au prochain rename client.
 *
 * Le code reference STZ-NNN n'est jamais touché — c'est l'ancre comptable.
 */
export async function renameProjectCodeAction(formData: FormData) {
  await assertRole(['ceo', 'chef_projet']);
  const data = projectRenameCodeSchema.parse(Object.fromEntries(formData));
  const supabase = createClient();

  const { error } = await supabase
    .from('projects')
    .update({ code: data.new_code, code_locked: true } as any)
    .eq('id', data.project_id);
  if (error) throw new Error(error.message);

  revalidatePath('/projects');
  revalidatePath(`/projects/${data.project_id}`);
  return { ok: true };
}

/**
 * Invite automatiquement le client au portail si pas encore fait.
 * Auto-complète la tâche "Envoyer email de bienvenue + accès portail".
 */
async function autoInviteClientForProject(clientId: string, projectId: string) {
  const admin = createAdminClient();

  const { data: client } = await admin
    .from('clients')
    .select('id, email, full_name, profile_id')
    .eq('id', clientId)
    .single();

  if (!client) return;

  // Si déjà invité, on auto-complète juste la tâche
  if (!client.profile_id) {
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      client.email,
      {
        data: { full_name: client.full_name, role: 'client' },
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/client`,
      }
    );

    if (inviteErr || !invited.user) {
      console.warn('[auto-invite] inviteUserByEmail KO :', inviteErr?.message);
      return;
    }

    await admin.from('clients').update({ profile_id: invited.user.id }).eq('id', clientId);

    // Email de bienvenue customisé Stoniz (en plus du mail Supabase Auth)
    await sendWelcomePortal({
      to: client.email,
      client_name: client.full_name,
      portal_url: `${process.env.NEXT_PUBLIC_APP_URL}/client`,
      project_id: projectId,
    });
  }

  // Auto-compléter la tâche "Envoyer email de bienvenue + accès portail" pour ce projet
  await admin
    .from('tasks')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
    })
    .eq('project_id', projectId)
    .eq('title', 'Envoyer email de bienvenue + accès portail')
    .eq('status', 'todo');
}

export async function advancePhaseAction(input: unknown) {
  await assertRole(['ceo','chef_projet']);
  const parsed = advancePhaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { error } = await supabase.rpc('advance_project_phase', {
    p_project_id: parsed.data.project_id,
    p_new_phase: parsed.data.new_phase,
  });
  if (error) return { ok: false, error: error.message };

  // Emails déclenchés par le changement de phase
  try {
    const admin = createAdminClient();
    const { data: proj } = await admin.from('projects')
      .select('client:clients(email, full_name), property:properties(name)')
      .eq('id', parsed.data.project_id).single();
    const client = (proj as any)?.client;
    const property = (proj as any)?.property;

    if (client?.email) {
      const portalUrl = `${APP_URL}/client/projects/${parsed.data.project_id}`;

      // Email de transition de phase (sauf onboarding qui est le départ)
      const phaseLabel = PHASE_LABELS_FOR_CLIENT[parsed.data.new_phase];
      if (phaseLabel) {
        await sendPhaseStart({
          to: client.email, client_name: client.full_name,
          phase: parsed.data.new_phase,
          phase_label: phaseLabel, portal_url: portalUrl,
          project_id: parsed.data.project_id,
        });
      }

      // Si une enquête est déclenchée par cette phase, notifier le client.
      // IMPORTANT : on lie DIRECTEMENT vers la page enquête (/client/surveys/{id}),
      // pas vers la page projet. Sinon, comme l'enquête naît au changement de
      // phase, le pop-up "guide de phase à lire" de la page projet masque la
      // bannière d'enquête et le client ne peut pas y accéder depuis le mail.
      const surveyPhase = SURVEY_TRIGGER_PHASE[parsed.data.new_phase];
      if (surveyPhase) {
        const { data: survey } = await admin.from('satisfaction_surveys')
          .select('id')
          .eq('project_id', parsed.data.project_id)
          .is('completed_at', null)
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const surveyUrl = survey?.id
          ? `${APP_URL}/client/surveys/${survey.id}`
          : portalUrl;
        await sendSurveyToClient({
          to: client.email, client_name: client.full_name,
          phase_label: surveyPhase, portal_url: surveyUrl,
          project_id: parsed.data.project_id,
        });
      }

      // Projet terminé
      if (parsed.data.new_phase === 'termine') {
        await sendProjectCompleted({
          to: client.email, client_name: client.full_name,
          property_name: property?.name ?? 'votre projet',
          portal_url: portalUrl,
          project_id: parsed.data.project_id,
        });
      }
    }
  } catch (e) { console.warn('[email-phase-advance] echec', e); }

  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true };
}

type ProjectDates = {
  compromis_date?: string | null;
  acte_authentique_date?: string | null;
  travaux_start_date?: string | null;
  travaux_end_date?: string | null;
  livraison_date?: string | null;
  onboarding_date?: string | null;
};

export async function updateProjectDatesAction(projectId: string, dates: ProjectDates) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  const payload: any = {};
  for (const [k, v] of Object.entries(dates)) {
    if (v === '' || v === undefined) payload[k] = null;
    else payload[k] = v;
  }

  // On lit l'état AVANT update pour détecter les changements de dates jalons
  const { data: before } = await supabase.from('projects')
    .select('acte_authentique_date, acte_authentique_notified_at, client_id, compromis_date, travaux_start_date, livraison_date')
    .eq('id', projectId).single();

  const { error } = await supabase.from('projects').update(payload).eq('id', projectId);
  if (error) return { ok: false, error: error.message };

  // ─── Sync paiements jalons sur les dates renseignées ────────────────────
  try {
    const adminPay = createAdminClient();
    // Compromis : payment dû le jour de la signature
    if (payload.compromis_date && payload.compromis_date !== before?.compromis_date) {
      await adminPay.rpc('upsert_milestone_payment', {
        p_project_id: projectId,
        p_type: 'honoraires_compromis',
        p_amount: 3800,
        p_due_date: payload.compromis_date,
        p_due_at_phase: 'sourcing',
      });
    }
    // Chantier : payment dû 7 jours AVANT le démarrage
    if (payload.travaux_start_date && payload.travaux_start_date !== before?.travaux_start_date) {
      const start = new Date(payload.travaux_start_date);
      const due = new Date(start.getTime() - 7 * 86_400_000);
      await adminPay.rpc('upsert_milestone_payment', {
        p_project_id: projectId,
        p_type: 'honoraires_chantier',
        p_amount: 4200,
        p_due_date: due.toISOString().slice(0, 10),
        p_due_at_phase: 'travaux',
      });
    }
    // Livraison : payment dû le jour de la livraison
    if (payload.livraison_date && payload.livraison_date !== before?.livraison_date) {
      await adminPay.rpc('upsert_milestone_payment', {
        p_project_id: projectId,
        p_type: 'honoraires_livraison',
        p_amount: 4200,
        p_due_date: payload.livraison_date,
        p_due_at_phase: 'livraison',
      });
    }
  } catch (e) { console.warn('[milestone-payments-sync] echec', e); }

  // Side effects acte authentique : auto-complete tâche + email client (idempotent)
  const wasEmpty = !before?.acte_authentique_date;
  const nowSet = !!payload.acte_authentique_date;
  if (wasEmpty && nowSet && !before?.acte_authentique_notified_at) {
    try {
      const admin = createAdminClient();

      // Auto-complete la tâche bloquante "Faire signer l'acte authentique"
      await admin.from('tasks').update({
        status: 'done',
        completed_at: new Date().toISOString(),
      })
        .eq('project_id', projectId)
        .eq('title', ACTE_AUTHENTIQUE_TASK_TITLE)
        .neq('status', 'done');

      // Marque le projet comme notifié pour éviter d'envoyer l'email 2 fois
      await admin.from('projects')
        .update({ acte_authentique_notified_at: new Date().toISOString() })
        .eq('id', projectId);

      // Email félicitations au client
      const { data: proj } = await admin.from('projects')
        .select('client:clients(email, full_name)').eq('id', projectId).single();
      const client = (proj as any)?.client;
      if (client?.email) {
        await sendActeAuthentiqueToClient({
          to: client.email,
          client_name: client.full_name ?? '',
          portal_url: `${APP_URL}/client/projects/${projectId}`,
          project_id: projectId,
        });
      }
    } catch (e) { console.warn('[acte-authentique-side-effects] echec', e); }
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/client/projects/${projectId}`);
  return { ok: true };
}

/**
 * Met à jour les infos d'infrastructure du bien depuis la fiche projet :
 * contrats utilités (eau / élec / internet) + accès partagés (WiFi, serrure).
 *
 * Tous ces champs vivent sur properties (attributs du bien physique partagés
 * par toutes les suites Propria d'un même bien). Le contrat survit à la
 * clôture du projet et alimente la gestion Propria ensuite.
 */
export async function updatePropertyInfrastructureAction(
  projectId: string,
  payload: {
    water_contract?: string | null;
    electricity_contract?: string | null;
    internet_contract?: string | null;
    wifi_ssid?: string | null;
    wifi_password?: string | null;
    lock_code?: string | null;
    smart_lock?: boolean | null;
  },
) {
  await assertRole(['ceo','chef_projet','assistante']);
  const supabase = createClient();

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('property_id')
    .eq('id', projectId)
    .single();
  if (projErr) return { ok: false, error: projErr.message };
  if (!project.property_id) {
    return { ok: false, error: 'Aucun bien n\'est lié à ce projet. Acceptez d\'abord une proposition.' };
  }

  // Construit le payload en n'incluant que les champs fournis (undefined =
  // pas touché, null = vidé, string = nouvelle valeur).
  const update: Record<string, any> = {};
  if (payload.water_contract !== undefined) {
    update.propria_water_contract = payload.water_contract?.trim() || null;
  }
  if (payload.electricity_contract !== undefined) {
    update.propria_electricity_contract = payload.electricity_contract?.trim() || null;
  }
  if (payload.internet_contract !== undefined) {
    update.propria_internet_contract = payload.internet_contract?.trim() || null;
  }
  if (payload.wifi_ssid !== undefined) {
    update.propria_wifi_ssid = payload.wifi_ssid?.trim() || null;
  }
  if (payload.wifi_password !== undefined) {
    update.propria_wifi_password = payload.wifi_password?.trim() || null;
  }
  if (payload.lock_code !== undefined) {
    update.propria_lock_code = payload.lock_code?.trim() || null;
  }
  if (payload.smart_lock !== undefined) {
    update.propria_smart_lock = !!payload.smart_lock;
  }

  if (Object.keys(update).length === 0) {
    return { ok: true };
  }

  const { error } = await supabase
    .from('properties')
    .update(update as any)
    .eq('id', project.property_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/**
 * Compatibilité descendante avec l'ancienne signature.
 * @deprecated utiliser updatePropertyInfrastructureAction
 */
export async function updateContractNumbersAction(
  projectId: string,
  water: string | null,
  electricity: string | null,
  internet?: string | null,
) {
  return updatePropertyInfrastructureAction(projectId, {
    water_contract: water,
    electricity_contract: electricity,
    internet_contract: internet ?? null,
  });
}

export async function updateStonizReductionAction(projectId: string, reduction: number) {
  await assertRole(['ceo','chef_projet']);
  if (reduction < 0 || reduction > 21_000) {
    return { ok: false, error: 'Réduction invalide (0 à 21 000 €)' };
  }
  const supabase = createClient();
  const { error } = await supabase.from('projects')
    .update({ stoniz_reduction: reduction })
    .eq('id', projectId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

/**
 * Soft-delete d'un projet (deleted_at = NOW()).
 * Tous les listings filtrent déjà sur `is('deleted_at', null)` donc l'élément
 * disparaît automatiquement. Réversible côté BDD si besoin.
 *
 * Hard-delete reste réservé au CEO via /admin/preparation.
 */
export async function deleteProjectAction(projectId: string) {
  const user = await assertRole(['ceo']); // QA-BUG-024 (décision CEO 2026-06-13) : suppression projet = CEO-only
  const supabase = createClient();
  const { data: proj } = await supabase.from('projects').select('*').eq('id', projectId).single();
  const { error } = await supabase
    .from('projects')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', projectId);
  if (error) return { ok: false, error: error.message };
  await logDeletion({
    table: 'projects',
    recordId: projectId,
    actorId: user.id,
    label: proj ? `Projet ${(proj as any).code ?? ''} - ${(proj as any).title ?? ''}` : 'Projet',
    snapshot: proj,
  });
  revalidatePath('/projects');
  return { ok: true };
}

// ─── Retour d'étape (CEO 2026-08-19, session D roadmap évolutions) ─────────
// Recule le projet d'UNE étape (répétable). Rien n'est supprimé : tâches,
// paiements, documents restent en place. La ré-avancée ne recrée plus les
// tâches déjà instanciées (fix anti-doublon dans advance_project_phase,
// migration 20260819180000). Traçabilité : project_phases_history (qui, quand).
export async function revertPhaseAction(projectId: string) {
  await assertRole(['ceo', 'chef_projet']);
  if (!projectId || typeof projectId !== 'string') {
    return { ok: false as const, error: 'Projet manquant' };
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc('revert_project_phase', {
    p_project_id: projectId,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const, newPhase: (data as any)?.new_phase as string | undefined };
}
