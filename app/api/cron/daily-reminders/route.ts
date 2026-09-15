import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendReminderClient, sendReminderTeam, sendDailyAlertsRecap } from '@/lib/email/templates';
import { collectAlerts } from '@/lib/alerts/collect';
import { getFinanceRecipients, buildPaymentSubject } from '@/lib/notifications/recipients';
import { notifyCheckupOverdue } from '@/lib/propria/checkup-notify';
import {
  findCheckInsNeedingPoliceRecord,
  POLICE_RECORDS_TABLE,
  pullDataFromHostawayReservation,
  pullDataFromDirectReservation,
  pullDataFromCashReservation,
  splitGuestName,
  type PoliceRecordReservationSource,
} from '@/lib/propria/police-records';
import { notifyPoliceRecordsTeam } from '@/app/(team)/propria/fiches-police/actions';
import { requireCronAuth } from '@/lib/cron/auth';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * Cron quotidien : envoie tous les rappels en cours.
 * Sécurisé via header `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Configuration recommandée :
 *  - Vercel Cron : ajouter dans vercel.json
 *      { "crons": [{ "path": "/api/cron/daily-reminders", "schedule": "0 8 * * *" }] }
 *    Vercel passe automatiquement le token d'authentification.
 *
 *  - GitHub Actions / autre :
 *      curl -X POST $APP_URL/api/cron/daily-reminders \
 *           -H "Authorization: Bearer $CRON_SECRET"
 */
export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const results: Record<string, number> = {};
  const errors: string[] = [];

  // ─── 0. Pré-filtre : projets notifiables ───────────────────────────────
  // Évite le bruit du wrap sendEmail (qui blockerait mais loggerait du
  // 'skipped' partout sur les projets en préparation). On filtre en amont.
  const { data: notifiableProjects } = await admin
    .from('projects')
    .select('id')
    .eq('is_preparation', false)
    .eq('legacy_imported', false)
    .neq('status', 'perdu')
    .not('activated_at', 'is', null)
    .not('client_id', 'is', null)
    .is('deleted_at', null);
  const notifiableIds = new Set((notifiableProjects ?? []).map((p: any) => p.id));
  results['_pre_filter_notifiable_projects'] = notifiableIds.size;

  function isNotifiable(projectId: string | null | undefined): boolean {
    return !!projectId && notifiableIds.has(projectId);
  }

  // ─── 1. Rappels onboarding non complete ─────────────────────────────────
  try {
    // Filtre : clients déjà invités (profile_id) ET au moins un projet activé.
    // Sinon on rappelle de l'onboarding à des clients qui n'ont jamais reçu d'invite.
    const { data: pending } = await admin
      .from('clients')
      .select('id, email, full_name, created_at, profile_id')
      .is('onboarding_completed_at', null)
      .not('profile_id', 'is', null)
      .is('deleted_at', null);

    let count = 0;
    for (const c of pending ?? []) {
      const daysSince = Math.floor(
        (Date.now() - new Date(c.created_at).getTime()) / 86400000
      );
      if (daysSince === 3 || daysSince === 7) {
        await sendReminderClient({
          to: c.email,
          client_name: c.full_name,
          title: `Finalisez votre onboarding Stoniz (J+${daysSince})`,
          message: `Il vous reste quelques informations à renseigner pour démarrer votre projet. Cela ne prend que 5 minutes.`,
          cta_url: `${APP_URL}/client/onboarding`,
          cta_label: 'Compléter mon onboarding',
          template_id: 'rappel_onboarding',
          idempotency_key: `rem-onboarding-${c.id}-${today}`,
        });
        count++;
      }
    }
    results['onboarding'] = count;
  } catch (e) { errors.push(`onboarding: ${String(e)}`); }

  // ─── 2. Rappels cahier des charges en attente client ───────────────────
  try {
    const { data: briefs } = await admin
      .from('project_briefs')
      .select('id, project_id, sent_at, project:projects(client:clients(email, full_name))')
      .eq('status', 'sent_to_client');

    let count = 0;
    for (const b of briefs ?? []) {
      if (!isNotifiable(b.project_id)) continue;
      const days = Math.floor((Date.now() - new Date(b.sent_at).getTime()) / 86400000);
      if (days === 3 || days === 7) {
        const client = (b as any).project?.client;
        if (!client?.email) continue;
        await sendReminderClient({
          to: client.email,
          client_name: client.full_name,
          title: `Cahier des charges à valider (J+${days})`,
          message: 'Votre conseiller attend votre validation pour démarrer la recherche du bien.',
          cta_url: `${APP_URL}/client/projects/${b.project_id}/brief`,
          cta_label: 'Valider mon cahier des charges',
          template_id: 'rappel_brief',
          idempotency_key: `rem-brief-${b.id}-${today}`,
          project_id: b.project_id,
        });
        count++;
      }
    }
    results['brief'] = count;
  } catch (e) { errors.push(`brief: ${String(e)}`); }

  // ─── 3. Rappels propositions non répondues ─────────────────────────────
  try {
    const { data: proposals } = await admin
      .from('property_proposals')
      .select('id, project_id, sent_at, property:properties(name), project:projects(client:clients(email, full_name))')
      .eq('client_response', 'pending');

    let count = 0;
    for (const p of proposals ?? []) {
      if (!isNotifiable(p.project_id)) continue;
      const days = Math.floor((Date.now() - new Date(p.sent_at).getTime()) / 86400000);
      if (days === 3 || days === 7) {
        const client = (p as any).project?.client;
        if (!client?.email) continue;
        await sendReminderClient({
          to: client.email,
          client_name: client.full_name,
          title: `Proposition en attente de votre réponse (J+${days})`,
          message: `Le bien <strong>${(p as any).property?.name}</strong> vous a été proposé. Indiquez votre intérêt depuis votre portail.`,
          cta_url: `${APP_URL}/client/projects/${p.project_id}/proposals`,
          cta_label: 'Voir la proposition',
          template_id: 'rappel_proposition',
          idempotency_key: `rem-proposal-${p.id}-${today}`,
          project_id: p.project_id,
        });
        count++;
      }
    }
    results['propositions'] = count;
  } catch (e) { errors.push(`propositions: ${String(e)}`); }

  // ─── 4. Rappels documents à valider ────────────────────────────────────
  try {
    const { data: docs } = await admin
      .from('documents')
      .select('id, project_id, name, type, created_at, project:projects(client:clients(email, full_name))')
      .eq('requires_client_validation', true)
      .eq('client_validation_status', 'pending')
      .eq('is_visible_to_client', true)
      .is('deleted_at', null);

    let count = 0;
    for (const d of docs ?? []) {
      if (!isNotifiable(d.project_id)) continue;
      const days = Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86400000);
      if (days === 3 || days === 7) {
        const client = (d as any).project?.client;
        if (!client?.email) continue;
        await sendReminderClient({
          to: client.email,
          client_name: client.full_name,
          title: `Document à valider (J+${days})`,
          message: `Le document <strong>${d.name}</strong> attend votre validation.`,
          cta_url: `${APP_URL}/client/projects/${d.project_id}`,
          cta_label: 'Voir le document',
          template_id: 'rappel_document',
          idempotency_key: `rem-doc-${d.id}-${today}`,
          project_id: d.project_id,
        });
        count++;
      }
    }
    results['documents'] = count;
  } catch (e) { errors.push(`documents: ${String(e)}`); }

  // ─── 5. Rappels enquêtes non complétées ────────────────────────────────
  try {
    const { data: surveys } = await admin
      .from('satisfaction_surveys')
      .select('id, project_id, sent_at, trigger_phase, client:clients(email, full_name)')
      .is('completed_at', null);

    let count = 0;
    for (const s of surveys ?? []) {
      if (!isNotifiable(s.project_id)) continue;
      const days = Math.floor((Date.now() - new Date(s.sent_at).getTime()) / 86400000);
      if (days === 3 || days === 7) {
        const client = (s as any).client;
        if (!client?.email) continue;
        await sendReminderClient({
          to: client.email,
          client_name: client.full_name,
          title: `Enquête de satisfaction en attente (J+${days})`,
          message: `Votre avis sur la phase ${s.trigger_phase} nous aide à améliorer nos services.`,
          cta_url: `${APP_URL}/client/surveys/${s.id}`,
          cta_label: 'Compléter l\'enquête',
          template_id: 'rappel_enquete',
          idempotency_key: `rem-survey-${s.id}-${today}`,
          project_id: s.project_id,
        });
        count++;
      }
    }
    results['surveys'] = count;
  } catch (e) { errors.push(`surveys: ${String(e)}`); }

  // ─── 6. Paiements clients overdue → CLIENT (relance directe) + Nabil en CC ───
  // CEO 2026-06-19 : le rappel doit aller au CLIENT lui-même pour qu'il paie,
  // avec Nabil (finance) en copie pour suivi. Avant le fix, ça allait à
  // `finance@stoniz.co` (boîte fantôme) → 100% suppressed Resend.
  try {
    const { data: overdue } = await admin
      .from('payments')
      .select('id, project_id, type, amount_expected, amount_paid, due_date, project:projects(reference, status, deleted_at, client:clients(email, full_name))')
      .lt('due_date', today)
      .neq('status', 'paid')
      .is('deleted_at', null);

    const financeRecipients = await getFinanceRecipients(admin);

    let count = 0;
    for (const p of overdue ?? []) {
      if (!isNotifiable(p.project_id)) continue;
      // Règle métier permanente : pas de notif pour les projets perdus
      const proj0 = (p as any).project;
      if (!proj0 || proj0.status === 'perdu' || proj0.deleted_at != null) continue;
      const days = Math.floor((Date.now() - new Date(p.due_date).getTime()) / 86400000);
      if (days !== 7 && days !== 15) continue;
      const remaining = Number(p.amount_expected) - Number(p.amount_paid);
      const client = proj0?.client;
      const subject = buildPaymentSubject({
        projectRef: proj0?.reference,
        clientName: client?.full_name,
        label: `Honoraire en retard ${days}j (${p.type})`,
        amount: remaining,
        currency: 'EUR',
      });

      // 6a. Relance directe au CLIENT (sauf si email manquant)
      if (client?.email && !client.email.includes('placeholder')) {
        await sendReminderClient({
          to: client.email,
          client_name: client.full_name,
          title: `Rappel : votre paiement Stoniz est en retard de ${days} jours`,
          message: `Nous n'avons pas encore reçu votre paiement <strong>${p.type}</strong> (${remaining.toLocaleString('fr-FR')} €). Merci de procéder au virement ou de nous contacter si vous avez besoin d'aide.`,
          cta_url: `${APP_URL}/client/projects/${p.project_id}`,
          cta_label: 'Voir mon échéancier',
          template_id: 'rappel_paiement_client',
          idempotency_key: `rem-overdue-client-${p.id}-d${days}-${today}`,
          project_id: p.project_id,
        });
        count++;
      }

      // 6b. Copie interne Nabil/finance pour suivi
      for (const r of financeRecipients) {
        await sendReminderTeam({
          to: r.email,
          recipient_name: r.full_name ?? r.email,
          title: subject,
          message: `${client?.full_name ?? 'Client'} (${proj0?.reference}) a un paiement <strong>${p.type}</strong> en retard de <strong>${days} jours</strong>. Reste dû : ${remaining.toLocaleString('fr-FR')} €.`,
          cta_url: `${APP_URL}/projects/${p.project_id}/payments`,
          cta_label: 'Ouvrir le projet',
          template_id: 'alerte_paiement_retard',
          idempotency_key: `rem-overdue-finance-${p.id}-d${days}-${today}-${r.email}`,
          project_id: p.project_id,
        });
        count++;
      }
    }
    results['payments_overdue'] = count;
  } catch (e) { errors.push(`payments_overdue: ${String(e)}`); }

  // ─── 7. Acomptes artisans à verser bientôt (J-3) → Nabil/finance seul ───
  // CEO 2026-06-19 : ce rappel est purement opérationnel (le financier
  // exécute le virement). Pas de CC CEO pour limiter le bruit.
  try {
    const future = new Date();
    future.setDate(future.getDate() + 3);
    const target = future.toISOString().slice(0, 10);

    const { data: upcoming } = await admin
      .from('travaux_payments')
      .select('id, project_id, artisan_name, amount_total, scheduled_date, project:projects(reference, client:clients(full_name))')
      .eq('scheduled_date', target)
      .neq('status', 'paid')
      .is('deleted_at', null);

    const financeRecipients = await getFinanceRecipients(admin);

    let count = 0;
    for (const p of upcoming ?? []) {
      if (!isNotifiable(p.project_id)) continue;
      const proj = (p as any).project;
      const subject = buildPaymentSubject({
        projectRef: proj?.reference,
        clientName: proj?.client?.full_name,
        label: `Acompte artisan ${p.artisan_name} (J-3)`,
        amount: Number(p.amount_total),
        currency: 'MAD',
      });
      for (const r of financeRecipients) {
        await sendReminderTeam({
          to: r.email,
          recipient_name: r.full_name ?? r.email,
          title: subject,
          message: `Acompte de <strong>${Number(p.amount_total).toLocaleString('fr-FR')} MAD</strong> à <strong>${p.artisan_name}</strong> prévu le ${p.scheduled_date} (${proj?.reference}).`,
          cta_url: `${APP_URL}/projects/${p.project_id}/travaux`,
          cta_label: 'Ouvrir le suivi travaux',
          template_id: 'alerte_acompte_a_verser',
          idempotency_key: `rem-acompte-${p.id}-${today}-${r.email}`,
          project_id: p.project_id,
        });
        count++;
      }
    }
    results['acomptes_upcoming'] = count;
  } catch (e) { errors.push(`acomptes_upcoming: ${String(e)}`); }

  // ─── 8. Tâches bloquantes en retard ────────────────────────────────────
  try {
    const { data: blocking } = await admin
      .from('tasks')
      .select('id, project_id, title, due_date, assigned_to, project:projects(reference), assignee:profiles!tasks_assigned_to_fkey(email, full_name)')
      .eq('is_blocking', true)
      .neq('status', 'done')
      .lt('due_date', today);

    let count = 0;
    for (const t of blocking ?? []) {
      const assignee = (t as any).assignee;
      if (!assignee?.email) continue;
      const days = Math.floor((Date.now() - new Date((t as any).due_date).getTime()) / 86400000);
      await sendReminderTeam({
        to: assignee.email,
        recipient_name: assignee.full_name,
        title: `Tâche bloquante en retard de ${days} jour(s)`,
        message: `<strong>${t.title}</strong> (${(t as any).project?.reference}) est bloquante et en retard de ${days} jour(s).`,
        cta_url: `${APP_URL}/projects/${t.project_id}/tasks`,
        cta_label: 'Voir les tâches',
        template_id: 'alerte_tache_bloquante',
        idempotency_key: `rem-task-${t.id}-${today}`,
        project_id: t.project_id,
      });
      count++;
    }
    results['blocking_tasks'] = count;
  } catch (e) { errors.push(`blocking_tasks: ${String(e)}`); }

  // ─── 9. Récap quotidien alertes → CEO + chefs de projet + finance ──────
  // Désinscrits du récap quotidien (13/09/2026) : le mail réémet chaque matin
  // le stock complet d'alertes sans notion de "nouveau depuis hier", il n'est
  // donc pas lu. Retirer un email d'ici le réabonne.
  const ALERTS_RECAP_OPTOUT = ['othmane@stoniz.co'];
  try {
    const { data: recipients } = await admin
      .from('profiles')
      .select('id, email, full_name, role')
      .in('role', ['ceo','chef_projet','finance'])
      .eq('is_active', true);

    let count = 0;
    for (const r of recipients ?? []) {
      if (ALERTS_RECAP_OPTOUT.includes(r.email)) continue;
      const all = await collectAlerts({ userId: r.id, role: r.role as any });
      // Pour finance : filtre uniquement la catégorie paiements
      const scoped = r.role === 'finance'
        ? all.filter(a => a.category === 'paiements')
        : all;
      if (scoped.length === 0) continue;
      await sendDailyAlertsRecap({
        to: r.email,
        recipient_name: r.full_name,
        alerts: scoped,
        scope: r.role === 'finance' ? 'paiements' : 'all',
        app_url: APP_URL,
        date_iso: today,
      });
      count++;
    }
    results['alerts_recap'] = count;
  } catch (e) { errors.push(`alerts_recap: ${String(e)}`); }

  // ─── 10. Checkups échus (due_date passée et toujours pas validés) ──────
  // Pings échelonnés à J+3, J+7, J+14, J+30 après la due_date.
  // Destinataire : l'assigned_to_id si présent, sinon CEO + assistantes
  // en fallback (un checkup orphelin doit quand même remonter).
  try {
    const { data: overdueCheckups } = await admin
      .from('propria_checkups')
      .select('id, property_id, propria_unit_id, due_date, assigned_to_id, status')
      .in('status', ['a_faire', 'en_cours', 'a_valider'])
      .lt('due_date', today)
      .is('deleted_at', null);

    let count = 0;
    for (const c of (overdueCheckups ?? []) as any[]) {
      if (!c.due_date) continue;
      const days = Math.floor(
        (Date.now() - new Date(c.due_date).getTime()) / 86_400_000,
      );
      if (days !== 3 && days !== 7 && days !== 14 && days !== 30) continue;
      const sent = await notifyCheckupOverdue({
        admin,
        checkupId: c.id,
        propertyId: c.property_id ?? null,
        propriaUnitId: c.propria_unit_id ?? null,
        assignedToId: c.assigned_to_id ?? null,
        daysOverdue: days,
        todayIso: today,
      });
      count += sent;
    }
    results['checkups_overdue'] = count;
  } catch (e) { errors.push(`checkups_overdue: ${String(e)}`); }

  // ─── 11. Création auto des fiches police pour check-ins du jour ────────
  // CEO 2026-06-19 : tous voyageurs sans exception. Le helper renvoie déjà
  // les check-ins du jour SANS fiche existante (anti-doublon BDD + app-level).
  try {
    const checkIns = await findCheckInsNeedingPoliceRecord(admin, today);
    let count = 0;
    for (const c of checkIns) {
      // Pull les data de la source (best-effort — si la résa a été soft-deleted
      // entre temps, on insert quand même un brouillon minimal avec ce qu'on a).
      let prefill: Record<string, unknown> = {};
      try {
        if (c.reservation_source === 'hostaway') {
          prefill = await pullDataFromHostawayReservation(admin as any, c.reservation_source_id);
        } else if (c.reservation_source === 'direct') {
          prefill = await pullDataFromDirectReservation(admin as any, c.reservation_source_id);
        } else if (c.reservation_source === 'cash') {
          prefill = await pullDataFromCashReservation(admin as any, c.reservation_source_id);
        }
      } catch (e) {
        console.warn('[police-records cron] prefill failed for', c.reservation_source, c.reservation_source_id, e);
      }

      // Fallback : si le helper n'a rien retourné (résa soft-deleted ?),
      // on reconstruit le minimum depuis la ligne CheckInNeedingRecord.
      if (!prefill || Object.keys(prefill).length === 0) {
        const { first_name, last_name } = splitGuestName(c.guest_name);
        prefill = {
          reservation_source: c.reservation_source,
          reservation_source_id: c.reservation_source_id,
          property_id: c.property_id,
          propria_unit_id: c.propria_unit_id,
          head_first_name: first_name,
          head_last_name: last_name,
          arrival_date_property: c.arrival_date,
          expected_departure_date: c.departure_date,
          data_source: c.reservation_source === 'hostaway' ? 'hostaway_portal' : 'manual_checkin',
        };
      }

      const { data: created, error: insErr } = await admin
        .from(POLICE_RECORDS_TABLE)
        .insert({
          ...prefill,
          status: 'draft',
          created_by: null,
        } as any)
        .select('id')
        .single();
      if (insErr) {
        // Doublon attrapé par l'index unique → on saute proprement
        if ((insErr.message ?? '').toLowerCase().includes('duplicate')) continue;
        console.warn('[police-records cron] insert failed:', insErr.message);
        continue;
      }
      const createdRow = created as { id: string } | null;
      if (createdRow?.id) {
        await notifyPoliceRecordsTeam(admin, {
          title: 'Nouvelle fiche police à compléter',
          body: `${c.guest_name || 'Voyageur'} arrive aujourd'hui — fiche ${createdRow.id.slice(0, 8)}`,
          href: `/propria/fiches-police/${createdRow.id}`,
        });
        count++;
      }
    }
    results['police_records_created'] = count;
  } catch (e) { errors.push(`police_records: ${String(e)}`); }

  return NextResponse.json({
    ok: errors.length === 0,
    date: today,
    sent: results,
    total_sent: Object.values(results).reduce((s, n) => s + n, 0),
    errors: errors.length > 0 ? errors : undefined,
  });
}

// POST identique pour faciliter le curl
export const POST = GET;
