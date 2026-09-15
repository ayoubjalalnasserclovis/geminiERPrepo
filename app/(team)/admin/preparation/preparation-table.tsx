'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MailWarning, ExternalLink, AlertTriangle } from 'lucide-react';
import { batchActivateAction } from './actions';

type Row = {
  id: string;
  code: string | null;
  reference: string | null;
  current_phase: string;
  status: string;
  notion_page_id: string | null;
  client: { id: string; full_name: string; email: string; phone: string | null } | null;
  property: { id: string; name: string; quartier: string | null } | null;
  _is_placeholder_email: boolean;
  _bypass_count: number;
};

export function PreparationTable({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map(r => r.id)));
    }
  }

  function onBulkActivate() {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const placeholderInSelection = rows.filter(r => selected.has(r.id) && r._is_placeholder_email).length;

    const message = placeholderInSelection > 0
      ? `Activer ${ids.length} projet(s) ?\n\n⚠ ${placeholderInSelection} client(s) ont un email placeholder — l'invitation ne pourra pas leur être envoyée. Tu peux quand même activer (le projet sera visible côté staff) puis fixer les emails plus tard.\n\nConfirmer ?`
      : `Activer ${ids.length} projet(s) ?\n\nÇa va créer leurs comptes auth + envoyer les emails d'invitation.\n\nConfirmer ?`;

    if (!window.confirm(message)) return;

    setResult(null);
    start(async () => {
      const r = await batchActivateAction({ project_ids: ids, send_invitation_email: true });
      setResult(`Activés : ${r.success} | Échecs : ${r.failed} | Total : ${r.total}`);
      setSelected(new Set());
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center">
        <div className="font-medium mb-1">Aucun projet en mode préparation</div>
        <div className="text-sm text-stoniz-gray-600">
          Tous les projets sont activés ou aucun ne correspond aux filtres actuels.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Barre d'actions */}
      <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-lg p-3 mb-3 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-stoniz-gray-700">
          {selected.size > 0 ? (
            <span><strong>{selected.size}</strong> projet(s) sélectionné(s)</span>
          ) : (
            <span>Sélectionne des projets pour activer en batch</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onBulkActivate}
            disabled={selected.size === 0 || pending}
            className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? '…' : `Activer la sélection (${selected.size})`}
          </button>
        </div>
      </div>

      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3 text-sm text-emerald-900">
          {result}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
            <tr>
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Client</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Bien</th>
              <th className="px-4 py-3 text-center">Phase</th>
              <th className="px-4 py-3 text-center">Gates sautées</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {rows.map(r => (
              <tr key={r.id} className={`hover:bg-stoniz-gray-50 ${selected.has(r.id) ? 'bg-blue-50/40' : ''}`}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                  />
                </td>
                <td className="px-4 py-3 text-xs text-stoniz-gray-600">
                  {r.code ?? r.reference ?? '—'}
                </td>
                <td className="px-4 py-3 font-medium">{r.client?.full_name ?? '—'}</td>
                <td className="px-4 py-3 text-xs">
                  {r._is_placeholder_email ? (
                    <span className="inline-flex items-center gap-1 text-amber-700">
                      <MailWarning className="w-3.5 h-3.5" />
                      Placeholder
                    </span>
                  ) : (
                    <span className="text-stoniz-gray-700">{r.client?.email}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-stoniz-gray-700">
                  {r.property?.name ?? <span className="text-stoniz-gray-400 italic">aucun</span>}
                  {r.property?.quartier && <span className="text-stoniz-gray-500"> · {r.property.quartier}</span>}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-stoniz-gray-100 text-stoniz-gray-700">
                    {r.current_phase}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {r._bypass_count > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="w-3 h-3" />
                      {r._bypass_count}
                    </span>
                  ) : (
                    <span className="text-xs text-stoniz-gray-400">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/preparation/${r.id}`}
                    className="text-xs text-stoniz-black hover:underline inline-flex items-center gap-1"
                  >
                    Détail
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
