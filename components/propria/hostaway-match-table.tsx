'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, RefreshCw, Sparkles, X } from 'lucide-react';
import {
  syncHostawayListingsAction,
  matchHostawayListingAction,
  unmatchHostawayListingAction,
} from '@/app/(team)/propria/integrations/hostaway/actions';

type Candidate = {
  id: string;
  code: string;
  property_name: string | null;
};

type Suggestion = {
  unit_id: string;
  unit_code: string;
  property_name: string | null;
  score: number;
};

type Listing = {
  id: string;
  hostaway_id: number;
  name: string | null;
  address: string | null;
  external_listing_id: string | null;
  is_active: boolean;
  propria_unit_id: string | null;
  matched_at: string | null;
  last_synced_at: string;
  suggestions: Suggestion[];
  matchedUnit: Candidate | null;
};

export function HostawayMatchTable({
  listings,
  candidates,
}: {
  listings: Listing[];
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [filter, setFilter] = useState<'unmatched' | 'matched' | 'all'>('unmatched');

  function runSync() {
    setMsg(null);
    start(async () => {
      const r = await syncHostawayListingsAction()
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!r?.ok) {
        setMsg({ kind: 'err', text: r?.error ?? 'Échec sync.' });
        return;
      }
      setMsg({
        kind: 'ok',
        text: `✓ ${(r as any).total} listing(s) synchronisé(s) — ${(r as any).created} créé(s), ${(r as any).updated} mis à jour.`,
      });
      router.refresh();
    });
  }

  function confirmMatch(listingId: string, unitId: string) {
    setMsg(null);
    start(async () => {
      const r = await matchHostawayListingAction({
        hostaway_listing_id: listingId,
        propria_unit_id: unitId,
      }).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any)?.ok) {
        setMsg({ kind: 'err', text: (r as any)?.error ?? 'Échec' });
        return;
      }
      router.refresh();
    });
  }

  function unmatch(listingId: string) {
    if (!confirm('Retirer le matching pour ce listing ?')) return;
    start(async () => {
      await unmatchHostawayListingAction(listingId);
      router.refresh();
    });
  }

  const filteredListings = listings.filter((l) => {
    if (filter === 'unmatched') return !l.propria_unit_id;
    if (filter === 'matched') return !!l.propria_unit_id;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setFilter('unmatched')}
            className={`px-3 py-1.5 rounded-full ${filter === 'unmatched' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'}`}
          >
            À matcher ({listings.filter((l) => !l.propria_unit_id).length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('matched')}
            className={`px-3 py-1.5 rounded-full ${filter === 'matched' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
          >
            Matchés ({listings.filter((l) => l.propria_unit_id).length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-full ${filter === 'all' ? 'bg-stoniz-black text-white' : 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200'}`}
          >
            Tous ({listings.length})
          </button>
        </div>

        <button
          type="button"
          onClick={runSync}
          disabled={pending}
          className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 disabled:opacity-50 inline-flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${pending ? 'animate-spin' : ''}`} />
          {pending ? 'Sync…' : 'Synchroniser depuis Hostaway'}
        </button>
      </div>

      {msg && (
        <div className={`text-sm rounded-md px-3 py-2 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {listings.length === 0 ? (
        <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center">
          <p className="text-stoniz-gray-700 mb-2">Aucun listing synchronisé.</p>
          <p className="text-xs text-stoniz-gray-500">
            Clique sur <strong>« Synchroniser depuis Hostaway »</strong> pour démarrer.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
              <tr>
                <th className="px-3 py-3 text-left">Listing Hostaway</th>
                <th className="px-3 py-3 text-left">Adresse</th>
                <th className="px-3 py-3 text-left">Suite Stoniz</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stoniz-gray-100">
              {filteredListings.map((l) => {
                const isMatched = !!l.propria_unit_id;
                return (
                  <tr key={l.id} className={isMatched ? 'bg-emerald-50/30' : 'hover:bg-stoniz-gray-50'}>
                    <td className="px-3 py-3 align-top">
                      <div className="font-medium">{l.name ?? <em className="text-stoniz-gray-400">(sans nom)</em>}</div>
                      <div className="text-[11px] text-stoniz-gray-500 font-mono mt-0.5">
                        #{l.hostaway_id}
                        {!l.is_active && <span className="ml-2 text-red-600">inactif</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-top text-xs text-stoniz-gray-700 max-w-xs">
                      {l.address ?? '—'}
                    </td>
                    <td className="px-3 py-3 align-top min-w-[300px]">
                      {isMatched && l.matchedUnit ? (
                        <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-800 px-2 py-1 rounded-md text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span className="font-mono">{l.matchedUnit.code}</span>
                          {l.matchedUnit.property_name && (
                            <span className="text-emerald-700">· {l.matchedUnit.property_name}</span>
                          )}
                        </div>
                      ) : l.suggestions.length > 0 ? (
                        <div className="space-y-1.5">
                          {l.suggestions.map((s, idx) => (
                            <button
                              key={s.unit_id}
                              type="button"
                              onClick={() => confirmMatch(l.id, s.unit_id)}
                              disabled={pending}
                              className={`w-full text-left text-xs px-2 py-1.5 rounded border transition flex items-center justify-between gap-2 ${
                                idx === 0
                                  ? 'border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-900'
                                  : 'border-stoniz-gray-200 bg-white hover:bg-stoniz-gray-50 text-stoniz-gray-700'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {idx === 0 && <Sparkles className="w-3 h-3 flex-shrink-0" />}
                                <span className="font-mono">{s.unit_code}</span>
                                {s.property_name && (
                                  <span className="text-[11px] text-stoniz-gray-600 truncate">· {s.property_name}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[10px] text-stoniz-gray-500">{Math.round(s.score * 100)}%</span>
                                <span className="text-[11px] underline">Confirmer</span>
                              </div>
                            </button>
                          ))}
                          {/* Sélecteur manuel pour les cas où aucune suggestion ne convient */}
                          <ManualMatch
                            candidates={candidates}
                            disabled={pending}
                            onConfirm={(unitId) => confirmMatch(l.id, unitId)}
                          />
                        </div>
                      ) : (
                        <ManualMatch
                          candidates={candidates}
                          disabled={pending}
                          onConfirm={(unitId) => confirmMatch(l.id, unitId)}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3 align-top text-right">
                      {isMatched && (
                        <button
                          type="button"
                          onClick={() => unmatch(l.id)}
                          disabled={pending}
                          title="Retirer le matching"
                          className="text-stoniz-gray-400 hover:text-red-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredListings.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                    Aucun listing pour ce filtre.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Dropdown manuel : utile quand les suggestions auto sont à côté de la plaque. */
function ManualMatch({
  candidates,
  disabled,
  onConfirm,
}: {
  candidates: Candidate[];
  disabled: boolean;
  onConfirm: (unitId: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="flex gap-2 items-center mt-1.5 pt-1.5 border-t border-dashed border-stoniz-gray-200">
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        className="flex-1 text-xs border border-stoniz-gray-300 rounded px-2 py-1 bg-white"
      >
        <option value="">— Sélection manuelle —</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code}{c.property_name ? ` · ${c.property_name}` : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => value && onConfirm(value)}
        disabled={disabled || !value}
        className="text-xs px-2 py-1 rounded bg-stoniz-black text-white hover:bg-stoniz-gray-800 disabled:opacity-30"
      >
        OK
      </button>
    </div>
  );
}
