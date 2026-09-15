'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';

/** Débounce autosave mesure pendant que l'utilisateur tape (chantier 5 UX terrain). */
const MEASURE_AUTOSAVE_DELAY_MS = 700;
import {
  CHECKUP_INVENTORY_ITEMS,
  CHECKUP_MEASUREMENT_ITEMS,
} from '@/lib/propria/checkup-checklist';
import {
  upsertCheckupInventoryAction,
  upsertCheckupMeasurementAction,
} from '@/app/(team)/propria/checkups/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

export type InventoryRow = {
  item_key: string;
  expected_qty: number;
  actual_qty: number | null;
  missing_list: string[];
  note: string | null;
};

export type MeasurementRow = {
  item_key: string;
  value_numeric: number;
  unit: string;
  note: string | null;
};

/**
 * Section « Inventaire & mesures » (chantier 3 marathon, CEO 2026-06-18).
 *
 * Compteurs vaisselle (assiettes X/6, fourchettes Y/6…) + manquants libres
 * (couteau cuisine, tire-bouchon…) + mesures chiffrées (débit wifi en Mbps).
 *
 * Inspiré du rapport Kamil Bernat (JOUNDI 4 — 10/06/2026) qui contenait
 * exactement ce type d'information chiffrée que la checklist OK/Problème/N/A
 * ne savait pas capter.
 */
export function CheckupInventoryGrid({
  checkupId,
  inventory,
  measurements,
  canEdit,
}: {
  checkupId: string;
  inventory: InventoryRow[];
  measurements: MeasurementRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const invByKey = new Map(inventory.map((i) => [i.item_key, i]));
  const measByKey = new Map(measurements.map((m) => [m.item_key, m]));

  // State des drafts (édition non sauvegardée)
  const [drafts, setDrafts] = useState<Record<string, { actual?: string; missingDraft?: string; note?: string }>>({});
  const [measureDrafts, setMeasureDrafts] = useState<Record<string, { value?: string; note?: string }>>({});

  // Timers d'autosave par item de mesure (chantier 5 : suppression du bouton "Enregistrer"
  // → autosave on-blur + débounce 700ms pendant la frappe, comme le reste de la grille).
  const measureTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    return () => {
      Object.values(measureTimers.current).forEach(clearTimeout);
    };
  }, []);

  function saveInventory(itemKey: string, patch: Partial<InventoryRow>) {
    const existing = invByKey.get(itemKey);
    const defaultItem = CHECKUP_INVENTORY_ITEMS.find((i) => i.key === itemKey);
    const expected = existing?.expected_qty ?? defaultItem?.defaultExpected ?? 6;
    const draft = drafts[itemKey] ?? {};
    const actualStr = patch.actual_qty !== undefined ? String(patch.actual_qty ?? '') : draft.actual ?? (existing?.actual_qty?.toString() ?? '');
    const actualNum = actualStr.trim() ? Number(actualStr) : null;
    setErr(null);
    start(async () => {
      try {
        const r = await upsertCheckupInventoryAction({
          checkup_id: checkupId,
          item_key: itemKey,
          expected_qty: expected,
          actual_qty: actualNum,
          missing_list: patch.missing_list ?? existing?.missing_list ?? [],
          note: patch.note !== undefined ? patch.note : (draft.note ?? existing?.note ?? null),
        });
        if (!r || !r.ok) { setErr(r?.error ?? 'Erreur inconnue'); return; }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  function addMissingItem(itemKey: string) {
    const draft = drafts[itemKey]?.missingDraft?.trim();
    if (!draft) return;
    const existing = invByKey.get(itemKey);
    const newList = [...(existing?.missing_list ?? []), draft];
    setDrafts((d) => ({ ...d, [itemKey]: { ...d[itemKey], missingDraft: '' } }));
    saveInventory(itemKey, { missing_list: newList });
  }

  function removeMissingItem(itemKey: string, idx: number) {
    const existing = invByKey.get(itemKey);
    const newList = (existing?.missing_list ?? []).filter((_, i) => i !== idx);
    saveInventory(itemKey, { missing_list: newList });
  }

  function saveMeasurement(itemKey: string, unit: string) {
    const draft = measureDrafts[itemKey] ?? {};
    const existing = measByKey.get(itemKey);
    const valStr = draft.value ?? existing?.value_numeric?.toString() ?? '';
    const valNum = valStr.trim() ? Number(valStr.replace(',', '.')) : null;
    if (valNum == null || !isFinite(valNum)) {
      // Silencieux en autosave on-blur : ne pas crier si vide
      return;
    }
    // Pas de save inutile si la valeur n'a pas changé
    if (existing?.value_numeric === valNum && (draft.note ?? null) === (existing?.note ?? null)) {
      return;
    }
    setErr(null);
    start(async () => {
      try {
        const r = await upsertCheckupMeasurementAction({
          checkup_id: checkupId,
          item_key: itemKey,
          value_numeric: valNum,
          unit,
          note: draft.note ?? existing?.note ?? null,
        });
        if (!r || !r.ok) { setErr(r?.error ?? 'Erreur inconnue'); return; }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 space-y-5">
      <div>
        <h2 className="font-display text-lg">🍽️ Inventaire & mesures</h2>
        <p className="text-xs text-stoniz-gray-500 mt-0.5">
          Compteurs vaisselle (constaté / attendu), manquants libres, mesures chiffrées (wifi, etc.).
        </p>
      </div>

      {err && <SessionExpiredBanner error={err} />}

      {/* Inventaire vaisselle */}
      <div>
        <h3 className="text-sm font-medium text-stoniz-gray-800 mb-2">Inventaire vaisselle</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {CHECKUP_INVENTORY_ITEMS.map((item) => {
            const row = invByKey.get(item.key);
            const expected = row?.expected_qty ?? item.defaultExpected;
            const actualDraft = drafts[item.key]?.actual ?? (row?.actual_qty?.toString() ?? '');
            const isComplete = row?.actual_qty != null && row.actual_qty >= expected;
            const isPartial = row?.actual_qty != null && row.actual_qty < expected && row.actual_qty > 0;
            const isEmpty = row?.actual_qty === 0;
            const color = isComplete ? 'border-emerald-300 bg-emerald-50/40'
              : isEmpty ? 'border-red-300 bg-red-50/40'
              : isPartial ? 'border-orange-300 bg-orange-50/40'
              : 'border-stoniz-gray-200';
            return (
              <div key={item.key} className={`border rounded-lg p-2.5 ${color}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-sm">{item.emoji} {item.label}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* text-base sur mobile pour éviter le zoom auto Safari iOS (<16px = zoom).
                      Compact text-sm seulement à partir de sm (desktop). */}
                  <input
                    type="text"
                    inputMode="numeric"
                    value={actualDraft}
                    disabled={!canEdit || pending}
                    onChange={(e) => setDrafts((d) => ({ ...d, [item.key]: { ...d[item.key], actual: e.target.value } }))}
                    onBlur={() => actualDraft !== (row?.actual_qty?.toString() ?? '') && saveInventory(item.key, {})}
                    className="w-16 sm:w-14 border border-stoniz-gray-300 rounded-md px-2 py-2 sm:py-1 text-base sm:text-sm text-center"
                    placeholder="?"
                  />
                  <span className="text-sm text-stoniz-gray-600">/ {expected}</span>
                </div>
                {/* Manquants libres rattachés à cet item */}
                {(row?.missing_list?.length ?? 0) > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {row!.missing_list.map((m, idx) => (
                      <li key={idx} className="flex items-center justify-between text-[11px] bg-white border border-stoniz-gray-200 rounded px-1.5 py-0.5">
                        <span className="truncate">{m}</span>
                        {canEdit && (
                          <button onClick={() => removeMissingItem(item.key, idx)}
                            className="text-stoniz-gray-400 hover:text-red-600 ml-1 flex-shrink-0">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canEdit && (
                  <div className="mt-2 flex gap-1">
                    {/* text-base sur mobile : anciennement text-[11px] = zoom Safari
                        garanti + clavier qui couvre 50 % de l'écran. text-xs en sm+. */}
                    <input
                      type="text"
                      placeholder="+ manquant"
                      value={drafts[item.key]?.missingDraft ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [item.key]: { ...d[item.key], missingDraft: e.target.value } }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMissingItem(item.key); } }}
                      className="flex-1 min-w-0 border border-stoniz-gray-300 rounded-md px-2 py-2 sm:py-0.5 text-base sm:text-xs"
                    />
                    <button
                      onClick={() => addMissingItem(item.key)}
                      disabled={pending}
                      aria-label="Ajouter manquant"
                      className="bg-stoniz-black text-white px-2 rounded-md disabled:opacity-40 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:px-1.5 flex items-center justify-center"
                    >
                      <Plus className="w-4 h-4 sm:w-3 sm:h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mesures chiffrées */}
      <div>
        <h3 className="text-sm font-medium text-stoniz-gray-800 mb-2">Mesures chiffrées</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CHECKUP_MEASUREMENT_ITEMS.map((item) => {
            const row = measByKey.get(item.key);
            const valueDraft = measureDrafts[item.key]?.value ?? (row?.value_numeric?.toString() ?? '');
            return (
              <div key={item.key} className="border border-stoniz-gray-200 rounded-lg p-2.5">
                <div className="text-sm mb-1">{item.emoji} {item.label}</div>
                {item.hint && <div className="text-[11px] text-stoniz-gray-500 mb-1.5">{item.hint}</div>}
                <div className="flex items-center gap-2">
                  {/* Chantier 5 : autosave on-blur + débounce 700ms (cohérent avec
                      l'inventaire et la checklist). Le bouton "Enregistrer" manuel
                      a été supprimé — il était la seule action manuelle restante.
                      text-base sur mobile pour éviter le zoom Safari iOS. */}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={valueDraft}
                    disabled={!canEdit || pending}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMeasureDrafts((d) => ({ ...d, [item.key]: { ...d[item.key], value: v } }));
                      if (!canEdit) return;
                      const t = measureTimers.current[item.key];
                      if (t) clearTimeout(t);
                      measureTimers.current[item.key] = setTimeout(() => {
                        saveMeasurement(item.key, item.unit);
                      }, MEASURE_AUTOSAVE_DELAY_MS);
                    }}
                    onBlur={() => {
                      const t = measureTimers.current[item.key];
                      if (t) clearTimeout(t);
                      if (canEdit) saveMeasurement(item.key, item.unit);
                    }}
                    className="w-24 border border-stoniz-gray-300 rounded-md px-2 py-2 sm:py-1 text-base sm:text-sm"
                    placeholder="?"
                  />
                  <span className="text-sm text-stoniz-gray-600">{item.unit}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
