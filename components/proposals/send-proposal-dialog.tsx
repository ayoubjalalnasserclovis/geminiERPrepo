'use client';

import { useState, useTransition, useMemo } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Money } from '@/components/ui/money';
import { sendProposalsBatchAction } from '@/app/(team)/projects/[id]/proposals/actions';
import { calculateKPIs } from '@/lib/finance/property-calc';

type Property = {
  id: string;
  name: string;
  quartier: string | null;
  price: number | null;
  evaluation: number | null;
  badge_label: string | null;
  agency_fees: number | null;
  notary_fees: number | null;
  travaux_budget_estimate: number | null;
  estimated_rent: number | null;
  superficie: number | null;
  gross_yield: number | null;
};

export function SendProposalDialog({ projectId, properties }: {
  projectId: string;
  properties: Property[];
}) {
  const [open, setOpen] = useState(false);
  // selected = liste ordonnée (1er = meilleur)
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [teamNote, setTeamNote] = useState('');
  const [step, setStep] = useState<'pick' | 'review'>('pick');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return properties;
    return properties.filter(p =>
      norm(p.name).includes(q) || norm(p.quartier ?? '').includes(q)
    );
  }, [properties, query]);

  function toggle(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function toggleAllVisible() {
    setSelected(prev => {
      const allSelected = filtered.every(p => prev.includes(p.id));
      if (allSelected) return prev.filter(id => !filtered.some(p => p.id === id));
      const ids = filtered.map(p => p.id);
      return [...prev, ...ids.filter(id => !prev.includes(id))];
    });
  }

  function moveUp(idx: number) {
    if (idx <= 0) return;
    setSelected(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function moveDown(idx: number) {
    setSelected(prev => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  function submit() {
    if (selected.length === 0) return;
    if (teamNote.trim().length < 10) {
      setError('La note explicative est obligatoire (10 caractères minimum).');
      return;
    }
    setError(null);
    start(async () => {
      const r = await sendProposalsBatchAction({
        project_id: projectId,
        ordered_property_ids: selected,
        team_note: teamNote.trim(),
      });
      if (!r.ok && r.error_count && r.sent_count === 0) {
        setError(`Aucune proposition envoyée. ${r.errors?.[0]?.error ?? r.error ?? ''}`);
        return;
      }
      if (r.error_count && r.error_count > 0) {
        setError(`${r.sent_count} envoyée(s), ${r.error_count} en erreur.`);
        setTimeout(() => { setOpen(false); reset(); }, 1500);
        return;
      }
      setOpen(false);
      reset();
    });
  }

  function reset() {
    setSelected([]);
    setQuery('');
    setTeamNote('');
    setStep('pick');
    setError(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selected.includes(p.id));
  const propMap = useMemo(() => new Map(properties.map(p => [p.id, p])), [properties]);

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Envoyer une sélection</Button>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6" onClick={close}>
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b">
              <h2 className="font-display text-xl">
                {step === 'pick' ? 'Choisir les biens à proposer' : 'Ordonner et expliquer votre choix'}
              </h2>
              <p className="text-sm text-stoniz-gray-500">
                {step === 'pick'
                  ? 'Sélectionnez un ou plusieurs biens à inclure dans cette sélection.'
                  : 'Classez les biens (1 = meilleur choix) et expliquez votre sélection au client.'}
              </p>
              {step === 'pick' && (
                <>
                  <div className="mt-4 relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stoniz-gray-400" />
                    <Input
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      placeholder="Rechercher par nom ou quartier…"
                      className="pl-9"
                      autoFocus
                    />
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-stoniz-gray-500">
                      {filtered.length} bien{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''}
                      {selected.length > 0 && <> · <strong>{selected.length} sélectionné{selected.length > 1 ? 's' : ''}</strong></>}
                    </span>
                    {filtered.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleAllVisible}
                        className="text-xs text-stoniz-black hover:underline">
                        {allFilteredSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {step === 'pick' && (
            <div className="p-6 space-y-2 overflow-auto flex-1">
              {properties.length === 0 && (
                <p className="text-sm text-stoniz-gray-500">
                  Aucun bien disponible. Créez-en un dans /properties.
                </p>
              )}
              {properties.length > 0 && filtered.length === 0 && (
                <p className="text-sm text-stoniz-gray-500">
                  Aucun bien ne correspond à « {query} ».
                </p>
              )}
              {filtered.map(p => {
                const isChecked = selected.includes(p.id);
                const kpis = calculateKPIs({
                  price: p.price,
                  superficie: p.superficie,
                  agency_fees: p.agency_fees,
                  notary_fees: p.notary_fees,
                  travaux_budget_estimate: p.travaux_budget_estimate,
                  estimated_rent: p.estimated_rent,
                });
                return (
                  <label key={p.id}
                    className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
                      isChecked ? 'border-stoniz-black bg-stoniz-gray-50' : 'border-stoniz-gray-200 hover:border-stoniz-gray-400'
                    }`}>
                    <input type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(p.id)}
                      className="w-4 h-4 mt-1 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-stoniz-gray-500 flex items-center gap-2 mt-0.5">
                            <span>📍 {p.quartier ?? '—'}</span>
                            {p.evaluation && <span>{'⭐'.repeat(p.evaluation)}</span>}
                            {p.badge_label && (
                              <span className="inline-block px-2 py-0.5 rounded-full bg-yellow text-stoniz-black text-[10px] font-medium">
                                {p.badge_label}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-xs">
                        <Stat label="Prix bien" value={<Money amount={p.price} />} />
                        <Stat label="Coût total projet"
                          value={p.price ? <Money amount={kpis.cout_total_projet} /> : '—'}
                          emphasized />
                        <Stat label="Loyer / mois"
                          value={p.estimated_rent ? <Money amount={p.estimated_rent} /> : '—'} />
                        <Stat label="Rendement brut"
                          value={p.gross_yield != null
                            ? <span className="font-medium text-stoniz-black">{Number(p.gross_yield).toFixed(2)}%</span>
                            : (kpis.rendement_brut_pct > 0
                              ? <span className="font-medium text-stoniz-black">{kpis.rendement_brut_pct.toFixed(2)}%</span>
                              : '—')} />
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            )}

            {step === 'review' && (
              <div className="p-6 overflow-auto flex-1 space-y-5">
                <div>
                  <div className="text-sm font-medium mb-2">Ordre de présentation</div>
                  <p className="text-xs text-stoniz-gray-500 mb-3">
                    Utilisez ↑ ↓ pour réordonner. Le bien classé #1 sera mis en avant comme « coup de cœur ».
                  </p>
                  <ol className="space-y-2">
                    {selected.map((id, idx) => {
                      const p = propMap.get(id);
                      if (!p) return null;
                      return (
                        <li key={id} className="flex items-center gap-3 border border-stoniz-gray-200 rounded-lg p-3">
                          <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                            idx === 0 ? 'bg-stoniz-black text-white' : 'bg-stoniz-gray-100 text-stoniz-black'
                          }`}>{idx + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{p.name}</div>
                            <div className="text-xs text-stoniz-gray-500">{p.quartier ?? '—'}</div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0}
                              className="text-xs px-2 py-0.5 border border-stoniz-gray-300 rounded hover:bg-stoniz-gray-50 disabled:opacity-30">↑</button>
                            <button type="button" onClick={() => moveDown(idx)} disabled={idx === selected.length - 1}
                              className="text-xs px-2 py-0.5 border border-stoniz-gray-300 rounded hover:bg-stoniz-gray-50 disabled:opacity-30">↓</button>
                          </div>
                          <button type="button" onClick={() => toggle(id)}
                            className="text-xs text-red-600 hover:underline ml-2">retirer</button>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Note explicative pour le client <span className="text-red-600">*</span>
                  </label>
                  <p className="text-xs text-stoniz-gray-500 mb-2">
                    Cette note apparaîtra dans l&apos;email envoyé au client ET sur son portail. Expliquez vos raisons : pourquoi ce(s) bien(s), points forts, à quoi faire attention, etc.
                  </p>
                  <textarea
                    value={teamNote}
                    onChange={e => setTeamNote(e.target.value)}
                    rows={6}
                    placeholder="Ex : Suite à votre cahier des charges, je vous propose 3 biens qui correspondent à votre budget et à vos critères de localisation. Le premier est mon coup de cœur car..."
                    className="w-full border border-stoniz-gray-300 rounded-md p-3 text-sm"
                    autoFocus
                  />
                  <div className="text-xs text-stoniz-gray-500 mt-1">
                    {teamNote.length} caractères — minimum 10
                  </div>
                </div>
              </div>
            )}

            {error && <div className="px-6 pb-2 text-sm text-red-600">{error}</div>}

            <div className="p-6 border-t flex justify-between items-center gap-2">
              <span className="text-sm text-stoniz-gray-500">
                {selected.length === 0
                  ? 'Aucun bien sélectionné'
                  : `${selected.length} bien${selected.length > 1 ? 's' : ''} dans la sélection`}
              </span>
              <div className="flex gap-2">
                {step === 'pick' ? (
                  <>
                    <Button variant="secondary" onClick={close} disabled={pending}>Annuler</Button>
                    <Button disabled={selected.length === 0} onClick={() => setStep('review')}>
                      Suivant : ordonner et expliquer →
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="secondary" onClick={() => setStep('pick')} disabled={pending}>← Modifier la sélection</Button>
                    <Button disabled={selected.length === 0 || pending || teamNote.trim().length < 10} onClick={submit}>
                      {pending ? 'Envoi…' : `Envoyer la sélection (${selected.length})`}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, emphasized }: { label: string; value: React.ReactNode; emphasized?: boolean }) {
  return (
    <div>
      <div className="text-stoniz-gray-500">{label}</div>
      <div className={emphasized ? 'font-medium text-stoniz-black' : ''}>{value}</div>
    </div>
  );
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
