'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { sendSurveyCompletedToTeam, sendSurveyThanksToClient, sendLowNpsAlertToCeo } from '@/lib/email/templates';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const PHASE_LABELS: Record<string, string> = {
  onboarding: 'Onboarding', sourcing: 'Sourcing', design: 'Design',
  travaux: 'Travaux', livraison: 'Livraison',
  mise_en_location: 'Mise en location', termine: 'Terminé',
};

const surveySchema = z.object({
  survey_id: z.string().uuid(),
  global_score: z.coerce.number().int().min(1).max(5),
  communication_score: z.coerce.number().int().min(1).max(5),
  reactivity_score: z.coerce.number().int().min(1).max(5),
  quality_score: z.coerce.number().int().min(1).max(5),
  deadline_score: z.coerce.number().int().min(1).max(5),
  comment: z.string().optional().nullable(),
  nps_score: z.coerce.number().int().min(0).max(10).optional().nullable(),
  nps_comment: z.string().optional().nullable(),
});

export async function submitSurveyAction(input: unknown) {
  await assertRole(['client']);

  // Nettoyage : strings vides → null pour les champs optionnels
  const raw: any = { ...(input as any) };
  if (raw.nps_score === '' || raw.nps_score === undefined) raw.nps_score = null;
  if (raw.comment === '') raw.comment = null;
  if (raw.nps_comment === '') raw.nps_comment = null;

  const parsed = surveySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { error } = await supabase
    .from('satisfaction_surveys')
    .update({
      global_score: parsed.data.global_score,
      communication_score: parsed.data.communication_score,
      reactivity_score: parsed.data.reactivity_score,
      quality_score: parsed.data.quality_score,
      deadline_score: parsed.data.deadline_score,
      comment: parsed.data.comment,
      nps_score: parsed.data.nps_score,
      nps_comment: parsed.data.nps_comment,
      completed_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.survey_id);

  if (error) return { ok: false, error: error.message };

  // Emails : merci au client + notif équipe + alerte CEO si NPS faible
  try {
    const admin = createAdminClient();
    const { data: survey } = await admin.from('satisfaction_surveys')
      .select('project_id, trigger_phase, global_score, project:projects(reference, assigned_chef_projet, client:clients(email, full_name, phone))')
      .eq('id', parsed.data.survey_id).single();
    if (!survey) throw new Error('Sondage introuvable pour l’envoi des emails');
    const proj: any = (survey as any)?.project;
    const phaseLabel = PHASE_LABELS[(survey as any)?.trigger_phase] ?? (survey as any)?.trigger_phase;

    if (proj?.client?.email) {
      await sendSurveyThanksToClient({
        to: proj.client.email,
        client_name: proj.client.full_name,
        phase_label: phaseLabel,
        portal_url: `${APP_URL}/client/projects/${survey.project_id}`,
        project_id: survey.project_id,
      });
    }

    const team: { email: string; full_name: string }[] = [];
    if (proj?.assigned_chef_projet) {
      const { data: chef } = await admin.from('profiles')
        .select('email, full_name').eq('id', proj.assigned_chef_projet).single();
      if (chef?.email) team.push(chef);
    }
    const { data: ceos } = await admin.from('profiles')
      .select('email, full_name').eq('role', 'ceo').eq('is_active', true);
    (ceos ?? []).forEach((c: any) => {
      if (!team.find(t => t.email === c.email)) team.push(c);
    });
    for (const r of team) {
      await sendSurveyCompletedToTeam({
        to: r.email, chef_name: r.full_name,
        client_name: proj?.client?.full_name ?? '',
        phase_label: phaseLabel,
        satisfaction_score: parsed.data.global_score,
        project_url: `${APP_URL}/projects/${survey.project_id}`,
        project_id: survey.project_id,
      });
    }

    // ⚠ Alerte spécifique NPS détracteur (< 7) — séparée de la notif générique
    // Vise uniquement les CEOs (pour intervention rapide, pas tous les chefs projet)
    const npsScore = parsed.data.nps_score;
    if (npsScore != null && npsScore < 7) {
      let chefName: string | undefined;
      if (proj?.assigned_chef_projet) {
        const { data: chef } = await admin.from('profiles')
          .select('full_name').eq('id', proj.assigned_chef_projet).single();
        chefName = chef?.full_name;
      }
      for (const c of ceos ?? []) {
        const ceo: any = c;
        await sendLowNpsAlertToCeo({
          to: ceo.email,
          ceo_name: ceo.full_name ?? 'CEO',
          client_name: proj?.client?.full_name ?? '—',
          client_phone: proj?.client?.phone ?? null,
          client_email: proj?.client?.email ?? null,
          project_reference: proj?.reference ?? '—',
          phase_label: phaseLabel,
          nps_score: npsScore,
          nps_comment: parsed.data.nps_comment,
          global_score: parsed.data.global_score,
          chef_projet_name: chefName ?? null,
          project_url: `${APP_URL}/projects/${survey.project_id}`,
          project_id: survey.project_id,
        });
      }
    }
  } catch (e) { console.warn('[email-survey-completed] echec', e); }

  revalidatePath('/client', 'layout');
  return { ok: true };
}
