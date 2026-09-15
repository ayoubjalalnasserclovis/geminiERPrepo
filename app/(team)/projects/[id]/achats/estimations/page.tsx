import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid, DashboardSection } from '@/components/dashboard/kpi-card';
import { EstimationsManager } from '@/components/achats/estimations-manager';
import { FinanceSectionAuditTimeline } from '@/components/finance/finance-section-audit-timeline';
import { formatMad } from '@/lib/utils/format';
import { requireRole } from '@/lib/auth/require';

/**
 * Page Estimations achats (CEO 2026-08-19, session B roadmap évolutions).
 *
 * CLOISONNEMENT (cahier des charges) : cette page lit UNIQUEMENT la table
 * achats_estimations (+ les lots réels convertis, pour l'écart estimé vs
 * réel). Ses KPI sont 100% prévisionnels. Réciproquement, AUCUN dashboard ni
 * calcul du suivi réel ne lit achats_estimations — le prévisionnel ne peut
 * pas polluer le réel, par construction.
 */
export default async function ProjectEstimationsPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo', 'chef_projet', 'developer', 'finance', 'assistante', 'achats']);
  const supabase = createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, reference, property_id, achats_budget_mad, client:clients(full_name)')
    .eq('id', params.id)
    .single();
  if (!project) notFound();

  const [estimationsRes, suppliersRes, unitsRes] = await Promise.all([
    supabase.from('achats_estimations').select('*')
      .eq('project_id', params.id).is('deleted_at', null).order('numero'),
    supabase.from('artisans').select('id, name')
      .eq('status', 'actif').is('deleted_at', null).order('name'),
    project.property_id
      ? supabase.from('propria_units')
          .select('id, code, order_index')
          .eq('property_id', project.property_id)
          .is('deleted_at', null)
          .eq('is_active', true)
          .order('order_index')
      : Promise.resolve({ data: [] } as any),
  ]);

  const estimations = (estimationsRes.data ?? []) as any[];
  const suppliers = (suppliersRes.data ?? []) as any[];
  const units = ((unitsRes as any).data ?? []) as any[];

  // Lots réels liés aux lignes converties — pour l'écart estimé vs réel.
  const convertedLotIds = estimations
    .filter((e) => e.converted_lot_id)
    .map((e) => e.converted_lot_id as string);
  const { data: convertedLots } = convertedLotIds.length > 0
    ? await supabase.from('achats_lots')
        .select('id, numero, budget_estimate_mad, devis_fournisseur_mad, status, deleted_at')
        .in('id', convertedLotIds)
    : { data: [] as any[] };
  const lotById = new Map((convertedLots ?? []).map((l: any) => [l.id, l]));

  // ─── KPIs 100% prévisionnels ─────────────────────────────────────────────
  const num = (v: any) => (v == null ? 0 : Number(v));
  const actives = estimations.filter((e) => e.status === 'estime');
  const converties = estimations.filter((e) => e.status === 'converti');
  const abandonnees = estimations.filter((e) => e.status === 'abandonne');

  const totalEstimeActif = actives.reduce((s, e) => s + num(e.prix_estime_mad), 0);
  const totalConverti = converties.reduce((s, e) => s + num(e.prix_estime_mad), 0);
  const totalEngage = totalEstimeActif + totalConverti; // projection hors abandonnées
  const forfait = num(project.achats_budget_mad);
  const margeVsForfait = forfait > 0 ? forfait - totalEngage : null;

  // Écart estimé vs réel : uniquement les converties dont le lot réel a un
  // devis fournisseur signé (le coût réel dû). Positif = le réel coûte plus
  // cher que l'estimation (dérive → orange, jamais rouge : pas une perte
  // réelle, canon UX couleurs).
  let ecartReel = 0;
  let nbComparables = 0;
  for (const e of converties) {
    const lot = e.converted_lot_id ? lotById.get(e.converted_lot_id) : null;
    if (lot && lot.devis_fournisseur_mad != null && e.prix_estime_mad != null) {
      ecartReel += num(lot.devis_fournisseur_mad) - num(e.prix_estime_mad);
      nbComparables += 1;
    }
  }

  return (
    <div className="space-y-6">
      <Link href={`/projects/${params.id}/achats`}
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" />
        Retour au suivi achats {project.reference}
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Estimations achats"
          description={`${project.reference} · ${(project as any).client?.full_name ?? ''} — prévisionnel cloisonné, n'entre dans aucun KPI du suivi réel`}
        />
      </div>

      <DashboardSection title="Synthèse prévisionnelle (aucun impact sur le suivi réel)">
        <KpiGrid>
          <KpiCard label="Total estimé (à confirmer)" value={formatMad(totalEstimeActif)}
            hint={`${actives.length} ligne(s) au statut Estimé`} />
          <KpiCard label="Converti en réel" value={formatMad(totalConverti)}
            hint={`${converties.length} ligne(s) devenues des lots réels`}
            variant={converties.length > 0 ? 'success' : 'default'} />
          <KpiCard label="Projection totale vs forfait achats"
            value={forfait > 0 ? `${formatMad(totalEngage)} / ${formatMad(forfait)}` : formatMad(totalEngage)}
            hint={forfait > 0
              ? (margeVsForfait! >= 0
                  ? `Marge restante ${formatMad(margeVsForfait!)} sur le forfait`
                  : `⚠ Dépassement du forfait de ${formatMad(-margeVsForfait!)}`)
              : 'Forfait achats non renseigné dans Paramètres achats'}
            variant={forfait > 0 && margeVsForfait! < 0 ? 'warning' : 'default'} />
          <KpiCard label="Écart estimé vs réel" value={`${ecartReel >= 0 ? '+' : '−'}${formatMad(Math.abs(ecartReel))}`}
            hint={nbComparables > 0
              ? `Sur ${nbComparables} ligne(s) converties avec devis fournisseur signé. Positif = le réel coûte plus cher.`
              : 'Aucune ligne convertie n\'a encore de devis fournisseur signé'}
            variant={nbComparables === 0 ? 'default' : ecartReel > 0 ? 'warning' : 'success'} />
        </KpiGrid>
      </DashboardSection>

      <EstimationsManager
        projectId={project.id}
        estimations={estimations.map((e) => ({
          ...e,
          converted_lot: e.converted_lot_id ? (lotById.get(e.converted_lot_id) ?? null) : null,
        }))}
        suppliers={suppliers}
        units={units}
        abandonneesCount={abandonnees.length}
      />

      <FinanceSectionAuditTimeline
        tables={['achats_estimations']}
        recordIds={estimations.map((e) => e.id)}
        title="Historique des estimations"
      />
    </div>
  );
}
