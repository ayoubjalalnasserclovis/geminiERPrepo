import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ArrowLeft, AlertTriangle, Wallet, Calendar } from 'lucide-react';
import { ProjectionDetailsDrawer, type FlowItem, type RecurringDetail } from './projection-details-drawer';
import { MissingDatesBanner } from './missing-dates-banner';
import { ACHATS_LOT_NOT_TO_PROGRAM_PG } from '@/lib/finance/projection-invariants';
import { getSessionUser } from '@/lib/auth/require';
import { detectRecurringPayments } from '@/lib/finance/recurring-detector';

/**
 * Projection cashflow 30/60/90 jours — Chantier 4 trésorerie.
 *
 * Hypothèses : on prend ton solde actuel et on simule l'évolution sur 90 jours
 * en considérant :
 *   ENTRÉES  prévues = honoraires Stoniz scheduled non payés (clients)
 *                    + encaissements travaux/achats scheduled non reçus
 *   SORTIES  prévues = paiements artisans/fournisseurs/services scheduled non payés
 *                    + charges récurrentes moyennes mensuelles (3 derniers mois)
 *
 * Ne dépend PAS des allocations bancaires — utilise les échéanciers et l'historique.
 */

function fmtMad(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

function fmtMadCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M MAD`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k MAD`;
  return `${Math.round(n)} MAD`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export default async function ProjectionPage() {
  await requireRole(['ceo', 'finance', 'developer']);
  const me = await getSessionUser();
  const canEdit = me?.role === 'ceo' || me?.role === 'finance';
  const supabase = createClient();

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d30 = addDays(start, 30);
  const d60 = addDays(start, 60);
  const d90 = addDays(start, 90);
  // Fenêtre étendue pour inclure les retards : on remonte 90 jours dans le passé
  const overdueStart = addDays(start, -90);
  const todayIso = isoDate(start);

  // ─── 1) Solde courant groupe ─────────────────────────────────────────
  const { data: balances } = await supabase
    .from('v_bank_account_current_balance')
    .select('*')
    .eq('is_active', true);
  const startingBalance = ((balances ?? []) as any[]).reduce(
    (s, b) => s + Number(b.current_balance ?? 0),
    0
  );

  // ─── 2) ENTRÉES PRÉVUES — incluant les retards (90j passés + 90j futurs) ──
  // Honoraires Stoniz : on inclut désormais les overdues (due_date < today, non payés)
  // → ils apparaissent comme "En retard" dans le drawer et comptent à J+0 dans la projection.
  const { data: honoraires } = await supabase
    .from('payments')
    .select('id, amount_expected, currency, due_date, paid_at, status, label, project:projects(status, deleted_at, reference, client:clients(full_name))')
    .is('deleted_at', null)
    .lte('due_date', isoDate(d90))
    .gte('due_date', isoDate(overdueStart));

  const upcomingHonoraires = ((honoraires ?? []) as any[])
    .filter((h) => {
      const p = h.project;
      if (!p || p.deleted_at) return false;
      if (p.status === 'perdu') return false;
      if (h.paid_at) return false;
      return h.status !== 'paid' && h.status !== 'paye' && h.status !== 'cancelled';
    })
    .map((h) => {
      const amt = Number(h.amount_expected ?? 0);
      const amount_mad = h.currency === 'EUR' ? amt * 10 : amt;
      const dueDate = h.due_date as string;
      return {
        id: h.id as string,
        date: dueDate,
        amount_mad,
        label: h.label ?? `Honoraires ${h.project?.client?.full_name ?? h.project?.reference ?? ''}`,
        kind: 'honoraires' as const,
        overdue: dueDate < todayIso,
      };
    });

  // Encaissements client travaux & achats planifiés (status='planifie', date d'échéance scheduled_date)
  // Depuis 2026-06-08, on a un vrai échéancier de rentrées attendues.
  const [travauxEnc, achatsEnc] = await Promise.all([
    supabase
      .from('travaux_encaissements')
      .select('id, amount_mad, scheduled_date, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
      .is('deleted_at', null)
      .eq('status', 'planifie')
      .lte('scheduled_date', isoDate(d90))
      .gte('scheduled_date', isoDate(overdueStart)),
    supabase
      .from('achats_encaissements')
      .select('id, amount_mad, scheduled_date, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
      .is('deleted_at', null)
      .eq('status', 'planifie')
      .lte('scheduled_date', isoDate(d90))
      .gte('scheduled_date', isoDate(overdueStart)),
  ]);

  const travauxInflows = ((travauxEnc.data ?? []) as any[])
    .filter((e) => e.project && !e.project.deleted_at && e.project.status !== 'perdu' && e.scheduled_date)
    .map((e) => ({
      id: `te_${e.id}` as string,
      date: e.scheduled_date as string,
      amount_mad: Number(e.amount_mad ?? 0),
      label: `Encaissement travaux — ${e.project?.client?.full_name ?? e.project?.reference ?? ''}`,
      kind: 'travaux_encaissement' as const,
      overdue: (e.scheduled_date as string) < todayIso,
    }));

  const achatsInflows = ((achatsEnc.data ?? []) as any[])
    .filter((e) => e.project && !e.project.deleted_at && e.project.status !== 'perdu' && e.scheduled_date)
    .map((e) => ({
      id: `ae_${e.id}` as string,
      date: e.scheduled_date as string,
      amount_mad: Number(e.amount_mad ?? 0),
      label: `Encaissement achats — ${e.project?.client?.full_name ?? e.project?.reference ?? ''}`,
      kind: 'achats_encaissement' as const,
      overdue: (e.scheduled_date as string) < todayIso,
    }));

  const allInflows = [...upcomingHonoraires, ...travauxInflows, ...achatsInflows];

  // ─── 3) SORTIES PRÉVUES — incluant les retards (90j passés + 90j futurs) ──
  const [travauxPay, achatsPay, servicesPay] = await Promise.all([
    supabase
      .from('travaux_payments')
      .select('id, amount_total, amount_paid, scheduled_date, status, artisan_name, project:projects(status, deleted_at, reference, client:clients(full_name))')
      .is('deleted_at', null)
      .lte('scheduled_date', isoDate(d90))
      .gte('scheduled_date', isoDate(overdueStart)),
    // CEO 2026-06-18 B3 : on joint le lot pour exclure status='a_commander'
    // (prix non encore négocié — ne doit pas peser dans la projection).
    supabase
      .from('achats_payments')
      .select('id, amount_total, amount_paid, scheduled_date, status, supplier_name, lot_id, lot:achats_lots(status), project:projects(status, deleted_at, reference, client:clients(full_name))')
      .is('deleted_at', null)
      .lte('scheduled_date', isoDate(d90))
      .gte('scheduled_date', isoDate(overdueStart)),
    // CEO 2026-06-18 — services_payments désormais inclus dans la projection
    // (auparavant chargé mais ignoré dans projectAtDay). Filtre identique aux
    // travaux/achats : scheduled_date dans la fenêtre [J-90, J+90].
    supabase
      .from('services_payments')
      .select('id, amount_total, amount_paid, scheduled_date, status, project:projects(status, deleted_at, reference, client:clients(full_name))')
      .is('deleted_at', null)
      .lte('scheduled_date', isoDate(d90))
      .gte('scheduled_date', isoDate(overdueStart)),
  ]);

  function isFutureUnpaid(p: any): boolean {
    if (!p.project || p.project.deleted_at) return false;
    if (p.project.status === 'perdu') return false;
    if (p.status === 'paid' || p.status === 'paye') return false;
    return Number(p.amount_total ?? 0) > Number(p.amount_paid ?? 0);
  }

  const travauxOutflows = ((travauxPay.data ?? []) as any[])
    .filter(isFutureUnpaid)
    .map((p) => {
      const date = p.scheduled_date as string;
      return {
        id: p.id as string,
        date,
        amount_mad: Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0),
        label: `${p.artisan_name ?? 'Artisan'} (${p.project?.client?.full_name ?? p.project?.reference ?? '—'})`,
        kind: 'travaux' as const,
        overdue: date < todayIso,
      };
    });

  // CEO 2026-06-18 B3 : exclure les paiements liés à un lot status
  // 'a_commander' (prix non encore négocié) ou 'annule' (lot abandonné).
  // Compteur séparé pour alerte UI sur les incohérences a_commander.
  const achatsPayRaw = (achatsPay.data ?? []) as any[];
  const EXCLUDED_LOT_STATUSES = new Set(['a_commander', 'annule']);
  const achatsIncohérents = achatsPayRaw.filter((p) =>
    p.lot?.status === 'a_commander' && isFutureUnpaid(p),
  );
  const achatsOutflows = achatsPayRaw
    .filter(isFutureUnpaid)
    .filter((p) => !p.lot || !EXCLUDED_LOT_STATUSES.has(p.lot.status))
    .map((p) => {
      const date = p.scheduled_date as string;
      return {
        id: p.id as string,
        date,
        amount_mad: Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0),
        label: `${p.supplier_name ?? 'Fournisseur'} (${p.project?.client?.full_name ?? p.project?.reference ?? '—'})`,
        kind: 'achats' as const,
        overdue: date < todayIso,
      };
    });

  const servicesOutflows = ((servicesPay.data ?? []) as any[])
    .filter(isFutureUnpaid)
    .filter((p) => p.scheduled_date)
    .map((p) => {
      const date = p.scheduled_date as string;
      return {
        id: p.id as string,
        date,
        amount_mad: Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0),
        label: `Service · ${p.project?.client?.full_name ?? p.project?.reference ?? '—'}`,
        kind: 'services' as const,
        overdue: date < todayIso,
      };
    });

  // Charges récurrentes : moyenne mensuelle des 3 derniers mois pour cabinet_charge etc.
  const start3m = addDays(start, -90);
  const { data: recentTxs } = await supabase
    .from('bank_transactions')
    .select('debit_mad, category_code, operation_date, beneficiary')
    .gte('operation_date', isoDate(start3m))
    .lt('operation_date', isoDate(start))
    .is('deleted_at', null)
    .eq('is_pending', false)
    .limit(3000);

  const RECURRING_CATEGORIES = ['dgi', 'cnss', 'maroc_telecom', 'frais_bancaire'];

  // Récupère les noms des artisans/fournisseurs/services connus pour les EXCLURE des récurrents.
  // Le user a explicitement dit : "ne me met pas les travaux/achats même si payés chaque mois,
  // c'est lié à des chantiers, c'est pas une charge récurrente".
  const { data: knownProviders } = await supabase
    .from('artisans')
    .select('name, provider_type')
    .is('deleted_at', null);

  function normalize(s: string): string {
    return s.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }
  const providerNeedles = (knownProviders ?? [])
    .map((p: any) => normalize(p.name ?? ''))
    .filter((n) => n.length >= 3);

  // Récupère aussi les bénéficiaires des transactions déjà allouées comme travaux/achats/services.
  // Si on a déjà rattaché ces virements à un projet, ils ne sont PAS des charges récurrentes.
  const { data: projectAllocs } = await supabase
    .from('bank_transaction_allocations')
    .select('transaction:bank_transactions(beneficiary)')
    .in('allocation_type', ['travaux', 'achats', 'services'])
    .is('deleted_at', null);
  const projectAllocBeneficiaries = new Set<string>();
  for (const a of (projectAllocs ?? []) as any[]) {
    const b = a.transaction?.beneficiary;
    if (b) projectAllocBeneficiaries.add(normalize(b));
  }

  // Mappings appris : bénéficiaires explicitement marqués non-cabinet (via bouton "Exclure")
  // Tout ce qui n'est PAS cabinet_charge / cabinet_fiscal / cabinet_social / frais_bancaire
  // est exclu des charges récurrentes.
  const { data: nonCabinetMappings } = await supabase
    .from('bank_category_mappings')
    .select('bank_label_match, match_type, allocation_type')
    .in('allocation_type', ['travaux', 'achats', 'services', 'honoraires', 'propria', 'intercompany', 'autre'])
    .is('deleted_at', null);
  const mappedNonCabinet = (nonCabinetMappings ?? []).map((m: any) => normalize(m.bank_label_match ?? ''));

  function isProviderBeneficiary(benef: string): boolean {
    const n = normalize(benef);
    if (projectAllocBeneficiaries.has(n)) return true;
    for (const needle of providerNeedles) {
      if (n.includes(needle) || needle.includes(n)) return true;
    }
    for (const needle of mappedNonCabinet) {
      if (needle && (n.includes(needle) || needle.includes(n))) return true;
    }
    return false;
  }

  let recurringTotal3m = 0;
  for (const t of (recentTxs ?? []) as any[]) {
    if (RECURRING_CATEGORIES.includes(t.category_code) && Number(t.debit_mad ?? 0) > 0) {
      recurringTotal3m += Number(t.debit_mad);
    }
  }
  // Salaires + prestataires récurrents : détection stricte via helper canon
  // (même montant récurrent ≥ 3 mois, tolérance CV < 20 %, actif dans les
  // 2 derniers mois). Aligné avec la page /finance/projection/mensuelle.
  // CEO 2026-09-02.
  const recurringPaymentsAll = await detectRecurringPayments();
  const recurringPersonsActive = recurringPaymentsAll.filter(p => p.is_active);
  const recurringPersonsMonthly = recurringPersonsActive.reduce(
    (s, p) => s + p.amount_per_month, 0,
  );
  const totalRecurringPerMonth = (recurringTotal3m / 3) + recurringPersonsMonthly;

  // Détail par catégorie pour le drawer
  const recurringDetail: RecurringDetail[] = [];
  const CATEGORY_LABELS_LOCAL: Record<string, string> = {
    dgi: 'Impôts (DGI)',
    cnss: 'Charges sociales (CNSS)',
    maroc_telecom: 'Maroc Telecom',
    frais_bancaire: 'Frais bancaires',
  };
  for (const cat of RECURRING_CATEGORIES) {
    let total = 0;
    for (const t of (recentTxs ?? []) as any[]) {
      if (t.category_code === cat) total += Number(t.debit_mad ?? 0);
    }
    if (total > 0) {
      recurringDetail.push({
        category: CATEGORY_LABELS_LOCAL[cat] ?? cat,
        total_3m: total,
        per_month: total / 3,
      });
    }
  }
  // Versements récurrents actifs (helper canon)
  const recurringPersons = recurringPersonsActive.map(p => ({
    name: p.beneficiary,
    total: p.amount_per_month * 3, // estimé sur 3 mois pour cohérence UI
    count: p.nb_mois,
  }));
  if (recurringPersonsMonthly > 0) {
    recurringDetail.push({
      category: 'Salaires & versements récurrents actifs',
      total_3m: recurringPersonsMonthly * 3,
      per_month: recurringPersonsMonthly,
      beneficiaries: recurringPersons,
    });
  }

  // ─── 4) Agrégation par mois (J+30, J+60, J+90) ───────────────────────
  // Les overdues (date < today) sont considérés comme dus J+0 → toujours dans la fenêtre.
  function aggregateUntil(items: { date: string; amount_mad: number }[], until: Date): number {
    return items
      .filter((it) => {
        const effectiveDate = it.date < todayIso ? todayIso : it.date;
        return effectiveDate <= isoDate(until);
      })
      .reduce((s, it) => s + it.amount_mad, 0);
  }

  function projectAtDay(days: number) {
    const targetDate = addDays(start, days);
    const inflows = aggregateUntil(allInflows, targetDate);
    // INVARIANT : sources de sorties = travaux + achats + services (cf. C3 invariants)
    const scheduled = aggregateUntil([...travauxOutflows, ...achatsOutflows, ...servicesOutflows], targetDate);
    const recurringEstimate = totalRecurringPerMonth * (days / 30);
    const outflows = scheduled + recurringEstimate;
    const ending = startingBalance + inflows - outflows;
    return { inflows, scheduled, recurringEstimate, outflows, ending };
  }

  const p30 = projectAtDay(30);
  const p60 = projectAtDay(60);
  const p90 = projectAtDay(90);

  // Détection des moments de tension (solde projeté négatif)
  const tensionPoints: { date: string; balance: number }[] = [];
  let cumBalance = startingBalance;
  for (let d = 0; d <= 90; d++) {
    const day = isoDate(addDays(start, d));
    // Les overdues comptent à J+0 (today), même si leur date est dans le passé
    const ins = allInflows
      .filter((i: any) => {
        const eff = i.date < todayIso ? todayIso : i.date;
        return eff === day;
      })
      .reduce((s: number, i: any) => s + i.amount_mad, 0);
    const outs = [...travauxOutflows, ...achatsOutflows, ...servicesOutflows]
      .filter((i: any) => {
        const eff = i.date < todayIso ? todayIso : i.date;
        return eff === day;
      })
      .reduce((s: number, i: any) => s + i.amount_mad, 0);
    // Estimation des charges récurrentes : on les répartit uniformément
    const recurringDaily = totalRecurringPerMonth / 30;
    cumBalance = cumBalance + ins - outs - recurringDaily;
    if (cumBalance < 0 && tensionPoints.length === 0) {
      tensionPoints.push({ date: day, balance: cumBalance });
    }
  }

  // ─── LOTS avec reste à payer (vrai signal de cashflow futur à programmer) ──
  // Les paiements historiques sans scheduled_date sont des soldés (data lecture).
  // Le vrai pilotage = lots actifs où devis - somme(amount_paid) > 0 ET pas d'acompte futur.
  const projectJoinShort = 'project:projects(reference, status, deleted_at, client:clients(full_name))';
  const [travauxLotsRes, achatsLotsRes, travauxPayAllRes, achatsPayAllRes] = await Promise.all([
    supabase.from('travaux_lots')
      .select(`id, project_id, artisan_name, category, status, devis_artisan_mad, budget_estimate_mad, description, ${projectJoinShort}`)
      .is('deleted_at', null)
      .not('status', 'in', '(termine,annule)'),
    // CEO 2026-06-18 : exclusion centralisée — installe/livre (produit reçu),
    // annule (lot abandonné), a_commander (prix inconnu, ne doit pas générer
    // de proposition de programmation).
    supabase.from('achats_lots')
      .select(`id, project_id, supplier_name, category, status, description, devis_fournisseur_mad, budget_estimate_mad, ${projectJoinShort}`)
      .is('deleted_at', null)
      .not('status', 'in', ACHATS_LOT_NOT_TO_PROGRAM_PG),
    supabase.from('travaux_payments')
      .select('lot_id, amount_paid, amount_total, scheduled_date, status')
      .is('deleted_at', null)
      .not('lot_id', 'is', null),
    supabase.from('achats_payments')
      .select('lot_id, amount_paid, amount_total, scheduled_date, status')
      .is('deleted_at', null)
      .not('lot_id', 'is', null),
  ]);

  // Index des paiements par lot
  const travauxPayByLot = new Map<string, { paid: number; hasScheduledFuture: boolean }>();
  for (const p of (travauxPayAllRes.data ?? []) as any[]) {
    const k = p.lot_id;
    if (!travauxPayByLot.has(k)) travauxPayByLot.set(k, { paid: 0, hasScheduledFuture: false });
    const entry = travauxPayByLot.get(k)!;
    entry.paid += Number(p.amount_paid ?? 0);
    if (p.scheduled_date && p.scheduled_date >= isoDate(start) && p.status !== 'paid') {
      entry.hasScheduledFuture = true;
    }
  }
  const achatsPayByLot = new Map<string, { paid: number; hasScheduledFuture: boolean }>();
  for (const p of (achatsPayAllRes.data ?? []) as any[]) {
    const k = p.lot_id;
    if (!achatsPayByLot.has(k)) achatsPayByLot.set(k, { paid: 0, hasScheduledFuture: false });
    const entry = achatsPayByLot.get(k)!;
    entry.paid += Number(p.amount_paid ?? 0);
    if (p.scheduled_date && p.scheduled_date >= isoDate(start) && p.status !== 'paid') {
      entry.hasScheduledFuture = true;
    }
  }

  type UnscheduledLot = {
    source: 'travaux_lot' | 'achats_lot';
    lot_id: string;
    project_ref: string;
    client_name: string | null;
    partner: string;
    category: string | null;
    description: string | null;
    devis_mad: number;
    paid_mad: number;
    remaining_mad: number;
  };

  const unscheduledLots: UnscheduledLot[] = [];

  for (const lot of (travauxLotsRes.data ?? []) as any[]) {
    const proj = lot.project;
    if (!proj || proj.deleted_at || proj.status === 'perdu') continue;
    const devis = Number(lot.devis_artisan_mad ?? lot.budget_estimate_mad ?? 0);
    if (devis <= 0) continue;
    const pay = travauxPayByLot.get(lot.id);
    const paid = pay?.paid ?? 0;
    const remaining = devis - paid;
    if (remaining <= 1) continue; // 1 MAD de tolérance
    if (pay?.hasScheduledFuture) continue; // déjà un acompte futur programmé
    unscheduledLots.push({
      source: 'travaux_lot',
      lot_id: lot.id,
      project_ref: proj.reference,
      client_name: proj.client?.full_name ?? null,
      partner: lot.artisan_name ?? 'Artisan',
      category: lot.category,
      description: lot.description,
      devis_mad: devis,
      paid_mad: paid,
      remaining_mad: remaining,
    });
  }

  for (const lot of (achatsLotsRes.data ?? []) as any[]) {
    const proj = lot.project;
    if (!proj || proj.deleted_at || proj.status === 'perdu') continue;
    const devis = Number(lot.devis_fournisseur_mad ?? lot.budget_estimate_mad ?? 0);
    if (devis <= 0) continue;
    const pay = achatsPayByLot.get(lot.id);
    const paid = pay?.paid ?? 0;
    const remaining = devis - paid;
    if (remaining <= 1) continue;
    if (pay?.hasScheduledFuture) continue;
    unscheduledLots.push({
      source: 'achats_lot',
      lot_id: lot.id,
      project_ref: proj.reference,
      client_name: proj.client?.full_name ?? null,
      partner: lot.supplier_name ?? 'Fournisseur',
      category: lot.category,
      description: lot.description,
      devis_mad: devis,
      paid_mad: paid,
      remaining_mad: remaining,
    });
  }

  // ─── Paiements existants sans date et sans versement (en attente d'être datés) ──
  // Différent des lots : ce sont des lignes déjà créées qui attendent juste une scheduled_date.
  const [travauxPendingRes, achatsPendingRes] = await Promise.all([
    supabase.from('travaux_payments')
      .select(`id, artisan_name, amount_total, amount_paid, description, status, lot_id, ${projectJoinShort}`)
      .is('deleted_at', null)
      .is('scheduled_date', null)
      .eq('amount_paid', 0)
      .neq('status', 'paid')
      .limit(200),
    supabase.from('achats_payments')
      .select(`id, supplier_name, amount_total, amount_paid, description, status, lot_id, ${projectJoinShort}`)
      .is('deleted_at', null)
      .is('scheduled_date', null)
      .eq('amount_paid', 0)
      .neq('status', 'paid')
      .limit(200),
  ]);

  type UnscheduledPayment = {
    source: 'travaux_payment' | 'achats_payment';
    payment_id: string;
    project_ref: string;
    client_name: string | null;
    partner: string;
    description: string | null;
    amount_mad: number;
  };
  const unscheduledPayments: UnscheduledPayment[] = [];
  for (const p of ((travauxPendingRes.data ?? []) as any[])) {
    const proj = p.project;
    if (!proj || proj.deleted_at || proj.status === 'perdu') continue;
    unscheduledPayments.push({
      source: 'travaux_payment',
      payment_id: p.id,
      project_ref: proj.reference,
      client_name: proj.client?.full_name ?? null,
      partner: p.artisan_name ?? 'Artisan',
      description: p.description,
      amount_mad: Number(p.amount_total ?? 0),
    });
  }
  for (const p of ((achatsPendingRes.data ?? []) as any[])) {
    const proj = p.project;
    if (!proj || proj.deleted_at || proj.status === 'perdu') continue;
    unscheduledPayments.push({
      source: 'achats_payment',
      payment_id: p.id,
      project_ref: proj.reference,
      client_name: proj.client?.full_name ?? null,
      partner: p.supplier_name ?? 'Fournisseur',
      description: p.description,
      amount_mad: Number(p.amount_total ?? 0),
    });
  }

  const totalUnscheduledRemaining = unscheduledLots.reduce((s, l) => s + l.remaining_mad, 0)
    + unscheduledPayments.reduce((s, p) => s + p.amount_mad, 0);
  const showMissingDatesBanner = unscheduledLots.length >= 1 || unscheduledPayments.length >= 1;

  // ─── 5) Flows typés pour le drawer (édition inline des dates + flag overdue) ──
  const flowsForDrawer: FlowItem[] = [
    ...allInflows.map((i: any) => ({
      source: 'honoraires_payment' as const,
      id: i.id,
      date: i.date,
      amount_mad: i.amount_mad,
      label: i.label,
      partner: null,
      kind: 'inflow' as const,
      editable: true,
      overdue: !!i.overdue,
    })),
    ...travauxOutflows.map((o: any) => ({
      source: 'travaux_payment' as const,
      id: o.id,
      date: o.date,
      amount_mad: o.amount_mad,
      label: o.label,
      partner: null,
      kind: 'outflow' as const,
      editable: true,
      overdue: !!o.overdue,
    })),
    ...achatsOutflows.map((o: any) => ({
      source: 'achats_payment' as const,
      id: o.id,
      date: o.date,
      amount_mad: o.amount_mad,
      label: o.label,
      partner: null,
      kind: 'outflow' as const,
      editable: true,
      overdue: !!o.overdue,
    })),
    ...servicesOutflows.map((o: any) => ({
      source: 'services_payment' as const,
      id: o.id,
      date: o.date,
      amount_mad: o.amount_mad,
      label: o.label,
      partner: null,
      kind: 'outflow' as const,
      editable: true,
      overdue: !!o.overdue,
    })),
  ];

  return (
    <div className="max-w-7xl space-y-6">
      <div>
        <Link
          href="/finance/tresorerie"
          className="inline-flex items-center gap-2 text-sm text-stoniz-gray-500 hover:text-stoniz-black mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour à la trésorerie
        </Link>
        <PageHeader
          title="Projection cashflow 30 / 60 / 90 jours"
          description="Simule l'évolution de ta trésorerie sur les 90 prochains jours à partir de tes échéances connues et de tes charges récurrentes moyennes."
        />
        {/* Onglets vue 30/60/90 vs mois par mois (CEO 2026-08-17d) */}
        <div className="mt-4 flex items-center gap-2 text-sm">
          <span className="px-3 py-1.5 rounded-md bg-stoniz-black text-white border border-stoniz-black">
            30 / 60 / 90 jours
          </span>
          <Link
            href="/finance/projection/mensuelle"
            className="px-3 py-1.5 rounded-md bg-white border border-stoniz-gray-300 hover:bg-stoniz-gray-50"
          >
            Mois par mois
          </Link>
        </div>
      </div>

      {/* Alerte si tension détectée */}
      {tensionPoints.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium mb-1">
                ⚠ Tension de trésorerie projetée le {new Date(tensionPoints[0].date).toLocaleDateString('fr-FR')}
              </div>
              <div className="text-xs text-red-800">
                Selon les hypothèses ci-dessous, ton solde groupe passerait sous 0 MAD à cette date.
                Tu as ~{Math.ceil((new Date(tensionPoints[0].date).getTime() - start.getTime()) / (1000 * 60 * 60 * 24))} jours pour agir :
                relancer des clients, étaler des paiements artisans, ou injecter du cash.
              </div>
            </div>
          </div>
        </div>
      )}

      {showMissingDatesBanner && (
        <MissingDatesBanner
          items={unscheduledLots}
          payments={unscheduledPayments}
          totalRemaining={totalUnscheduledRemaining}
          canEdit={canEdit}
        />
      )}

      {/* CEO 2026-06-18 B3 : alerte incohérence — lot 'a_commander' avec
          acompte daté. Normalement impossible (pas de prix connu = pas de date),
          c'est probablement une saisie à corriger. Exclus de la projection mais
          listés ici pour action manuelle. */}
      {achatsIncohérents.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-md p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium mb-1.5">
                ⚠ {achatsIncohérents.length} acompte(s) achats incohérents — exclus de la projection
              </div>
              <p className="text-xs mb-2">
                Ces acomptes ont une date prévue mais leur lot est encore en statut <strong>« à commander »</strong>
                (le produit n&apos;a pas encore été trouvé / le prix n&apos;est pas connu). Ils ne sont pas comptés
                dans la projection. Soit le statut du lot doit passer à <em>commande</em> / <em>livré</em>,
                soit l&apos;acompte est à supprimer.
              </p>
              <ul className="text-xs space-y-0.5">
                {achatsIncohérents.slice(0, 10).map((p: any) => (
                  <li key={p.id}>
                    • {p.supplier_name ?? 'Fournisseur'} ·{' '}
                    {p.project?.reference ?? '—'} ·{' '}
                    {Math.round(Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0)).toLocaleString('fr-FR')} MAD
                    · prévu {p.scheduled_date}
                  </li>
                ))}
                {achatsIncohérents.length > 10 && (
                  <li className="italic">… et {achatsIncohérents.length - 10} autre(s)</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Bandeau pédagogique */}
      <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-md p-4 text-xs text-stoniz-gray-700">
        <strong>Comment c'est calculé :</strong>
        {' '}solde actuel ({fmtMadCompact(startingBalance)})
        {' + '}<strong className="text-emerald-700">entrées</strong> (échéances honoraires Stoniz `due_date` non encore payées)
        {' − '}<strong className="text-red-700">sorties scheduled</strong> (acomptes artisans/fournisseurs avec `scheduled_date` renseignée)
        {' − '}<strong className="text-amber-700">charges récurrentes</strong> (~{fmtMadCompact(totalRecurringPerMonth)}/mois, moyenne des 3 derniers mois sur DGI+CNSS+Maroc Telecom+frais bancaires+salaires détectés).
        <br />
        <em>Note : les encaissements travaux/achats clients marqués &laquo;&nbsp;À encaisser&nbsp;&raquo; (avec une date d&apos;échéance) sont inclus dans la projection depuis 2026-06-08. Pense à les saisir côté projet pour qu&apos;ils apparaissent ici.</em>
      </div>

      {/* Solde projeté à J+30 / J+60 / J+90 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-stoniz-gray-500" />
            <div className="text-xs uppercase text-stoniz-gray-500">Aujourd'hui</div>
          </div>
          <div className={`text-2xl font-display ${startingBalance < 0 ? 'text-red-700' : ''}`}>
            {fmtMadCompact(startingBalance)}
          </div>
          <div className="text-xs text-stoniz-gray-500 mt-1">Solde groupe</div>
        </Card>
        {[
          { d: d30, p: p30, label: 'À J+30' },
          { d: d60, p: p60, label: 'À J+60' },
          { d: d90, p: p90, label: 'À J+90' },
        ].map(({ d, p, label }) => (
          <Card key={label}>
            <div className="flex items-center gap-2 mb-1">
              <Calendar className="w-4 h-4 text-stoniz-gray-500" />
              <div className="text-xs uppercase text-stoniz-gray-500">{label} · {d.toLocaleDateString('fr-FR')}</div>
            </div>
            <div className={`text-2xl font-display ${p.ending < 0 ? 'text-red-700' : p.ending < startingBalance ? 'text-amber-700' : 'text-emerald-700'}`}>
              {fmtMadCompact(p.ending)}
            </div>
            <div className="text-[10px] text-stoniz-gray-500 mt-1 space-y-0.5">
              <div className="text-emerald-700">+ {fmtMadCompact(p.inflows)} <span className="text-stoniz-gray-400">honoraires</span></div>
              <div className="text-red-700">− {fmtMadCompact(p.scheduled)} <span className="text-stoniz-gray-400">acomptes scheduled</span></div>
              <div className="text-amber-700">− {fmtMadCompact(p.recurringEstimate)} <span className="text-stoniz-gray-400">charges récurrentes</span></div>
            </div>
          </Card>
        ))}
      </div>

      {/* CEO 2026-09-02 : bloc synthétique dédié aux charges récurrentes
          (auparavant visible uniquement dans le drawer). Rend la ventilation
          par catégorie + top salariés directement lisible. */}
      {(totalRecurringPerMonth > 0 || recurringPersons.length > 0) && (
        <div>
          <h2 className="text-lg font-display mb-2">Charges récurrentes prévisionnelles</h2>
          <p className="text-xs text-stoniz-gray-500 mb-3">
            Moyenne des 3 derniers mois (DGI, CNSS, télécom, frais bancaires, salariés/prestataires récurrents détectés). Ces montants sont déjà déduits des KPI J+30/60/90 ci-dessus.
          </p>
          <Card>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 pb-4 border-b">
              <div>
                <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Par mois</div>
                <div className="text-xl font-display text-amber-700">
                  {fmtMadCompact(totalRecurringPerMonth)}
                </div>
              </div>
              {[30, 60, 90].map(days => (
                <div key={days}>
                  <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Impact J+{days}</div>
                  <div className="text-xl font-display text-amber-700">
                    − {fmtMadCompact(totalRecurringPerMonth * (days / 30))}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase text-stoniz-gray-500 mb-2">Par catégorie</div>
                <ul className="space-y-1">
                  {recurringDetail.filter(d => !d.beneficiaries).map(d => (
                    <li key={d.category} className="flex justify-between border-b border-stoniz-gray-100 py-1">
                      <span>{d.category}</span>
                      <span className="font-medium">{fmtMadCompact(d.per_month)}/mois</span>
                    </li>
                  ))}
                  {recurringDetail.filter(d => !d.beneficiaries).length === 0 && (
                    <li className="text-xs text-stoniz-gray-500 italic">Aucune charge institutionnelle détectée sur 3 mois</li>
                  )}
                </ul>
              </div>

              <div>
                <div className="text-xs uppercase text-stoniz-gray-500 mb-2">
                  Salariés / prestataires récurrents ({recurringPersons.length})
                </div>
                {recurringPersons.length === 0 ? (
                  <div className="text-xs text-stoniz-gray-500 italic">
                    Aucun paiement récurrent à une personne physique détecté sur 3 mois.
                  </div>
                ) : (
                  <ul className="space-y-1 max-h-48 overflow-y-auto">
                    {recurringPersons.slice(0, 10).map(p => (
                      <li key={p.name} className="flex justify-between border-b border-stoniz-gray-100 py-1">
                        <span className="truncate mr-2" title={p.name}>{p.name}</span>
                        <span className="text-xs text-stoniz-gray-600 whitespace-nowrap">
                          {fmtMadCompact(p.total / 3)}/mois · {p.count}×
                        </span>
                      </li>
                    ))}
                    {recurringPersons.length > 10 && (
                      <li className="text-xs text-stoniz-gray-500 italic pt-1">
                        + {recurringPersons.length - 10} autre(s) — voir le drawer pour la liste complète
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Drawer interactif : clic pour voir le détail + éditer les dates */}
      <div>
        <h2 className="text-lg font-display mb-2">Détail des flux prévus</h2>
        <p className="text-xs text-stoniz-gray-500 mb-3">
          Clique sur une carte pour voir le détail.
          {canEdit && ' Tu peux modifier les dates prévues directement dans le drawer pour simuler un scénario (décaler un paiement, anticiper un encaissement…).'}
        </p>
        <ProjectionDetailsDrawer
          flows={flowsForDrawer}
          recurring={recurringDetail}
          canEdit={canEdit}
        />
      </div>

      {/* Note méthodologique */}
      <div className="bg-blue-50 border border-blue-200 rounded p-4 text-xs text-blue-900">
        <strong>Pour fiabiliser cette projection :</strong>
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          <li>Renseigne les <strong>scheduled_date</strong> des acomptes artisans/fournisseurs sur tes fiches projets actifs</li>
          <li>Garde tes <strong>honoraires Stoniz</strong> à jour (échéances client à venir)</li>
          <li>Importe régulièrement tes relevés bancaires pour que la moyenne des charges récurrentes reste pertinente</li>
        </ul>
      </div>
    </div>
  );
}
