import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { computePartnersCompletude } from '@/lib/completude/partenaires-completude';
import { LOST_STATUS, isProjectLost } from '@/lib/projects/lost';

export type AlertSeverity = 'critique' | 'importante' | 'info';
export type AlertCategory = 'paiements' | 'operations' | 'clients' | 'sourcing' | 'propria';

export type Alert = {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  description: string;
  href: string;
  meta?: string;          // ex: "3 800 €" / "Riad Hivernage"
  days_overdue?: number;
};

import type { Role } from '@/lib/auth/require'; // QA-BUG-006 : type local obsolète (8 rôles) remplacé par le canon (12)

const DAYS = (n: number) => n * 86_400_000;
const today = () => new Date();
const isoDateTodayMinus = (days: number) =>
  new Date(Date.now() - DAYS(days)).toISOString();

/**
 * Collecte toutes les alertes visibles pour un user donné.
 * - CEO : voit tout
 * - finance : uniquement les alertes paiements
 * - chef_projet : uniquement les alertes de ses projets (assigned_chef_projet = lui)
 * - autres rôles : alertes globales sourcing/ops (mais pas finance détaillée)
 */
export async function collectAlerts({
  userId,
  role,
}: {
  userId: string;
  role: Role;
}): Promise<Alert[]> {
  const supabase = createClient();
  const admin = createAdminClient();
  const alerts: Alert[] = [];

  // Helper : filtre les projets visibles selon le rôle
  let visibleProjectIds: Set<string> | null = null; // null = tous visibles
  if (role === 'chef_projet') {
    const { data: myProjects } = await admin.from('projects')
      .select('id').eq('assigned_chef_projet', userId).is('deleted_at', null);
    visibleProjectIds = new Set((myProjects ?? []).map(p => p.id));
  }
  const projectFilter = (projectId: string | null | undefined) =>
    !visibleProjectIds || (projectId && visibleProjectIds.has(projectId));

  // Le rôle developer voit toutes les alertes en lecture pour pouvoir
  // debugger / reproduire les conditions d'apparition.
  const isDev = role === 'developer';
  const seePaiements  = role === 'ceo' || role === 'finance' || role === 'chef_projet' || isDev;
  const seeOperations = role === 'ceo' || role === 'chef_projet' || isDev;
  const seeClients    = role === 'ceo' || role === 'chef_projet' || role === 'commercial' || isDev;
  const seeSourcing   = role === 'ceo' || role === 'sourcing' || role === 'chef_projet' || isDev;
  const seePropria    = role === 'ceo' || role === 'chef_projet' || role === 'propria' || isDev; // QA-BUG-006 : le rôle propria ne voyait aucune alerte Propria

  const todayIso = today().toISOString().slice(0, 10);

  // ─── 🚨 CRITIQUE : Paiements clients en retard ─────────────────────────
  if (seePaiements) {
    // Règle 2026-05-30 : rouge dès le JOUR de l'échéance → due_date <= aujourd'hui (inclusif).
    // On ne se fie jamais au statut stocké ('overdue' n'est pas rafraîchi par le temps) : on recalcule ici.
    const { data: paysOverdue } = await admin
      .from('payments')
      .select('id, project_id, type, amount_expected, amount_paid, due_date, project:projects(reference, status, deleted_at, client:clients(full_name))')
      .lte('due_date', todayIso)
      .is('deleted_at', null);

    for (const p of (paysOverdue ?? []) as any[]) {
      if (Number(p.amount_paid ?? 0) >= Number(p.amount_expected ?? 0)) continue;
      if (!projectFilter(p.project_id)) continue;
      // Règle métier 2026-05-30 : projet perdu ou supprimé → pas d'alerte de recouvrement
      if (!p.project) continue;
      if (p.project.status === 'perdu') continue;
      if (p.project.deleted_at != null) continue;
      const daysLate = Math.max(
        0,
        Math.floor((today().getTime() - new Date(p.due_date).getTime()) / DAYS(1)),
      );
      const remaining = Number(p.amount_expected) - Number(p.amount_paid);
      alerts.push({
        id: `pay-${p.id}`,
        severity: 'critique',
        category: 'paiements',
        title: daysLate === 0
          ? `Paiement client échu aujourd'hui (à régler)`
          : `Paiement client en retard de ${daysLate}j`,
        description: `${p.project?.client?.full_name ?? '—'} · ${p.project?.reference ?? ''} · ${formatPaymentType(p.type)}`,
        meta: `${remaining.toLocaleString('fr-FR')} €`,
        href: `/projects/${p.project_id}/payments`,
        days_overdue: daysLate,
      });
    }
  }

  // ─── 🚨 Budget vendu manquant PAR PÔLE (travaux / achats) — chiffres faux ──
  // Signalé CEO 2026-06-14. Le budget vendu (forfait) est la référence de TOUS
  // les KPI financiers (marge, reste à encaisser, cockpit). On vérifie CHAQUE
  // pôle SÉPARÉMENT (un budget travaux peut manquer même si l'achats est saisi),
  // déclenché dès qu'il y a de l'activité dans ce pôle (lot / devis / encaissement
  // reçu). CRITIQUE si du cash est déjà encaissé sur le pôle, IMPORTANTE sinon.
  if (seePaiements) {
    const [cfgRes, teRes, aeRes, tlRes, alRes] = await Promise.all([
      admin.from('projects')
        .select('id, reference, status, travaux_budget_mad, achats_budget_mad, client:clients(full_name)')
        .neq('status', 'perdu').is('deleted_at', null),
      admin.from('travaux_encaissements').select('project_id, amount_mad').eq('status', 'recu').is('deleted_at', null),
      admin.from('achats_encaissements').select('project_id, amount_mad').eq('status', 'recu').is('deleted_at', null),
      admin.from('travaux_lots').select('project_id, devis_artisan_mad').is('deleted_at', null),
      admin.from('achats_lots').select('project_id, devis_fournisseur_mad').is('deleted_at', null),
    ]);
    const sumMap = (rows: any[] | null, key: string) => {
      const m = new Map<string, number>();
      for (const r of rows ?? []) m.set(r.project_id, (m.get(r.project_id) ?? 0) + Number(r[key] ?? 0));
      return m;
    };
    const countMap = (rows: any[] | null) => {
      const m = new Map<string, number>();
      for (const r of rows ?? []) m.set(r.project_id, (m.get(r.project_id) ?? 0) + 1);
      return m;
    };
    const tRecu = sumMap(teRes.data, 'amount_mad'), tDevis = sumMap(tlRes.data, 'devis_artisan_mad'), tLots = countMap(tlRes.data);
    const aRecu = sumMap(aeRes.data, 'amount_mad'), aDevis = sumMap(alRes.data, 'devis_fournisseur_mad'), aLots = countMap(alRes.data);

    const emitMissingBudget = (p: any, pole: 'travaux' | 'achats', budget: number, recu: number, devis: number, lots: number) => {
      if (budget > 0) return;                          // budget saisi → OK
      if (lots === 0 && devis === 0 && recu === 0) return; // aucune activité sur ce pôle → on n'embête pas
      const cash = recu > 0;
      alerts.push({
        id: `budget-vendu-manquant-${pole}-${p.id}`,
        severity: cash ? 'critique' : 'importante',
        category: 'paiements',
        title: `Budget ${pole} vendu manquant — ${p.reference}`,
        description: cash
          ? `${recu.toLocaleString('fr-FR')} MAD déjà encaissés sur les ${pole} mais aucun budget ${pole} vendu n'est renseigné → la marge, le reste à encaisser et la trésorerie de ce pôle sont faux. À saisir sur la fiche projet.`
          : `${pole === 'travaux' ? 'Travaux' : 'Achats'} engagés (devis/lots) sans budget ${pole} vendu → la marge de ce pôle est calculée sans référence (faussée). À saisir sur la fiche projet.`,
        href: `/projects/${p.id}/${pole}`,
        meta: p.client?.full_name ?? undefined,
      });
    };

    for (const p of (cfgRes.data ?? []) as any[]) {
      if (!projectFilter(p.id)) continue;
      emitMissingBudget(p, 'travaux', Number(p.travaux_budget_mad ?? 0), tRecu.get(p.id) ?? 0, tDevis.get(p.id) ?? 0, tLots.get(p.id) ?? 0);
      emitMissingBudget(p, 'achats',  Number(p.achats_budget_mad ?? 0),  aRecu.get(p.id) ?? 0, aDevis.get(p.id) ?? 0, aLots.get(p.id) ?? 0);
    }
  }

  // ─── 🚨 CRITIQUE : Validations paiement en attente Finance/CEO > 48h ───
  if (seePaiements) {
    const cutoff48h = new Date(Date.now() - DAYS(2)).toISOString();
    const { data: approvals } = await admin
      .from('payment_approvals')
      .select('id, amount, currency, beneficiary_name, project_id, requested_at, finance_status, ceo_status, project:projects(reference)')
      .lt('requested_at', cutoff48h)
      .is('deleted_at', null)
      .neq('final_status', 'approved')
      .neq('final_status', 'rejected');

    for (const a of (approvals ?? []) as any[]) {
      if (!projectFilter(a.project_id)) continue;
      const days = Math.floor((today().getTime() - new Date(a.requested_at).getTime()) / DAYS(1));
      const blocker = a.finance_status === 'pending' ? 'Finance'
                    : a.ceo_status === 'pending' ? 'CEO'
                    : 'Validation';
      alerts.push({
        id: `approval-${a.id}`,
        severity: 'critique',
        category: 'paiements',
        title: `Validation ${blocker} en attente depuis ${days}j`,
        description: `${a.beneficiary_name} · ${a.project?.reference ?? '—'}`,
        meta: `${Number(a.amount).toLocaleString('fr-FR')} ${a.currency}`,
        href: `/validations#${a.id}`,
        days_overdue: days - 2,
      });
    }
  }

  // ─── 🚨 CRITIQUE : Phases bloquées > 30 jours ──────────────────────────
  if (seeOperations) {
    const cutoff30j = new Date(Date.now() - DAYS(30)).toISOString();
    const { data: history } = await admin
      .from('project_phases_history')
      .select('project_id, phase, started_at, project:projects(reference, current_phase, client:clients(full_name))')
      .is('completed_at', null)
      .lt('started_at', cutoff30j);

    for (const h of (history ?? []) as any[]) {
      if (!projectFilter(h.project_id)) continue;
      // Ne signaler que si la phase courante du projet est bien celle bloquée
      if (h.project?.current_phase !== h.phase) continue;
      const days = Math.floor((today().getTime() - new Date(h.started_at).getTime()) / DAYS(1));
      alerts.push({
        id: `phase-stuck-${h.project_id}-${h.phase}`,
        severity: 'critique',
        category: 'operations',
        title: `Projet bloqué en phase ${formatPhase(h.phase)} depuis ${days}j`,
        description: `${h.project?.client?.full_name ?? '—'} · ${h.project?.reference ?? ''}`,
        href: `/projects/${h.project_id}`,
        days_overdue: days - 30,
      });
    }
  }

  // ─── 🚨 CRITIQUE : Acte authentique en retard (>90j après compromis) ───
  if (seeOperations) {
    const cutoff90j = new Date(Date.now() - DAYS(90)).toISOString().slice(0, 10);
    const { data: projects } = await admin
      .from('projects')
      .select('id, reference, compromis_date, acte_authentique_date, client:clients(full_name)')
      .lt('compromis_date', cutoff90j)
      .is('acte_authentique_date', null)
      .neq('status', 'perdu') // QA-BUG-003 : jamais d'alerte sur un projet perdu
      .is('deleted_at', null);

    for (const p of (projects ?? []) as any[]) {
      if (!projectFilter(p.id)) continue;
      const days = Math.floor((today().getTime() - new Date(p.compromis_date).getTime()) / DAYS(1));
      alerts.push({
        id: `acte-${p.id}`,
        severity: 'critique',
        category: 'operations',
        title: `Acte authentique non signé après ${days}j`,
        description: `${p.client?.full_name ?? '—'} · ${p.reference}`,
        href: `/projects/${p.id}`,
        days_overdue: days - 90,
      });
    }
  }

  // ─── 🚨 CRITIQUE : Maintenance Propria en retard ───────────────────────
  if (seePropria) {
    // Table réelle : propria_maintenance_visits (clé property_id ; deleted_at ajouté le 2026-06-08).
    // "en retard" = visite préventive dont la date est dépassée et non réalisée.
    const { data: maintenance } = await admin
      .from('propria_maintenance_visits')
      .select('id, property_id, quarter, due_date, status, bien:properties(name)')
      .lt('due_date', todayIso)
      .neq('status', 'realise')
      .is('deleted_at', null); // QA-BUG-002 : ignorer les visites supprimées

    for (const m of (maintenance ?? []) as any[]) {
      const days = Math.floor((today().getTime() - new Date(m.due_date).getTime()) / DAYS(1));
      alerts.push({
        id: `maint-${m.id}`,
        severity: 'critique',
        category: 'propria',
        title: `Maintenance préventive ${m.quarter} en retard de ${days}j`,
        description: `${m.bien?.name ?? '—'}`,
        href: `/propria/biens/${m.property_id}`,
        days_overdue: days,
      });
    }
  }

  // ─── 🚨 Stock clés bureau critique / seuil bas (chantier 1 marathon) ────
  if (seePropria) {
    // Vue dérivée des mouvements physiques — bureau ≤1 = critique, =2 = warn.
    const { data: keyStatus } = await admin
      .from('propria_unit_keys_status')
      .select('propria_unit_id, code, nb_bureau, nb_armoire, nb_total, bureau_alert, armoire_alert');

    for (const k of (keyStatus ?? []) as any[]) {
      // Pas d'alerte tant que l'inventaire n'a pas commencé (0 jeu enregistré)
      if (Number(k.nb_total) === 0 && Number(k.nb_bureau) === 0) continue;
      if (k.bureau_alert === 'critique') {
        alerts.push({
          id: `keys-bureau-${k.propria_unit_id}`,
          severity: 'critique',
          category: 'propria',
          title: `Stock clés bureau critique (${k.nb_bureau} jeu) — ${k.code ?? 'lot'}`,
          description: 'Refaire des doubles immédiatement (cible : 4 jeux par logement).',
          href: '/propria/cles',
        });
      } else if (k.bureau_alert === 'warn' || k.armoire_alert === 'warn') {
        alerts.push({
          id: `keys-warn-${k.propria_unit_id}`,
          severity: 'importante',
          category: 'propria',
          title: `Seuil clés bas — ${k.code ?? 'lot'} (bureau ${k.nb_bureau}, armoire ${k.nb_armoire})`,
          description: 'Armoire : 2 jeux de réserve attendus. Bureau : alerte à 2 jeux.',
          href: '/propria/cles',
        });
      }
    }
  }

  // ─── 🚨 Seuils de note voyageurs par lot (chantier 11.c — U30) ──────────
  if (seePropria) {
    // Note moyenne DÉRIVÉE des avis Hostaway des 90 derniers jours (jamais
    // stockée). Seuils consultant : <4,5 = critique « Note critique » ·
    // <4,6 = « Surveillance renforcée » · <4,8 = « Préventif note » (info).
    // Minimum 3 avis sur 90 j pour éviter le bruit statistique.
    const [reviews90Res, unitsEnrichedRes] = await Promise.all([
      admin
        .from('hostaway_reviews')
        .select('propria_unit_id, rating_normalized')
        .gte('submitted_at', isoDateTodayMinus(90))
        .not('propria_unit_id', 'is', null)
        .not('rating_normalized', 'is', null)
        .is('removed_at', null)
        .is('deleted_at', null)
        .limit(10000),
      admin
        .from('propria_units_enriched')
        .select('unit_id, display_label')
        .eq('is_active', true)
        .not('propria_managed_at', 'is', null)
        .is('propria_refused_at', null),
    ]);

    const labelByUnit = new Map(
      ((unitsEnrichedRes.data ?? []) as any[]).map((u) => [u.unit_id, u.display_label]),
    );
    const ratingAgg = new Map<string, { sum: number; n: number }>();
    for (const r of (reviews90Res.data ?? []) as any[]) {
      if (!labelByUnit.has(r.propria_unit_id)) continue; // lots actifs sous gestion uniquement
      const agg = ratingAgg.get(r.propria_unit_id) ?? { sum: 0, n: 0 };
      agg.sum += Number(r.rating_normalized);
      agg.n += 1;
      ratingAgg.set(r.propria_unit_id, agg);
    }

    for (const [unitId, agg] of Array.from(ratingAgg.entries())) {
      if (agg.n < 3) continue;
      const avg = agg.sum / agg.n;
      if (avg >= 4.8) continue;
      const label = labelByUnit.get(unitId) ?? 'lot';
      const noteTxt = `${avg.toFixed(2).replace('.', ',')}/5 sur ${agg.n} avis (90 j)`;
      if (avg < 4.5) {
        alerts.push({
          id: `note-critique-${unitId}`,
          severity: 'critique',
          category: 'propria',
          title: `Note critique — ${label}`,
          description: `Note moyenne ${noteTxt} : sous le seuil 4,5. Plan d'action immédiat.`,
          meta: `${avg.toFixed(2)}/5`,
          href: '/propria/qualite',
        });
      } else if (avg < 4.6) {
        alerts.push({
          id: `note-surveillance-${unitId}`,
          severity: 'importante',
          category: 'propria',
          title: `Surveillance renforcée — ${label}`,
          description: `Note moyenne ${noteTxt} : sous le seuil 4,6. Contrôles à intensifier.`,
          meta: `${avg.toFixed(2)}/5`,
          href: '/propria/qualite',
        });
      } else {
        alerts.push({
          id: `note-preventif-${unitId}`,
          severity: 'info',
          category: 'propria',
          title: `Préventif note — ${label}`,
          description: `Note moyenne ${noteTxt} : sous le seuil 4,8. À surveiller.`,
          meta: `${avg.toFixed(2)}/5`,
          href: '/propria/qualite',
        });
      }
    }
  }

  // ─── ⚠️ IMPORTANTE : Docs client en attente validation > 3j ────────────
  if (seeOperations) {
    const cutoff3j = isoDateTodayMinus(3);
    const { data: docs } = await admin
      .from('documents')
      .select('id, name, type, project_id, created_at, project:projects(reference, client:clients(full_name))')
      .eq('requires_client_validation', true)
      .eq('client_validation_status', 'pending')
      .eq('is_visible_to_client', true)
      .is('deleted_at', null)
      .lt('created_at', cutoff3j);

    for (const d of (docs ?? []) as any[]) {
      if (!projectFilter(d.project_id)) continue;
      const days = Math.floor((today().getTime() - new Date(d.created_at).getTime()) / DAYS(1));
      alerts.push({
        id: `doc-pending-${d.id}`,
        severity: 'importante',
        category: 'clients',
        title: `Document en attente validation client (${days}j)`,
        description: `${d.project?.client?.full_name ?? '—'} · ${d.name}`,
        href: `/projects/${d.project_id}/documents`,
      });
    }
  }

  // ─── ⚠️ IMPORTANTE : Cahier des charges en attente > 3j ────────────────
  if (seeClients) {
    const cutoff3j = isoDateTodayMinus(3);
    const { data: briefs } = await admin
      .from('project_briefs')
      .select('id, project_id, sent_at, project:projects(reference, client:clients(full_name))')
      .eq('status', 'sent_to_client')
      .lt('sent_at', cutoff3j);

    for (const b of (briefs ?? []) as any[]) {
      if (!projectFilter(b.project_id)) continue;
      const days = Math.floor((today().getTime() - new Date(b.sent_at).getTime()) / DAYS(1));
      alerts.push({
        id: `brief-${b.id}`,
        severity: 'importante',
        category: 'clients',
        title: `Cahier des charges en attente client (${days}j)`,
        description: `${b.project?.client?.full_name ?? '—'} · ${b.project?.reference ?? ''}`,
        href: `/projects/${b.project_id}/brief`,
      });
    }
  }

  // ─── ⚠️ IMPORTANTE : Propositions sans réponse > 3j ────────────────────
  if (seeClients) {
    const cutoff3j = isoDateTodayMinus(3);
    const { data: proposals } = await admin
      .from('property_proposals')
      .select('id, project_id, sent_at, property:properties(name), project:projects(reference, client:clients(full_name))')
      .eq('client_response', 'pending')
      .lt('sent_at', cutoff3j);

    for (const p of (proposals ?? []) as any[]) {
      if (!projectFilter(p.project_id)) continue;
      const days = Math.floor((today().getTime() - new Date(p.sent_at).getTime()) / DAYS(1));
      alerts.push({
        id: `prop-${p.id}`,
        severity: 'importante',
        category: 'clients',
        title: `Proposition sans réponse client (${days}j)`,
        description: `${p.project?.client?.full_name ?? '—'} · ${p.property?.name ?? ''}`,
        href: `/projects/${p.project_id}/proposals`,
      });
    }
  }

  // ─── ⚠️ IMPORTANTE : Enquêtes satisfaction non complétées > 3j ─────────
  if (seeClients) {
    const cutoff3j = isoDateTodayMinus(3);
    const { data: surveys } = await admin
      .from('satisfaction_surveys')
      .select('id, project_id, sent_at, trigger_phase, project:projects(reference, client:clients(full_name))')
      .is('completed_at', null)
      .lt('sent_at', cutoff3j);

    for (const s of (surveys ?? []) as any[]) {
      if (!projectFilter(s.project_id)) continue;
      const days = Math.floor((today().getTime() - new Date(s.sent_at).getTime()) / DAYS(1));
      alerts.push({
        id: `survey-${s.id}`,
        severity: 'importante',
        category: 'clients',
        title: `Enquête satisfaction non remplie (${days}j)`,
        description: `${s.project?.client?.full_name ?? '—'} · phase ${s.trigger_phase}`,
        href: `/projects/${s.project_id}`,
      });
    }
  }

  // ─── ⚠️ IMPORTANTE : Fiches artisans incomplètes ───────────────────────
  if (seePaiements || seeOperations) {
    const { data: incompleteArtisans } = await admin
      .from('artisans_completeness')
      .select('id, name, missing_for_payment');

    const incompleteCount = (incompleteArtisans ?? []).filter(
      (a: any) => a.missing_for_payment && a.missing_for_payment.length > 0,
    ).length;
    if (incompleteCount > 0) {
      alerts.push({
        id: 'artisans-incomplete',
        severity: 'importante',
        category: 'paiements',
        title: `${incompleteCount} fiche${incompleteCount > 1 ? 's' : ''} artisan${incompleteCount > 1 ? 's' : ''} incomplète${incompleteCount > 1 ? 's' : ''}`,
        description: 'Les paiements ne peuvent pas être validés tant que ces fiches ne sont pas complétées.',
        href: '/admin/completude?tab=artisans&mode=strict',
        meta: `${incompleteCount}`,
      });
    }
  }

  // ─── ⚠️ IMPORTANTE : Fiches partenaires incomplètes (B3 2026-06-24) ────
  // Symétrique de l'alerte artisans : ≥1 partner critique (red) ou ≥1 sans
  // partner_type → alerte importante avec lien vers le tab dédié.
  // Le cas dominant au launch est "sans type" (62/62) : on l'expose
  // explicitement dans le titre quand il est dominant.
  if (seeSourcing || seeOperations) {
    try {
      const { stats } = await computePartnersCompletude({ partnerType: 'all' });
      const red = stats.red;
      const withoutType = stats.withoutPartnerType;
      const totalToFix = red + withoutType;
      if (totalToFix > 0) {
        // Cas dominant : majorité sans type → libellé spécifique.
        const dominantNoType = withoutType > 0 && withoutType >= red;
        const title = dominantNoType
          ? `${withoutType} partenaire${withoutType > 1 ? 's' : ''} sans type à classer`
          : `${red} partenaire${red > 1 ? 's' : ''} à compléter`;
        const href = dominantNoType
          ? '/admin/completude?tab=partenaires&partnerType=none'
          : '/admin/completude?tab=partenaires';
        alerts.push({
          id: 'partners-incomplete',
          severity: 'importante',
          category: 'sourcing',
          title,
          description: dominantNoType
            ? 'Le type partenaire (agence / particulier / notaire / ...) est obligatoire pour piloter le sourcing.'
            : 'Fiches partenaires sous le seuil 50% : à compléter pour fiabiliser la base sourcing.',
          href,
          meta: dominantNoType ? `${withoutType}` : `${red}`,
        });
      }
    } catch (e) {
      // silencieux : pas d'alerte plutôt que crash du dashboard alertes
    }
  }

  // ─── ⚠️ IMPORTANTE : Biens en cours d'import > 3j ──────────────────────
  if (seeSourcing) {
    const { data: drafts } = await admin
      .from('properties_publication_status')
      .select('id, name, missing_for_publication, created_at')
      .eq('is_published', false)
      .lt('created_at', isoDateTodayMinus(3));

    const draftCount = (drafts ?? []).length;
    if (draftCount > 0) {
      alerts.push({
        id: 'properties-drafts-3j',
        severity: 'importante',
        category: 'sourcing',
        title: `${draftCount} bien${draftCount > 1 ? 's' : ''} en brouillon depuis +3j`,
        description: 'À compléter (sourcing + médias) pour publication.',
        href: '/properties/incomplets',
        meta: `${draftCount}`,
      });
    }
  }

  // ─── ⚠️ IMPORTANTE : Onboarding client > 3j ────────────────────────────
  if (seeClients) {
    const { data: pending } = await admin
      .from('clients')
      .select('id, full_name, created_at')
      .is('onboarding_completed_at', null)
      .is('deleted_at', null)
      .lt('created_at', isoDateTodayMinus(3));

    for (const c of (pending ?? []) as any[]) {
      const days = Math.floor((today().getTime() - new Date(c.created_at).getTime()) / DAYS(1));
      alerts.push({
        id: `onboarding-${c.id}`,
        severity: 'importante',
        category: 'clients',
        title: `Onboarding non terminé (${days}j)`,
        description: c.full_name,
        href: `/clients/${c.id}`,
      });
    }
  }

  // ─── ℹ️ INFO : Projets en cours sans chef de projet ────────────────────
  if (seeOperations && role === 'ceo') {
    const { data: noChef } = await admin
      .from('projects')
      .select('id, reference, client:clients(full_name)')
      // Canon : « pas perdu » — un projet en pause sans chef doit être signalé.
      .neq('status', LOST_STATUS)
      .is('assigned_chef_projet', null)
      .is('deleted_at', null);

    for (const p of (noChef ?? []) as any[]) {
      alerts.push({
        id: `nochef-${p.id}`,
        severity: 'info',
        category: 'operations',
        title: `Projet sans chef de projet assigné`,
        description: `${p.client?.full_name ?? '—'} · ${p.reference}`,
        href: `/projects/${p.id}`,
      });
    }
  }

  // ─── ℹ️ INFO : Clients sans projet actif > 60j ─────────────────────────
  if (seeClients && role === 'ceo') {
    const { data: allClients } = await admin
      .from('clients').select('id, full_name, created_at, project:projects(id, status, deleted_at)')
      .is('deleted_at', null)
      .lt('created_at', isoDateTodayMinus(60));

    for (const c of (allClients ?? []) as any[]) {
      // Canon : un projet en pause ou terminé reste un projet du client — seuls
      // les perdus et les supprimés ne comptent pas (isProjectLost couvre les deux).
      const hasProject = (c.project ?? []).some((p: any) => !isProjectLost(p));
      if (hasProject) continue;
      alerts.push({
        id: `noproject-${c.id}`,
        severity: 'info',
        category: 'clients',
        title: `Client sans projet en cours`,
        description: c.full_name,
        href: `/clients/${c.id}`,
      });
    }
  }

  // ─── ℹ️ INFO : Biens disponibles depuis > 90j ──────────────────────────
  if (seeSourcing) {
    const { data: stale } = await admin
      .from('properties')
      .select('id, name, quartier, created_at')
      .eq('status', 'disponible')
      .eq('is_published', true)
      .is('deleted_at', null)
      .lt('created_at', isoDateTodayMinus(90));

    for (const p of (stale ?? []) as any[]) {
      const days = Math.floor((today().getTime() - new Date(p.created_at).getTime()) / DAYS(1));
      alerts.push({
        id: `stale-prop-${p.id}`,
        severity: 'info',
        category: 'sourcing',
        title: `Bien disponible depuis ${days}j sans transaction`,
        description: `${p.name} · ${p.quartier ?? ''}`,
        href: `/properties/${p.id}`,
      });
    }
  }

  // ─── ℹ️ INFO : Biens en brouillon (tous, même récents) ─────────────────
  if (seeSourcing) {
    const { data: allDrafts } = await admin
      .from('properties_publication_status')
      .select('id, name, missing_for_publication, created_at')
      .eq('is_published', false);

    for (const p of (allDrafts ?? []) as any[]) {
      const missing = p.missing_for_publication ?? [];
      if (missing.length === 0) continue;
      alerts.push({
        id: `draft-info-${p.id}`,
        severity: 'info',
        category: 'sourcing',
        title: `Bien en brouillon : ${p.name}`,
        description: `À compléter : ${missing.join(', ')}`,
        href: `/properties/${p.id}`,
      });
    }
  }

  // ─── ℹ️ INFO : Partenaires sans contact > 90j ──────────────────────────
  if (seeSourcing && role === 'ceo') {
    const { data: partners } = await admin
      .from('partners')
      .select('id, agency_name, last_contact_at, created_at')
      .eq('status', 'actif')
      .is('deleted_at', null);

    for (const p of (partners ?? []) as any[]) {
      const last = p.last_contact_at ?? p.created_at;
      const days = Math.floor((today().getTime() - new Date(last).getTime()) / DAYS(1));
      if (days < 90) continue;
      alerts.push({
        id: `partner-stale-${p.id}`,
        severity: 'info',
        category: 'sourcing',
        title: `Partenaire sans contact depuis ${days}j`,
        description: p.agency_name,
        href: `/partners/${p.id}`,
      });
    }
  }

  return alerts;
}

// ─── Helpers de formatage ─────────────────────────────────────────────────

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  acompte_stoniz: 'Acompte Stoniz',
  honoraires_compromis: 'Honoraires compromis',
  honoraires_3d: 'Honoraires 3D',
  honoraires_chantier: 'Honoraires chantier',
  honoraires_livraison: 'Honoraires livraison',
};

function formatPaymentType(type: string): string {
  return PAYMENT_TYPE_LABELS[type] ?? type;
}

const PHASE_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  sourcing: 'Sourcing',
  design: 'Design',
  travaux: 'Travaux',
  livraison: 'Livraison',
  mise_en_location: 'Mise en location',
  termine: 'Terminé',
};

function formatPhase(phase: string): string {
  return PHASE_LABELS[phase] ?? phase;
}
