'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Flag, Hammer, PackageCheck, CheckCircle2, ChevronDown } from 'lucide-react';
import {
  updateChantierSousPhaseAction,
  updateChantierDateAction,
} from '@/app/(team)/projects/[id]/travaux/chantier-sous-phase-actions';

/**
 * Timeline chantier — CEO 2026-08-19c.
 *
 * Barre horizontale Gantt-like avec 4 sous-phases (gros_oeuvre / second_oeuvre /
 * finitions / livre) + curseur "aujourd'hui" en surimpression sur l'axe temps
 * réel entre travaux_start_date et travaux_end_date (fin prévue). En dessous,
 * 4 KPIs cliquables : Démarrage · Sous-phase actuelle (sélecteur) · Fin prévue
 * · Fin réelle.
 *
 * Affiché en haut de /projects/[id]/travaux, uniquement pertinent quand
 * current_phase = 'travaux' (ou après). Cache l'ensemble si aucune des 3 dates
 * n'est renseignée (impossible d'afficher une timeline).
 */

export type SousPhase = 'gros_oeuvre' | 'second_oeuvre' | 'finitions' | 'livre';

const SOUS_PHASES: Array<{ key: SousPhase; label: string; icon: typeof Hammer; color: string; bgLight: string }> = [
  { key: 'gros_oeuvre',   label: 'Gros œuvre',    icon: Hammer,        color: '#712B13', bgLight: '#F0997B' },
  { key: 'second_oeuvre', label: 'Second œuvre',  icon: Hammer,        color: '#0C447C', bgLight: '#85B7EB' },
  { key: 'finitions',     label: 'Finitions',     icon: PackageCheck,  color: '#3C3489', bgLight: '#AFA9EC' },
  { key: 'livre',         label: 'Livré',         icon: CheckCircle2,  color: '#085041', bgLight: '#5DCAA5' },
];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysBetween(a: string | Date, b: string | Date): number {
  const da = typeof a === 'string' ? new Date(a) : a;
  const db = typeof b === 'string' ? new Date(b) : b;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

export function ChantierTimeline({
  projectId,
  travauxStartDate,
  travauxEndDate,
  livraisonDate,
  sousPhase,
  userRole,
}: {
  projectId: string;
  travauxStartDate: string | null;
  travauxEndDate: string | null;
  livraisonDate: string | null;
  sousPhase: SousPhase | null;
  userRole: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canEdit = userRole === 'ceo' || userRole === 'chef_projet';

  // Si toutes les dates manquent + user pas éditeur : bandeau info.
  // Sinon on affiche les KPIs éditables (l'éditeur peut renseigner depuis là).
  if (!travauxStartDate && !travauxEndDate && !livraisonDate && !canEdit) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-900">
        <strong>Timeline chantier indisponible</strong> — dates chantier non renseignées.
      </div>
    );
  }

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  // Calcul position curseur aujourd'hui entre start et end prévue
  let progressPct = 0;
  let daysLeft: number | null = null;
  let daysOverdue: number | null = null;
  if (travauxStartDate && travauxEndDate) {
    const total = daysBetween(travauxStartDate, travauxEndDate);
    const done = daysBetween(travauxStartDate, todayIso);
    if (total > 0) progressPct = Math.max(0, Math.min(100, (done / total) * 100));
    daysLeft = daysBetween(todayIso, travauxEndDate);
    if (daysLeft < 0) {
      daysOverdue = -daysLeft;
      daysLeft = null;
    }
  }
  const isLivre = !!livraisonDate;
  const currentPhaseMeta = sousPhase ? SOUS_PHASES.find((p) => p.key === sousPhase) : null;

  function pickPhase(next: SousPhase | null) {
    setError(null);
    start(async () => {
      const r = await updateChantierSousPhaseAction({
        project_id: projectId,
        sous_phase: next,
      });
      if (!r.ok) { setError(r.error); return; }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="font-display text-lg">Timeline chantier</h2>
        {isLivre && (
          <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-medium">
            <CheckCircle2 className="w-3 h-3" /> Livré le {fmtDate(livraisonDate)}
          </span>
        )}
      </div>

      {/* Barre visuelle 4 sous-phases */}
      <div className="relative mb-3">
        <div className="flex rounded-lg overflow-hidden border border-stoniz-gray-200" style={{ height: 44 }}>
          {SOUS_PHASES.map((p) => {
            const isCurrent = sousPhase === p.key;
            const passed = sousPhase && SOUS_PHASES.findIndex((s) => s.key === sousPhase) >= SOUS_PHASES.findIndex((s) => s.key === p.key);
            const Icon = p.icon;
            return (
              <div
                key={p.key}
                className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-medium transition-colors"
                style={{
                  backgroundColor: isCurrent ? p.bgLight : passed ? '#F1EFE8' : '#FAFAF8',
                  color: isCurrent ? p.color : passed ? '#5F5E5A' : '#B4B2A9',
                  borderRight: '1px solid #E5E0D5',
                }}
              >
                <Icon className="w-3 h-3" />
                {p.label}
              </div>
            );
          })}
        </div>

        {/* Curseur aujourd'hui — barre verticale rouge */}
        {travauxStartDate && travauxEndDate && (
          <>
            <div
              className="absolute top-0 bottom-0 border-l-2 border-red-500"
              style={{ left: `${progressPct}%`, height: 44 }}
              title={`Aujourd'hui · ${progressPct.toFixed(0)}% écoulé`}
            />
            <div
              className="absolute text-[9px] text-red-600 font-medium whitespace-nowrap"
              style={{ left: `calc(${progressPct}% + 4px)`, top: 46 }}
            >
              Aujourd'hui
            </div>
          </>
        )}
      </div>

      {/* Progression et alerte retard */}
      {travauxStartDate && travauxEndDate && !isLivre && (
        <div className="mt-8 mb-4 text-xs text-stoniz-gray-600 flex items-center justify-between flex-wrap gap-2">
          <div>
            {progressPct >= 100 && daysOverdue !== null ? (
              <span className="text-red-700 font-medium">
                🔴 Retard de {daysOverdue} jour{daysOverdue > 1 ? 's' : ''} sur la date prévue
              </span>
            ) : daysLeft !== null ? (
              <span>
                {progressPct.toFixed(0)}% du temps écoulé · <strong>{daysLeft} jour{daysLeft > 1 ? 's' : ''}</strong> restant{daysLeft > 1 ? 's' : ''}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* 4 KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <DateKpiBox
          icon={<Flag className="w-4 h-4 text-emerald-700" />}
          label="Démarrage"
          field="travaux_start_date"
          value={travauxStartDate}
          projectId={projectId}
          canEdit={canEdit}
        />

        {/* Sous-phase avec sélecteur inline */}
        <div className="bg-stoniz-gray-50 rounded-lg p-3 relative">
          <div className="flex items-center gap-1.5 text-xs text-stoniz-gray-500 mb-1">
            <Hammer className="w-4 h-4" />
            Sous-phase
          </div>
          <button
            type="button"
            onClick={() => canEdit && setOpen((o) => !o)}
            disabled={!canEdit || pending}
            className={`text-sm font-medium inline-flex items-center gap-1.5 ${canEdit ? 'cursor-pointer hover:text-stoniz-black' : 'cursor-default'} ${currentPhaseMeta ? 'text-stoniz-black' : 'text-stoniz-gray-400 italic'}`}
            title={canEdit ? 'Cliquer pour changer' : ''}
          >
            {currentPhaseMeta ? currentPhaseMeta.label : 'Non renseignée'}
            {canEdit && <ChevronDown className="w-3 h-3" />}
          </button>

          {open && canEdit && (
            <div
              className="absolute z-40 mt-1 left-0 min-w-[200px] bg-white border border-stoniz-gray-200 rounded-lg shadow-lg p-1.5"
              onMouseLeave={() => !pending && setOpen(false)}
            >
              {SOUS_PHASES.map((p) => {
                const Icon = p.icon;
                const isCurrent = p.key === sousPhase;
                return (
                  <button
                    key={p.key}
                    type="button"
                    disabled={pending}
                    onClick={() => pickPhase(p.key)}
                    className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 text-sm ${isCurrent ? 'bg-stoniz-gray-100' : 'hover:bg-stoniz-gray-50'}`}
                  >
                    <Icon className="w-4 h-4" style={{ color: p.color }} />
                    {p.label}
                    {isCurrent && <span className="ml-auto text-[10px] text-stoniz-gray-500">actuel</span>}
                  </button>
                );
              })}
              {sousPhase && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => pickPhase(null)}
                  className="w-full text-left px-2 py-1.5 rounded text-xs text-stoniz-gray-500 hover:bg-stoniz-gray-50 border-t border-stoniz-gray-100 mt-1"
                >
                  Retirer (non renseignée)
                </button>
              )}
              {error && <div className="text-[11px] text-red-700 mt-1 px-2">{error}</div>}
            </div>
          )}
        </div>

        <DateKpiBox
          icon={<Calendar className="w-4 h-4 text-amber-700" />}
          label="Fin prévue"
          field="travaux_end_date"
          value={travauxEndDate}
          projectId={projectId}
          canEdit={canEdit}
          hint="Auto = démarrage + 6 mois"
        />

        <DateKpiBox
          icon={<CheckCircle2 className="w-4 h-4 text-emerald-700" />}
          label="Livraison réelle"
          field="livraison_date"
          value={livraisonDate}
          projectId={projectId}
          canEdit={canEdit}
          emptyLabel="Non livré"
        />
      </div>
    </div>
  );
}

/**
 * KPI de date éditable inline (CEO 2026-08-19e).
 * - CEO / chef_projet : input date natif, auto-save au change
 * - Autres rôles : affichage read-only
 */
function DateKpiBox({
  icon, label, field, value, projectId, canEdit, emptyLabel = '—', hint,
}: {
  icon: React.ReactNode;
  label: string;
  field: 'travaux_start_date' | 'travaux_end_date' | 'livraison_date';
  value: string | null;
  projectId: string;
  canEdit: boolean;
  emptyLabel?: string;
  hint?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [localValue, setLocalValue] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);

  function save(next: string) {
    setError(null);
    setLocalValue(next);
    start(async () => {
      const r = await updateChantierDateAction({
        project_id: projectId,
        field,
        value: next === '' ? null : next,
      });
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="bg-stoniz-gray-50 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-xs text-stoniz-gray-500 mb-1">
        {icon}
        {label}
      </div>
      {canEdit ? (
        <>
          <input
            type="date"
            value={localValue}
            onChange={(e) => save(e.target.value)}
            disabled={pending}
            className="text-sm font-medium bg-white border border-stoniz-gray-300 rounded px-2 py-1 w-full max-w-[140px] disabled:opacity-50"
            title={hint ?? label}
          />
          {hint && !localValue && (
            <div className="text-[10px] text-stoniz-gray-500 mt-1">{hint}</div>
          )}
          {error && <div className="text-[10px] text-red-700 mt-1">{error}</div>}
        </>
      ) : (
        <div className={`text-sm font-medium ${!value ? 'text-stoniz-gray-400 italic' : 'text-stoniz-black'}`}>
          {value ? fmtDate(value) : emptyLabel}
        </div>
      )}
    </div>
  );
}
