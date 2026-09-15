import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { StatusSelectInline } from '@/components/properties/status-select-inline';
import { PropertyMap } from '@/components/maps/property-map';
import { calculateKPIs } from '@/lib/finance/property-calc';
import { requireRole } from '@/lib/auth/require';
import { PropertyRowDeleteButton } from './row-delete-button';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, range, period, search, escapeIlike, sort, type SP } from '@/lib/list-filters/parse';

const STATUS_OPTIONS = [
  { v: 'sourcing', label: 'Sourcing' },
  { v: 'disponible', label: 'Disponible' },
  { v: 'propose', label: 'Proposé' },
  { v: 'offre', label: 'Offre' },
  { v: 'vendu', label: 'Vendu' },
  { v: 'perdu', label: 'Perdu' },
  { v: 'a_verifier', label: 'À vérifier' },
];
const TYPE_OPTIONS = ['Appartement', 'Riad', 'Villa', 'Terrain'].map(v => ({ v, label: v }));
const SOURCING_TYPE_OPTIONS = [
  { v: 'partenaire', label: '🤝 Partenaire' },
  { v: 'direct', label: '🎯 Direct' },
];
const PUBLISHED_OPTIONS = [
  { v: 'true', label: 'Publié' },
  { v: 'false', label: 'Brouillon' },
];

const SORTABLE_FIELDS: Record<string, string> = {
  name: 'name',
  price: 'price',
  gross_yield: 'gross_yield',
  superficie: 'superficie',
  sourcing_date: 'sourcing_date',
  evaluation: 'evaluation',
};

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const user = await requireRole(['ceo','chef_projet','developer','sourcing','commercial','finance','marketing','assistante']);
  const canDelete = user.role === 'ceo' || user.role === 'chef_projet' || user.role === 'sourcing';
  const supabase = createClient();
  const view = single(searchParams, 'view') === 'map' ? 'map' : 'table';

  // ─── Parse filtres ─────────────────────────────────────────────────────
  const q = search(searchParams);
  const statuses = multi(searchParams, 'status');
  const quartiers = multi(searchParams, 'quartier');
  const types = multi(searchParams, 'type');
  const sourcingType = single(searchParams, 'sourcing_type');
  const partnerId = single(searchParams, 'partner_id');
  const chefId = single(searchParams, 'chef');
  const publishedRaw = single(searchParams, 'is_published');
  const priceR = range(searchParams, 'price');
  const yieldR = range(searchParams, 'yield');
  const surfaceR = range(searchParams, 'surface');
  const sourcingP = period(searchParams, 'sourcing_period');
  const { field: sortField, dir: sortDir } = sort(searchParams, 'created_at', 'desc');
  const dbSortField = SORTABLE_FIELDS[sortField] ?? 'created_at';

  // ─── Options dynamiques (quartiers, partenaires, chefs) ────────────────
  const [quartiersListRes, partnersListRes, chefsListRes] = await Promise.all([
    supabase.from('properties').select('quartier').is('deleted_at', null).not('quartier', 'is', null),
    supabase.from('partners').select('id, agency_name').is('deleted_at', null).eq('status', 'actif').order('agency_name'),
    supabase.from('profiles').select('id, full_name').eq('role', 'chef_projet').eq('is_active', true).order('full_name'),
  ]);
  const quartierOptions = Array.from(new Set((quartiersListRes.data ?? []).map((r: any) => r.quartier).filter(Boolean)))
    .sort().map(q => ({ v: q as string, label: q as string }));
  const partnerOptions = (partnersListRes.data ?? []).map((p: any) => ({ v: p.id, label: p.agency_name }));
  const chefOptions = (chefsListRes.data ?? []).map((c: any) => ({ v: c.id, label: c.full_name }));

  // ─── Query principale ──────────────────────────────────────────────────
  let qb = supabase.from('properties_enriched')
    .select(`
      id, name, type, quartier, status, evaluation, sourcing_date, sourcing_type, partner_id, assigned_chasseur,
      price, agency_fees, notary_fees, travaux_budget_estimate, estimated_rent, nb_suites,
      superficie, terrasse_m2, badge_label, latitude, longitude, gross_yield, is_published, created_at
    `, { count: 'exact' });

  if (q) {
    const esc = escapeIlike(q);
    qb = qb.or(`name.ilike.%${esc}%,quartier.ilike.%${esc}%,address.ilike.%${esc}%`);
  }
  // INVARIANT (CEO 2026-06-18) : `properties.status` est typé en enum PG
  // `property_status`. PostgREST gère normalement .in() avec un enum, MAIS
  // si le cache schema PostgREST se désynchronise après une migration sur
  // la table/vue, le filtre peut être ignoré silencieusement → la liste
  // retourne tous les biens (bug remonté CEO 2026-06-18 : ?status=disponible
  // affichait aussi sourcing/vendu).
  // Si le bug réapparaît, exécuter : NOTIFY pgrst, 'reload schema';
  // depuis Supabase Studio. Voir lib/properties/diagnostic-status-filter.ts
  if (statuses.length) qb = qb.in('status', statuses);
  if (quartiers.length) qb = qb.in('quartier', quartiers);
  if (types.length) qb = qb.in('type', types);
  if (sourcingType) qb = qb.eq('sourcing_type', sourcingType);
  if (partnerId) qb = qb.eq('partner_id', partnerId);
  if (chefId) qb = qb.eq('assigned_chasseur', chefId);
  if (publishedRaw === 'true') qb = qb.eq('is_published', true);
  else if (publishedRaw === 'false') qb = qb.eq('is_published', false);
  if (priceR.min != null) qb = qb.gte('price', priceR.min);
  if (priceR.max != null) qb = qb.lte('price', priceR.max);
  if (yieldR.min != null) qb = qb.gte('gross_yield', yieldR.min);
  if (yieldR.max != null) qb = qb.lte('gross_yield', yieldR.max);
  if (surfaceR.min != null) qb = qb.gte('superficie', surfaceR.min);
  if (surfaceR.max != null) qb = qb.lte('superficie', surfaceR.max);
  if (sourcingP.from) qb = qb.gte('sourcing_date', sourcingP.from);

  qb = qb.order(dbSortField, { ascending: sortDir === 'asc' });
  qb = qb.limit(view === 'map' ? 500 : 100);

  const { data: properties, count } = await qb;

  // ─── Total non filtré pour le compteur ────────────────────────────────
  const { count: totalCount } = await supabase
    .from('properties').select('id', { count: 'exact', head: true }).is('deleted_at', null);

  // ─── Projet / client lié à chaque bien ────────────────────────────────
  const propertyIds = (properties ?? []).map((p: any) => p.id);
  const linkByProperty = new Map<string, { id: string; reference: string; client: string | null }>();
  if (propertyIds.length > 0) {
    const { data: linkedProjects } = await supabase
      .from('projects')
      .select('id, reference, property_id, status, client:clients(full_name)')
      .in('property_id', propertyIds)
      .is('deleted_at', null)
      .neq('status', 'perdu');
    (linkedProjects ?? []).forEach((pr: any) => {
      if (pr.property_id) {
        linkByProperty.set(pr.property_id, {
          id: pr.id, reference: pr.reference, client: pr.client?.full_name ?? null,
        });
      }
    });
  }

  // ─── Stats publication ────────────────────────────────────────────────
  const { data: pubRows } = await supabase
    .from('properties_publication_status')
    .select('is_published, step2_sourcing_done, step3_media_done');
  const incomplets = (pubRows ?? []).filter((p: any) => !p.is_published);
  const noSourcing = incomplets.filter((p: any) => !p.step2_sourcing_done).length;
  const noMedia = incomplets.filter((p: any) => p.step2_sourcing_done && !p.step3_media_done).length;
  const readyToPublish = incomplets.filter((p: any) => p.step2_sourcing_done && p.step3_media_done).length;
  const hasDrafts = incomplets.length > 0;

  // ─── Définitions filtres pour la toolbar ──────────────────────────────
  const filters: FilterDef[] = [
    { kind: 'multi',  key: 'status',          label: 'Statut',           options: STATUS_OPTIONS },
    { kind: 'multi',  key: 'quartier',        label: 'Quartier',         options: quartierOptions },
    { kind: 'multi',  key: 'type',            label: 'Type',             options: TYPE_OPTIONS },
    { kind: 'single', key: 'sourcing_type',   label: 'Canal sourcing',   options: SOURCING_TYPE_OPTIONS },
    { kind: 'single', key: 'partner_id',      label: 'Partenaire',       options: partnerOptions },
    { kind: 'single', key: 'chef',            label: 'Chef',             options: chefOptions },
    { kind: 'range',  key: 'price',           label: 'Prix',             unit: '€', step: 1000 },
    { kind: 'range',  key: 'yield',           label: 'Rendement',        unit: '%', step: 0.1 },
    { kind: 'range',  key: 'surface',         label: 'Surface',          unit: 'm²', step: 1 },
    { kind: 'period', key: 'sourcing_period', label: 'Période sourcing' },
    { kind: 'single', key: 'is_published',    label: 'Publication',      options: PUBLISHED_OPTIONS },
  ];

  return (
    <div>
      <PageHeader
        title="Biens"
        description="Base des biens sourcés"
        action={
          <div className="flex gap-2 flex-wrap">
            <Link href="/properties/incomplets"><Button variant="ghost">📋 Brouillons</Button></Link>
            <Link href="/properties/import"><Button variant="secondary">📤 Importer CSV</Button></Link>
            <Link href="/properties/new"><Button>+ Nouveau bien</Button></Link>
          </div>
        }
      />

      {hasDrafts && (
        <Link href="/properties/incomplets" className="block mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className={`border rounded-md p-4 transition-colors ${noSourcing > 0 ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'bg-white border-grey-line opacity-60'}`}>
              <p className="text-xs uppercase tracking-wider text-red-700 mb-1">Sourcing manquant</p>
              <p className="font-display text-2xl text-red-900">{noSourcing}</p>
              <p className="text-xs text-red-700 mt-1">À assigner à un partenaire ou un chasseur</p>
            </div>
            <div className={`border rounded-md p-4 transition-colors ${noMedia > 0 ? 'bg-orange-50 border-orange-200 hover:bg-orange-100' : 'bg-white border-grey-line opacity-60'}`}>
              <p className="text-xs uppercase tracking-wider text-orange-700 mb-1">Sans média</p>
              <p className="font-display text-2xl text-orange-900">{noMedia}</p>
              <p className="text-xs text-orange-700 mt-1">À compléter avec photos / vidéo</p>
            </div>
            <div className={`border rounded-md p-4 transition-colors ${readyToPublish > 0 ? 'bg-green-50 border-green-200 hover:bg-green-100' : 'bg-white border-grey-line opacity-60'}`}>
              <p className="text-xs uppercase tracking-wider text-green-700 mb-1">Prêts à publier</p>
              <p className="font-display text-2xl text-green-900">{readyToPublish}</p>
              <p className="text-xs text-green-700 mt-1">Toutes les étapes complétées</p>
            </div>
          </div>
        </Link>
      )}

      <ListToolbar
        moduleKey="properties"
        filters={filters}
        searchHint="Rechercher (nom, quartier, adresse)…   ⌘K"
        count={{ filtered: count ?? 0, total: totalCount ?? 0 }}
      />

      <div className="flex justify-end mb-3">
        <div className="flex gap-1 border rounded-md p-0.5 bg-white">
          <Link
            href={`/properties?${new URLSearchParams({ ...flattenSP(searchParams), view: 'table' }).toString()}`}
            className={`text-sm px-3 py-1 rounded ${view === 'table' ? 'bg-stoniz-black text-white' : 'text-stoniz-gray-600'}`}>
            📋 Tableau
          </Link>
          <Link
            href={`/properties?${new URLSearchParams({ ...flattenSP(searchParams), view: 'map' }).toString()}`}
            className={`text-sm px-3 py-1 rounded ${view === 'map' ? 'bg-stoniz-black text-white' : 'text-stoniz-gray-600'}`}>
            🗺 Carte
          </Link>
        </div>
      </div>

      {!properties || properties.length === 0 ? (
        <EmptyState title="Aucun bien" action={<Link href="/properties/new"><Button>+ Créer</Button></Link>} />
      ) : view === 'map' ? (
        <PropertyMap
          height={600}
          properties={(properties as any[]).map(p => ({
            id: p.id, name: p.name, status: p.status, quartier: p.quartier,
            price: p.price, latitude: p.latitude, longitude: p.longitude,
            badge_label: p.badge_label, evaluation: p.evaluation,
            detailHref: `/properties/${p.id}`,
          }))}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <SortableHeader field="name">Nom</SortableHeader>
              <TH>Quartier</TH>
              <TH>Highlight</TH>
              <SortableHeader field="superficie" className="text-right">Surface</SortableHeader>
              <SortableHeader field="price" className="text-right">Prix bien</SortableHeader>
              <TH className="text-right">Coût total projet</TH>
              <TH className="text-right">Loyer / mois</TH>
              <SortableHeader field="gross_yield" className="text-right">Rendement brut</SortableHeader>
              <TH>Statut</TH>
              <TH>Projet / Client</TH>
              <SortableHeader field="evaluation">Évaluation</SortableHeader>
              <SortableHeader field="sourcing_date">Sourcé le</SortableHeader>
              <TH></TH>
            </TR>
          </THead>
          <TBody>
            {properties.map((p: any) => {
              const kpis = calculateKPIs({
                price: p.price, superficie: p.superficie, nb_suites: p.nb_suites,
                agency_fees: p.agency_fees, notary_fees: p.notary_fees,
                travaux_budget_estimate: p.travaux_budget_estimate,
                estimated_rent: p.estimated_rent,
              });
              return (
                <TR key={p.id}>
                  <TD className="font-medium">{p.name}</TD>
                  <TD>{p.quartier ?? '—'}</TD>
                  <TD>
                    {p.badge_label
                      ? <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-yellow text-stoniz-black">{p.badge_label}</span>
                      : <span className="text-stoniz-gray-400">—</span>}
                  </TD>
                  <TD className="text-right text-sm whitespace-nowrap">
                    {p.superficie ? `${p.superficie} m²` : '—'}
                    {p.terrasse_m2 ? <span className="text-stoniz-gray-500"> + {p.terrasse_m2} m² terrasse</span> : null}
                  </TD>
                  <TD className="text-right"><Money amount={p.price} /></TD>
                  <TD className="text-right font-medium">
                    {p.price ? <Money amount={kpis.cout_total_projet} /> : '—'}
                  </TD>
                  <TD className="text-right">
                    {p.estimated_rent ? <Money amount={p.estimated_rent} /> : '—'}
                  </TD>
                  <TD className="text-right">
                    {p.gross_yield != null ? `${p.gross_yield}%` : '—'}
                  </TD>
                  <TD><StatusSelectInline id={p.id} value={p.status} /></TD>
                  <TD className="text-sm whitespace-nowrap">
                    {linkByProperty.has(p.id) ? (
                      <Link href={`/projects/${linkByProperty.get(p.id)!.id}`} className="hover:underline">
                        <span className="block font-medium">{linkByProperty.get(p.id)!.client ?? '—'}</span>
                        <span className="block text-xs text-stoniz-gray-500">{linkByProperty.get(p.id)!.reference}</span>
                      </Link>
                    ) : (
                      <span className="text-stoniz-gray-400">—</span>
                    )}
                  </TD>
                  <TD>{p.evaluation ? '⭐'.repeat(p.evaluation) : '—'}</TD>
                  <TD className="text-xs text-stoniz-gray-600 whitespace-nowrap">
                    {p.sourcing_date ?? '—'}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1 justify-end">
                      <Link href={`/properties/${p.id}`} className="underline text-sm">Voir</Link>
                      {canDelete && (
                        <PropertyRowDeleteButton propertyId={p.id} propertyName={p.name} />
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}

/** Aplatit searchParams pour les liens (filtre les arrays en gardant 1 valeur) */
function flattenSP(sp: SP): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    out[k] = Array.isArray(v) ? (v[0] ?? '') : v;
  }
  return out;
}
