import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { getActiveLotOptions, getLotLabelMap } from '@/lib/propria/lots';
import { madToEur } from '@/lib/finance/fx-fixed';
import {
  UPSELL_CATEGORIES,
  UPSELL_CATEGORY_LABELS,
  UPSELL_CA_STATUSES,
  type UpsellCategory,
} from '@/lib/propria/upsell';
import { createUpsellAction, setUpsellStatusAction, setUpsellAmountAction } from './actions';
import { UpsellStatusSelect, UpsellAmountButton } from '@/components/propria/upsell-controls';
import { UpsellCreateModal, type UpsellResaOption } from '@/components/propria/upsell-create-modal';
import { UpsellQrSection } from '@/components/propria/upsell-qr-section';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, period, search, escapeIlike as parseEscapeIlike, sort, type SP } from '@/lib/list-filters/parse';

function fmtMad(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' DH';
}
function fmtEur(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €';
}
function fmtDate(d: any): string {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('fr-FR');
}

const STATUS_OPTIONS = [
  { v: 'commande',  label: 'Commandé' },
  { v: 'confirme',  label: 'Confirmé' },
  { v: 'livre',     label: 'Livré' },
  { v: 'annule',    label: 'Annulé' },
];

const SOURCE_OPTIONS = [
  { v: 'interne', label: 'Interne' },
  { v: 'qr',      label: 'QR voyageur' },
];

const SORT_FIELDS: Record<string, string> = {
  created_at: 'created_at',
  amount_mad: 'amount_mad',
};

export default async function UpsellPage({
  searchParams,
}: {
  searchParams?: SP;
}) {
  const user = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const isCeo = user.role === 'ceo';
  const supabase = createClient();
  const sp = searchParams ?? {};

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

  const [upsellsRes, lotOptions, lotLabels, slugsRes, resasRes, listingsRes] = await Promise.all([
    supabase.from('propria_upsells').select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1000),
    getActiveLotOptions(),
    getLotLabelMap(),
    supabase.from('propria_units').select('id, upsell_slug')
      .eq('is_active', true).is('deleted_at', null),
    supabase.from('hostaway_reservations')
      .select('hostaway_id, guest_name, arrival_date, departure_date, hostaway_listing_db_id')
      .in('status', ['new', 'modified'])
      .gte('departure_date', today)
      .lte('arrival_date', horizon)
      .is('deleted_at', null)
      .order('arrival_date', { ascending: true })
      .limit(500),
    supabase.from('hostaway_listings').select('id, propria_unit_id').is('deleted_at', null),
  ]);

  const allRows = (upsellsRes.data ?? []) as any[];
  const slugByUnit = new Map(
    ((slugsRes.data ?? []) as any[]).map((u) => [u.id, u.upsell_slug as string | null]),
  );
  const unitByListing = new Map(
    ((listingsRes.data ?? []) as any[]).map((l) => [l.id, l.propria_unit_id as string | null]),
  );
  const resaOptions: UpsellResaOption[] = ((resasRes.data ?? []) as any[]).map((r) => ({
    hostaway_id: Number(r.hostaway_id),
    unit_id: r.hostaway_listing_db_id ? (unitByListing.get(r.hostaway_listing_db_id) ?? null) : null,
    guest_name: r.guest_name ?? null,
    arrival_date: r.arrival_date,
    departure_date: r.departure_date,
  }));
  const resaGuestById = new Map(resaOptions.map((r) => [r.hostaway_id, r.guest_name]));

  // ─── Dashboard CA dérivé (confirme + livre, jamais stocké) ──────────────
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const caRows = allRows.filter((r) => UPSELL_CA_STATUSES.includes(r.status));
  const ca12m = caRows.filter((r) => new Date(r.created_at) >= twelveMonthsAgo);
  const caMonth = caRows.filter((r) => new Date(r.created_at) >= monthStart);

  const sum = (xs: any[]) => xs.reduce((s, r) => s + Number(r.amount_mad ?? 0), 0);
  const caMonthMad = sum(caMonth);
  const ca12mMad = sum(ca12m);

  const byCategory = new Map<string, number>();
  const byLot = new Map<string, number>();
  for (const r of ca12m) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + Number(r.amount_mad ?? 0));
    byLot.set(r.propria_unit_id, (byLot.get(r.propria_unit_id) ?? 0) + Number(r.amount_mad ?? 0));
  }
  const byLotSorted = Array.from(byLot.entries()).sort((a, b) => b[1] - a[1]);

  // ─── Parse toolbar ─────────────────────────────────────────────────────
  const q = search(sp);
  const categories = multi(sp, 'category');
  const statuses = multi(sp, 'status');
  const sourceFilter = multi(sp, 'source');
  const unitId = single(sp, 'unit');
  const periodCreated = period(sp, 'period');
  const { field: sortField, dir: sortDir } = sort(sp, 'created_at', 'desc');
  const dbSortField = SORT_FIELDS[sortField] ?? 'created_at';

  // Compat onglet "cat" legacy
  const cat = single(sp, 'cat');
  const activeCat: UpsellCategory | null =
    cat && (UPSELL_CATEGORIES as readonly string[]).includes(cat) ? (cat as UpsellCategory) : null;

  let visible = allRows;
  if (activeCat) visible = visible.filter((r) => r.category === activeCat);
  if (categories.length) visible = visible.filter((r) => categories.includes(r.category));
  if (statuses.length) visible = visible.filter((r) => statuses.includes(r.status));
  if (sourceFilter.length) visible = visible.filter((r) => sourceFilter.includes(r.source ?? 'interne'));
  if (unitId) visible = visible.filter((r) => r.propria_unit_id === unitId);
  if (periodCreated.from) visible = visible.filter((r) => String(r.created_at).slice(0, 10) >= periodCreated.from!);
  if (periodCreated.to) visible = visible.filter((r) => String(r.created_at).slice(0, 10) <= periodCreated.to!);
  if (q) {
    const needle = q.toLowerCase();
    visible = visible.filter((r) => {
      const guest = (r.guest_name ?? '').toLowerCase();
      const contact = (r.guest_contact ?? '').toLowerCase();
      const description = (r.description ?? '').toLowerCase();
      return guest.includes(needle) || contact.includes(needle) || description.includes(needle);
    });
  }

  // Tri
  visible = [...visible].sort((a, b) => {
    const av = a[dbSortField] ?? '';
    const bv = b[dbSortField] ?? '';
    if (dbSortField === 'amount_mad') {
      return (sortDir === 'asc' ? 1 : -1) * (Number(av) - Number(bv));
    }
    const cmp = String(av).localeCompare(String(bv));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const enAttente = allRows.filter((r) => r.status === 'commande').length;
  const aChiffrer = allRows.filter((r) => r.status !== 'annule' && Number(r.amount_mad ?? 0) === 0).length;

  const qrLots = lotOptions.map((l) => ({
    id: l.id,
    label: l.label,
    slug: slugByUnit.get(l.id) ?? null,
  }));

  // ─── Options dynamiques ─────────────────────────────────────────────
  const categoryOptions = UPSELL_CATEGORIES.map((c) => ({
    v: c,
    label: UPSELL_CATEGORY_LABELS[c],
  }));

  const unitOptions = lotOptions.map(l => ({ v: l.id, label: l.label }));

  const filters: FilterDef[] = [
    { kind: 'single', key: 'unit',     label: 'Lot / Bien',  options: unitOptions },
    { kind: 'multi',  key: 'category', label: 'Catégorie',   options: categoryOptions },
    { kind: 'multi',  key: 'status',   label: 'Statut',      options: STATUS_OPTIONS },
    { kind: 'multi',  key: 'source',   label: 'Source',      options: SOURCE_OPTIONS },
    { kind: 'period', key: 'period',   label: 'Période' },
  ];

  return (
    <div className="max-w-7xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Upsell
          </div>
          <h1 className="text-2xl md:text-3xl font-display">Upsell — services additionnels</h1>
          <p className="text-sm text-stoniz-gray-600 mt-2">
            Transferts, petits-déjeuners, activités, early/late… Commandes internes + commandes
            voyageur via QR code (sans paiement en ligne — le bureau chiffre et confirme).
          </p>
        </div>
        <UpsellCreateModal
          lots={lotOptions.map((l) => ({ id: l.id, label: l.label }))}
          reservations={resaOptions}
          createAction={createUpsellAction}
        />
      </div>

      {/* ─── Dashboard CA ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <div className="text-xs text-emerald-800 uppercase tracking-wider">CA mois en cours</div>
          <div className="text-2xl font-display mt-1 text-emerald-900">{fmtMad(caMonthMad)}</div>
          <div className="text-[11px] text-emerald-700 mt-1">≈ {fmtEur(madToEur(caMonthMad))} (taux fixe 10 DH = 1 €)</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-700 uppercase tracking-wider">CA 12 derniers mois</div>
          <div className="text-2xl font-display mt-1">{fmtMad(ca12mMad)}</div>
          <div className="text-[11px] text-stoniz-gray-500 mt-1">≈ {fmtEur(madToEur(ca12mMad))} · {ca12m.length} vente(s)</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="text-xs text-amber-800 uppercase tracking-wider">📥 Commandes à traiter</div>
          <div className="text-2xl font-display mt-1 text-amber-900">{enAttente}</div>
          <div className="text-[11px] text-amber-700 mt-1">Statut « commandé »</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-700 uppercase tracking-wider">À chiffrer</div>
          <div className="text-2xl font-display mt-1">{aChiffrer}</div>
          <div className="text-[11px] text-stoniz-gray-500 mt-1">Montant encore à 0 DH</div>
        </div>
      </div>

      {/* ─── Ventilation CA 12 mois ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-display text-sm uppercase tracking-wider text-stoniz-gray-700 mb-3">
            CA par catégorie (12 mois)
          </h2>
          <ul className="space-y-1.5">
            {UPSELL_CATEGORIES.map((c) => {
              const v = byCategory.get(c) ?? 0;
              if (v === 0) return null;
              return (
                <li key={c} className="flex items-center justify-between text-sm">
                  <span>{UPSELL_CATEGORY_LABELS[c]}</span>
                  <span className="font-display">{fmtMad(v)} <span className="text-xs text-stoniz-gray-500">≈ {fmtEur(madToEur(v))}</span></span>
                </li>
              );
            })}
            {byCategory.size === 0 && (
              <li className="text-sm text-stoniz-gray-500">Aucune vente confirmée/livrée sur 12 mois.</li>
            )}
          </ul>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-display text-sm uppercase tracking-wider text-stoniz-gray-700 mb-3">
            CA par logement (12 mois)
          </h2>
          <ul className="space-y-1.5">
            {byLotSorted.map(([uid, v]) => (
              <li key={uid} className="flex items-center justify-between text-sm">
                <span>{lotLabels.get(uid) ?? '—'}</span>
                <span className="font-display">{fmtMad(v)} <span className="text-xs text-stoniz-gray-500">≈ {fmtEur(madToEur(v))}</span></span>
              </li>
            ))}
            {byLotSorted.length === 0 && (
              <li className="text-sm text-stoniz-gray-500">Aucune vente confirmée/livrée sur 12 mois.</li>
            )}
          </ul>
        </div>
      </div>

      {/* Toolbar unifiée */}
      <div className="mb-4">
        <ListToolbar
          moduleKey="propria-upsell"
          count={{ filtered: visible.length, total: allRows.length }}
          filters={filters}
          searchHint="nom client, description, contact"
        />
      </div>

      {/* ─── Liste des upsells ──────────────────────────────────────────── */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">
                <SortableHeader field="created_at">Date</SortableHeader>
              </th>
              <th className="px-3 py-2 text-left">Lot</th>
              <th className="px-3 py-2 text-left">Voyageur / Résa</th>
              <th className="px-3 py-2 text-left">Catégorie</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">
                <SortableHeader field="amount_mad">Montant</SortableHeader>
              </th>
              <th className="px-3 py-2 text-center">Statut</th>
              <th className="px-3 py-2 text-center">Source</th>
              {isCeo && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {visible.map((r) => (
              <tr key={r.id} className="hover:bg-stoniz-gray-50">
                <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                <td className="px-3 py-2 text-xs">{lotLabels.get(r.propria_unit_id) ?? '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {r.guest_name ?? resaGuestById.get(Number(r.hostaway_reservation_id)) ?? '—'}
                  {r.hostaway_reservation_id != null && (
                    <span className="block text-[10px] text-stoniz-gray-500">
                      Résa #{r.hostaway_reservation_id}
                    </span>
                  )}
                  {r.guest_contact && (
                    <span className="block text-[10px] text-stoniz-gray-500">{r.guest_contact}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {UPSELL_CATEGORY_LABELS[r.category as UpsellCategory] ?? r.category}
                </td>
                <td className="px-3 py-2 text-xs max-w-[280px]">
                  <span className="line-clamp-2">{r.description ?? '—'}</span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <UpsellAmountButton
                    id={r.id}
                    amountMad={Number(r.amount_mad ?? 0)}
                    setAmountAction={setUpsellAmountAction}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <UpsellStatusSelect
                    id={r.id}
                    current={r.status}
                    setStatusAction={setUpsellStatusAction}
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  {r.source === 'qr' ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-800">QR</span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-stoniz-gray-100 text-stoniz-gray-700">Interne</span>
                  )}
                </td>
                {isCeo && (
                  <td className="px-3 py-2 text-center">
                    <PropriaDeleteButton table="propria_upsells" id={r.id} />
                  </td>
                )}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={isCeo ? 9 : 8} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                  Aucun upsell pour ces filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ─── QR codes ────────────────────────────────────────────────────── */}
      <UpsellQrSection lots={qrLots} baseUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''} />
    </div>
  );
}
