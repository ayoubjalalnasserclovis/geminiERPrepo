import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { madToEur } from '@/lib/finance/fx-fixed';
import { getActiveLotOptions } from '@/lib/propria/lots';
import {
  COST_PARAM_KEYS,
  COST_PARAM_META,
  loadCostParams,
  resolveParam,
  type CostParamKey,
  type CostParamRow,
} from '@/lib/propria/cost-matrix';
import { addCostParamAction, softDeleteCostParamAction } from './actions';

/**
 * Écran de saisie des coûts unitaires ménage (chantier 15 — décision CEO B7).
 *
 * Seuls les PARAMÈTRES saisis sont stockés (propria_cost_params) — tous les
 * coûts de ménage / rentabilités sont dérivés à la lecture. Historisation par
 * date d'effet : un changement = NOUVELLE ligne, l'ancienne valeur continue de
 * valoriser les ménages passés. Écriture CEO (+ developer pour la QA), lecture
 * équipe Propria.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

function fmtMad(v: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v);
}
function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR');
}

function HistoryList({
  rows, canDelete,
}: { rows: CostParamRow[]; canDelete: boolean }) {
  if (rows.length === 0) {
    return <p className="text-xs text-stoniz-gray-400 mt-2">Aucune valeur saisie.</p>;
  }
  return (
    <ul className="mt-2 space-y-1">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-stoniz-gray-600">
          <span className="font-medium text-stoniz-black">{fmtMad(r.value_mad)} MAD</span>
          <span>· effet {fmtDate(r.effective_from)}</span>
          {r.comment && <span className="text-stoniz-gray-400 italic">— {r.comment}</span>}
          {canDelete && (
            <form
              action={async () => {
                'use server';
                await softDeleteCostParamAction(r.id);
              }}
            >
              <button
                type="submit"
                className="text-[10px] text-red-500 hover:text-red-700 underline"
                title="Erreur de saisie — soft-delete (la ligne reste auditable)"
              >
                supprimer
              </button>
            </form>
          )}
        </li>
      ))}
    </ul>
  );
}

function AddValueForm({
  paramKey, unitId, defaultValue,
}: { paramKey: CostParamKey; unitId?: string; defaultValue?: number | null }) {
  return (
    <form action={addCostParamAction} className="flex flex-wrap items-center gap-2 mt-2">
      <input type="hidden" name="param_key" value={paramKey} />
      {unitId && <input type="hidden" name="propria_unit_id" value={unitId} />}
      <input
        type="number" name="value_mad" step="0.01" min="0" required
        defaultValue={defaultValue ?? undefined}
        placeholder="MAD"
        className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 w-24"
      />
      <input
        type="date" name="effective_from" defaultValue={todayIso()} required
        className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
        title="Date d'effet"
      />
      <input
        type="text" name="comment" placeholder="Commentaire (optionnel)"
        className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 flex-1 min-w-[140px]"
      />
      <button type="submit" className="text-xs bg-stoniz-black text-white rounded px-2.5 py-1">
        Enregistrer
      </button>
    </form>
  );
}

export default async function PropriaCoutsPage() {
  const me = await requireRole(['ceo', 'developer', 'finance', 'assistante', 'propria']);
  const canWrite = me.role === 'ceo' || me.role === 'developer';
  const canDelete = me.role === 'ceo';
  const supabase = createClient();

  const [params, lots] = await Promise.all([
    loadCostParams(supabase),
    getActiveLotOptions(),
  ]);
  const today = todayIso();
  const lotLabelById = new Map(lots.map((l) => [l.id, l.label]));

  const globalRows = params.filter((r) => r.scope === 'global');
  const unitRows = params.filter((r) => r.scope === 'unit');

  // Overrides groupés par lot (les lignes sont déjà triées effet DESC)
  const overridesByUnit = new Map<string, CostParamRow[]>();
  for (const r of unitRows) {
    if (!r.propria_unit_id) continue;
    if (!overridesByUnit.has(r.propria_unit_id)) overridesByUnit.set(r.propria_unit_id, []);
    overridesByUnit.get(r.propria_unit_id)!.push(r);
  }

  return (
    <div className="max-w-5xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · Coûts'}
      </div>
      <h1 className="text-2xl md:text-3xl font-display mb-2">💸 Coûts unitaires ménage</h1>
      <p className="text-sm text-stoniz-gray-600 mb-4">
        Matrice des coûts unitaires (MAD) qui valorisent chaque ménage : main d’œuvre,
        linge, consommables, transport, frais de gestion. Valeur globale par défaut,
        override possible par logement. Rien de calculé n’est stocké — la rentabilité
        est dérivée à la lecture.
      </p>

      {/* Bandeau historisation */}
      <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-md px-3 py-2 text-xs mb-6">
        📌 Un changement de coût crée une <strong>nouvelle ligne à date d’effet</strong> —
        on ne modifie jamais une valeur passée. L’historique sert aux calculs passés :
        un ménage est toujours valorisé avec les coûts en vigueur à sa date.
        En cas d’erreur de saisie : suppression (soft-delete) puis re-saisie.
      </div>

      {params.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2 text-xs mb-6">
          ⏳ Aucun coût unitaire saisi pour l’instant — les dashboards coût ménage et
          rentabilité affichent « en attente de données » tant que rien n’est saisi ici.
        </div>
      )}

      {/* ─── Paramètres globaux ─── */}
      <h2 className="text-sm uppercase text-stoniz-gray-500 mb-2">Paramètres globaux (tous les lots)</h2>
      <div className="space-y-3 mb-10">
        {COST_PARAM_KEYS.map((key) => {
          const meta = COST_PARAM_META[key];
          const current = resolveParam(globalRows, key, null, today);
          const history = globalRows.filter((r) => r.param_key === key);
          return (
            <div key={key} className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">
                    {meta.label}
                    {!meta.usedInCalc && (
                      <span className="ml-2 text-[10px] bg-stoniz-gray-100 text-stoniz-gray-500 px-1.5 py-0.5 rounded-full">
                        référence — hors calcul
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-stoniz-gray-500">{meta.description}</div>
                </div>
                <div className="text-right">
                  {current ? (
                    <>
                      <div className="text-lg font-display">
                        {fmtMad(current.value_mad)} <span className="text-xs text-stoniz-gray-400">MAD</span>
                      </div>
                      <div className="text-[10px] text-stoniz-gray-400">
                        ≈ {fmtMad(madToEur(current.value_mad))} € · effet {fmtDate(current.effective_from)}
                      </div>
                    </>
                  ) : (
                    <div className="text-lg font-display text-stoniz-gray-300" title="En attente de données">—</div>
                  )}
                </div>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-stoniz-gray-500 hover:text-stoniz-black">
                  Historique ({history.length})
                </summary>
                <HistoryList rows={history} canDelete={canDelete} />
              </details>
              {canWrite && <AddValueForm paramKey={key} defaultValue={current?.value_mad ?? null} />}
            </div>
          );
        })}
      </div>

      {/* ─── Overrides par logement ─── */}
      <h2 className="text-sm uppercase text-stoniz-gray-500 mb-2">Overrides par logement</h2>
      <p className="text-xs text-stoniz-gray-500 mb-3">
        Un override prime sur la valeur globale pour le lot concerné, à partir de sa date d’effet
        (ex. un lot excentré avec un transport plus cher).
      </p>

      {canWrite && (
        <form
          action={addCostParamAction}
          className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-4 flex flex-wrap items-center gap-2"
        >
          <select
            name="propria_unit_id" required
            className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5 min-w-[200px]"
            defaultValue=""
          >
            <option value="" disabled>Lot…</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
          <select
            name="param_key" required
            className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5 min-w-[200px]"
            defaultValue=""
          >
            <option value="" disabled>Paramètre…</option>
            {COST_PARAM_KEYS.map((key) => (
              <option key={key} value={key}>{COST_PARAM_META[key].label}</option>
            ))}
          </select>
          <input
            type="number" name="value_mad" step="0.01" min="0" required placeholder="MAD"
            className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5 w-24"
          />
          <input
            type="date" name="effective_from" defaultValue={today} required
            className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5"
            title="Date d'effet"
          />
          <input
            type="text" name="comment" placeholder="Commentaire (optionnel)"
            className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5 flex-1 min-w-[140px]"
          />
          <button type="submit" className="text-xs bg-stoniz-black text-white rounded px-3 py-1.5">
            + Override
          </button>
        </form>
      )}

      {overridesByUnit.size === 0 ? (
        <p className="text-xs text-stoniz-gray-400 mb-8">Aucun override par logement pour l’instant.</p>
      ) : (
        <div className="space-y-3 mb-8">
          {Array.from(overridesByUnit.entries()).map(([unitId, rows]) => {
            const byKey = new Map<CostParamKey, CostParamRow[]>();
            for (const r of rows) {
              if (!byKey.has(r.param_key)) byKey.set(r.param_key, []);
              byKey.get(r.param_key)!.push(r);
            }
            return (
              <div key={unitId} className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
                <div className="text-sm font-medium mb-2">
                  {lotLabelById.get(unitId) ?? 'Lot inconnu / désactivé'}
                </div>
                <div className="space-y-2">
                  {Array.from(byKey.entries()).map(([key, keyRows]) => {
                    const current = resolveParam(keyRows, key, unitId, today);
                    return (
                      <div key={key} className="border border-stoniz-gray-100 rounded-lg px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs">{COST_PARAM_META[key].label}</span>
                          <span className="text-xs font-medium">
                            {current ? `${fmtMad(current.value_mad)} MAD · effet ${fmtDate(current.effective_from)}` : '—'}
                          </span>
                        </div>
                        <details>
                          <summary className="cursor-pointer text-[10px] text-stoniz-gray-400 hover:text-stoniz-black">
                            Historique ({keyRows.length})
                          </summary>
                          <HistoryList rows={keyRows} canDelete={canDelete} />
                        </details>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-stoniz-gray-400">
        Tout est en MAD opérationnel — l’équivalent € (taux interne fixe 10 DH = 1 €) n’est
        qu’un affichage de pilotage. Saisie {canWrite ? 'autorisée' : 'réservée au CEO'} ·
        ces coûts alimentent <Link href="/propria/rentabilite" className="underline">la rentabilité par lot</Link> et
        le sous-onglet « Coût ménage » des fiches biens.
      </p>
    </div>
  );
}
