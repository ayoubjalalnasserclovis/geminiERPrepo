'use client';

import { useState, useTransition } from 'react';
import { History, X, User, Clock, Plus, Edit, ArrowRightCircle, Link2, Link2Off, Trash2 } from 'lucide-react';
import type { FinanceAuditAction, FinanceAuditTable } from '@/lib/finance/audit';
import { fetchFinanceAuditEntries } from '@/app/actions/finance-audit';

/**
 * Timeline d'audit (CEO 2026-06-16).
 *
 * Composant client réutilisable :
 *   <FinanceAuditButton table="achats_encaissements" recordId={enc.id} />
 *
 * - Bouton icône (horloge) discret à droite de chaque ligne
 * - Click → modale avec timeline complète (qui/quand/quoi)
 * - Lazy-load : on charge l'historique seulement à l'ouverture
 */

type Entry = {
  id: string;
  occurred_at: string;
  action: FinanceAuditAction;
  label: string | null;
  payload: any;
  actor_id: string | null;
  actor_name: string | null;
};

const ACTION_META: Record<FinanceAuditAction, { icon: any; color: string; label: string }> = {
  create: { icon: Plus, color: 'text-emerald-600 bg-emerald-50', label: 'Création' },
  update: { icon: Edit, color: 'text-blue-600 bg-blue-50', label: 'Modification' },
  status_change: { icon: ArrowRightCircle, color: 'text-amber-600 bg-amber-50', label: 'Bascule statut' },
  allocate: { icon: Link2, color: 'text-purple-600 bg-purple-50', label: 'Allocation banque' },
  unallocate: { icon: Link2Off, color: 'text-stoniz-gray-600 bg-stoniz-gray-100', label: 'Désallocation' },
  delete: { icon: Trash2, color: 'text-red-600 bg-red-50', label: 'Suppression' },
  validate: { icon: Edit, color: 'text-purple-600 bg-purple-50', label: 'Validation' },
  attach_doc: { icon: Edit, color: 'text-indigo-600 bg-indigo-50', label: 'Doc attaché' },
  bulk_update: { icon: Edit, color: 'text-pink-600 bg-pink-50', label: 'Action en masse' },
  category_change: { icon: ArrowRightCircle, color: 'text-teal-600 bg-teal-50', label: 'Catégorie' },
  pending_merge: { icon: Edit, color: 'text-cyan-600 bg-cyan-50', label: 'Fusion pending→validé' },
  mask: { icon: Edit, color: 'text-stoniz-gray-600 bg-stoniz-gray-100', label: 'Masquage' },
  unmask: { icon: Edit, color: 'text-stoniz-gray-600 bg-stoniz-gray-100', label: 'Démasquage' },
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatValue(v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function renderPayload(payload: any) {
  if (!payload || typeof payload !== 'object') return null;
  const entries = Object.entries(payload);
  if (entries.length === 0) return null;
  return (
    <ul className="text-[11px] text-stoniz-gray-600 space-y-0.5 mt-1.5">
      {entries.map(([key, val]: [string, any]) => {
        // Diff structuré : { before, after }
        if (val && typeof val === 'object' && ('before' in val || 'after' in val)) {
          return (
            <li key={key} className="font-mono">
              <span className="text-stoniz-gray-500">{key}</span>{' : '}
              <span className="line-through text-red-600">{formatValue(val.before)}</span>{' → '}
              <span className="text-emerald-700">{formatValue(val.after)}</span>
            </li>
          );
        }
        // Champ simple
        return (
          <li key={key} className="font-mono">
            <span className="text-stoniz-gray-500">{key}</span>{' : '}
            <span>{formatValue(val)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function FinanceAuditButton({
  table,
  recordId,
  size = 'sm',
  inline = false,
}: {
  table: FinanceAuditTable;
  recordId: string;
  size?: 'sm' | 'md';
  /** Si true, affiche le texte "Historique" à côté de l'icône */
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setOpen(true);
    if (!entries) {
      start(async () => {
        try {
          const data = await fetchFinanceAuditEntries(table, recordId);
          setEntries(data as Entry[]);
        } catch (e: any) {
          setError(e?.message ?? 'Erreur');
        }
      });
    }
  }

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Voir l'historique des actions"
        className="inline-flex items-center gap-1 text-stoniz-gray-500 hover:text-stoniz-black text-[11px]"
      >
        <History className={iconSize} />
        {inline && <span>Historique</span>}
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-stoniz-gray-200 p-4 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg inline-flex items-center gap-2">
                  <History className="w-4 h-4 text-stoniz-gray-600" />
                  Historique des actions
                </h2>
                <p className="text-xs text-stoniz-gray-500 mt-0.5">
                  {entries == null ? '…' : `${entries.length} événement${entries.length > 1 ? 's' : ''}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-stoniz-gray-500 hover:text-stoniz-black p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-4">
              {pending && (
                <div className="text-center text-sm text-stoniz-gray-500 py-8">Chargement…</div>
              )}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3">
                  {error}
                </div>
              )}
              {entries != null && entries.length === 0 && (
                <div className="text-center text-sm text-stoniz-gray-500 py-8">
                  Aucun événement enregistré pour cette ligne.
                  <div className="text-[11px] text-stoniz-gray-400 mt-1">
                    L'historique commence à compter des actions à partir du 16/06/2026.
                  </div>
                </div>
              )}
              {entries != null && entries.length > 0 && (
                <ol className="relative space-y-3">
                  <span
                    aria-hidden
                    className="absolute left-3 top-2 bottom-2 w-px bg-stoniz-gray-200"
                  />
                  {entries.map((e) => {
                    const meta = ACTION_META[e.action] ?? ACTION_META.update;
                    const Icon = meta.icon;
                    return (
                      <li key={e.id} className="pl-9 relative">
                        <span
                          className={`absolute left-0 top-0 w-6 h-6 rounded-full ${meta.color} inline-flex items-center justify-center`}
                        >
                          <Icon className="w-3 h-3" />
                        </span>
                        <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded p-2.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-medium text-stoniz-gray-800">
                              {e.label ?? meta.label}
                            </span>
                            <span className="text-[10px] text-stoniz-gray-500 inline-flex items-center gap-1 shrink-0">
                              <Clock className="w-2.5 h-2.5" />
                              {fmtDateTime(e.occurred_at)}
                            </span>
                          </div>
                          <div className="text-[11px] text-stoniz-gray-600 mt-0.5 inline-flex items-center gap-1">
                            <User className="w-2.5 h-2.5" />
                            {e.actor_name ?? <span className="italic">(auteur supprimé)</span>}
                          </div>
                          {renderPayload(e.payload)}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
