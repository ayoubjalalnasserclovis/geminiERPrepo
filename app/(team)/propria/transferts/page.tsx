import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  createTransferAction,
  setTransferStatusAction,
  toggleBonSigneAction,
  markCashCollectedAction,
  markCashRemittedToCeoAction,
} from './actions';
import { TransferStatusSelect } from '@/components/propria/transfer-status-select';
import { getActiveLotOptions, getLotLabelMap } from '@/lib/propria/lots';
import { getUpcomingResaOptions } from '@/lib/propria/reservations';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { PropriaBulkDeleteForm } from '@/components/propria/propria-bulk-delete-form';

const STATUS_LABELS: Record<string, string> = {
  a_faire: '⏳ À faire',
  fait: '✓ Fait',
  offert: '🎁 Offert',
  anomalie: '⚠ Anomalie',
  annule: '✕ Annulé',
};

function fmt(n: any) {
  if (n == null || isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n)) + ' DH';
}
function fmtDate(d: any): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR');
}

export default async function TransfersPage() {
  const user = await requireRole(['ceo','developer','assistante','propria']);
  const isCeo = user.role === 'ceo';
  const supabase = createClient();

  const [trRes, profRes, lotOptions, lotLabels, resaOptions] = await Promise.all([
    supabase.from('propria_transfers').select('*')
      .is('deleted_at', null).order('travel_date', { ascending: false }).limit(300),
    // Collaborateurs uniquement (responsable collecte = jamais un client)
    supabase.from('profiles').select('id, full_name').eq('is_active', true)
      .neq('role', 'client').order('full_name'),
    getActiveLotOptions(),
    getLotLabelMap(),
    // Chantier 14 : résas en cours/à venir pour lier un transfert à une résa
    getUpcomingResaOptions(),
  ]);

  // Résas groupées par lot pour le sélecteur « Réservation liée » (optgroups)
  const lotLabelById = new Map(lotOptions.map((l) => [l.id, l.label]));
  const resasByLot = new Map<string, typeof resaOptions>();
  for (const r of resaOptions) {
    if (!r.unit_id || !lotLabelById.has(r.unit_id)) continue;
    const arr = resasByLot.get(r.unit_id) ?? [];
    arr.push(r);
    resasByLot.set(r.unit_id, arr);
  }

  const rows = (trRes.data ?? []) as any[];
  const profs = (profRes.data ?? []) as any[];
  const profMap = new Map(profs.map((p: any) => [p.id, p.full_name]));

  // ─── KPIs "qui doit quoi" ──────────────────────────────────────────────
  const isPayable = (r: any) => r.amount_mad != null && Number(r.amount_mad) > 0 && r.status === 'fait';

  // Cash dû par le chauffeur (transport réalisé, cash pas encore collecté)
  const cashDuTerrain = rows
    .filter(r => isPayable(r) && !r.cash_collected)
    .reduce((s, r) => s + Number(r.amount_mad), 0);

  // Cash collecté par le terrain mais pas encore remis au CEO
  const cashAremettreCeo = rows
    .filter(r => r.cash_collected && !r.cash_remitted_at)
    .reduce((s, r) => s + Number(r.amount_mad ?? 0), 0);

  // Cash bien remis au CEO
  const cashRemisCeo = rows
    .filter(r => r.cash_remitted_at)
    .reduce((s, r) => s + Number(r.amount_mad ?? 0), 0);

  // Ventilation "qui doit me remettre quoi" — collaborateurs ayant collecté mais pas encore remis
  const debtsByCollaborator = new Map<string, number>();
  for (const r of rows) {
    if (r.cash_collected && !r.cash_remitted_at && r.collect_responsible_id && r.amount_mad) {
      const cur = debtsByCollaborator.get(r.collect_responsible_id) ?? 0;
      debtsByCollaborator.set(r.collect_responsible_id, cur + Number(r.amount_mad));
    }
  }

  const aFaire = rows.filter(r => r.status === 'a_faire').length;
  const anomalies = rows.filter(r => r.status === 'anomalie').length;

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Transferts
        </div>
        <h1 className="text-2xl md:text-3xl font-display">Transferts aéroport / gare</h1>
        <p className="text-sm text-stoniz-gray-600 mt-2">
          Workflow : transport effectué → cash collecté par le terrain → cash remis au CEO (seul le CEO confirme).
        </p>
      </div>

      {/* ─── KPIs cash ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="text-xs text-amber-800 uppercase tracking-wider">⏳ À collecter</div>
          <div className="text-2xl font-display mt-1 text-amber-900">{fmt(cashDuTerrain)}</div>
          <div className="text-[11px] text-amber-700 mt-1">Cash dû par les chauffeurs</div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="text-xs text-orange-800 uppercase tracking-wider">📥 À remettre au CEO</div>
          <div className="text-2xl font-display mt-1 text-orange-900">{fmt(cashAremettreCeo)}</div>
          <div className="text-[11px] text-orange-700 mt-1">Collecté, pas encore remis</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <div className="text-xs text-emerald-800 uppercase tracking-wider">✓ Remis au CEO</div>
          <div className="text-2xl font-display mt-1 text-emerald-900">{fmt(cashRemisCeo)}</div>
          <div className="text-[11px] text-emerald-700 mt-1">Cumul historique</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-700 uppercase tracking-wider">Activité</div>
          <div className="text-2xl font-display mt-1">
            {aFaire} <span className="text-sm text-stoniz-gray-500">à faire</span>
          </div>
          {anomalies > 0 && (
            <div className="text-[11px] text-red-700 mt-1">⚠ {anomalies} anomalie(s)</div>
          )}
        </div>
      </div>

      {/* ─── Qui me doit quoi (ventilation par collaborateur) ─────────── */}
      {debtsByCollaborator.size > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 mb-6">
          <h2 className="font-display text-sm uppercase tracking-wider text-orange-900 mb-3">
            🧾 Qui doit me remettre quoi
          </h2>
          <ul className="space-y-1.5">
            {Array.from(debtsByCollaborator.entries()).map(([profileId, amount]) => (
              <li key={profileId} className="flex items-center justify-between text-sm">
                <span className="font-medium text-orange-900">
                  {profMap.get(profileId) ?? '—'}
                </span>
                <span className="font-display text-orange-900">{fmt(amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ─── Nouveau transfert ────────────────────────────────────────── */}
      <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
        <summary className="cursor-pointer font-medium">+ Nouveau transfert</summary>
        <form action={createTransferAction} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-stoniz-gray-600">Date *</label>
            <input
              name="travel_date" type="date" required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Lot (optionnel)</label>
            <select name="propria_unit_id" className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
              <option value="">—</option>
              {lotOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Voyageur</label>
            <input
              name="voyageur_name" placeholder="Nom du voyageur"
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Montant MAD</label>
            <input
              name="amount_mad" type="number" step="0.01" placeholder="ex: 150"
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Chauffeur</label>
            <input
              name="driver_name" placeholder="Nom du chauffeur"
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Responsable collecte cash</label>
            <select name="collect_responsible_id"
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
              <option value="">— Non assigné —</option>
              {profs.map((p: any) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Réservation liée (optionnel)</label>
            <select name="hostaway_ref"
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
              <option value="">— Sans résa identifiée —</option>
              {Array.from(resasByLot.entries()).map(([unitId, resas]) => (
                <optgroup key={unitId} label={lotLabelById.get(unitId) ?? 'Lot'}>
                  {resas.map((r) => (
                    <option key={r.hostaway_id} value={String(r.hostaway_id)}>
                      #{r.hostaway_id} · {r.guest_name ?? 'Voyageur'} · {fmtDate(r.arrival_date)} → {fmtDate(r.departure_date)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-stoniz-gray-600">Commentaire</label>
            <input
              name="comment" placeholder="Ex: vol AF1234, terminal 1"
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <button className="md:col-span-3 bg-stoniz-black text-white py-2 rounded text-sm hover:bg-stoniz-gray-800">
            + Créer le transfert
          </button>
        </form>
      </details>

      {/* ─── Tableau des transferts ──────────────────────────────────── */}
      <PropriaBulkDeleteForm table="propria_transfers">
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-2 py-2"></th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Lot</th>
              <th className="px-3 py-2 text-left">Voyageur</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2 text-left">Chauffeur</th>
              <th className="px-3 py-2 text-left">Responsable</th>
              <th className="px-3 py-2 text-center">Statut</th>
              <th className="px-3 py-2 text-center">Bon</th>
              <th className="px-3 py-2 text-center">Cash collecté</th>
              <th className="px-3 py-2 text-center">Remis CEO</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {rows.map(r => {
              const lotLabel = r.propria_unit_id ? (lotLabels.get(r.propria_unit_id) ?? '—') : '—';
              return (
                <tr key={r.id} className="hover:bg-stoniz-gray-50">
                  <td className="px-2 py-2 text-center"><input type="checkbox" data-bulk-id={r.id} /></td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDate(r.travel_date)}</td>
                  <td className="px-3 py-2 text-xs">{lotLabel}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.voyageur_name ?? '—'}
                    {r.hostaway_ref && (
                      <span className="block text-[10px] text-stoniz-gray-500">🔖 Résa {r.hostaway_ref}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-medium">{fmt(r.amount_mad)}</td>
                  <td className="px-3 py-2 text-xs">{r.driver_name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {profMap.get(r.collect_responsible_id) ?? (
                      <span className="text-stoniz-gray-400 italic">non assigné</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <TransferStatusSelect
                      id={r.id}
                      current={r.status}
                      setStatusAction={setTransferStatusAction}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <form action={async () => { 'use server'; await toggleBonSigneAction(r.id, !r.bon_signe); }}>
                      <button className="text-xs hover:underline">
                        {r.bon_signe ? '✓ signé' : '— à signer'}
                      </button>
                    </form>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.cash_collected ? (
                      <span className="text-xs text-emerald-700" title={fmtDate(r.collected_at)}>
                        ✓ {fmtDate(r.collected_at)}
                      </span>
                    ) : (
                      <form action={async () => { 'use server'; await markCashCollectedAction(r.id, true); }}>
                        <button className="text-xs text-stoniz-gray-600 hover:text-stoniz-black underline">
                          Marquer collecté
                        </button>
                      </form>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.cash_remitted_at ? (
                      <span className="text-xs text-emerald-700">
                        ✓ {fmtDate(r.cash_remitted_at)}
                      </span>
                    ) : r.cash_collected ? (
                      isCeo ? (
                        <form action={async () => { 'use server'; await markCashRemittedToCeoAction(r.id); }}>
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
                    <PropriaDeleteButton table="propria_transfers" id={r.id} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={12} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                Aucun transfert enregistré.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      </PropriaBulkDeleteForm>
    </div>
  );
}
