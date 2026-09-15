'use client';

// ─── Chantier 1 marathon — Section « Accès & Clés » d'un lot ────────────────
// 4 blocs consultant : Accès Voyageur · Clé Sécurité · Armoire · Stock Bureau.
// Tous les compteurs viennent de la vue propria_unit_keys_status (dérivés).
// Aucune saisie de comptage : on AJOUTE un jeu ou on le DÉPLACE.

import { useState, useTransition } from 'react';
import { KeyRound, Plus, MapPin, AlertTriangle, History } from 'lucide-react';
import { addKeyAction, moveKeyAction, softDeleteKeyAction, updateSecurityKeyAction } from '@/app/(team)/propria/cles/actions';

const LOCATION_LABELS: Record<string, string> = {
  boite_voyageur: 'Boîte voyageur',
  armoire_logement: 'Armoire logement',
  bureau: 'Bureau',
  externe: 'Externe (artisan, autre)',
  perdue: 'Perdue',
};

const TYPE_LABELS: Record<string, string> = {
  voyageur: 'Voyageur',
  reserve: 'Réserve',
  securite: 'Sécurité',
};

export type UnitKeysStatus = {
  propria_unit_id: string;
  nb_total: number;
  nb_boite_voyageur: number;
  nb_armoire: number;
  nb_bureau: number;
  nb_externe: number;
  nb_perdues: number;
  bureau_alert: 'ok' | 'warn' | 'critique';
  armoire_alert: 'ok' | 'warn';
  total_alert: 'ok' | 'warn';
};

export type UnitKey = {
  id: string;
  key_number: number;
  key_type: string;
  current_location: string;
  label: string | null;
};

type UnitAccess = {
  id: string;
  code: string | null;
  propria_lock_code: string | null;
  propria_key_box_suite: string | null;
  propria_key_box_location: string | null;
  propria_arrival_instructions: string | null;
  propria_security_key_location: string | null;
  propria_security_key_code: string | null;
};

function AlertBadge({ level }: { level: string }) {
  if (level === 'critique')
    return <span className="inline-flex items-center gap-1 text-[11px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full"><AlertTriangle className="w-3 h-3" />critique</span>;
  if (level === 'warn')
    return <span className="inline-flex items-center gap-1 text-[11px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full"><AlertTriangle className="w-3 h-3" />seuil bas</span>;
  return <span className="text-[11px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">ok</span>;
}

export function PropriaUnitKeysSection({
  unit,
  propertyId,
  status,
  keys,
  userRole,
}: {
  unit: UnitAccess;
  propertyId: string;
  status: UnitKeysStatus | null;
  keys: UnitKey[];
  userRole: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editSecurity, setEditSecurity] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'Erreur');
    });

  const addKey = (keyType: string) => {
    const fd = new FormData();
    fd.set('propria_unit_id', unit.id);
    fd.set('property_id', propertyId);
    fd.set('key_type', keyType);
    run(() => addKeyAction(fd));
  };

  const moveKey = (keyId: string, to: string) => {
    const fd = new FormData();
    fd.set('key_id', keyId);
    fd.set('property_id', propertyId);
    fd.set('to_location', to);
    run(() => moveKeyAction(fd));
  };

  const removeKey = (keyId: string) => {
    const reason = window.prompt('Raison du retrait de ce jeu de clés (min 5 caractères) :');
    if (!reason) return;
    const fd = new FormData();
    fd.set('key_id', keyId);
    fd.set('property_id', propertyId);
    fd.set('reason', reason);
    run(() => softDeleteKeyAction(fd));
  };

  const saveSecurity = (form: HTMLFormElement) => {
    const fd = new FormData(form);
    fd.set('propria_unit_id', unit.id);
    fd.set('property_id', propertyId);
    run(async () => {
      const res = await updateSecurityKeyAction(fd);
      if (res.ok) setEditSecurity(false);
      return res;
    });
  };

  const activeKeys = keys.filter((k) => k.current_location !== 'perdue');
  const lostKeys = keys.filter((k) => k.current_location === 'perdue');

  return (
    <section className="bg-white border border-stoniz-gray-200 rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg flex items-center gap-2">
          <KeyRound className="w-4 h-4" /> Accès &amp; Clés {unit.code ? `· ${unit.code}` : ''}
        </h2>
        {status && status.total_alert === 'warn' && (
          <span className="text-xs text-amber-700">Cible 4 jeux — actuellement {status.nb_total}</span>
        )}
      </div>

      {error && <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

      {/* 4 blocs consultant */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <div className="border border-stoniz-gray-200 rounded-lg p-3">
          <div className="text-xs text-stoniz-gray-500 mb-1">Accès Voyageur</div>
          <div className="text-sm">
            {unit.propria_lock_code && <div>Code serrure : <strong>{unit.propria_lock_code}</strong></div>}
            {unit.propria_key_box_suite && <div>Boîte à clés : <strong>{unit.propria_key_box_suite}</strong></div>}
            {unit.propria_key_box_location && (
              <div className="flex items-center gap-1 text-stoniz-gray-600 text-xs mt-1">
                <MapPin className="w-3 h-3" /> {unit.propria_key_box_location}
              </div>
            )}
            <div className="text-xs mt-1">Jeux en boîte : <strong>{status?.nb_boite_voyageur ?? 0}</strong></div>
            {!unit.propria_lock_code && !unit.propria_key_box_suite && (
              <div className="text-xs text-stoniz-gray-400">Non renseigné</div>
            )}
          </div>
        </div>

        <div className="border border-stoniz-gray-200 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-stoniz-gray-500 mb-1">Clé Sécurité</div>
            <button
              type="button"
              onClick={() => setEditSecurity((v) => !v)}
              className="text-[11px] text-stoniz-gray-500 hover:text-stoniz-black underline"
            >
              {editSecurity ? 'annuler' : 'modifier'}
            </button>
          </div>
          {editSecurity ? (
            <form
              onSubmit={(e) => { e.preventDefault(); saveSecurity(e.currentTarget); }}
              className="space-y-2"
            >
              <input
                name="propria_security_key_location"
                defaultValue={unit.propria_security_key_location ?? ''}
                placeholder="Emplacement (ex: coffre bureau)"
                className="w-full text-xs border border-stoniz-gray-300 rounded px-2 py-1"
              />
              <input
                name="propria_security_key_code"
                defaultValue={unit.propria_security_key_code ?? ''}
                placeholder="Code"
                className="w-full text-xs border border-stoniz-gray-300 rounded px-2 py-1"
              />
              <button
                type="submit"
                disabled={isPending}
                className="text-xs bg-stoniz-black text-white px-3 py-1 rounded disabled:opacity-50"
              >
                Enregistrer
              </button>
              <div className="text-[10px] text-stoniz-gray-400 flex items-center gap-1">
                <History className="w-3 h-3" /> Chaque changement de code est historisé
              </div>
            </form>
          ) : (
            <div className="text-sm">
              {unit.propria_security_key_location
                ? <div>{unit.propria_security_key_location}</div>
                : <div className="text-xs text-stoniz-gray-400">Emplacement non renseigné</div>}
              {unit.propria_security_key_code && <div>Code : <strong>{unit.propria_security_key_code}</strong></div>}
            </div>
          )}
        </div>

        <div className="border border-stoniz-gray-200 rounded-lg p-3">
          <div className="text-xs text-stoniz-gray-500 mb-1">Armoire logement</div>
          <div className="text-xl font-display">{status?.nb_armoire ?? 0}</div>
          <div className="text-xs text-stoniz-gray-600 mb-1">jeux de réserve (attendu : 2)</div>
          <AlertBadge level={status?.armoire_alert ?? 'warn'} />
        </div>

        <div className="border border-stoniz-gray-200 rounded-lg p-3">
          <div className="text-xs text-stoniz-gray-500 mb-1">Stock Bureau</div>
          <div className="text-xl font-display">{status?.nb_bureau ?? 0}</div>
          <div className="text-xs text-stoniz-gray-600 mb-1">jeux au bureau</div>
          <AlertBadge level={status?.bureau_alert ?? 'critique'} />
        </div>
      </div>

      {/* Liste des jeux + mouvements */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider">
          Jeux de clés ({activeKeys.length} actifs{lostKeys.length > 0 ? `, ${lostKeys.length} perdu(s)` : ''})
        </div>
        <button
          type="button"
          onClick={() => addKey('reserve')}
          disabled={isPending}
          className="inline-flex items-center gap-1 text-xs bg-stoniz-black text-white px-3 py-1.5 rounded hover:bg-stoniz-gray-800 disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> Ajouter un jeu (arrive au bureau)
        </button>
      </div>

      {keys.length === 0 ? (
        <div className="text-xs text-stoniz-gray-400 border border-dashed border-stoniz-gray-200 rounded p-4 text-center">
          Aucun jeu enregistré. Ajoute les jeux physiques lors de l&apos;inventaire terrain.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stoniz-gray-500 border-b border-stoniz-gray-200">
              <th className="py-1.5 pr-2">N°</th>
              <th className="py-1.5 pr-2">Type</th>
              <th className="py-1.5 pr-2">Emplacement</th>
              <th className="py-1.5 pr-2">Déplacer vers…</th>
              {userRole === 'ceo' && <th className="py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className={`border-b border-stoniz-gray-100 ${k.current_location === 'perdue' ? 'opacity-50' : ''}`}>
                <td className="py-1.5 pr-2 font-mono text-xs">#{k.key_number}</td>
                <td className="py-1.5 pr-2 text-xs">{TYPE_LABELS[k.key_type] ?? k.key_type}{k.label ? ` · ${k.label}` : ''}</td>
                <td className="py-1.5 pr-2 text-xs">{LOCATION_LABELS[k.current_location] ?? k.current_location}</td>
                <td className="py-1.5 pr-2">
                  <select
                    className="text-xs border border-stoniz-gray-300 rounded px-1.5 py-1"
                    value=""
                    disabled={isPending}
                    onChange={(e) => { if (e.target.value) moveKey(k.id, e.target.value); }}
                  >
                    <option value="">—</option>
                    {Object.entries(LOCATION_LABELS)
                      .filter(([loc]) => loc !== k.current_location)
                      .map(([loc, label]) => (
                        <option key={loc} value={loc}>{label}</option>
                      ))}
                  </select>
                </td>
                {userRole === 'ceo' && (
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeKey(k.id)}
                      className="text-[11px] text-red-500 hover:text-red-700 underline"
                    >
                      retirer
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
