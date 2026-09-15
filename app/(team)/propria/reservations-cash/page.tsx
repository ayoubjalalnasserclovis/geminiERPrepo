import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  createCashReservationAction,
  createCollectTaskAction,
  createDirectReservationAction,
  collectDirectReservationAction,
  markRecoveredAction,
  markRemittedToCeoAction,
} from './actions';
import { getActiveLotOptions, getLotLabelMap } from '@/lib/propria/lots';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { PropriaBulkDeleteForm } from '@/components/propria/propria-bulk-delete-form';
import {
  CollectTaskButton,
  DirectCollectButton,
} from '@/components/propria/cash-collect-task-button';

function fmt(n: any) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n)) + ' DH';
}

function fmtDate(d: any): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR');
}

/** Réf interne d'une résa cash manuelle — propagée dans hostaway_ref de la tâche. */
function cashRef(id: string) {
  return `CASH-${id.slice(0, 8).toUpperCase()}`;
}

// Filtres dynamiques portés par les cartes KPI (chantier 14, point 1).
type CashFilter = 'a_recuperer' | 'a_remettre' | 'remis';
const FILTERS: readonly CashFilter[] = ['a_recuperer', 'a_remettre', 'remis'] as const;

export default async function CashReservationsPage({
  searchParams,
}: {
  searchParams?: { f?: string };
}) {
  const user = await requireRole(['ceo','developer','finance','assistante','propria']);
  const isCeo = user.role === 'ceo';
  const supabase = createClient();

  const activeFilter: CashFilter | null =
    searchParams?.f && (FILTERS as readonly string[]).includes(searchParams.f)
      ? (searchParams.f as CashFilter)
      : null;

  const [resRes, directRes, profRes, lotOptions, lotLabels] = await Promise.all([
    supabase.from('propria_cash_reservations').select('*')
      .is('deleted_at', null).order('arrival_date', { ascending: false }).limit(200),
    // Résas directes hors OTA (décision A3 : auto-remontée interne)
    supabase.from('propria_direct_reservations').select('*')
      .is('deleted_at', null).order('arrival_date', { ascending: false }).limit(200),
    // Assistants terrain = collaborateurs, jamais des clients
    supabase.from('profiles').select('id, full_name').eq('is_active', true).neq('role', 'client'),
    getActiveLotOptions(),
    getLotLabelMap(),
  ]);

  const rows = (resRes.data ?? []) as any[];
  const directRows = (directRes.data ?? []) as any[];
  const profMap = new Map((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));
  const profileOptions = ((profRes.data ?? []) as any[]).map((p) => ({
    id: p.id as string,
    label: p.full_name as string,
  }));

  // ─── Anti-doublon tâches de collecte : map réf résa → tâche ouverte ─────
  const refs = [
    ...rows.filter((r) => !r.recovered).map((r) => cashRef(r.id)),
    ...directRows.map((r) => r.reservation_code as string),
  ];
  let openTaskByRef = new Map<string, string>();
  if (refs.length > 0) {
    const { data: openTasks } = await supabase
      .from('propria_interventions')
      .select('id, hostaway_ref')
      .eq('kind', 'tache')
      .in('hostaway_ref', refs)
      .in('status', ['a_traiter', 'en_cours', 'a_valider', 'refusee'])
      .is('deleted_at', null);
    openTaskByRef = new Map(
      ((openTasks ?? []) as any[]).map((t) => [t.hostaway_ref as string, t.id as string]),
    );
  }

  // ─── KPI (dérivés à la lecture, rien de stocké) ──────────────────────────
  const totalEncaisse = rows.reduce((s, r) => s + Number(r.amount_mad ?? 0), 0);
  const pendingPickup = rows.filter(r => !r.recovered).reduce((s, r) => s + Number(r.amount_mad ?? 0), 0);
  const pendingRemise = rows.filter(r => r.recovered && !r.remitted_to_ceo).reduce((s, r) => s + Number(r.amount_mad ?? 0), 0);
  const remised = rows.filter(r => r.remitted_to_ceo).reduce((s, r) => s + Number(r.amount_mad ?? 0), 0);

  // Résas directes : reste à encaisser TOUJOURS dérivé (total − collecté)
  const directWithReste = directRows.map((r) => ({
    ...r,
    reste_mad: Number(r.total_price_mad ?? 0) - Number(r.collected_mad ?? 0),
  }));
  const directResteTotal = directWithReste.reduce((s, r) => s + Math.max(0, r.reste_mad), 0);

  // ─── Filtre dynamique : cartes cliquables (toggle via searchParams) ─────
  const visibleRows =
    activeFilter === 'a_recuperer' ? rows.filter((r) => !r.recovered)
    : activeFilter === 'a_remettre' ? rows.filter((r) => r.recovered && !r.remitted_to_ceo)
    : activeFilter === 'remis' ? rows.filter((r) => r.remitted_to_ceo)
    : rows;
  const visibleDirect =
    activeFilter === 'a_recuperer' ? directWithReste.filter((r) => r.reste_mad > 0)
    : activeFilter === 'remis' || activeFilter === 'a_remettre' ? []
    : directWithReste;

  const cardClass = (filter: CashFilter | null, base: string) =>
    `${base} block rounded-lg p-4 border transition ${
      activeFilter === filter
        ? 'ring-2 ring-stoniz-black ring-offset-1'
        : 'hover:ring-1 hover:ring-stoniz-gray-300'
    }`;
  const filterHref = (filter: CashFilter) =>
    activeFilter === filter ? '/propria/reservations-cash' : `/propria/reservations-cash?f=${filter}`;

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Réservations cash
        </div>
        <h1 className="text-2xl md:text-3xl font-display">Réservations payées en espèces</h1>
        <p className="text-sm text-stoniz-gray-600 mt-2">
          Workflow : récupération par l'assistant terrain → confirmation de remise au CEO (seul le CEO peut valider).
          Clique sur une carte pour filtrer la liste.
        </p>
      </div>

      {/* ─── KPI cliquables = filtres (toggle on/off) ───────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Link href="/propria/reservations-cash" className={cardClass(null, 'bg-white border-stoniz-gray-200')}>
          <div className="text-xs text-stoniz-gray-600">Total encaissé</div>
          <div className="text-2xl font-display mt-1">{fmt(totalEncaisse)}</div>
          <div className="text-[11px] text-stoniz-gray-500 mt-1">Tout afficher</div>
        </Link>
        <Link href={filterHref('a_recuperer')} className={cardClass('a_recuperer', 'bg-amber-50 border-amber-200')}>
          <div className="text-xs text-amber-800">À récupérer terrain</div>
          <div className="text-2xl font-display mt-1 text-amber-900">{fmt(pendingPickup)}</div>
          <div className="text-[11px] text-amber-700 mt-1">
            {activeFilter === 'a_recuperer' ? '✕ Retirer le filtre' : 'Filtrer →'}
          </div>
        </Link>
        <Link href={filterHref('a_remettre')} className={cardClass('a_remettre', 'bg-orange-50 border-orange-200')}>
          <div className="text-xs text-orange-800">Récupéré, pas remis</div>
          <div className="text-2xl font-display mt-1 text-orange-900">{fmt(pendingRemise)}</div>
          <div className="text-[11px] text-orange-700 mt-1">
            {activeFilter === 'a_remettre' ? '✕ Retirer le filtre' : 'Filtrer →'}
          </div>
        </Link>
        <Link href={filterHref('remis')} className={cardClass('remis', 'bg-emerald-50 border-emerald-200')}>
          <div className="text-xs text-emerald-800">Confirmé remis</div>
          <div className="text-2xl font-display mt-1 text-emerald-900">{fmt(remised)}</div>
          <div className="text-[11px] text-emerald-700 mt-1">
            {activeFilter === 'remis' ? '✕ Retirer le filtre' : 'Filtrer →'}
          </div>
        </Link>
      </div>

      <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
        <summary className="cursor-pointer font-medium">+ Nouvelle réservation cash</summary>
        <form action={createCashReservationAction} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <select name="propria_unit_id" required className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
            <option value="">— Lot (listing) *</option>
            {lotOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <input name="voyageur_name" placeholder="Nom voyageur"
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          <input name="amount_mad" type="number" step="0.01" required placeholder="Montant MAD *"
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          <input name="arrival_date" type="date" className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          <input name="departure_date" type="date" className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          <input name="nb_nights" type="number" placeholder="Nb nuits"
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          <select name="assistant_id" className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm md:col-span-2">
            <option value="">— Assistant terrain</option>
            {(profRes.data ?? []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.full_name}</option>
            ))}
          </select>
          <button className="bg-stoniz-black text-white py-2 rounded text-sm">Créer</button>
        </form>
      </details>

      <PropriaBulkDeleteForm table="propria_cash_reservations">
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-2 py-2"></th>
              <th className="px-3 py-2 text-left">Arrivée</th>
              <th className="px-3 py-2 text-left">Lot</th>
              <th className="px-3 py-2 text-left">Voyageur</th>
              <th className="px-3 py-2 text-center">Nuits</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2 text-left">Assistant</th>
              <th className="px-3 py-2 text-center">Récupéré</th>
              <th className="px-3 py-2 text-center">Tâche terrain</th>
              <th className="px-3 py-2 text-center">Remis au CEO</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {visibleRows.map(r => {
              const lotLabel = r.propria_unit_id ? (lotLabels.get(r.propria_unit_id) ?? '—') : '—';
              return (
                <tr key={r.id} className="hover:bg-stoniz-gray-50">
                  <td className="px-2 py-2 text-center"><input type="checkbox" data-bulk-id={r.id} /></td>
                  <td className="px-3 py-2 text-xs">{fmtDate(r.arrival_date)}</td>
                  <td className="px-3 py-2 text-xs">{lotLabel}</td>
                  <td className="px-3 py-2 text-xs">{r.voyageur_name ?? '—'}</td>
                  <td className="px-3 py-2 text-center text-xs">{r.nb_nights ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">{fmt(r.amount_mad)}</td>
                  <td className="px-3 py-2 text-xs">{profMap.get(r.assistant_id) ?? '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {r.recovered ? (
                      <span className="text-xs text-emerald-700" title={`Le ${fmtDate(r.recovered_at)}`}>
                        ✓ {fmtDate(r.recovered_at)}
                      </span>
                    ) : (
                      <form action={async () => { 'use server'; await markRecoveredAction(r.id); }}>
                        <button className="text-xs text-stoniz-gray-500 hover:text-stoniz-black underline">
                          Marquer récupéré
                        </button>
                      </form>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.recovered ? (
                      <span className="text-xs text-stoniz-gray-300">—</span>
                    ) : (
                      <CollectTaskButton
                        source="cash"
                        reservationId={r.id}
                        amountLabel={fmt(r.amount_mad)}
                        existingTaskId={openTaskByRef.get(cashRef(r.id)) ?? null}
                        profiles={profileOptions}
                        createAction={createCollectTaskAction}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.remitted_to_ceo ? (
                      <span className="text-xs text-emerald-700">
                        ✓ {fmtDate(r.remitted_at)}
                      </span>
                    ) : r.recovered ? (
                      isCeo ? (
                        <form action={async () => { 'use server'; await markRemittedToCeoAction(r.id); }}>
                          <button className="text-xs bg-stoniz-black text-white px-3 py-1 rounded hover:bg-stoniz-gray-800">
                            ✓ Confirmer remise
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-stoniz-gray-400">CEO uniquement</span>
                      )
                    ) : (
                      <span className="text-xs text-stoniz-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <PropriaDeleteButton table="propria_cash_reservations" id={r.id} />
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                {activeFilter ? 'Aucune réservation cash pour ce filtre.' : 'Aucune réservation cash enregistrée.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      </PropriaBulkDeleteForm>

      {/* ─── Résas directes hors OTA (décision A3 : auto-remontée interne) ── */}
      <div className="mt-8 mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-display">Résas directes (hors OTA)</h2>
          <p className="text-sm text-stoniz-gray-600 mt-1">
            Saisies à la main (Hostaway reste unidirectionnel). Reste à encaisser
            global : <strong>{fmt(directResteTotal)}</strong> — toujours dérivé (prix − encaissé).
          </p>
        </div>
      </div>

      <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
        <summary className="cursor-pointer font-medium">+ Résa directe</summary>
        <form action={createDirectReservationAction} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <select name="propria_unit_id" required className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
            <option value="">— Lot (listing) *</option>
            {lotOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <input name="guest_name" required placeholder="Nom voyageur *"
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          <input name="guest_contact" placeholder="Contact (tél / WhatsApp)"
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          <div>
            <label className="text-xs text-stoniz-gray-600">Arrivée *</label>
            <input name="arrival_date" type="date" required
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Départ *</label>
            <input name="departure_date" type="date" required
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Prix total MAD *</label>
            <input name="total_price_mad" type="number" step="0.01" min="0" required placeholder="ex : 1500"
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          </div>
          <input name="notes" placeholder="Notes (optionnel)"
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm md:col-span-2" />
          <button className="bg-stoniz-black text-white py-2 rounded text-sm">
            + Créer (code DIR- généré automatiquement)
          </button>
        </form>
      </details>

      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Code résa</th>
              <th className="px-3 py-2 text-left">Arrivée → Départ</th>
              <th className="px-3 py-2 text-left">Lot</th>
              <th className="px-3 py-2 text-left">Voyageur</th>
              <th className="px-3 py-2 text-right">Prix total</th>
              <th className="px-3 py-2 text-right">Encaissé</th>
              <th className="px-3 py-2 text-right">Reste à encaisser</th>
              <th className="px-3 py-2 text-center">Actions</th>
              {isCeo && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {visibleDirect.map((r: any) => {
              const lotLabel = r.propria_unit_id ? (lotLabels.get(r.propria_unit_id) ?? '—') : '—';
              const reste = Math.max(0, r.reste_mad);
              return (
                <tr key={r.id} className="hover:bg-stoniz-gray-50">
                  <td className="px-3 py-2 text-xs font-mono whitespace-nowrap">{r.reservation_code}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {fmtDate(r.arrival_date)} → {fmtDate(r.departure_date)}
                  </td>
                  <td className="px-3 py-2 text-xs">{lotLabel}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.guest_name}
                    {r.guest_contact && (
                      <span className="block text-[10px] text-stoniz-gray-500">{r.guest_contact}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{fmt(r.total_price_mad)}</td>
                  <td className="px-3 py-2 text-right text-xs">{fmt(r.collected_mad)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${reste > 0 ? 'text-amber-800' : 'text-emerald-700'}`}>
                    {reste > 0 ? fmt(reste) : '✓ Soldé'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {reste > 0 ? (
                      <span className="inline-flex items-center gap-2">
                        <DirectCollectButton
                          id={r.id}
                          resteMad={reste}
                          collectAction={collectDirectReservationAction}
                        />
                        <CollectTaskButton
                          source="direct"
                          reservationId={r.id}
                          amountLabel={fmt(reste)}
                          existingTaskId={openTaskByRef.get(r.reservation_code) ?? null}
                          profiles={profileOptions}
                          createAction={createCollectTaskAction}
                        />
                      </span>
                    ) : (
                      <span className="text-xs text-stoniz-gray-300">—</span>
                    )}
                  </td>
                  {isCeo && (
                    <td className="px-3 py-2 text-center">
                      <PropriaDeleteButton table="propria_direct_reservations" id={r.id} />
                    </td>
                  )}
                </tr>
              );
            })}
            {visibleDirect.length === 0 && (
              <tr><td colSpan={isCeo ? 9 : 8} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                {activeFilter ? 'Aucune résa directe pour ce filtre.' : 'Aucune résa directe enregistrée.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
