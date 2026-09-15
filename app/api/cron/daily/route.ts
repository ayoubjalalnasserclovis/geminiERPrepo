import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendPaymentReminder } from '@/lib/email/templates';
import { getFinanceRecipients, buildPaymentSubject } from '@/lib/notifications/recipients';
import { requireCronAuth } from '@/lib/cron/auth';

/**
 * Cron quotidien — appelé par Vercel Cron à 6h UTC.
 * 1. Consomme la table scheduled_jobs (run_at <= now)
 * 2. Identifie les paiements en retard pour rappel (Nabil/finance)
 * 3. Purge email_logs > 365 jours
 *
 * Fix CEO 2026-06-19 : remplacement de l'anti-pattern `to: EMAIL_FROM ?? finance@stoniz.co`
 * par une vraie liste finance issue de `profiles` (Nabil + role=finance actif).
 * Sujets enrichis [STZ-ref] + nom client + montant pour identifier le dossier en 1 coup d'œil.
 */

export async function GET(request: NextRequest) {
  // Sécurité : garde-fou centralisé (lib/cron/auth.ts) — Bearer CRON_SECRET.
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const admin = createAdminClient();
  const stats: any = {};

  // Charge une seule fois la liste finance pour tous les rappels du cron
  const financeRecipients = await getFinanceRecipients(admin);
  stats.finance_recipients = financeRecipients.length;
  if (financeRecipients.length === 0) {
    // Le helper renvoie au moins le fallback Nabil, donc 0 ne devrait jamais arriver.
    console.error('[cron/daily] aucun destinataire finance — rappels skip');
  }

  // ─── 1. Consomme les jobs scheduled_jobs ────────────────────────────────
  const { data: jobs } = await admin
    .from('scheduled_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at')
    .limit(100);

  let jobsProcessed = 0;
  for (const job of jobs ?? []) {
    try {
      await admin.from('scheduled_jobs').update({
        status: 'running',
        attempts: job.attempts + 1,
      }).eq('id', job.id);

      // Traitement par type
      if (job.job_type === 'reminder_artisan_acompte' || job.job_type === 'reminder_artisan_solde') {
        const { data: project } = await admin.from('projects')
          .select('id, reference, travaux_budget, client:clients(full_name)')
          .eq('id', job.payload?.project_id).single();
        if (project && financeRecipients.length > 0) {
          const label = job.job_type === 'reminder_artisan_acompte' ? 'Acompte artisan' : 'Solde artisan';
          const amount = (project.travaux_budget ?? 0) * 0.5;
          const clientName = (project as any).client?.full_name ?? null;
          const subject = buildPaymentSubject({
            projectRef: project.reference,
            clientName,
            label,
            amount,
            currency: 'EUR',
          });
          // 1 mail par destinataire finance (idempotency_key inclut l'email)
          for (const r of financeRecipients) {
            await sendPaymentReminder({
              to: r.email,
              subject_override: subject,
              subject_label: `${label} — ${project.reference}`,
              amount_eur: amount,
              project_id: project.id,
              idempotency_key: `${job.idempotency_key ?? `${job.job_type}-${project.id}`}-${r.email}`,
            });
          }
        }
      }

      await admin.from('scheduled_jobs').update({ status: 'done' }).eq('id', job.id);
      jobsProcessed++;
    } catch (err: any) {
      await admin.from('scheduled_jobs').update({
        status: job.attempts >= 3 ? 'failed' : 'pending',
        last_error: err?.message ?? String(err),
      }).eq('id', job.id);
    }
  }
  stats.jobs_processed = jobsProcessed;

  // ─── 2. Paiements en retard → rappel finance ───────────────────────────
  // Règle 2026-05-30 : on recalcule le retard (due_date <= aujourd'hui, inclusif,
  // rouge dès le jour J) au lieu de se fier à status='overdue' qui n'est pas
  // rafraîchi par le temps — sinon des échéances réellement dues restent muettes.
  const todayIsoDaily = new Date().toISOString().slice(0, 10);
  const { data: overdueRaw } = await admin
    .from('payments')
    .select('id, project_id, type, amount_expected, amount_paid, due_date, project:projects(reference, status, deleted_at, client:clients(full_name))')
    .lte('due_date', todayIsoDaily)
    .neq('status', 'paid')
    .is('deleted_at', null)
    .limit(200);
  // Règle métier permanente : pas de rappel pour les projets perdus
  // (voir lib/projects/lost.ts)
  const overduePayments = (overdueRaw ?? []).filter(
    (p: any) =>
      Number(p.amount_paid ?? 0) < Number(p.amount_expected ?? 0)
      && p.project
      && p.project.status !== 'perdu'
      && p.project.deleted_at == null,
  );

  let remindersSent = 0;
  for (const p of overduePayments) {
    if (financeRecipients.length === 0) break;
    const proj = (p as any).project;
    const remaining = Number(p.amount_expected) - Number(p.amount_paid);
    const subject = buildPaymentSubject({
      projectRef: proj?.reference,
      clientName: proj?.client?.full_name,
      label: `Honoraire en retard (${p.type})`,
      amount: remaining,
      currency: 'EUR',
    });
    for (const r of financeRecipients) {
      const idempo = `overdue-payment-${p.id}-${todayIsoDaily}-${r.email}`;
      const { data: existing } = await admin.from('email_logs')
        .select('id').eq('idempotency_key', idempo).maybeSingle();
      if (existing) continue;

      await sendPaymentReminder({
        to: r.email,
        subject_override: subject,
        subject_label: `Paiement en retard : ${p.type}`,
        amount_eur: remaining,
        due_date: p.due_date ?? undefined,
        project_id: p.project_id,
        idempotency_key: idempo,
      });
      remindersSent++;
    }
  }
  stats.overdue_reminders = remindersSent;

  // ─── 3. Purge email_logs > 365 jours ────────────────────────────────────
  const { count: purged } = await admin.from('email_logs')
    .delete({ count: 'exact' })
    .lt('retention_until', new Date().toISOString().slice(0,10));
  stats.email_logs_purged = purged ?? 0;

  return NextResponse.json({ ok: true, stats });
}
