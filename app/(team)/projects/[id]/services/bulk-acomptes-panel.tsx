'use client';

import { useMemo, useState } from 'react';
import { CheckSquare, Square, X } from 'lucide-react';
import { BulkAcomptesManager } from '@/components/finance/bulk-acomptes-manager';
import { formatServiceCategory } from '@/lib/finance/services-calc';

/**
 * Panneau "Actions en bulk" du module SERVICES (CEO 2026-07-08).
 *
 * Le module services n'avait aucun panneau bulk — celui-ci se limite à la
 * gestion des acomptes existants (supprimer / date / montant), symétrique aux
 * panneaux achats/travaux. Sélection de lots prestataires → sous-panneau
 * <BulkAcomptesManager> partagé.
 */

type ServiceLot = {
  id: string;
  service_category: string;
  description: string | null;
  devis_prestataire_mad: number | null;
  provider?: { id: string; name: string } | null;
};

type ServicePayment = {
  id: string;
  lot_id: string | null;
  acompte_index: number | null;
  status: string;
  amount_total: number | null;
  scheduled_date: string | null;
};

export function ServicesBulkAcomptesPanel({
  projectId,
  lots,
  payments,
}: {
  projectId: string;
  lots: ServiceLot[];
  payments: ServicePayment[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [managing, setManaging] = useState(false);

  const selectedLots = useMemo(() => lots.filter((l) => selected.has(l.id)), [lots, selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === lots.length ? new Set() : new Set(lots.map((l) => l.id))));
  }

  if (lots.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-stoniz-gray-300 px-3 py-1.5 rounded-md text-xs hover:bg-stoniz-gray-50 inline-flex items-center gap-1.5"
      >
        <CheckSquare className="w-3.5 h-3.5" />
        Actions en bulk
      </button>
    );
  }

  return (
    <div className="bg-white border-2 border-blue-300 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium inline-flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-blue-600" />
          Sélection multiple ({selected.size}/{lots.length})
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); setSelected(new Set()); setManaging(false); }}
          className="text-stoniz-gray-500 hover:text-stoniz-black inline-flex items-center gap-1 text-xs"
        >
          <X className="w-3 h-3" /> Fermer
        </button>
      </div>

      <div className="border border-stoniz-gray-200 rounded max-h-60 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-stoniz-gray-50 sticky top-0">
            <tr>
              <th className="px-2 py-1.5 w-8">
                <button type="button" onClick={toggleAll} title="Tout cocher / décocher">
                  {selected.size === lots.length && lots.length > 0
                    ? <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                    : <Square className="w-3.5 h-3.5 text-stoniz-gray-400" />}
                </button>
              </th>
              <th className="px-2 py-1.5 text-left">Catégorie</th>
              <th className="px-2 py-1.5 text-left">Prestataire</th>
              <th className="px-2 py-1.5 text-right w-28">Devis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {lots.map((l) => (
              <tr key={l.id} className={selected.has(l.id) ? 'bg-blue-50' : 'hover:bg-stoniz-gray-50'}>
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => toggle(l.id)}>
                    {selected.has(l.id)
                      ? <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                      : <Square className="w-3.5 h-3.5 text-stoniz-gray-400" />}
                  </button>
                </td>
                <td className="px-2 py-1.5">{formatServiceCategory(l.service_category)}</td>
                <td className="px-2 py-1.5 truncate max-w-[160px]">{l.provider?.name ?? '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {l.devis_prestataire_mad != null
                    ? `${Math.round(Number(l.devis_prestataire_mad)).toLocaleString('fr-FR')} MAD`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && !managing && (
        <button
          type="button"
          onClick={() => setManaging(true)}
          className="bg-orange-50 text-orange-800 border border-orange-200 px-3 py-1.5 rounded text-xs hover:bg-orange-100"
        >
          Gérer les acomptes de {selected.size} lot{selected.size > 1 ? 's' : ''}
        </button>
      )}

      {managing && selected.size > 0 && (
        <div className="border-t border-stoniz-gray-200 pt-3">
          <BulkAcomptesManager
            projectId={projectId}
            source="services"
            lots={selectedLots.map((l) => ({
              id: l.id,
              label: `${formatServiceCategory(l.service_category)} (${l.provider?.name ?? '?'})`,
              devis: l.devis_prestataire_mad != null ? Number(l.devis_prestataire_mad) : null,
            }))}
            payments={payments.map((p) => ({
              id: p.id,
              lot_id: p.lot_id,
              acompte_number: p.acompte_index,
              status: p.status,
              amount_total: Number(p.amount_total ?? 0),
              scheduled_date: p.scheduled_date ?? null,
            }))}
            onClose={() => setManaging(false)}
          />
        </div>
      )}
    </div>
  );
}
