'use client';

// ─── Gestion des estimations achats (CEO 2026-08-19, session B) ────────────
// Tableau + formulaire d'ajout + actions par ligne :
//   Convertir en lot réel (verrouille la ligne) · Abandonner / Réactiver ·
//   Modifier · Supprimer (soft-delete, interdit sur une convertie).
// Une ligne convertie affiche le lot réel créé et l'écart estimé vs réel dès
// que le devis fournisseur du lot est signé.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, ArrowRightCircle, Undo2, Ban, Trash2, Pencil, X } from 'lucide-react';
import {
  createEstimationAction,
  updateEstimationAction,
  setEstimationStatusAction,
  deleteEstimationAction,
  convertEstimationToLotAction,
} from '@/app/(team)/projects/[id]/achats/estimations/actions';
import { ACHAT_CATEGORIES, formatAchatCategory, formatAchatLotStatus } from '@/lib/finance/achats-calc';
import { formatMad } from '@/lib/utils/format';

type ConvertedLot = {
  id: string;
  numero: number;
  budget_estimate_mad: number | null;
  devis_fournisseur_mad: number | null;
  status: string;
  deleted_at: string | null;
} | null;

type Estimation = {
  id: string;
  numero: number;
  category: string;
  description: string | null;
  supplier_name: string | null;
  supplier_id: string | null;
  quantity: number | null;
  unit_price_mad: number | null;
  prix_estime_mad: number | null;
  propria_unit_id: string | null;
  notes: string | null;
  status: 'estime' | 'converti' | 'abandonne';
  converted_lot: ConvertedLot;
};

type Supplier = { id: string; name: string | null };
type Unit = { id: string; code: string | null };

const EMPTY_FORM = {
  category: 'divers',
  description: '',
  supplier_name: '',
  supplier_id: '',
  quantity: '',
  unit_price_mad: '',
  prix_estime_mad: '',
  propria_unit_id: '',
  notes: '',
};

export function EstimationsManager({
  projectId,
  estimations,
  suppliers,
  units,
  abandonneesCount,
}: {
  projectId: string;
  estimations: Estimation[];
  suppliers: Supplier[];
  units: Unit[];
  abandonneesCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const [showAbandonnees, setShowAbandonnees] = useState(false);

  const unitById = useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  const visible = useMemo(
    () => estimations.filter((e) => showAbandonnees || e.status !== 'abandonne'),
    [estimations, showAbandonnees],
  );

  function set(k: string, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // Confort de saisie (même convention que achats_lots) : Q × PU
      // pré-remplit le prix estimé tant qu'il n'a pas été saisi à la main.
      if ((k === 'quantity' || k === 'unit_price_mad')) {
        const q = Number(k === 'quantity' ? v : next.quantity);
        const pu = Number(k === 'unit_price_mad' ? v : next.unit_price_mad);
        if (q > 0 && pu > 0) next.prix_estime_mad = String(Math.round(q * pu * 100) / 100);
      }
      return next;
    });
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setMsg(null);
  }

  function openEdit(e: Estimation) {
    setEditingId(e.id);
    setForm({
      category: e.category,
      description: e.description ?? '',
      supplier_name: e.supplier_name ?? '',
      supplier_id: e.supplier_id ?? '',
      quantity: e.quantity == null ? '' : String(e.quantity),
      unit_price_mad: e.unit_price_mad == null ? '' : String(e.unit_price_mad),
      prix_estime_mad: e.prix_estime_mad == null ? '' : String(e.prix_estime_mad),
      propria_unit_id: e.propria_unit_id ?? '',
      notes: e.notes ?? '',
    });
    setShowForm(true);
    setMsg(null);
  }

  function submitForm() {
    const payload = { ...form, project_id: projectId };
    start(async () => {
      const r = editingId
        ? await updateEstimationAction(editingId, payload).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }))
        : await createEstimationAction(payload).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' }); return; }
      setMsg({ kind: 'ok', text: editingId ? '✓ Estimation modifiée' : '✓ Estimation ajoutée' });
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      router.refresh();
    });
  }

  function runConvert(e: Estimation) {
    if (!confirm(`Convertir l'estimation #${e.numero} en lot réel ?\n\nUn lot sera créé dans le suivi achats avec le prix estimé (${formatMad(Number(e.prix_estime_mad ?? 0))}) en Devis prévisionnel. La ligne d'estimation sera verrouillée — pas de double conversion possible.`)) return;
    start(async () => {
      const r = await convertEstimationToLotAction(e.id).catch((er: any) => ({ ok: false as const, error: er?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' }); return; }
      setMsg({ kind: 'ok', text: `✓ Convertie → lot réel #${(r as any).lotNumero} créé dans le suivi achats` });
      router.refresh();
    });
  }

  function runStatus(e: Estimation, status: 'estime' | 'abandonne') {
    start(async () => {
      const r = await setEstimationStatusAction(e.id, status).catch((er: any) => ({ ok: false as const, error: er?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' }); return; }
      setMsg({ kind: 'ok', text: status === 'abandonne' ? `✓ Estimation #${e.numero} abandonnée` : `✓ Estimation #${e.numero} réactivée` });
      router.refresh();
    });
  }

  function runDelete(e: Estimation) {
    if (!confirm(`Supprimer l'estimation #${e.numero} ? (soft-delete, récupérable par le CEO)`)) return;
    start(async () => {
      const r = await deleteEstimationAction(e.id).catch((er: any) => ({ ok: false as const, error: er?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' }); return; }
      setMsg({ kind: 'ok', text: `✓ Estimation #${e.numero} supprimée` });
      router.refresh();
    });
  }

  function statusBadge(e: Estimation) {
    if (e.status === 'converti') {
      return <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 text-[11px]">Converti en réel</span>;
    }
    if (e.status === 'abandonne') {
      return <span className="inline-flex items-center rounded-full bg-stoniz-gray-100 border border-stoniz-gray-200 text-stoniz-gray-500 px-2 py-0.5 text-[11px]">Abandonné</span>;
    }
    return <span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-200 text-blue-800 px-2 py-0.5 text-[11px]">Estimé</span>;
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-medium">Lignes d'estimation ({visible.length})</div>
        <div className="flex items-center gap-2">
          {abandonneesCount > 0 && (
            <button type="button" onClick={() => setShowAbandonnees((v) => !v)}
              className="text-xs text-stoniz-gray-500 hover:text-stoniz-black underline">
              {showAbandonnees ? 'Masquer' : 'Afficher'} les abandonnées ({abandonneesCount})
            </button>
          )}
          <button type="button" onClick={openCreate}
            className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> Ajouter une estimation
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium">{editingId ? 'Modifier l\'estimation' : 'Nouvelle estimation'}</div>
            <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }}
              className="text-stoniz-gray-500 hover:text-stoniz-black"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <select value={form.category} onChange={(ev) => set('category', ev.target.value)}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5">
              {ACHAT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input type="text" placeholder="Description (ex : Micro-ondes Samsung 23L)" value={form.description}
              onChange={(ev) => set('description', ev.target.value)}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5 col-span-1 md:col-span-3" />
            <select value={form.supplier_id}
              onChange={(ev) => {
                const s = suppliers.find((x) => x.id === ev.target.value);
                setForm((f) => ({ ...f, supplier_id: ev.target.value, supplier_name: s?.name ?? f.supplier_name }));
              }}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5">
              <option value="">Fournisseur pressenti (optionnel)</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name ?? '?'}</option>)}
            </select>
            <input type="text" placeholder="ou nom libre" value={form.supplier_name}
              onChange={(ev) => set('supplier_name', ev.target.value)}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5" />
            <select value={form.propria_unit_id} onChange={(ev) => set('propria_unit_id', ev.target.value)}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5">
              <option value="">Bien global (parties communes)</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code ?? 'Suite ?'}</option>)}
            </select>
            <input type="number" min={0} step="0.01" placeholder="Quantité" value={form.quantity}
              onChange={(ev) => set('quantity', ev.target.value)}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5" />
            <input type="number" min={0} step="0.01" placeholder="Prix unitaire MAD" value={form.unit_price_mad}
              onChange={(ev) => set('unit_price_mad', ev.target.value)}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5" />
            <input type="number" min={0} step="0.01" placeholder="Prix estimé total MAD" value={form.prix_estime_mad}
              onChange={(ev) => set('prix_estime_mad', ev.target.value)}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5 font-medium" />
            <input type="text" placeholder="Notes" value={form.notes}
              onChange={(ev) => set('notes', ev.target.value)}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5 col-span-2" />
          </div>
          <button type="button" onClick={submitForm} disabled={pending}
            className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs disabled:opacity-50">
            {pending ? '…' : editingId ? '✓ Enregistrer' : '✓ Ajouter'}
          </button>
        </div>
      )}

      <div className="border border-stoniz-gray-200 rounded overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-stoniz-gray-50">
            <tr>
              <th className="px-2 py-1.5 text-left w-10">N°</th>
              <th className="px-2 py-1.5 text-left">Description</th>
              <th className="px-2 py-1.5 text-left">Catégorie</th>
              <th className="px-2 py-1.5 text-left">Fournisseur</th>
              <th className="px-2 py-1.5 text-left">Suite</th>
              <th className="px-2 py-1.5 text-right">Prix estimé</th>
              <th className="px-2 py-1.5 text-left">Statut</th>
              <th className="px-2 py-1.5 text-left">Lot réel / écart</th>
              <th className="px-2 py-1.5 text-right w-32">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {visible.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-stoniz-gray-400">
                Aucune estimation. Ajoute une première ligne pour chiffrer le prévisionnel de ce projet.
              </td></tr>
            )}
            {visible.map((e) => {
              const lot = e.converted_lot;
              const ecart = lot && lot.devis_fournisseur_mad != null && e.prix_estime_mad != null
                ? Number(lot.devis_fournisseur_mad) - Number(e.prix_estime_mad)
                : null;
              const abandoned = e.status === 'abandonne';
              return (
                <tr key={e.id} className={abandoned ? 'text-stoniz-gray-400' : ''}>
                  <td className="px-2 py-1.5 font-mono">{e.numero}</td>
                  <td className={`px-2 py-1.5 max-w-[220px] truncate ${abandoned ? 'line-through' : ''}`}>{e.description ?? '—'}</td>
                  <td className="px-2 py-1.5">{formatAchatCategory(e.category)}</td>
                  <td className="px-2 py-1.5 truncate max-w-[120px]">{e.supplier_name ?? <span className="text-stoniz-gray-400">à définir</span>}</td>
                  <td className="px-2 py-1.5">{e.propria_unit_id ? (unitById.get(e.propria_unit_id)?.code ?? '?') : 'Global'}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{e.prix_estime_mad == null ? '—' : formatMad(Number(e.prix_estime_mad))}</td>
                  <td className="px-2 py-1.5">{statusBadge(e)}</td>
                  <td className="px-2 py-1.5">
                    {lot ? (
                      <span>
                        <Link href={`/projects/${projectId}/achats`} className="text-blue-600 hover:underline">Lot #{lot.numero}</Link>
                        {' · '}{formatAchatLotStatus(lot.status)}
                        {ecart != null && (
                          <span className={ecart > 0 ? 'text-orange-600' : 'text-emerald-700'}>
                            {' · '}{ecart > 0 ? '+' : ''}{formatMad(ecart)} vs estimé
                          </span>
                        )}
                        {ecart == null && <span className="text-stoniz-gray-400"> · devis non signé</span>}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {e.status === 'estime' && (
                      <>
                        <button type="button" onClick={() => runConvert(e)} disabled={pending}
                          title="Convertir en lot réel"
                          className="text-emerald-700 hover:bg-emerald-50 rounded p-1"><ArrowRightCircle className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => openEdit(e)} disabled={pending}
                          title="Modifier"
                          className="text-stoniz-gray-600 hover:bg-stoniz-gray-100 rounded p-1"><Pencil className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => runStatus(e, 'abandonne')} disabled={pending}
                          title="Abandonner"
                          className="text-stoniz-gray-600 hover:bg-stoniz-gray-100 rounded p-1"><Ban className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => runDelete(e)} disabled={pending}
                          title="Supprimer (soft-delete)"
                          className="text-red-600 hover:bg-red-50 rounded p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                      </>
                    )}
                    {e.status === 'abandonne' && (
                      <>
                        <button type="button" onClick={() => runStatus(e, 'estime')} disabled={pending}
                          title="Réactiver"
                          className="text-blue-700 hover:bg-blue-50 rounded p-1"><Undo2 className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => runDelete(e)} disabled={pending}
                          title="Supprimer (soft-delete)"
                          className="text-red-600 hover:bg-red-50 rounded p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                      </>
                    )}
                    {e.status === 'converti' && (
                      <span className="text-[11px] text-stoniz-gray-400" title="Ligne verrouillée — modifie le lot réel directement">verrouillée</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {msg && (
        <div className={`text-xs rounded px-2 py-1.5 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
