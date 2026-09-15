import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { LOST_STATUS } from '@/lib/projects/lost';
import {
  wrapPage,
  htmlHeader,
  htmlFooter,
  kpiCard,
  kpiRow,
  section,
  sectionTitle,
  alertBox,
  dataTable,
  emptyOk,
  fmtDate,
  fmtMad,
  weekWindows,
  isoDay,
  esc,
  daysAgo,
  COLORS,
} from './brief-common';

const MOBILIER_DECO_CATS = new Set([
  'mobilier_salon',
  'mobilier_chambre',
  'mobilier_sdb',
  'mobilier_cuisine',
  'electromenager',
  'luminaire',
  'textile_decoration',
  'vaisselle_arts_table',
  'linge_maison',
]);

const CAT_LABELS: Record<string, string> = {
  mobilier_salon: 'Mobilier salon',
  mobilier_chambre: 'Mobilier chambre',
  mobilier_sdb: 'Mobilier SDB',
  mobilier_cuisine: 'Mobilier cuisine',
  electromenager: 'Électroménager',
  luminaire: 'Luminaire',
  textile_decoration: 'Textile / déco',
  vaisselle_arts_table: 'Vaisselle',
  linge_maison: 'Linge',
};

const STATUS_LABELS: Record<string, string> = {
  a_commander: 'À commander',
  devis_recu: 'Devis reçu',
  commande: 'Commandé',
  en_livraison: 'En livraison',
  livre: 'Livré',
  installe: 'Installé',
  annule: 'Annulé',
};

export async function buildAchatsBrief(): Promise<{ subject: string; html: string }> {
  const admin = createAdminClient();
  const { lastWeekStart, lastWeekEnd, nextWeekStart, nextWeekEnd, today, labelLast, labelNext } =
    weekWindows();
  const fromIso = isoDay(lastWeekStart);
  const toIso = isoDay(lastWeekEnd);
  const nextFromIso = isoDay(nextWeekStart);
  const nextToIso = isoDay(nextWeekEnd);
  const todayIso = isoDay(today);

  // ─── 1) Lots créés / livrés / retard livraison ───────────────────────
  const { data: lots } = await admin
    .from('achats_lots')
    .select('id, category, status, description, supplier_name, devis_fournisseur_mad, date_commande, date_livraison_estimee, date_livraison_reelle, created_at, project:projects(reference, status, deleted_at, client:clients(full_name))')
    .is('deleted_at', null);
  const activeLots = ((lots ?? []) as any[]).filter(
    (l) => l.project && !l.project.deleted_at && l.project.status !== LOST_STATUS,
  );

  const createsSemaine = activeLots.filter(
    (l) => l.created_at >= fromIso && l.created_at <= `${toIso}T23:59:59`,
  );
  const livresSemaine = activeLots.filter(
    (l) =>
      l.date_livraison_reelle &&
      l.date_livraison_reelle >= fromIso &&
      l.date_livraison_reelle <= toIso,
  );
  const enRetardLivraison = activeLots.filter(
    (l) =>
      l.date_livraison_estimee &&
      l.date_livraison_estimee < todayIso &&
      !l.date_livraison_reelle &&
      l.status !== 'annule',
  );

  // ─── 2) Bons de commande émis ───────────────────────────────────────
  const bcEmis = activeLots.filter(
    (l) => l.date_commande && l.date_commande >= fromIso && l.date_commande <= toIso,
  );
  const totalBc = bcEmis.reduce((s, l) => s + Number(l.devis_fournisseur_mad ?? 0), 0);

  // ─── 3) Acomptes fournisseurs à payer semaine prochaine ────────────
  const { data: acomptes } = await admin
    .from('achats_payments')
    .select('id, supplier_name, amount_total, amount_paid, scheduled_date, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
    .is('deleted_at', null)
    .gte('scheduled_date', nextFromIso)
    .lte('scheduled_date', nextToIso);
  const toPay = ((acomptes ?? []) as any[]).filter(
    (p) => p.project && !p.project.deleted_at && p.project.status !== LOST_STATUS && p.status !== 'paid' && p.status !== 'paye',
  );

  // ─── 4) Encaissements clients achats ────────────────────────────────
  const { data: encaisRecus } = await admin
    .from('achats_encaissements')
    .select('id, amount_mad, received_at, status, project:projects(deleted_at, status)')
    .is('deleted_at', null)
    .eq('status', 'recu')
    .gte('received_at', fromIso)
    .lte('received_at', toIso);
  const totalRecu = ((encaisRecus ?? []) as any[])
    .filter((e) => e.project && !e.project.deleted_at)
    .reduce((s, e) => s + Number(e.amount_mad ?? 0), 0);

  const { data: encaisPlan } = await admin
    .from('achats_encaissements')
    .select('id, amount_mad, scheduled_date, project:projects(deleted_at, status)')
    .is('deleted_at', null)
    .eq('status', 'planifie')
    .gte('scheduled_date', nextFromIso)
    .lte('scheduled_date', nextToIso);
  const totalPrev = ((encaisPlan ?? []) as any[])
    .filter((e) => e.project && !e.project.deleted_at && e.project.status !== LOST_STATUS)
    .reduce((s, e) => s + Number(e.amount_mad ?? 0), 0);

  // ─── 5) Mobilier & déco en cours ────────────────────────────────────
  const mobilierEnCours = activeLots.filter(
    (l) => MOBILIER_DECO_CATS.has(l.category) && l.status !== 'installe' && l.status !== 'annule',
  );

  // ─── 6) Anomalies : lots a_commander avec acomptes planifiés ───────
  const lotsIdsACommander = new Set(
    activeLots.filter((l) => l.status === 'a_commander').map((l) => l.id),
  );
  let anomaliesIncoherence = 0;
  try {
    const { data: acompteAll } = await admin
      .from('achats_payments')
      .select('lot_id, scheduled_date')
      .is('deleted_at', null)
      .not('scheduled_date', 'is', null);
    for (const a of (acompteAll ?? []) as any[]) {
      if (lotsIdsACommander.has(a.lot_id)) anomaliesIncoherence++;
    }
  } catch {}

  // ═══ Compose ═══
  const subject = `Semaine du ${labelLast}`;
  const subtitle = 'Achats & fournisseurs';

  const kpis = kpiRow([
    kpiCard({
      label: 'Lots créés',
      value: String(createsSemaine.length),
      subValue: 'cette semaine',
      variant: 'emerald',
    }),
    kpiCard({
      label: 'Lots livrés',
      value: String(livresSemaine.length),
      subValue: 'cette semaine',
      variant: 'dark',
    }),
    kpiCard({
      label: 'BC émis (montant)',
      value: fmtMad(totalBc),
      subValue: `${bcEmis.length} bon(s)`,
      variant: 'light',
    }),
  ]);

  const retardLivSection = enRetardLivraison.length === 0
    ? emptyOk('Aucun lot en retard de livraison.')
    : dataTable({
        headers: ['Fournisseur', 'Projet', 'Livraison prévue', 'Retard'],
        rows: enRetardLivraison.slice(0, 10).map((l: any) => [
          esc(l.supplier_name ?? '—'),
          `${esc(l.project?.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(l.project?.reference ?? '')}</span>`,
          { text: fmtDate(l.date_livraison_estimee), align: 'left' as const },
          { text: `${daysAgo(l.date_livraison_estimee)} j`, align: 'right' as const, color: COLORS.danger, bold: true },
        ]),
      });

  const toPaySection = toPay.length === 0
    ? emptyOk('Aucun acompte fournisseur à payer semaine prochaine.')
    : dataTable({
        headers: ['Fournisseur', 'Projet', 'Date', 'Montant'],
        rows: toPay.slice(0, 10).map((p: any) => [
          esc(p.supplier_name ?? '—'),
          esc(p.project?.client?.full_name ?? p.project?.reference ?? '—'),
          { text: fmtDate(p.scheduled_date), align: 'left' as const },
          {
            text: fmtMad(Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0)),
            align: 'right' as const,
            bold: true,
          },
        ]),
      });

  const encaissementsSection = `
    <div style="font-size:13px;color:${COLORS.muted};margin-bottom:10px;">
      Semaine écoulée : <strong>${fmtMad(totalRecu)}</strong> encaissés · Prévu semaine prochaine : <strong>${fmtMad(totalPrev)}</strong>
    </div>`;

  const mobilierSection = mobilierEnCours.length === 0
    ? emptyOk('Aucun lot mobilier/déco en cours.')
    : dataTable({
        headers: ['Client', 'Catégorie', 'Fournisseur', 'Statut'],
        rows: mobilierEnCours.slice(0, 15).map((l: any) => [
          `${esc(l.project?.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(l.project?.reference ?? '')}</span>`,
          esc(CAT_LABELS[l.category] ?? l.category),
          esc(l.supplier_name ?? '—'),
          { text: esc(STATUS_LABELS[l.status] ?? l.status), align: 'right' as const, bold: true },
        ]),
      });

  const anomaliesSection = anomaliesIncoherence === 0
    ? emptyOk('Aucune incohérence détectée sur les lots à commander.')
    : alertBox({
        level: 'warning',
        content: `<strong>${anomaliesIncoherence}</strong> acompte(s) planifié(s) sur des lots encore en statut <em>a_commander</em> — incohérence à vérifier.`,
      });

  const body =
    htmlHeader(subject, subtitle) +
    section(sectionTitle('Vue d\'ensemble') + kpis, { padding: '24px 32px 8px' }) +
    section(sectionTitle('Lots en retard de livraison') + retardLivSection) +
    section(sectionTitle(`Acomptes fournisseurs à payer (${labelNext})`) + toPaySection) +
    section(sectionTitle('Encaissements clients achats') + encaissementsSection) +
    section(sectionTitle('Mobilier & déco en cours') + mobilierSection) +
    section(sectionTitle('Anomalies') + anomaliesSection) +
    htmlFooter('/dashboard/achats', 'Ouvrir dashboard achats');

  const full = `Stoniz · ${subtitle} · ${subject}`;
  return { subject: full, html: wrapPage(body, full) };
}
