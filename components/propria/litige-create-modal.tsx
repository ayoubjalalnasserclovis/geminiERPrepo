'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X, AlertCircle, Plus } from 'lucide-react';
import { createLitigeAction } from '@/app/(team)/propria/litiges/actions';

type Suite = { id: string; code: string; property_name: string | null };

type Resa = {
  hostaway_id: number;
  guest_name: string | null;
  arrival_date: string;
  departure_date: string;
  channel_name: string | null;
  total_price: number | null;
  currency: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  caution: '🛡️ Caution',
  degats: '🔨 Dégâts matériels',
  frais_contestes: '💶 Frais contestés',
  annulation_tardive: '⏰ Annulation tardive',
  tapage: '📢 Tapage / Comportement',
  menage: '🧹 Ménage',
  autre: '🔧 Autre',
};

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
}

export function LitigeCreateModal({
  suites,
  resasByUnit,
}: {
  suites: Suite[];
  /** Map unit_id → liste de résa des 30 derniers jours (par défaut, élargi via date) */
  resasByUnit: Record<string, Resa[]>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Filtres
  const [unitId, setUnitId] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  // Sélection résa
  const [selectedResa, setSelectedResa] = useState<number | null>(null);

  // Détails litige
  const [type, setType] = useState('caution');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');

  // Liste résa filtrée par date sur le listing sélectionné
  const allResasOnUnit = unitId ? (resasByUnit[unitId] ?? []) : [];
  const filteredResas = allResasOnUnit.filter((r) =>
    r.arrival_date >= dateFrom && r.arrival_date <= dateTo
  );

  function reset() {
    setUnitId(''); setSelectedResa(null);
    setType('caution'); setDescription(''); setAmount('');
    setErr(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedResa) { setErr('Sélectionne une réservation'); return; }
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set('hostaway_reservation_id', String(selectedResa));
    fd.set('type', type);
    fd.set('description', description);
    if (amount) fd.set('amount', amount);
    setErr(null);
    start(async () => {
      const r = await createLitigeAction(fd)
        .catch((ex: any) => ({ ok: false as const, error: ex?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setErr((r as any).error ?? 'Échec'); return; }
      setOpen(false); reset(); router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 inline-flex items-center gap-2">
        <Plus className="w-4 h-4" /> Créer un litige
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-stoniz-gray-200 px-5 py-4 flex items-center justify-between">
          <div className="text-lg font-medium">Créer un litige Airbnb</div>
          <button type="button" onClick={() => setOpen(false)}
            className="text-stoniz-gray-500 hover:text-stoniz-black">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {/* Étape 1 : Listing (suite) */}
          <div>
            <label className="text-xs font-medium text-stoniz-gray-700 mb-1 block">
              1. Listing (suite Stoniz matchée) *
            </label>
            <select value={unitId} onChange={(e) => { setUnitId(e.target.value); setSelectedResa(null); }}
              className="w-full border border-stoniz-gray-300 rounded px-2 py-1.5 text-sm">
              <option value="">— Choisir une suite —</option>
              {suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} {s.property_name ? `(${s.property_name})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Étape 2 : Filtre date */}
          {unitId && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-stoniz-gray-700 mb-1 block">Du</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full border border-stoniz-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-stoniz-gray-700 mb-1 block">Au</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="w-full border border-stoniz-gray-300 rounded px-2 py-1.5 text-sm" />
              </div>
            </div>
          )}

          {/* Étape 3 : Liste résa */}
          {unitId && (
            <div>
              <label className="text-xs font-medium text-stoniz-gray-700 mb-1 block">
                2. Réservation concernée * ({filteredResas.length} dans la période)
              </label>
              {filteredResas.length === 0 ? (
                <div className="text-xs text-stoniz-gray-500 bg-stoniz-gray-50 border border-stoniz-gray-200 rounded p-3">
                  Aucune réservation sur ce listing dans la période. Élargis les dates.
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto border border-stoniz-gray-200 rounded">
                  {filteredResas.map((r) => (
                    <button key={r.hostaway_id} type="button"
                      onClick={() => setSelectedResa(r.hostaway_id)}
                      className={`w-full text-left px-3 py-2 text-xs border-b border-stoniz-gray-100 last:border-b-0 ${
                        selectedResa === r.hostaway_id ? 'bg-blue-50 border-l-4 border-l-blue-600' : 'hover:bg-stoniz-gray-50'
                      }`}>
                      <div className="font-medium">{r.guest_name ?? 'Voyageur'}</div>
                      <div className="text-stoniz-gray-500">
                        {fmtDate(r.arrival_date)} → {fmtDate(r.departure_date)} · {r.channel_name ?? '?'}
                        {r.total_price && (
                          <span> · {Intl.NumberFormat('fr-FR').format(Number(r.total_price))} {r.currency ?? 'MAD'}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Étape 4 : Détails litige */}
          {selectedResa && (
            <>
              <div>
                <label className="text-xs font-medium text-stoniz-gray-700 mb-1 block">3. Type de litige *</label>
                <select value={type} onChange={(e) => setType(e.target.value)}
                  className="w-full border border-stoniz-gray-300 rounded px-2 py-1.5 text-sm">
                  {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-stoniz-gray-700 mb-1 block">Description (optionnelle)</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder="Contexte, détails du litige…"
                  className="w-full border border-stoniz-gray-300 rounded px-2 py-1.5 text-sm" rows={2} />
              </div>

              <div>
                <label className="text-xs font-medium text-stoniz-gray-700 mb-1 block">
                  Montant demandé (MAD)
                </label>
                <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                  placeholder="Ex : 500"
                  className="w-full border border-stoniz-gray-300 rounded px-2 py-1.5 text-sm" />
                <p className="text-[10px] text-stoniz-gray-500 mt-0.5">
                  Devient la 1re ligne du dossier — d&apos;autres éléments (avec coût réel, facture, photos)
                  s&apos;ajoutent ensuite depuis « Dossier complet ». Tout en MAD.
                </p>
                <input type="hidden" name="currency" value="MAD" />
              </div>

              <div>
                <label className="text-xs font-medium text-stoniz-gray-700 mb-1 block">Pièce jointe (optionnelle)</label>
                <input name="file" type="file" accept="application/pdf,image/*"
                  className="w-full text-xs" />
                <p className="text-[10px] text-stoniz-gray-500 mt-0.5">PDF / image, max 10 MB</p>
              </div>
            </>
          )}

          {err && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-stoniz-gray-100">
            <button type="button" onClick={() => setOpen(false)}
              className="px-4 py-2 text-xs text-stoniz-gray-600 hover:text-stoniz-black">
              Annuler
            </button>
            <button type="submit" disabled={pending || !selectedResa}
              className="bg-stoniz-black text-white px-4 py-2 rounded text-xs disabled:opacity-50">
              {pending ? 'Création…' : '✓ Créer le litige'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
