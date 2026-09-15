import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { LOST_STATUS } from '@/lib/projects/lost';
import { PHASE_STUCK_THRESHOLDS, STUCK_RED_FACTOR, daysBetween } from '@/lib/projects/lifecycle-kpis';
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
  fmtEur,
  fmtMad,
  weekWindows,
  isoDay,
  esc,
  daysAgo,
  COLORS,
} from './brief-common';

const LIFECYCLE_PHASES = ['onboarding', 'sourcing', 'design', 'travaux', 'livraison', 'mise_en_location'] as const;
const PHASE_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  sourcing: 'Sourcing',
  design: 'Design',
  travaux: 'Travaux',
  livraison: 'Livraison',
  mise_en_location: 'Mise en location',
};

// Libellés lisibles pour les changements de status lifecycle (bloc 2).
const STATUS_LABELS: Record<string, string> = {
  actif: 'Actif',
  pause: 'Pause',
  perdu: 'Perdu',
  termine: 'Terminé',
};

// Libellés lisibles pour les sous-phases chantier (bloc 3).
const SOUS_PHASE_LABELS: Record<string, string> = {
  gros_oeuvre: 'Gros œuvre',
  second_oeuvre: 'Second œuvre',
  finitions: 'Finitions',
  livre: 'Livré',
};

// Libellés lisibles pour les types de documents (bloc 5).
// ⚠ CEO 2026-08-31b : la table `documents` compte 26 types distincts en prod ;
// la version précédente n'en mappait que 14, si bien que ~370 documents sur
// 458 tombaient dans "Autre" et la ventilation par type ne voulait rien dire.
// Tout type non listé ici reste "Autre" — à compléter si un nouveau type
// apparaît (SELECT DISTINCT type FROM documents).
const DOC_TYPE_LABELS: Record<string, string> = {
  // Identité & mandat
  piece_identite: 'Identité',
  cin: 'Identité',
  procuration: 'Procuration',
  // Contrats
  contrat_mission: 'Contrats',
  contrat_gestion_propria: 'Contrats',
  compromis: 'Contrats',
  // Contrats fluides & assurances
  contrat_eau: 'Fluides & assurances',
  contrat_electricite: 'Fluides & assurances',
  contrat_internet: 'Fluides & assurances',
  contrat_assurance: 'Fluides & assurances',
  // Juridique & foncier
  titre_foncier: 'Titre foncier',
  autorisation_travaux: 'Autorisations',
  permis_travaux: 'Autorisations',
  // Conception
  plans_3d: 'Plans 3D',
  plan_bet: 'Plans BET',
  lots_techniques: 'Lots techniques',
  cahier_des_charges: 'Cahier des charges',
  dossier_architecture: 'Dossier archi',
  shopping_list: 'Shopping list',
  // Chantier
  photos_chantier: 'Photos chantier',
  pv_livraison: 'PV livraison',
  // Argent
  devis_artisan: 'Devis',
  devis_fournisseur: 'Devis',
  devis_travaux: 'Devis',
  facture_artisan: 'Factures',
  facture_fournisseur: 'Factures',
  bon_commande: 'Bons commande',
  attestation_rib: 'Bancaire',
  rib: 'Bancaire',
  preuve_virement: 'Bancaire',
  justificatif_financement: 'Bancaire',
  attestation_regularite_fiscale: 'Fiscal',
};

/** Regroupe une liste par une clé, ignorant les null. */
function groupBy<T>(items: T[], keyFn: (t: T) => string | null | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    const arr = m.get(k) ?? [];
    arr.push(it);
    m.set(k, arr);
  }
  return m;
}

export async function buildProjetsBrief(): Promise<{ subject: string; html: string }> {
  const admin = createAdminClient();
  const { lastWeekStart, lastWeekEnd, today, labelLast } = weekWindows();
  const fromIso = isoDay(lastWeekStart);
  const toIso = isoDay(lastWeekEnd);
  const fromTs = `${fromIso}T00:00:00`;
  const toTs = `${toIso}T23:59:59`;

  // ═══════════════════════════════════════════════════════════════════════════
  // Pré-chargement : profils CP+CEO + tous projets pour mapping id → chef
  // ═══════════════════════════════════════════════════════════════════════════
  const { data: staffProfiles } = await admin
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['chef_projet', 'ceo']);
  const staffMap = new Map<string, { full_name: string; role: string }>(
    ((staffProfiles ?? []) as any[]).map((p) => [p.id, { full_name: p.full_name, role: p.role }]),
  );
  const staffIds = Array.from(staffMap.keys());

  const { data: allProjects } = await admin
    .from('projects')
    .select(
      'id, reference, current_phase, status, service_type, chantier_sous_phase, ' +
        'travaux_start_date, travaux_end_date, livraison_date, compromis_date, ' +
        'stoniz_reduction, updated_at, activated_at, paused_at, ' +
        'expected_resume_at, lost_reason, lost_at, pause_reason_code_v, created_at, assigned_chef_projet, ' +
        'client:clients(full_name), chef:profiles!projects_assigned_chef_projet_fkey(id, full_name)',
    )
    .is('deleted_at', null);

  // Index projets par id — utile pour tous les blocs qui joignent via record_id/project_id
  const projById = new Map<string, any>();
  for (const p of (allProjects ?? []) as any[]) projById.set(p.id, p);

  // ─── Honoraires : SOURCE UNIQUE = vue project_honoraires_totals ─────────
  // (somme des échéances `payments` hors type 'autre'). La colonne legacy
  // projects.stoniz_fees_final n'est plus une source de vérité affichée.
  // Vérifié 2026-08-29 : la vue renvoie bien des lignes pour les projets
  // perdus (aucun filtre de statut dans sa définition).
  const { data: honorairesRows } = await admin
    .from('project_honoraires_totals')
    .select('project_id, honoraires_expected');
  const honByProject = new Map<string, number>(
    ((honorairesRows ?? []) as any[]).map((r) => [r.project_id, Number(r.honoraires_expected ?? 0)]),
  );
  const honTotal = (projectId: string): number => honByProject.get(projectId) ?? 0;

  // ─── Bloc 1 : Leaderboard actions par chef ─────────────────────────────
  const leaderboardRows: Array<{
    actorId: string;
    name: string;
    total: number;
    creates: number;
    updates: number;
    deletes: number;
  }> = [];
  if (staffIds.length > 0) {
    const { data: auditLogs } = await admin
      .from('finance_audit_log')
      .select('actor_id, action')
      .in('actor_id', staffIds)
      .gte('occurred_at', fromTs)
      .lte('occurred_at', toTs);
    const counts = new Map<string, { total: number; creates: number; updates: number; deletes: number }>();
    for (const l of (auditLogs ?? []) as any[]) {
      if (!l.actor_id) continue;
      const c = counts.get(l.actor_id) ?? { total: 0, creates: 0, updates: 0, deletes: 0 };
      c.total++;
      if (l.action === 'create') c.creates++;
      else if (l.action === 'delete') c.deletes++;
      else c.updates++; // update, status_change, allocate, validate, attach_doc, bulk_update, etc.
      counts.set(l.actor_id, c);
    }
    for (const [actorId, c] of counts) {
      const prof = staffMap.get(actorId);
      if (!prof) continue;
      leaderboardRows.push({ actorId, name: prof.full_name, ...c });
    }
    leaderboardRows.sort((a, b) => b.total - a.total);
  }

  // ─── Bloc 2 : Passages lifecycle status validés cette semaine ─────────
  const { data: lifecycleTr } = await admin
    .from('project_lifecycle_transition')
    .select('project_id, from_status, to_status, validated_at, requested_by')
    .eq('workflow_status', 'approved')
    .gte('validated_at', fromTs)
    .lte('validated_at', toTs)
    .order('validated_at', { ascending: false });
  const lifecycleRows = ((lifecycleTr ?? []) as any[])
    .map((t) => {
      const proj = projById.get(t.project_id);
      if (!proj) return null;
      return {
        ref: proj.reference ?? '—',
        client: proj.client?.full_name ?? '—',
        chef: proj.chef?.full_name ?? staffMap.get(t.requested_by)?.full_name ?? '—',
        from: STATUS_LABELS[t.from_status] ?? t.from_status,
        to: STATUS_LABELS[t.to_status] ?? t.to_status,
        date: t.validated_at,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  // ─── Bloc 3 : Sous-phases chantier avancées cette semaine ─────────────
  // On préfère le finance_audit_log (table_name='projects' + payload contient
  // chantier_sous_phase). Fallback : projects.chantier_sous_phase NOT NULL et
  // updated_at ≥ weekStart pour couvrir la période avant le logging audit.
  const sousPhaseRows: Array<{ ref: string; client: string; chef: string; sousPhase: string; date: string }> = [];
  const { data: sousPhaseAudit } = await admin
    .from('finance_audit_log')
    .select('record_id, occurred_at, payload')
    .eq('table_name', 'projects')
    .eq('action', 'update')
    .gte('occurred_at', fromTs)
    .lte('occurred_at', toTs)
    .order('occurred_at', { ascending: false })
    .limit(200);
  const seenPhaseProj = new Set<string>();
  for (const l of (sousPhaseAudit ?? []) as any[]) {
    const p = l.payload as any;
    if (!p || !p.chantier_sous_phase) continue;
    const after = p.chantier_sous_phase?.after ?? p.chantier_sous_phase;
    if (!after) continue;
    if (seenPhaseProj.has(l.record_id)) continue;
    seenPhaseProj.add(l.record_id);
    const proj = projById.get(l.record_id);
    if (!proj) continue;
    sousPhaseRows.push({
      ref: proj.reference ?? '—',
      client: proj.client?.full_name ?? '—',
      chef: proj.chef?.full_name ?? '—',
      sousPhase: SOUS_PHASE_LABELS[after] ?? String(after),
      date: l.occurred_at,
    });
  }
  // Fallback : projets avec sous-phase renseignée + updated_at cette semaine,
  // pas déjà comptés par l'audit (période avant migration).
  if (sousPhaseRows.length === 0) {
    for (const p of (allProjects ?? []) as any[]) {
      if (!p.chantier_sous_phase) continue;
      if (!p.updated_at) continue;
      if (p.updated_at < fromTs || p.updated_at > toTs) continue;
      if (seenPhaseProj.has(p.id)) continue;
      sousPhaseRows.push({
        ref: p.reference ?? '—',
        client: p.client?.full_name ?? '—',
        chef: p.chef?.full_name ?? '—',
        sousPhase: SOUS_PHASE_LABELS[p.chantier_sous_phase] ?? p.chantier_sous_phase,
        date: p.updated_at,
      });
    }
  }

  // ─── Bloc 4 : Argent en mouvement ─────────────────────────────────────
  // 4a) Nouveaux acomptes créés cette semaine (travaux + achats)
  const { data: acompteAudit } = await admin
    .from('finance_audit_log')
    .select('actor_id, table_name, record_id, payload, occurred_at')
    .in('table_name', ['travaux_payments', 'achats_payments'])
    .eq('action', 'create')
    .gte('occurred_at', fromTs)
    .lte('occurred_at', toTs);
  // Charger les amount_total via record_id → tables sources (payload n'est pas
  // garanti d'avoir amount_total selon la source du log).
  const travauxPayIds = ((acompteAudit ?? []) as any[])
    .filter((l) => l.table_name === 'travaux_payments')
    .map((l) => l.record_id);
  const achatsPayIds = ((acompteAudit ?? []) as any[])
    .filter((l) => l.table_name === 'achats_payments')
    .map((l) => l.record_id);
  const amountByPayId = new Map<string, number>();
  const projByPayId = new Map<string, string>();
  if (travauxPayIds.length > 0) {
    const { data: tp } = await admin
      .from('travaux_payments')
      .select('id, amount_total, project_id')
      .in('id', travauxPayIds);
    for (const r of (tp ?? []) as any[]) {
      amountByPayId.set(r.id, Number(r.amount_total ?? 0));
      if (r.project_id) projByPayId.set(r.id, r.project_id);
    }
  }
  if (achatsPayIds.length > 0) {
    const { data: ap } = await admin
      .from('achats_payments')
      .select('id, amount_total, project_id')
      .in('id', achatsPayIds);
    for (const r of (ap ?? []) as any[]) {
      amountByPayId.set(r.id, Number(r.amount_total ?? 0));
      if (r.project_id) projByPayId.set(r.id, r.project_id);
    }
  }
  const acomptesByChef = new Map<string, { name: string; count: number; total: number }>();
  for (const l of (acompteAudit ?? []) as any[]) {
    const projId = projByPayId.get(l.record_id);
    const proj = projId ? projById.get(projId) : null;
    const chefId = proj?.chef?.id ?? l.actor_id;
    const chefName = proj?.chef?.full_name ?? staffMap.get(l.actor_id ?? '')?.full_name ?? '—';
    if (!chefId) continue;
    const c = acomptesByChef.get(chefId) ?? { name: chefName, count: 0, total: 0 };
    c.count++;
    c.total += amountByPayId.get(l.record_id) ?? 0;
    acomptesByChef.set(chefId, c);
  }

  // 4b) Paiements clients marqués reçus (encaissements travaux + achats)
  // QA-BUG-032 (garde-fou) : le filtre de dates seul suffisait tant qu'aucune
  // ligne 'planifie' n'avait de received_at. On rend le critère explicite pour
  // qu'une saisie inhabituelle ne compte jamais un encaissement non reçu.
  const { data: travauxEnc } = await admin
    .from('travaux_encaissements')
    .select('project_id, amount_mad, received_at, status')
    .is('deleted_at', null)
    .eq('status', 'recu')
    .gte('received_at', fromIso)
    .lte('received_at', toIso);
  const { data: achatsEnc } = await admin
    .from('achats_encaissements')
    .select('project_id, amount_mad, received_at, status')
    .is('deleted_at', null)
    .eq('status', 'recu')
    .gte('received_at', fromIso)
    .lte('received_at', toIso);
  const encByChef = new Map<string, { name: string; count: number; total: number }>();
  for (const e of [...((travauxEnc ?? []) as any[]), ...((achatsEnc ?? []) as any[])]) {
    const proj = projById.get(e.project_id);
    const chefId = proj?.chef?.id ?? '__unassigned__';
    const chefName = proj?.chef?.full_name ?? 'Non assigné';
    const c = encByChef.get(chefId) ?? { name: chefName, count: 0, total: 0 };
    c.count++;
    c.total += Number(e.amount_mad ?? 0);
    encByChef.set(chefId, c);
  }

  // 4c) Demandes de validation créées cette semaine (payment_approvals)
  const { data: approvals } = await admin
    .from('payment_approvals')
    .select('requested_by, amount, currency, project_id')
    .is('deleted_at', null)
    .gte('requested_at', fromTs)
    .lte('requested_at', toTs)
    .eq('final_status', 'pending');
  const approvalByChef = new Map<string, { name: string; count: number; total: number }>();
  for (const a of (approvals ?? []) as any[]) {
    const chefId = a.requested_by ?? '__unknown__';
    const chefName = staffMap.get(a.requested_by ?? '')?.full_name ?? '—';
    const c = approvalByChef.get(chefId) ?? { name: chefName, count: 0, total: 0 };
    c.count++;
    // amount peut être EUR ou MAD selon currency ; on convertit EUR × 10
    const amt = Number(a.amount ?? 0);
    c.total += a.currency === 'EUR' ? amt * 10 : amt;
    approvalByChef.set(chefId, c);
  }

  // ─── Bloc 5 : Suivi client ────────────────────────────────────────────
  // 5a) Notes projet ajoutées cette semaine
  const { data: notes } = await admin
    .from('project_notes')
    .select('project_id, author_id, category')
    .is('deleted_at', null)
    .gte('created_at', fromTs)
    .lte('created_at', toTs);
  const notesByChef = new Map<string, { name: string; count: number }>();
  for (const n of (notes ?? []) as any[]) {
    const proj = projById.get(n.project_id);
    const chefId = proj?.chef?.id ?? n.author_id ?? '__unknown__';
    const chefName = proj?.chef?.full_name ?? staffMap.get(n.author_id ?? '')?.full_name ?? '—';
    const c = notesByChef.get(chefId) ?? { name: chefName, count: 0 };
    c.count++;
    notesByChef.set(chefId, c);
  }
  // Détail par client (CEO 2026-08-31b)
  const notesByProject = new Map<string, { client: string; ref: string; chef: string; count: number }>();
  for (const n of (notes ?? []) as any[]) {
    if (!n.project_id) continue;
    const proj = projById.get(n.project_id);
    const c =
      notesByProject.get(n.project_id) ??
      {
        client: proj?.client?.full_name ?? '—',
        ref: proj?.reference ?? '—',
        chef: proj?.chef?.full_name ?? '—',
        count: 0,
      };
    c.count++;
    notesByProject.set(n.project_id, c);
  }

  // 5b) Documents uploadés cette semaine (par type + par CP)
  const { data: docs } = await admin
    .from('documents')
    .select('project_id, type, uploaded_by')
    .is('deleted_at', null)
    .gte('created_at', fromTs)
    .lte('created_at', toTs);
  const docsByType = new Map<string, number>();
  for (const d of (docs ?? []) as any[]) {
    const label = DOC_TYPE_LABELS[d.type] ?? 'Autre';
    docsByType.set(label, (docsByType.get(label) ?? 0) + 1);
  }
  const docsByChef = new Map<string, { name: string; count: number }>();
  for (const d of (docs ?? []) as any[]) {
    const proj = d.project_id ? projById.get(d.project_id) : null;
    const chefId = proj?.chef?.id ?? d.uploaded_by ?? '__unknown__';
    const chefName = proj?.chef?.full_name ?? staffMap.get(d.uploaded_by ?? '')?.full_name ?? '—';
    if (!proj?.chef?.id && !staffMap.has(d.uploaded_by ?? '')) continue;
    const c = docsByChef.get(chefId) ?? { name: chefName, count: 0 };
    c.count++;
    docsByChef.set(chefId, c);
  }
  // Détail par client (CEO 2026-08-31b) : combien de docs, et lesquels.
  const docsByProject = new Map<
    string,
    { client: string; ref: string; chef: string; count: number; types: Map<string, number> }
  >();
  for (const d of (docs ?? []) as any[]) {
    if (!d.project_id) continue;
    const proj = projById.get(d.project_id);
    const c =
      docsByProject.get(d.project_id) ??
      {
        client: proj?.client?.full_name ?? '—',
        ref: proj?.reference ?? '—',
        chef: proj?.chef?.full_name ?? '—',
        count: 0,
        types: new Map<string, number>(),
      };
    c.count++;
    const label = DOC_TYPE_LABELS[d.type] ?? 'Autre';
    c.types.set(label, (c.types.get(label) ?? 0) + 1);
    docsByProject.set(d.project_id, c);
  }

  // 5c) Emails auto envoyés aux clients cette semaine (hors briefs internes)
  const { data: emails } = await admin
    .from('email_logs')
    .select('project_id, template_id, status')
    .eq('status', 'sent')
    .not('template_id', 'like', 'weekly_brief%')
    .gte('sent_at', fromTs)
    .lte('sent_at', toTs);
  const emailsByChef = new Map<string, { name: string; count: number }>();
  let emailsTotal = 0;
  for (const e of (emails ?? []) as any[]) {
    emailsTotal++;
    if (!e.project_id) continue;
    const proj = projById.get(e.project_id);
    if (!proj?.chef?.id) continue;
    const c = emailsByChef.get(proj.chef.id) ?? { name: proj.chef.full_name, count: 0 };
    c.count++;
    emailsByChef.set(proj.chef.id, c);
  }
  // Détail par client (CEO 2026-08-31b)
  const emailsByProject = new Map<string, { client: string; ref: string; chef: string; count: number }>();
  let emailsSansProjet = 0;
  for (const e of (emails ?? []) as any[]) {
    if (!e.project_id) {
      emailsSansProjet++;
      continue;
    }
    const proj = projById.get(e.project_id);
    const c =
      emailsByProject.get(e.project_id) ??
      {
        client: proj?.client?.full_name ?? '—',
        ref: proj?.reference ?? '—',
        chef: proj?.chef?.full_name ?? '—',
        count: 0,
      };
    c.count++;
    emailsByProject.set(e.project_id, c);
  }

  // 5d) Biens envoyés aux clients cette semaine (CEO 2026-08-31)
  // Source : property_proposals.sent_at. Un "envoi" = un selection_batch_id
  // (le CP envoie généralement plusieurs biens d'un coup) ; un "bien envoyé"
  // = une ligne. Pas de deleted_at sur cette table (cf. migration
  // 20260521000600_tasks_and_proposals.sql).
  const { data: proposalsSent } = await admin
    .from('property_proposals')
    .select(
      'id, project_id, sent_at, sent_by, client_response, selection_batch_id, ' +
        'property:properties(name, quartier)',
    )
    .gte('sent_at', fromTs)
    .lte('sent_at', toTs)
    .order('sent_at', { ascending: false });

  const propsTotal = (proposalsSent ?? []).length;
  const propsProjects = new Set<string>();
  const propsBatches = new Set<string>();
  const propsByChef = new Map<
    string,
    { name: string; biens: number; projects: Set<string>; batches: Set<string>; responded: number }
  >();
  for (const pr of (proposalsSent ?? []) as any[]) {
    if (pr.project_id) propsProjects.add(pr.project_id);
    // Une proposition sans batch = un envoi à elle seule (legacy avant la
    // migration 20260526000000 qui a introduit selection_batch_id).
    propsBatches.add(pr.selection_batch_id ?? `solo:${pr.id}`);

    const proj = pr.project_id ? projById.get(pr.project_id) : null;
    const chefId = proj?.chef?.id ?? pr.sent_by ?? '__unknown__';
    const chefName =
      proj?.chef?.full_name ?? staffMap.get(pr.sent_by ?? '')?.full_name ?? '—';
    const c =
      propsByChef.get(chefId) ??
      { name: chefName, biens: 0, projects: new Set<string>(), batches: new Set<string>(), responded: 0 };
    c.biens++;
    if (pr.project_id) c.projects.add(pr.project_id);
    c.batches.add(pr.selection_batch_id ?? `solo:${pr.id}`);
    // Retour client déjà arrivé sur un bien envoyé cette semaine (réactivité).
    if (pr.client_response && pr.client_response !== 'pending') c.responded++;
    propsByChef.set(chefId, c);
  }

  // CEO 2026-08-31b : le récap par chef ne se lit pas — ce qu'on veut savoir
  // c'est COMBIEN de biens sont partis chez CHAQUE client. Agrégation par
  // projet (= un client), avec le nom des biens.
  type PropsClientAgg = {
    client: string;
    ref: string;
    chef: string;
    biens: string[];
    lastSent: string | null;
    responded: number;
    batches: Set<string>;
  };
  const propsByClient = new Map<string, PropsClientAgg>();
  for (const pr of (proposalsSent ?? []) as any[]) {
    const key = pr.project_id ?? `__sans_projet__${pr.id}`;
    const proj = pr.project_id ? projById.get(pr.project_id) : null;
    const c =
      propsByClient.get(key) ??
      {
        client: proj?.client?.full_name ?? '—',
        ref: proj?.reference ?? '—',
        chef: proj?.chef?.full_name ?? staffMap.get(pr.sent_by ?? '')?.full_name ?? '—',
        biens: [] as string[],
        lastSent: null as string | null,
        responded: 0,
        batches: new Set<string>(),
      };
    c.biens.push(pr.property?.name ?? 'Bien sans nom');
    c.batches.add(pr.selection_batch_id ?? `solo:${pr.id}`);
    if (!c.lastSent || String(pr.sent_at) > c.lastSent) c.lastSent = pr.sent_at;
    if (pr.client_response && pr.client_response !== 'pending') c.responded++;
    propsByClient.set(key, c);
  }

  // 5e) Retours clients sur les biens + bien final retenu (CEO 2026-08-31)
  // Le pendant de 5d : on voyait l'effort de sourcing, jamais le résultat.
  // ⚠ properties n'a PAS de colonne `reference` — le libellé d'un bien, c'est
  // `name` (vérifié sur le schéma prod 2026-08-31).
  const { data: proposalResponses } = await admin
    .from('property_proposals')
    .select(
      'id, project_id, client_response, client_response_at, client_refusal_reason, ' +
        'property:properties(name, quartier)',
    )
    .neq('client_response', 'pending')
    .gte('client_response_at', fromTs)
    .lte('client_response_at', toTs)
    .order('client_response_at', { ascending: false });

  const { data: finalSelections } = await admin
    .from('property_proposals')
    .select('id, project_id, selected_as_final_at, selected_by, property:properties(name, quartier)')
    .not('selected_as_final_at', 'is', null)
    .gte('selected_as_final_at', fromTs)
    .lte('selected_as_final_at', toTs);

  const RESPONSE_LABELS: Record<string, { label: string; color: string }> = {
    accepted: { label: 'Intéressé', color: COLORS.emerald },
    refused: { label: 'Refusé', color: COLORS.warning },
    more_info: { label: "Demande d'infos", color: COLORS.muted },
  };

  // ─── Bloc 6 : Zone de silence ─────────────────────────────────────────
  // Union des project_ids touchés cette semaine (audit + email + lifecycle).
  const touchedProj = new Set<string>();
  // finance_audit_log via table_name='projects' → record_id = project_id
  const { data: projAudit } = await admin
    .from('finance_audit_log')
    .select('record_id, table_name')
    .in('table_name', ['projects'])
    .gte('occurred_at', fromTs)
    .lte('occurred_at', toTs);
  for (const l of (projAudit ?? []) as any[]) touchedProj.add(l.record_id);
  // Autres tables audit via record_id → project via lookup
  for (const l of (acompteAudit ?? []) as any[]) {
    const projId = projByPayId.get(l.record_id);
    if (projId) touchedProj.add(projId);
  }
  for (const e of [...((travauxEnc ?? []) as any[]), ...((achatsEnc ?? []) as any[])]) {
    if (e.project_id) touchedProj.add(e.project_id);
  }
  for (const em of (emails ?? []) as any[]) {
    if (em.project_id) touchedProj.add(em.project_id);
  }
  for (const n of (notes ?? []) as any[]) {
    if (n.project_id) touchedProj.add(n.project_id);
  }
  for (const t of (lifecycleTr ?? []) as any[]) {
    if (t.project_id) touchedProj.add(t.project_id);
  }
  for (const d of (docs ?? []) as any[]) {
    if (d.project_id) touchedProj.add(d.project_id);
  }
  // CEO 2026-08-31 : un projet à qui on a envoyé des biens cette semaine n'est
  // PAS silencieux — sans ça un CP qui ne fait "que" du sourcing client
  // remontait à tort dans la zone de silence.
  for (const pr of (proposalsSent ?? []) as any[]) {
    if (pr.project_id) touchedProj.add(pr.project_id);
  }
  const silenceProjects = ((allProjects ?? []) as any[])
    .filter((p) => {
      if (p.status !== 'actif') return false;
      if (p.service_type === 'coaching') return false;
      if (p.current_phase === 'termine') return false;
      if (touchedProj.has(p.id)) return false;
      return true;
    })
    .map((p) => ({
      ref: p.reference ?? '—',
      client: p.client?.full_name ?? '—',
      chef: p.chef?.full_name ?? '—',
      lastActivity: p.updated_at ?? p.activated_at ?? p.created_at,
    }))
    .sort((a, b) => (a.lastActivity ?? '').localeCompare(b.lastActivity ?? ''));

  // ─── Bloc 7 : Dates chantier modifiées cette semaine ──────────────────
  // Source : finance_audit_log table_name='projects' payload contenant l'un
  // des 3 champs dates. Le server action updateChantierDateAction loggue
  // automatiquement depuis CEO 2026-08-24.
  const { data: dateAudit } = await admin
    .from('finance_audit_log')
    .select('record_id, occurred_at, actor_id, payload')
    .eq('table_name', 'projects')
    .eq('action', 'update')
    .gte('occurred_at', fromTs)
    .lte('occurred_at', toTs)
    .order('occurred_at', { ascending: false });
  const dateFieldLabels: Record<string, string> = {
    travaux_start_date: 'Démarrage',
    travaux_end_date: 'Fin',
    livraison_date: 'Livraison',
  };
  const dateRows: Array<{
    ref: string;
    chef: string;
    field: string;
    from: string;
    to: string;
    date: string;
  }> = [];
  for (const l of (dateAudit ?? []) as any[]) {
    const p = l.payload as any;
    if (!p) continue;
    for (const [key, label] of Object.entries(dateFieldLabels)) {
      if (p[key] && (p[key].before !== undefined || p[key].after !== undefined)) {
        const proj = projById.get(l.record_id);
        dateRows.push({
          ref: proj?.reference ?? '—',
          chef: proj?.chef?.full_name ?? staffMap.get(l.actor_id ?? '')?.full_name ?? '—',
          field: label,
          from: p[key].before ?? '—',
          to: p[key].after ?? '—',
          date: l.occurred_at,
        });
      }
    }
  }

  // ─── Bloc 8 : Tâches (CEO 2026-08-31) ─────────────────────────────────
  // La table `tasks` n'apparaissait dans AUCUN des 6 briefs hebdo. C'est le
  // vrai indicateur de charge des chefs de projet — plus fiable que le
  // leaderboard d'audit log qui ne mesure que les écritures financières.
  // ⚠ `tasks` n'a pas de colonne deleted_at (schéma vérifié 2026-08-31).
  const todayIso = isoDay(today);
  const [{ data: tasksCreated }, { data: tasksDone }, { data: tasksOverdue }] = await Promise.all([
    admin
      .from('tasks')
      .select('id, project_id, assigned_to, is_blocking, created_at')
      .gte('created_at', fromTs)
      .lte('created_at', toTs),
    admin
      .from('tasks')
      .select('id, project_id, assigned_to, completed_by, completed_at')
      .gte('completed_at', fromTs)
      .lte('completed_at', toTs),
    // ⚠ Constat terrain 2026-08-31 : sur 399 tâches en base, AUCUNE n'a de
    // due_date. Un bloc "tâches en retard" basé uniquement sur due_date
    // afficherait éternellement "rien à signaler" — un faux bon signal.
    // On remonte donc les tâches EN SOUFFRANCE : échéance dépassée quand elle
    // existe, sinon tâche encore ouverte depuis plus de 21 jours.
    admin
      .from('tasks')
      .select('id, project_id, title, phase, assigned_to, status, priority, due_date, is_blocking, created_at')
      .neq('status', 'done')
      .order('created_at', { ascending: true }),
  ]);
  const DORMANT_DAYS = 21;

  type TaskAgg = { name: string; created: number; done: number; overdue: number; blocking: number };
  const tasksByChef = new Map<string, TaskAgg>();
  const bumpTask = (
    chefId: string,
    chefName: string,
    field: 'created' | 'done' | 'overdue' | 'blocking',
  ) => {
    const c = tasksByChef.get(chefId) ?? { name: chefName, created: 0, done: 0, overdue: 0, blocking: 0 };
    c[field]++;
    tasksByChef.set(chefId, c);
  };
  // Le porteur d'une tâche = son assigné ; à défaut le chef du projet.
  const taskOwner = (t: any): { id: string; name: string } => {
    const proj = t.project_id ? projById.get(t.project_id) : null;
    const id = t.assigned_to ?? proj?.chef?.id ?? '__unassigned__';
    const name =
      staffMap.get(t.assigned_to ?? '')?.full_name ?? proj?.chef?.full_name ?? 'Non assigné';
    return { id, name };
  };
  for (const t of (tasksCreated ?? []) as any[]) {
    const o = taskOwner(t);
    bumpTask(o.id, o.name, 'created');
  }
  for (const t of (tasksDone ?? []) as any[]) {
    const proj = t.project_id ? projById.get(t.project_id) : null;
    const id = t.completed_by ?? t.assigned_to ?? proj?.chef?.id ?? '__unassigned__';
    const name =
      staffMap.get(t.completed_by ?? '')?.full_name ??
      staffMap.get(t.assigned_to ?? '')?.full_name ??
      proj?.chef?.full_name ??
      'Non assigné';
    bumpTask(id, name, 'done');
  }
  const overdueRows: Array<{
    title: string;
    client: string;
    ref: string;
    owner: string;
    reason: 'echeance' | 'dormante';
    since: string;
    days: number;
    blocking: boolean;
  }> = [];
  for (const t of (tasksOverdue ?? []) as any[]) {
    const proj = t.project_id ? projById.get(t.project_id) : null;
    // On ne remonte pas la souffrance d'un projet perdu ou déjà clôturé.
    if (proj && (proj.status === LOST_STATUS || proj.current_phase === 'termine')) continue;

    const hasDue = !!t.due_date;
    const isOverdue = hasDue && t.due_date < todayIso;
    const ageDays = daysAgo(t.created_at);
    const isDormant = !hasDue && ageDays > DORMANT_DAYS;
    if (!isOverdue && !isDormant) continue;

    const o = taskOwner(t);
    bumpTask(o.id, o.name, 'overdue');
    if (t.is_blocking) bumpTask(o.id, o.name, 'blocking');
    overdueRows.push({
      title: t.title ?? '—',
      client: proj?.client?.full_name ?? '—',
      ref: proj?.reference ?? '—',
      owner: o.name,
      reason: isOverdue ? 'echeance' : 'dormante',
      since: isOverdue ? t.due_date : t.created_at,
      days: isOverdue ? daysAgo(t.due_date) : ageDays,
      blocking: !!t.is_blocking,
    });
  }
  // Les bloquantes d'abord (elles gèlent une phase), puis la plus ancienne.
  overdueRows.sort((a, b) => (Number(b.blocking) - Number(a.blocking)) || (b.days - a.days));
  const nbBlocking = overdueRows.filter((r) => r.blocking).length;
  const nbDormantes = overdueRows.filter((r) => r.reason === 'dormante').length;

  // ─── Bloc 9 : Réception chantier — VCT & PV (CEO 2026-08-31) ──────────
  // project_vct / project_reception_pvs n'apparaissaient dans aucun brief.
  // Ce sont pourtant les 2 objets qui bloquent la clôture d'un chantier et
  // le passage à Propria.
  // 2 requêtes simples plutôt qu'un .or() imbriqué : PostgREST échoue
  // silencieusement sur une syntaxe or/and mal échappée, et un brief qui
  // affiche "rien à signaler" par erreur est pire qu'un brief bruyant.
  const [
    { data: vctPerformedRows },
    { data: vctValidatedRows },
    { data: vctActionsOpen },
    { data: pvPending },
    { data: pvSignedWeek },
    { data: pvReservesOpen },
  ] = await Promise.all([
    admin
      .from('project_vct')
      .select('id, project_id, performed_at')
      .not('performed_at', 'is', null)
      .gte('performed_at', fromTs)
      .lte('performed_at', toTs),
    admin
      .from('project_vct')
      .select('id, project_id, validated_at')
      .not('validated_at', 'is', null)
      .gte('validated_at', fromTs)
      .lte('validated_at', toTs),
    admin
      .from('project_vct_corrective_actions')
      .select('id, project_id, description, status, deadline, responsible_role')
      .in('status', ['open', 'in_progress']),
    admin
      .from('project_reception_pvs')
      .select('id, project_id, status, sent_to_client_at')
      .eq('status', 'sent_to_client'),
    admin
      .from('project_reception_pvs')
      .select('id, project_id, client_signed_at, client_satisfaction_rating')
      .not('client_signed_at', 'is', null)
      .gte('client_signed_at', fromTs)
      .lte('client_signed_at', toTs),
    admin
      .from('project_reception_pv_reserves')
      .select('id, pv_id, description, status, deadline, responsible_role')
      .eq('status', 'open'),
  ]);

  const vctPerformed = (vctPerformedRows ?? []).length;
  const vctValidated = (vctValidatedRows ?? []).length;
  const vctActionsLate = ((vctActionsOpen ?? []) as any[]).filter(
    (a) => a.deadline && a.deadline < todayIso,
  );
  const reservesLate = ((pvReservesOpen ?? []) as any[]).filter(
    (r) => r.deadline && r.deadline < todayIso,
  );

  // ─── Bloc 10 : Satisfaction client (CEO 2026-08-31) ───────────────────
  const [{ data: surveysSent }, { data: surveysDone }, { data: surveysPending }] = await Promise.all([
    admin
      .from('satisfaction_surveys')
      .select('id, project_id, trigger_phase, sent_at')
      .gte('sent_at', fromTs)
      .lte('sent_at', toTs),
    admin
      .from('satisfaction_surveys')
      .select('id, project_id, trigger_phase, completed_at, global_score, nps_score, comment')
      .gte('completed_at', fromTs)
      .lte('completed_at', toTs),
    admin
      .from('satisfaction_surveys')
      .select('id, project_id, trigger_phase, sent_at')
      .is('completed_at', null)
      .lt('sent_at', new Date(today.getTime() - 10 * 86400000).toISOString())
      .order('sent_at', { ascending: true }),
  ]);
  const doneRows = (surveysDone ?? []) as any[];
  const scores = doneRows.map((r) => Number(r.global_score)).filter((n) => !Number.isNaN(n) && n > 0);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const npsScores = doneRows
    .map((r) => (r.nps_score == null ? null : Number(r.nps_score)))
    .filter((n): n is number => n != null);
  const avgNps = npsScores.length > 0 ? npsScores.reduce((a, b) => a + b, 0) / npsScores.length : null;
  const lowScores = doneRows.filter((r) => r.global_score != null && Number(r.global_score) <= 3);

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOCS EXISTANTS (cycle de vie / pause / perdus / stagnants / dossiers)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── 1) Projets en production par phase (hors perdus / livrés) ───────
  const phaseCount: Record<string, number> = {};
  for (const p of LIFECYCLE_PHASES) phaseCount[p] = 0;

  for (const p of (allProjects ?? []) as any[]) {
    // Canon : exclusion = « pas perdu » (la pause reste au portefeuille).
    if (p.status === LOST_STATUS || p.status === 'termine') continue;
    if (p.service_type === 'coaching') continue;
    if (p.current_phase === 'termine') continue;
    if (phaseCount[p.current_phase] != null) phaseCount[p.current_phase]++;
  }

  // Passages de phase de la semaine (via project_phases_history)
  const { data: transitions } = await admin
    .from('project_phases_history')
    .select('project_id, phase, started_at, project:projects(reference, status, deleted_at, client:clients(full_name))')
    .gte('started_at', fromIso)
    .lte('started_at', `${toIso}T23:59:59`)
    .order('started_at', { ascending: false })
    .limit(50);

  const transitionRows = ((transitions ?? []) as any[])
    .filter((t) => t.project && !t.project.deleted_at && t.project.status !== LOST_STATUS)
    .slice(0, 15);

  // ─── 2) Nouveaux projets créés cette semaine + fermés ────────────────
  const { data: newProjects } = await admin
    .from('projects')
    .select('id, reference, created_at, client:clients(full_name)')
    .gte('created_at', fromIso)
    .lte('created_at', `${toIso}T23:59:59`)
    .is('deleted_at', null);
  // FIX CEO 2026-08-31 : on comptait `current_phase='termine' + updated_at
  // dans la semaine` — un projet clôturé il y a 3 mois mais simplement
  // modifié la semaine passée (une note, un doc) était recompté comme
  // "clôturé cette semaine". La vraie date de clôture, c'est l'entrée en
  // phase 'termine' dans project_phases_history.
  const { data: closedHistory } = await admin
    .from('project_phases_history')
    .select('project_id, started_at, project:projects(reference, status, deleted_at, client:clients(full_name))')
    .eq('phase', 'termine')
    .gte('started_at', fromIso)
    .lte('started_at', `${toIso}T23:59:59`);
  const closedProjects = ((closedHistory ?? []) as any[]).filter(
    (h) => h.project && !h.project.deleted_at && h.project.status !== LOST_STATUS,
  );

  // ─── 3) Projets en pause ─────────────────────────────────────────────
  const { data: paused } = await admin
    .from('projects')
    .select('id, reference, paused_at, expected_resume_at, pause_reason_code_v, client:clients(full_name)')
    .eq('status', 'pause')
    .is('deleted_at', null)
    .order('paused_at', { ascending: true });

  const now = new Date();
  const pausedResumeOverdue = (paused ?? []).filter(
    (p: any) => p.expected_resume_at && new Date(p.expected_resume_at) < now,
  );

  // ─── 4) Projets perdus semaine ───────────────────────────────────────
  const { data: lost } = await admin
    .from('projects')
    .select('id, reference, lost_at, lost_reason, client:clients(full_name)')
    .eq('status', LOST_STATUS)
    .gte('lost_at', fromIso)
    .lte('lost_at', `${toIso}T23:59:59`)
    .is('deleted_at', null);
  const lostPipelineEur = (lost ?? []).reduce(
    (s: number, p: any) => s + honTotal(p.id),
    0,
  );

  // ─── 5) Projets stagnants ─────────────────────────────────────────────
  const activeIds = ((allProjects ?? []) as any[])
    .filter((p) => p.status === 'actif' && p.service_type !== 'coaching')
    .map((p) => p.id);
  const stuckList: Array<{ id: string; label: string; sub: string; days: number; chef: string | null; phase: string; level: 'orange' | 'red' }> = [];
  if (activeIds.length > 0) {
    const { data: openPhases } = await admin
      .from('project_phases_history')
      .select('project_id, phase, started_at, ended_at')
      .is('ended_at', null)
      .in('project_id', activeIds);
    for (const ph of (openPhases ?? []) as any[]) {
      const proj = projById.get(ph.project_id);
      if (!proj) continue;
      const days = daysBetween(ph.started_at, today);
      const seuil = PHASE_STUCK_THRESHOLDS[ph.phase];
      if (!seuil) continue;
      if (days <= seuil) continue;
      const level: 'orange' | 'red' = days > seuil * STUCK_RED_FACTOR ? 'red' : 'orange';
      stuckList.push({
        id: proj.id,
        label: proj.client?.full_name ?? '—',
        sub: `${proj.reference ?? ''} · ${PHASE_LABELS[ph.phase] ?? ph.phase}`,
        days,
        chef: proj.chef?.full_name ?? null,
        phase: ph.phase,
        level,
      });
    }
    stuckList.sort((a, b) => b.days - a.days);
  }

  // ─── 6) Dossiers à compléter ─────────────────────────────────────────
  const incomplete: Array<{ id: string; label: string; sub: string; missing: string[] }> = [];
  for (const p of (allProjects ?? []) as any[]) {
    // Canon : un dossier en pause reste un dossier à compléter.
    if (p.status === LOST_STATUS || p.status === 'termine') continue;
    if (p.service_type === 'coaching') continue;
    const missing: string[] = [];
    if (honTotal(p.id) === 0) missing.push('forfait');
    if (!p.assigned_chef_projet) missing.push('chef');
    if (!p.travaux_start_date || !p.travaux_end_date) missing.push('dates chantier');
    if (!p.compromis_date) missing.push('compromis');
    if (missing.length > 0) {
      incomplete.push({
        id: p.id,
        label: p.client?.full_name ?? '—',
        sub: p.reference ?? '',
        missing,
      });
    }
  }
  incomplete.sort((a, b) => b.missing.length - a.missing.length);

  // ═══════════════════════════════════════════════════════════════════════════
  // Compose HTML
  // ═══════════════════════════════════════════════════════════════════════════
  const subject = `Semaine du ${labelLast}`;
  const subtitle = 'Cycle de vie projets';

  // ── Bloc 1 rendu ──
  const leaderboardSection =
    leaderboardRows.length === 0
      ? emptyOk('Semaine calme côté audit — aucune action loguée par les chefs de projet.')
      : dataTable({
          headers: ['Chef', 'Total', 'Créations', 'Modifs', 'Suppressions'],
          rows: leaderboardRows.slice(0, 10).map((r) => [
            { text: esc(r.name), align: 'left' as const, bold: true },
            { text: String(r.total), align: 'right' as const, bold: true },
            { text: String(r.creates), align: 'right' as const, color: r.creates > 0 ? COLORS.emerald : undefined },
            { text: String(r.updates), align: 'right' as const },
            { text: String(r.deletes), align: 'right' as const, color: r.deletes > 0 ? COLORS.danger : undefined },
          ]),
        });

  // ── Bloc 2 rendu ──
  const lifecycleSection =
    lifecycleRows.length === 0
      ? emptyOk('Aucun passage de phase cette semaine.')
      : dataTable({
          headers: ['Client', 'Chef', 'Transition', 'Date'],
          rows: lifecycleRows.slice(0, 15).map((r) => [
            {
              text: `${esc(r.client)}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(r.ref)}</span>`,
              align: 'left' as const,
            },
            { text: esc(r.chef), align: 'left' as const },
            {
              text: `${esc(r.from)} → <strong>${esc(r.to)}</strong>`,
              align: 'left' as const,
            },
            { text: fmtDate(r.date), align: 'right' as const },
          ]),
        });

  // ── Bloc 3 rendu ──
  const sousPhaseSection =
    sousPhaseRows.length === 0
      ? emptyOk('Aucune sous-phase chantier avancée cette semaine.')
      : dataTable({
          headers: ['Ref projet', 'Client', 'Chef', 'Nouvelle sous-phase', 'Date'],
          rows: sousPhaseRows.slice(0, 15).map((r) => [
            { text: esc(r.ref), align: 'left' as const, bold: true },
            { text: esc(r.client), align: 'left' as const },
            { text: esc(r.chef), align: 'left' as const },
            { text: esc(r.sousPhase), align: 'left' as const, color: COLORS.emerald },
            { text: fmtDate(r.date), align: 'right' as const },
          ]),
        });

  // ── Bloc 4 rendu (3 sous-sections) ──
  const acomptesSubsec =
    acomptesByChef.size === 0
      ? emptyOk('Aucun nouvel acompte créé cette semaine.')
      : dataTable({
          headers: ['Chef', 'Nb acomptes', 'Montant total'],
          rows: Array.from(acomptesByChef.values())
            .sort((a, b) => b.total - a.total)
            .map((r) => [
              { text: esc(r.name), align: 'left' as const },
              { text: String(r.count), align: 'right' as const },
              { text: fmtMad(r.total), align: 'right' as const, bold: true },
            ]),
        });
  const encaissementsSubsec =
    encByChef.size === 0
      ? emptyOk('Aucun encaissement client marqué reçu cette semaine.')
      : dataTable({
          headers: ['Chef', 'Nb encaissements', 'Montant reçu'],
          rows: Array.from(encByChef.values())
            .sort((a, b) => b.total - a.total)
            .map((r) => [
              { text: esc(r.name), align: 'left' as const },
              { text: String(r.count), align: 'right' as const },
              { text: fmtMad(r.total), align: 'right' as const, bold: true, color: COLORS.emerald },
            ]),
        });
  const approvalsSubsec =
    approvalByChef.size === 0
      ? emptyOk('Aucune demande de validation créée cette semaine.')
      : dataTable({
          headers: ['Chef', 'Nb demandes', 'Montant en attente'],
          rows: Array.from(approvalByChef.values())
            .sort((a, b) => b.total - a.total)
            .map((r) => [
              { text: esc(r.name), align: 'left' as const },
              { text: String(r.count), align: 'right' as const },
              { text: fmtMad(r.total), align: 'right' as const, bold: true, color: COLORS.warning },
            ]),
        });

  const argentSection = `
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Nouveaux acomptes créés</div>
    ${acomptesSubsec}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Encaissements clients reçus</div>
    ${encaissementsSubsec}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Demandes de validation en attente</div>
    ${approvalsSubsec}`;

  // ── Bloc 5 rendu — DÉTAIL PAR CLIENT (CEO 2026-08-31b) ──
  // Un récap par chef ne se lit pas : ce qu'on veut voir, c'est combien de
  // biens / notes / docs / emails sont allés chez CHAQUE client. Le récap par
  // chef reste, mais en une ligne de texte sous le détail.
  const clientCell = (client: string, ref: string) => ({
    text: `${esc(client)}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(ref)}</span>`,
    align: 'left' as const,
  });
  /** Récap compact "Chef A 3 · Chef B 1" sous un tableau de détail. */
  const chefRecapLine = (entries: Array<{ name: string; count: number }>, unit: string) => {
    if (entries.length === 0) return '';
    const txt = entries
      .slice()
      .sort((a, b) => b.count - a.count)
      .map((e) => `${esc(e.name)} ${e.count}`)
      .join(' · ');
    return `<div style="font-size:11px;color:${COLORS.mutedSoft};margin-top:6px;">Par chef — ${txt} ${esc(unit)}</div>`;
  };

  const biensEnvoyesSubsec =
    propsTotal === 0
      ? emptyOk('Aucun bien envoyé aux clients cette semaine.')
      : `<div style="font-size:13px;color:${COLORS.muted};margin-bottom:8px;">
          <strong>${propsTotal}</strong> bien(s) envoyé(s) à <strong>${propsProjects.size}</strong> client(s)
          en <strong>${propsBatches.size}</strong> envoi(s).
        </div>` +
        dataTable({
          headers: ['Client', 'Chef', 'Biens envoyés', 'Lesquels', 'Retours'],
          rows: Array.from(propsByClient.values())
            .sort((a, b) => b.biens.length - a.biens.length)
            .slice(0, 15)
            .map((r) => [
              clientCell(r.client, r.ref),
              { text: esc(r.chef), align: 'left' as const },
              {
                // Le nombre d'envois n'est affiché que s'il APPORTE quelque
                // chose : plusieurs biens groupés en moins d'envois. Quand
                // chaque bien part seul, la mention doublonne la colonne.
                text: `${r.biens.length}${
                  r.batches.size > 1 && r.batches.size < r.biens.length
                    ? ` <span style="font-size:11px;color:${COLORS.mutedSoft};">(${r.batches.size} envois)</span>`
                    : ''
                }`,
                align: 'right' as const,
                bold: true,
              },
              {
                text: `${esc(r.biens.slice(0, 4).join(', '))}${r.biens.length > 4 ? ` <span style="color:${COLORS.mutedSoft};">+${r.biens.length - 4}</span>` : ''}`,
                align: 'left' as const,
              },
              {
                text: `${r.responded} / ${r.biens.length}`,
                align: 'right' as const,
                color: r.responded > 0 ? COLORS.emerald : COLORS.warning,
                bold: true,
              },
            ]),
        }) +
        chefRecapLine(
          Array.from(propsByChef.values()).map((c) => ({ name: c.name, count: c.biens })),
          'biens',
        );

  const notesSubsec =
    notesByProject.size === 0
      ? emptyOk('Aucune note projet ajoutée cette semaine.')
      : dataTable({
          headers: ['Client', 'Chef', 'Notes ajoutées'],
          rows: Array.from(notesByProject.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 15)
            .map((r) => [
              clientCell(r.client, r.ref),
              { text: esc(r.chef), align: 'left' as const },
              { text: String(r.count), align: 'right' as const, bold: true },
            ]),
        }) +
        chefRecapLine(Array.from(notesByChef.values()), 'notes');

  const docsTypeSubsec =
    docsByProject.size === 0
      ? emptyOk('Aucun document uploadé cette semaine.')
      : dataTable({
          headers: ['Client', 'Chef', 'Documents', 'Types'],
          rows: Array.from(docsByProject.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 15)
            .map((r) => [
              clientCell(r.client, r.ref),
              { text: esc(r.chef), align: 'left' as const },
              { text: String(r.count), align: 'right' as const, bold: true },
              {
                text: esc(
                  Array.from(r.types.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))
                    .join(', '),
                ),
                align: 'left' as const,
              },
            ]),
        }) +
        (docsByType.size === 0
          ? ''
          : `<div style="font-size:11px;color:${COLORS.mutedSoft};margin-top:6px;">Tous types confondus — ${esc(
              Array.from(docsByType.entries())
                .sort((a, b) => b[1] - a[1])
                .map(([label, n]) => `${label} ${n}`)
                .join(' · '),
            )}</div>`) +
        chefRecapLine(Array.from(docsByChef.values()), 'documents');

  const emailsSubsec =
    emailsTotal === 0
      ? emptyOk('Aucun email auto envoyé aux clients cette semaine.')
      : emailsByProject.size === 0
      ? alertBox({
          level: 'info',
          content: `<strong>${emailsTotal}</strong> email(s) envoyé(s) cette semaine, aucun rattaché à un projet.`,
        })
      : dataTable({
          headers: ['Client', 'Chef', 'Emails envoyés'],
          rows: Array.from(emailsByProject.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 15)
            .map((r) => [
              clientCell(r.client, r.ref),
              { text: esc(r.chef), align: 'left' as const },
              { text: String(r.count), align: 'right' as const, bold: true },
            ]),
        }) +
        (emailsSansProjet > 0
          ? `<div style="font-size:11px;color:${COLORS.mutedSoft};margin-top:6px;">+ ${emailsSansProjet} email(s) non rattaché(s) à un projet</div>`
          : '') +
        chefRecapLine(Array.from(emailsByChef.values()), 'emails');

  const retoursClientsSubsec = (() => {
    const finalLine =
      (finalSelections ?? []).length === 0
        ? ''
        : alertBox({
            level: 'info',
            content:
              `<strong>${(finalSelections ?? []).length}</strong> bien(s) retenu(s) comme bien final cette semaine ` +
              `— c'est le jalon qui débloque la phase Design.`,
          }) + '<div style="height:8px;"></div>';
    if ((proposalResponses ?? []).length === 0) {
      return finalLine + emptyOk('Aucun retour client sur les biens cette semaine.');
    }
    return (
      finalLine +
      dataTable({
        headers: ['Client', 'Bien', 'Réponse', 'Motif si refus', 'Date'],
        rows: ((proposalResponses ?? []) as any[]).slice(0, 15).map((r) => {
          const proj = r.project_id ? projById.get(r.project_id) : null;
          const meta = RESPONSE_LABELS[r.client_response] ?? {
            label: String(r.client_response),
            color: COLORS.muted,
          };
          return [
            clientCell(proj?.client?.full_name ?? '—', proj?.reference ?? ''),
            { text: esc(r.property?.name ?? '—'), align: 'left' as const },
            { text: esc(meta.label), align: 'left' as const, color: meta.color, bold: true },
            { text: esc(r.client_refusal_reason ?? '—'), align: 'left' as const },
            { text: fmtDate(r.client_response_at), align: 'right' as const },
          ];
        }),
      })
    );
  })();

  const suiviClientSection = `
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Biens envoyés aux clients</div>
    ${biensEnvoyesSubsec}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Retours clients sur les biens</div>
    ${retoursClientsSubsec}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Notes projet ajoutées</div>
    ${notesSubsec}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Documents uploadés (par type)</div>
    ${docsTypeSubsec}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Emails auto envoyés aux clients</div>
    ${emailsSubsec}`;

  // ── Bloc 6 rendu (zone silence) ──
  const silenceAlert =
    silenceProjects.length > 5
      ? alertBox({
          level: 'warning',
          content: `<strong>${silenceProjects.length}</strong> projet(s) actif(s) sans aucune activité cette semaine — à contacter en priorité.`,
        }) + '<div style="height:8px;"></div>'
      : '';
  const silenceSection =
    silenceProjects.length === 0
      ? emptyOk('Tous les projets actifs ont eu au moins une activité cette semaine.')
      : silenceAlert +
        dataTable({
          headers: ['Client', 'Chef', 'Dernière activité'],
          rows: silenceProjects.slice(0, 15).map((r) => [
            {
              text: `${esc(r.client)}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(r.ref)}</span>`,
              align: 'left' as const,
            },
            { text: esc(r.chef), align: 'left' as const },
            {
              text: fmtDate(r.lastActivity),
              align: 'right' as const,
              color: COLORS.warning,
              bold: true,
            },
          ]),
        });

  // ── Bloc 7 rendu (dates modifiées) ──
  const datesSection =
    dateRows.length === 0
      ? emptyOk('Aucune date chantier modifiée cette semaine.')
      : dataTable({
          headers: ['Ref projet', 'Chef', 'Champ', 'Changement', 'Date'],
          rows: dateRows.slice(0, 15).map((r) => [
            { text: esc(r.ref), align: 'left' as const, bold: true },
            { text: esc(r.chef), align: 'left' as const },
            { text: esc(r.field), align: 'left' as const },
            {
              text: `${esc(String(r.from))} → <strong>${esc(String(r.to))}</strong>`,
              align: 'left' as const,
            },
            { text: fmtDate(r.date), align: 'right' as const },
          ]),
        });

  // ── Bloc 8 rendu (tâches) ──
  const tasksRecapSubsec =
    tasksByChef.size === 0
      ? emptyOk('Aucune tâche créée, terminée ou en souffrance cette semaine.')
      : dataTable({
          headers: ['Chef', 'Créées', 'Terminées', 'En souffrance', 'Dont bloquantes'],
          rows: Array.from(tasksByChef.values())
            .sort((a, b) => b.overdue - a.overdue || b.done - a.done)
            .map((r) => [
              { text: esc(r.name), align: 'left' as const },
              { text: String(r.created), align: 'right' as const },
              { text: String(r.done), align: 'right' as const, color: r.done > 0 ? COLORS.emerald : undefined },
              {
                text: String(r.overdue),
                align: 'right' as const,
                color: r.overdue > 0 ? COLORS.warning : undefined,
                bold: r.overdue > 0,
              },
              {
                text: String(r.blocking),
                align: 'right' as const,
                color: r.blocking > 0 ? COLORS.danger : undefined,
                bold: r.blocking > 0,
              },
            ]),
        });
  const blockingAlert =
    nbBlocking > 0
      ? alertBox({
          level: 'danger',
          content: `<strong>${nbBlocking}</strong> tâche(s) bloquante(s) en souffrance — elles gèlent la progression de leur phase.`,
        }) + '<div style="height:8px;"></div>'
      : '';
  const dormantNote =
    nbDormantes > 0
      ? `<div style="font-size:11px;color:${COLORS.mutedSoft};margin-bottom:8px;">
          « Dormante » = tâche encore ouverte depuis plus de ${DORMANT_DAYS} jours, sans échéance saisie.
          Renseigner les échéances dans l'app rendra ce bloc bien plus précis.
        </div>`
      : '';
  const tasksOverdueSubsec =
    overdueRows.length === 0
      ? emptyOk('Aucune tâche en souffrance.')
      : blockingAlert +
        dormantNote +
        dataTable({
          headers: ['Tâche', 'Client', 'Responsable', 'Motif', 'Depuis'],
          rows: overdueRows.slice(0, 12).map((r) => [
            {
              text: `${r.blocking ? `<span style="background:${COLORS.warningBg};color:${COLORS.warningText};padding:1px 5px;border-radius:3px;font-size:10px;margin-right:4px;">bloquante</span>` : ''}${esc(r.title)}`,
              align: 'left' as const,
            },
            {
              text: `${esc(r.client)}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(r.ref)}</span>`,
              align: 'left' as const,
            },
            { text: esc(r.owner), align: 'left' as const },
            {
              text: r.reason === 'echeance' ? `Échéance ${fmtDate(r.since)}` : 'Dormante',
              align: 'left' as const,
              color: r.reason === 'echeance' ? COLORS.warning : COLORS.muted,
            },
            {
              text: `${r.days} j`,
              align: 'right' as const,
              color: r.blocking ? COLORS.danger : COLORS.warning,
              bold: true,
            },
          ]),
        });
  const tachesSection = `
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Activité par chef</div>
    ${tasksRecapSubsec}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Tâches en retard</div>
    ${tasksOverdueSubsec}`;

  // ── Bloc 9 rendu (VCT & PV de réception) ──
  const receptionKpis = kpiRow([
    kpiCard({
      label: 'VCT réalisées',
      value: String(vctPerformed),
      subValue: `${vctValidated} validée(s)`,
      variant: 'light',
    }),
    kpiCard({ label: 'PV signés client', value: String((pvSignedWeek ?? []).length), subValue: 'cette semaine', variant: 'emerald' }),
    kpiCard({
      label: 'PV en attente signature',
      value: String((pvPending ?? []).length),
      subValue: 'envoyés au client',
      variant: (pvPending ?? []).length > 0 ? 'warning' : 'light',
    }),
  ]);
  const pvPendingSubsec =
    (pvPending ?? []).length === 0
      ? emptyOk('Aucun PV en attente de signature client.')
      : dataTable({
          headers: ['Client', 'Chef', 'Envoyé le', 'Attente'],
          rows: ((pvPending ?? []) as any[])
            .sort((a, b) => String(a.sent_to_client_at ?? '').localeCompare(String(b.sent_to_client_at ?? '')))
            .slice(0, 10)
            .map((pv) => {
              const proj = projById.get(pv.project_id);
              return [
                {
                  text: `${esc(proj?.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(proj?.reference ?? '')}</span>`,
                  align: 'left' as const,
                },
                { text: esc(proj?.chef?.full_name ?? '—'), align: 'left' as const },
                { text: pv.sent_to_client_at ? fmtDate(pv.sent_to_client_at) : '—', align: 'left' as const },
                {
                  text: pv.sent_to_client_at ? `${daysAgo(pv.sent_to_client_at)} j` : '—',
                  align: 'right' as const,
                  color: pv.sent_to_client_at && daysAgo(pv.sent_to_client_at) > 7 ? COLORS.danger : COLORS.warning,
                  bold: true,
                },
              ];
            }),
        });
  const nbActionsOpen = (vctActionsOpen ?? []).length;
  const nbReservesOpen = (pvReservesOpen ?? []).length;
  const reservesSubsec =
    nbActionsOpen === 0 && nbReservesOpen === 0
      ? emptyOk('Aucune action corrective VCT ni réserve PV ouverte.')
      : `<div style="font-size:13px;color:${COLORS.muted};margin-bottom:8px;">
          Actions correctives VCT ouvertes : <strong>${nbActionsOpen}</strong>
          (dont <strong style="color:${vctActionsLate.length > 0 ? COLORS.danger : COLORS.muted};">${vctActionsLate.length} en retard</strong>)
          · Réserves PV ouvertes : <strong>${nbReservesOpen}</strong>
          (dont <strong style="color:${reservesLate.length > 0 ? COLORS.danger : COLORS.muted};">${reservesLate.length} en retard</strong>)
        </div>` +
        (vctActionsLate.length === 0
          ? ''
          : dataTable({
              headers: ['Client', 'Action corrective', 'Responsable', 'Échéance'],
              rows: vctActionsLate.slice(0, 10).map((a: any) => {
                const proj = projById.get(a.project_id);
                return [
                  {
                    text: `${esc(proj?.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(proj?.reference ?? '')}</span>`,
                    align: 'left' as const,
                  },
                  { text: esc(a.description ?? '—'), align: 'left' as const },
                  { text: esc(a.responsible_role ?? '—'), align: 'left' as const },
                  {
                    text: `${fmtDate(a.deadline)} (${daysAgo(a.deadline)} j)`,
                    align: 'right' as const,
                    color: COLORS.danger,
                    bold: true,
                  },
                ];
              }),
            }));
  const receptionSection = `
    ${receptionKpis}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">PV envoyés, en attente de signature</div>
    ${pvPendingSubsec}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Réserves &amp; actions correctives ouvertes</div>
    ${reservesSubsec}`;

  // ── Bloc 10 rendu (satisfaction / NPS) ──
  const satisfactionKpis = kpiRow([
    kpiCard({ label: 'Enquêtes envoyées', value: String((surveysSent ?? []).length), subValue: 'cette semaine', variant: 'light' }),
    kpiCard({
      label: 'Note moyenne',
      value: avgScore == null ? '—' : `${avgScore.toFixed(1)} / 5`,
      subValue: `${doneRows.length} réponse(s)`,
      variant: avgScore != null && avgScore < 4 ? 'warning' : 'emerald',
    }),
    kpiCard({
      label: 'NPS moyen',
      value: avgNps == null ? '—' : `${avgNps.toFixed(1)} / 10`,
      subValue: `${npsScores.length} note(s)`,
      variant: 'dark',
    }),
  ]);
  const lowScoresSubsec =
    lowScores.length === 0
      ? emptyOk('Aucune note basse (≤ 3/5) cette semaine.')
      : dataTable({
          headers: ['Client', 'Phase', 'Note', 'Commentaire'],
          rows: lowScores.slice(0, 10).map((r: any) => {
            const proj = projById.get(r.project_id);
            return [
              {
                text: `${esc(proj?.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(proj?.reference ?? '')}</span>`,
                align: 'left' as const,
              },
              { text: esc(PHASE_LABELS[r.trigger_phase] ?? r.trigger_phase ?? '—'), align: 'left' as const },
              { text: `${r.global_score} / 5`, align: 'left' as const, color: COLORS.danger, bold: true },
              { text: esc(r.comment ?? '—'), align: 'right' as const },
            ];
          }),
        });
  const surveysPendingSubsec =
    (surveysPending ?? []).length === 0
      ? emptyOk('Aucune enquête sans réponse depuis plus de 10 jours.')
      : dataTable({
          headers: ['Client', 'Phase', 'Envoyée le', 'Attente'],
          rows: ((surveysPending ?? []) as any[]).slice(0, 10).map((r) => {
            const proj = projById.get(r.project_id);
            return [
              {
                text: `${esc(proj?.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(proj?.reference ?? '')}</span>`,
                align: 'left' as const,
              },
              { text: esc(PHASE_LABELS[r.trigger_phase] ?? r.trigger_phase ?? '—'), align: 'left' as const },
              { text: fmtDate(r.sent_at), align: 'left' as const },
              { text: `${daysAgo(r.sent_at)} j`, align: 'right' as const, color: COLORS.warning, bold: true },
            ];
          }),
        });
  const satisfactionSection = `
    ${satisfactionKpis}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Notes basses à traiter</div>
    ${lowScoresSubsec}
    <div style="height:12px;"></div>
    <div style="font-size:12px;color:${COLORS.muted};margin-bottom:6px;font-weight:600;">Enquêtes sans réponse &gt; 10j</div>
    ${surveysPendingSubsec}`;

  // ═══════════════════════════════════════════════════════════════════════════
  // Blocs existants rendus
  // ═══════════════════════════════════════════════════════════════════════════
  const nbActifsTotal = LIFECYCLE_PHASES.reduce((s, p) => s + phaseCount[p], 0);
  const phaseKpis = kpiRow(
    LIFECYCLE_PHASES.slice(0, 3).map((ph) =>
      kpiCard({ label: PHASE_LABELS[ph], value: String(phaseCount[ph]), variant: 'light' }),
    ),
  );
  const phaseKpis2 = kpiRow(
    LIFECYCLE_PHASES.slice(3).map((ph) =>
      kpiCard({ label: PHASE_LABELS[ph], value: String(phaseCount[ph]), variant: 'light' }),
    ),
  );

  const flowKpis = kpiRow([
    kpiCard({
      label: 'Nouveaux projets',
      value: String((newProjects ?? []).length),
      subValue: 'cette semaine',
      variant: 'emerald',
    }),
    kpiCard({
      label: 'Projets clôturés',
      value: String((closedProjects ?? []).length),
      subValue: 'phase termine',
      variant: 'dark',
    }),
    kpiCard({
      label: 'Actifs (hors termine)',
      value: String(nbActifsTotal),
      variant: 'light',
    }),
  ]);

  const pausedSection = (paused ?? []).length === 0
    ? emptyOk('Aucun projet en pause actuellement.')
    : dataTable({
        headers: ['Client', 'En pause depuis', 'Reprise prévue', 'Motif'],
        rows: (paused as any[]).slice(0, 10).map((p) => [
          { text: `${esc(p.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(p.reference ?? '')}</span>`, align: 'left' as const },
          { text: fmtDate(p.paused_at), align: 'left' as const },
          {
            text: p.expected_resume_at ? fmtDate(p.expected_resume_at) : '—',
            align: 'left' as const,
            color: p.expected_resume_at && new Date(p.expected_resume_at) < now ? COLORS.danger : undefined,
            bold: !!(p.expected_resume_at && new Date(p.expected_resume_at) < now),
          },
          { text: esc(p.pause_reason_code_v ?? '—'), align: 'right' as const },
        ]),
      });

  const overdueResume = pausedResumeOverdue.length > 0
    ? alertBox({
        level: 'danger',
        content: `<strong>${pausedResumeOverdue.length}</strong> reprise(s) attendues déjà en retard — décision à prendre.`,
      })
    : '';

  const lostSection = (lost ?? []).length === 0
    ? emptyOk('Aucun projet perdu cette semaine.')
    : `<div style="font-size:13px;color:${COLORS.muted};margin-bottom:8px;">${(lost ?? []).length} projet(s) · manque à gagner cumulé ${fmtEur(lostPipelineEur)}</div>
    ${dataTable({
      headers: ['Client', 'Perdu le', 'Motif', 'Manque à gagner'],
      rows: (lost as any[]).map((l) => [
        { text: `${esc(l.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(l.reference ?? '')}</span>`, align: 'left' as const },
        { text: fmtDate(l.lost_at), align: 'left' as const },
        { text: esc(l.lost_reason ?? '—'), align: 'left' as const },
        { text: fmtEur(honTotal(l.id)), align: 'right' as const, bold: true, color: COLORS.danger },
      ]),
    })}`;

  const transitionsSection = transitionRows.length === 0
    ? emptyOk('Aucun passage de phase enregistré cette semaine.')
    : dataTable({
        headers: ['Client', 'Nouvelle phase', 'Date'],
        rows: transitionRows.map((t: any) => [
          { text: `${esc(t.project?.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(t.project?.reference ?? '')}</span>`, align: 'left' as const },
          { text: esc(PHASE_LABELS[t.phase] ?? t.phase), align: 'left' as const, bold: true },
          { text: fmtDate(t.started_at), align: 'right' as const },
        ]),
      });

  const stuckSection = stuckList.length === 0
    ? emptyOk('Aucun projet stagnant, tous progressent dans les seuils.')
    : dataTable({
        headers: ['Client', 'Phase', 'Bloqué depuis', 'Chef'],
        rows: stuckList.slice(0, 10).map((s) => [
          { text: `${esc(s.label)}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(s.sub)}</span>`, align: 'left' as const },
          { text: esc(PHASE_LABELS[s.phase] ?? s.phase), align: 'left' as const },
          {
            text: `${s.days} j`,
            align: 'left' as const,
            color: s.level === 'red' ? COLORS.danger : COLORS.warning,
            bold: true,
          },
          { text: esc(s.chef ?? '—'), align: 'right' as const },
        ]),
      });

  const incompleteSection = incomplete.length === 0
    ? emptyOk('Tous les dossiers actifs sont complets.')
    : dataTable({
        headers: ['Client', 'Référence', 'Manque'],
        rows: incomplete.slice(0, 5).map((i) => [
          esc(i.label),
          esc(i.sub),
          {
            text: i.missing.map((m) => `<span style="background:${COLORS.warningBg};color:${COLORS.warningText};padding:2px 6px;border-radius:4px;font-size:11px;">${esc(m)}</span>`).join(' '),
            align: 'right' as const,
          },
        ]),
      });

  const body =
    htmlHeader(subject, subtitle) +
    // ─── 7 nouveaux blocs récap chef de projet (CEO 2026-08-24) ─────────
    section(sectionTitle('1 · Leaderboard hebdo — actions par chef') + leaderboardSection) +
    section(sectionTitle('2 · Passages de phase (lifecycle)') + lifecycleSection) +
    section(sectionTitle('3 · Sous-phases chantier avancées') + sousPhaseSection) +
    section(sectionTitle('4 · Argent en mouvement') + argentSection) +
    section(sectionTitle('5 · Suivi client') + suiviClientSection) +
    section(sectionTitle('6 · Zone de silence') + silenceSection) +
    section(sectionTitle('7 · Dates chantier modifiées') + datesSection) +
    section(sectionTitle('8 · Tâches') + tachesSection) +
    section(sectionTitle('9 · Réception chantier — VCT & PV') + receptionSection) +
    section(sectionTitle('10 · Satisfaction client') + satisfactionSection) +
    // ─── Blocs existants ────────────────────────────────────────────────
    section(sectionTitle('Répartition projets en production') + phaseKpis + '<div style="height:8px;"></div>' + phaseKpis2, { padding: '24px 32px 8px' }) +
    section(sectionTitle('Flux de la semaine') + flowKpis) +
    section(sectionTitle('Projets en pause') + overdueResume + '<div style="height:8px;"></div>' + pausedSection) +
    section(sectionTitle('Projets perdus cette semaine') + lostSection) +
    section(sectionTitle('Passages de phase (audit)') + transitionsSection) +
    section(sectionTitle('Projets stagnants') + stuckSection) +
    section(sectionTitle('Top 5 dossiers à compléter') + incompleteSection) +
    htmlFooter('/dashboard/clients', 'Ouvrir le dashboard');

  const full = `Stoniz · ${subtitle} · ${subject}`;
  return { subject: full, html: wrapPage(body, full) };
}
