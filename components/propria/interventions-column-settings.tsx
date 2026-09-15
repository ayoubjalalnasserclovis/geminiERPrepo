'use client';

import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';

/**
 * Réglages d'affichage des colonnes du tableau interventions Propria.
 *
 * Comportement (décision CEO 2026-06-02) :
 *   - La colonne MARGE est masquée par DÉFAUT pour tout le monde (info business
 *     sensible, ne doit pas filtrer hors équipe finance/CEO).
 *   - Seul le CEO peut ouvrir le panneau de réglages pour réafficher MARGE
 *     ou masquer d'autres colonnes selon sa préférence.
 *   - Les préférences CEO sont persistées dans localStorage (par navigateur).
 *   - Les non-CEO n'ont aucun bouton — le défaut s'applique.
 *
 * Le composant injecte une <style> globale qui cache les colonnes via la règle
 * CSS `[data-col="..."] { display: none; }`. Les colonnes du tableau doivent
 * porter l'attribut data-col sur leur <th> et leurs <td>.
 */

type ColumnKey =
  | 'date' | 'echeance' | 'bien' | 'type' | 'description'
  | 'urgence' | 'statut' | 'assignee' | 'suivi'
  | 'hostaway' | 'cout' | 'refacturation' | 'marge';

/**
 * hiddenByDefault  : masquée par défaut pour TOUT LE MONDE (règle Marge CEO 2026-06-02).
 * sensitiveNonCeo  : visible par défaut pour CEO/developer, masquée par défaut
 *                    pour les autres rôles (décision CEO 2026-07-08 — coût
 *                    Propria + refacturation permettent de déduire la marge).
 */
type ColumnDef = { key: ColumnKey; label: string; hiddenByDefault?: boolean; sensitiveNonCeo?: boolean };

const COLUMNS: ColumnDef[] = [
  { key: 'date',          label: 'Date' },
  { key: 'echeance',      label: 'Échéance' },
  { key: 'bien',          label: 'Bien · Lot' },
  { key: 'type',          label: 'Type' },
  { key: 'description',   label: 'Description' },
  { key: 'urgence',       label: 'Urgence' },
  { key: 'statut',        label: 'Statut' },
  { key: 'assignee',      label: 'Assignée à' },
  { key: 'suivi',         label: 'Suivi par' },
  { key: 'hostaway',      label: 'Intégré Hostaway' },
  { key: 'cout',          label: 'Coût Propria', sensitiveNonCeo: true },
  { key: 'refacturation', label: 'Refacturation client', sensitiveNonCeo: true },
  { key: 'marge',         label: 'Marge', hiddenByDefault: true },
];

function defaultHidden(isCeo: boolean): ColumnKey[] {
  return COLUMNS
    .filter(c => c.hiddenByDefault || (c.sensitiveNonCeo && !isCeo))
    .map(c => c.key);
}
const LS_KEY = 'propria-interv-hidden-cols-v1';

export function InterventionsColumnSettings({ isCeo }: { isCeo: boolean }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState<ColumnKey[]>(defaultHidden(isCeo));
  const [mounted, setMounted] = useState(false);

  // Charge la préférence CEO depuis localStorage (côté CEO uniquement)
  useEffect(() => {
    setMounted(true);
    if (!isCeo) return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHidden(parsed as ColumnKey[]);
      }
    } catch {
      // ignore
    }
  }, [isCeo]);

  function toggle(key: ColumnKey) {
    setHidden(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function resetDefaults() {
    const defaults = defaultHidden(isCeo);
    setHidden(defaults);
    try { localStorage.setItem(LS_KEY, JSON.stringify(defaults)); } catch { /* ignore */ }
  }

  // CSS injecté pour cacher les colonnes
  const css = mounted
    ? hidden.map(k => `[data-col="${k}"] { display: none !important; }`).join('\n')
    : defaultHidden(isCeo).map(k => `[data-col="${k}"] { display: none !important; }`).join('\n');

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />

      {isCeo && (
        <div className="relative inline-block">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border border-stoniz-gray-300 hover:bg-stoniz-gray-50 bg-white"
          >
            <Settings2 className="w-4 h-4" />
            Colonnes
            {hidden.length > 0 && (
              <span className="ml-1 text-xs bg-stoniz-gray-100 text-stoniz-gray-700 rounded px-1.5">
                {COLUMNS.length - hidden.length}/{COLUMNS.length}
              </span>
            )}
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 mt-2 w-64 bg-white border border-stoniz-gray-200 rounded-lg shadow-lg z-50 p-3">
                <div className="text-xs uppercase text-stoniz-gray-500 mb-2">
                  Colonnes affichées
                </div>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {COLUMNS.map(c => {
                    const isVisible = !hidden.includes(c.key);
                    return (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-stoniz-gray-50 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={isVisible}
                          onChange={() => toggle(c.key)}
                        />
                        <span className={isVisible ? '' : 'text-stoniz-gray-400'}>
                          {c.label}
                          {(c.hiddenByDefault || c.sensitiveNonCeo) && (
                            <span className="text-[10px] text-stoniz-gray-400 ml-1">(sensible)</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="pt-2 mt-2 border-t border-stoniz-gray-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={resetDefaults}
                    className="text-xs text-stoniz-gray-600 hover:text-stoniz-black underline"
                  >
                    Réinitialiser
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-xs px-2 py-1 rounded bg-stoniz-black text-white hover:bg-stoniz-gray-800"
                  >
                    OK
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
