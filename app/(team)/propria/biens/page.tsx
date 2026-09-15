import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { Building2, ExternalLink, Wifi } from 'lucide-react';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, period, search, sort, type SP } from '@/lib/list-filters/parse';

/** Une suite est en alerte clés si nb_keys ≤ 2 ou non renseigné (CEO 2026-06-09). */
function hasKeyAlert(unit: any): boolean {
  if (unit?.propria_nb_keys == null) return true;
  return Number(unit.propria_nb_keys) <= 2;
}

const ACTIVATION_OPTIONS = [
  { v: 'active',   label: 'Actif sous gestion' },
  { v: 'inactive', label: 'Activation inactive' },
];

const SYNDIC_OPTIONS = [
  { v: 'yes', label: 'Oui' },
  { v: 'no',  label: 'Non' },
];

const SORT_FIELDS: Record<string, string> = {
  name:                'name',
  propria_managed_at:  'propria_managed_at',
};

export default async function PropriaLotsPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  // Compat anciens liens (completion/alerte) maintenus
  const completionFilter = single(searchParams, 'completion') === 'incomplete' ? 'incomplete' : null;
  const alerteFilter = single(searchParams, 'alerte') === 'cles_faibles' ? 'cles_faibles' : null;
  const legacyFilter = completionFilter ?? alerteFilter ?? 'all';

  // ─── Parse filtres toolbar ─────────────────────────────────────────────
  const q = search(searchParams);
  const quartiers = multi(searchParams, 'quartier');
  const activation = single(searchParams, 'activation');
  const syndic = single(searchParams, 'syndic_to_pay');
  const mandateP = period(searchParams, 'mandate_period');
  const { field: sortField, dir: sortDir } = sort(searchParams, 'name', 'asc');
  const dbSortField = SORT_FIELDS[sortField] ?? 'name';

  // Source de vérité = le LOT (propria_units). Chaque lot = un listing locatif.
  // Construction de la query property avec les filtres serveur applicables au bien
  let propsQuery = supabase
    .from('properties')
    .select(`
      id, name, propria_owner_name, quartier, propria_internal_code,
      propria_managed_at, propria_syndic_to_pay,
      projects:projects!projects_property_id_fkey(id)
    `)
    .is('deleted_at', null);

  if (activation === 'active') {
    propsQuery = propsQuery.not('propria_managed_at', 'is', null);
  } else if (activation === 'inactive') {
    propsQuery = propsQuery.is('propria_managed_at', null);
  } else {
    // Par défaut, on garde le comportement legacy : seulement les biens sous gestion
    propsQuery = propsQuery.not('propria_managed_at', 'is', null);
  }

  if (quartiers.length) propsQuery = propsQuery.in('quartier', quartiers);
  if (syndic === 'yes') propsQuery = propsQuery.eq('propria_syndic_to_pay', true);
  else if (syndic === 'no') propsQuery = propsQuery.or('propria_syndic_to_pay.eq.false,propria_syndic_to_pay.is.null');
  if (mandateP.from) propsQuery = propsQuery.gte('propria_managed_at', mandateP.from);

  const [unitsRes, propsRes, completenessRes, quartierListRes] = await Promise.all([
    supabase
      .from('propria_units')
      .select(`
        id, code, property_id, order_index,
        propria_capacity_voyageurs, propria_nb_chambres,
        propria_base_price_per_night, propria_nb_keys,
        propria_airbnb_url, propria_booking_url, propria_wifi_ssid
      `)
      .is('deleted_at', null)
      .eq('is_active', true)
      .order(dbSortField === 'name' ? 'code' : 'code', { ascending: sortDir === 'asc' }),
    propsQuery,
    supabase
      .from('v_property_completeness')
      .select('property_id, filled_count, total_count, completion_pct, is_complete'),
    // Options dynamiques quartiers
    supabase
      .from('properties')
      .select('quartier')
      .not('propria_managed_at', 'is', null)
      .is('deleted_at', null)
      .not('quartier', 'is', null),
  ]);

  const propsMap = new Map((propsRes.data ?? []).map((p: any) => [p.id, p]));
  const completenessMap = new Map((completenessRes.data ?? []).map((r: any) => [r.property_id, r]));

  // On ne garde que les lots dont le bien correspond aux filtres serveur
  let allLots = (unitsRes.data ?? [])
    .filter((u: any) => propsMap.has(u.property_id))
    .map((u: any) => ({ ...u, property: propsMap.get(u.property_id) as any }));

  // Recherche libre (sur lot.code, property.name, quartier, owner)
  if (q) {
    const needle = q.toLowerCase();
    allLots = allLots.filter((l: any) => {
      const code = (l.code ?? '').toLowerCase();
      const name = (l.property?.name ?? '').toLowerCase();
      const quartier = (l.property?.quartier ?? '').toLowerCase();
      const owner = (l.property?.propria_owner_name ?? '').toLowerCase();
      return code.includes(needle) || name.includes(needle) || quartier.includes(needle) || owner.includes(needle);
    });
  }

  // Tri secondaire en mémoire (par name du bien si demandé)
  if (sortField === 'name') {
    allLots.sort((a: any, b: any) => {
      const an = String(a.property?.name ?? '').toLowerCase();
      const bn = String(b.property?.name ?? '').toLowerCase();
      const cmp = an.localeCompare(bn);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  } else if (sortField === 'propria_managed_at') {
    allLots.sort((a: any, b: any) => {
      const av = a.property?.propria_managed_at ?? '';
      const bv = b.property?.propria_managed_at ?? '';
      const cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  const totalCount = allLots.length;
  const incompleteCount = allLots.filter((l: any) => {
    const c = completenessMap.get(l.property_id) as any;
    return c && !c.is_complete;
  }).length;
  const keyAlertCount = allLots.filter(hasKeyAlert).length;

  let lots = allLots;
  if (legacyFilter === 'incomplete') {
    lots = allLots.filter((l: any) => {
      const c = completenessMap.get(l.property_id) as any;
      return c && !c.is_complete;
    });
    lots.sort((a: any, b: any) => {
      const ca = (completenessMap.get(a.property_id) as any)?.completion_pct ?? 0;
      const cb = (completenessMap.get(b.property_id) as any)?.completion_pct ?? 0;
      if (ca !== cb) return ca - cb;
      return String(a.code ?? '').localeCompare(String(b.code ?? ''));
    });
  } else if (legacyFilter === 'cles_faibles') {
    lots = allLots.filter(hasKeyAlert);
    // Tri : NULL d'abord (à vérifier en priorité), puis 1 clé, puis 2 clés
    lots.sort((a: any, b: any) => {
      const ka = a.propria_nb_keys == null ? -1 : Number(a.propria_nb_keys);
      const kb = b.propria_nb_keys == null ? -1 : Number(b.propria_nb_keys);
      if (ka !== kb) return ka - kb;
      return String(a.code ?? '').localeCompare(String(b.code ?? ''));
    });
  }

  // Options quartiers (toujours sur l'univers complet sous gestion, pour ne pas
  // disparaître quand on filtre).
  const quartierOptions = Array.from(
    new Set(((quartierListRes.data ?? []) as any[]).map(r => r.quartier).filter(Boolean))
  ).sort().map(qq => ({ v: qq as string, label: qq as string }));

  const filters: FilterDef[] = [
    { kind: 'multi',  key: 'quartier',       label: 'Quartier',         options: quartierOptions },
    { kind: 'single', key: 'activation',     label: 'Activation Propria', options: ACTIVATION_OPTIONS },
    { kind: 'single', key: 'syndic_to_pay',  label: 'Syndic à payer',   options: SYNDIC_OPTIONS },
    { kind: 'period', key: 'mandate_period', label: 'Début mandat' },
  ];

  // Helper pour construire URL préservant tous les params sauf ceux passés
  function urlWithFlag(name: string, value: string | null): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v == null) continue;
      if (k === 'completion' || k === 'alerte') continue;
      params.set(k, Array.isArray(v) ? (v[0] ?? '') : v);
    }
    if (value) params.set(name, value);
    const s = params.toString();
    return s ? `/propria/biens?${s}` : '/propria/biens';
  }

  return (
    <div className="max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Lots gérés
          </div>
          <h1 className="text-2xl md:text-3xl font-display">Lots gérés ({lots.length})</h1>
          <p className="text-sm text-stoniz-gray-600 mt-1">
            Chaque lot = un listing locatif distinct (son prix, ses annonces). Un bien peut en regrouper plusieurs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/propria/biens/new"
            className="border border-stoniz-gray-300 px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-50"
          >
            + Bien externe
          </Link>
          <Link
            href="/propria/biens/activate"
            className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800"
          >
            🏠 Activer depuis un projet
          </Link>
        </div>
      </div>

      {/* Bandeau d'alerte clés faibles — cliquable */}
      {keyAlertCount > 0 && legacyFilter !== 'cles_faibles' && (
        <Link
          href={urlWithFlag('alerte', 'cles_faibles')}
          className="block bg-orange-50 border border-orange-300 rounded-xl p-4 mb-4 hover:bg-orange-100 transition"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <span className="text-xl flex-shrink-0">🔑</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-orange-900">
                  {keyAlertCount} suite{keyAlertCount > 1 ? 's' : ''} avec 2 clés ou moins
                </div>
                <p className="text-xs text-orange-800/80 mt-0.5">
                  Inclut les suites où le nombre de clés n'est pas renseigné. À compléter pour garder une marge (clé propriétaire, clé Stoniz, clé voyageur).
                </p>
              </div>
            </div>
            <span className="text-sm text-orange-700 underline flex-shrink-0">
              Voir et corriger →
            </span>
          </div>
        </Link>
      )}

      {/* Chips de filtre legacy (toggle alertes) — conservés en plus de la toolbar */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <Link
          href={urlWithFlag('completion', null)}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            legacyFilter === 'all'
              ? 'bg-stoniz-black text-white border-stoniz-black'
              : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:border-stoniz-black'
          }`}
        >
          Tous ({totalCount})
        </Link>
        <Link
          href={urlWithFlag('completion', 'incomplete')}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            legacyFilter === 'incomplete'
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:border-amber-500'
          }`}
        >
          Bien à compléter ({incompleteCount})
        </Link>
        <Link
          href={urlWithFlag('alerte', 'cles_faibles')}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            legacyFilter === 'cles_faibles'
              ? 'bg-orange-500 text-white border-orange-500'
              : 'bg-white text-orange-700 border-orange-300 hover:border-orange-500'
          }`}
        >
          🔑 Clés faibles ({keyAlertCount})
        </Link>
      </div>

      <ListToolbar
        moduleKey="propria-biens"
        filters={filters}
        searchHint="Rechercher (nom, quartier, propriétaire)… ⌘K"
        count={{ filtered: lots.length, total: totalCount }}
      />

      {lots.length === 0 ? (
        <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center">
          <Building2 className="w-10 h-10 mx-auto text-stoniz-gray-400 mb-3" />
          <div className="font-medium mb-1">
            {legacyFilter === 'incomplete'
              ? 'Aucun lot dont le bien reste à compléter — tout est à jour'
              : 'Aucun lot géré pour l\'instant'}
          </div>
          <div className="text-sm text-stoniz-gray-600 mb-4">
            {legacyFilter === 'incomplete'
              ? 'Toutes les fiches bien sont complètes. Bonne nouvelle.'
              : 'Ajoute un bien externe ou active la gestion Propria sur un projet Stoniz.'}
          </div>
          {legacyFilter === 'all' && (
            <Link
              href="/propria/biens/new"
              className="inline-block bg-stoniz-black text-white px-4 py-2 rounded-md text-sm"
            >
              + Ajouter le premier bien
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">Lot</th>
                <SortableHeader field="name" className="px-4 py-3 text-left">Bien / Propriétaire</SortableHeader>
                <th className="px-4 py-3 text-left">Quartier</th>
                <th className="px-4 py-3 text-center">Voyageurs</th>
                <th className="px-4 py-3 text-right">Prix nuit</th>
                <th className="px-4 py-3 text-center">Annonces</th>
                <th className="px-4 py-3 text-center">Origine</th>
                <th className="px-4 py-3 text-center">Complétude bien</th>
                <SortableHeader field="propria_managed_at" className="px-4 py-3 text-center">Sous gestion depuis</SortableHeader>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stoniz-gray-100">
              {lots.map((l: any) => {
                const p = l.property;
                const c = completenessMap.get(l.property_id) as any;
                const pct = c?.completion_pct ?? 0;
                const filled = c?.filled_count ?? 0;
                const total = c?.total_count ?? 17;
                const isComplete = c?.is_complete ?? false;
                const badgeClass = isComplete
                  ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                  : pct >= 70
                    ? 'bg-amber-100 text-amber-800 border-amber-200'
                    : 'bg-red-100 text-red-800 border-red-200';
                const isStoniz = Array.isArray(p?.projects) && p.projects.length > 0;
                return (
                  <tr key={l.id} className="hover:bg-stoniz-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/propria/biens/${l.property_id}`} className="font-medium font-mono text-xs hover:underline">
                          {l.code}
                        </Link>
                        {hasKeyAlert(l) && (
                          <span
                            className="text-[10px] bg-orange-100 text-orange-800 border border-orange-200 px-1.5 py-0.5 rounded-full"
                            title={l.propria_nb_keys == null
                              ? 'Nombre de clés non renseigné — à compléter'
                              : `Seulement ${l.propria_nb_keys} clé${Number(l.propria_nb_keys) > 1 ? 's' : ''} — risque opérationnel`}
                          >
                            🔑 {l.propria_nb_keys ?? '?'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/propria/biens/${l.property_id}`} className="hover:underline">
                        {p?.name ?? '—'}
                      </Link>
                      {p?.propria_owner_name && (
                        <div className="text-xs text-stoniz-gray-500">{p.propria_owner_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{p?.quartier ?? '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {l.propria_capacity_voyageurs ?? '—'}
                      {l.propria_nb_chambres && (
                        <div className="text-[10px] text-stoniz-gray-500">{l.propria_nb_chambres} ch.</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {l.propria_base_price_per_night
                        ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(l.propria_base_price_per_night))} DH`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-1.5 justify-center">
                        {l.propria_airbnb_url && (
                          <a href={l.propria_airbnb_url} target="_blank" rel="noopener" className="text-pink-600" title="Airbnb">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {l.propria_booking_url && (
                          <a href={l.propria_booking_url} target="_blank" rel="noopener" className="text-blue-600" title="Booking">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {l.propria_wifi_ssid && (
                          <span className="text-emerald-600" title={`Wifi: ${l.propria_wifi_ssid}`}>
                            <Wifi className="w-3.5 h-3.5" />
                          </span>
                        )}
                        {!l.propria_airbnb_url && !l.propria_booking_url && !l.propria_wifi_ssid && (
                          <span className="text-stoniz-gray-400 text-xs">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {isStoniz ? (
                        <span className="text-[10px] bg-stoniz-black text-white px-2 py-0.5 rounded-full">Stoniz</span>
                      ) : (
                        <span className="text-[10px] bg-stoniz-gray-200 text-stoniz-gray-700 px-2 py-0.5 rounded-full">Externe</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/propria/biens/${l.property_id}`}
                        className={`inline-block text-[11px] px-2 py-0.5 rounded-full border ${badgeClass} hover:opacity-80`}
                        title={isComplete ? 'Infos du bien complètes' : `${total - filled} champ(s) bien manquant(s)`}
                      >
                        {isComplete ? '✓ Complet' : `${filled}/${total} (${pct}%)`}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-stoniz-gray-500">
                      {p?.propria_managed_at ? new Date(p.propria_managed_at).toLocaleDateString('fr-FR') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/propria/biens/${l.property_id}`} className="text-xs text-stoniz-black hover:underline">
                        Voir →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
