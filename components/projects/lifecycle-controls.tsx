'use client';

/**
 * Contrôles lifecycle sur la fiche projet.
 *
 * Affichage adaptatif selon le rôle de l'utilisateur ET le status courant :
 *   - actif    : bouton "Mettre en pause" + (CEO seul) "Marquer perdu"
 *   - pause    : badge + (CEO seul) "Reprendre"
 *   - perdu    : badge + (CEO seul) "Ressusciter"
 *   - termine  : badge seul, pas de bouton
 *
 * Modal stack maison (pas de portail React) : un état modal: 'pause'|'lost'|null
 * qui contrôle l'affichage. Évite la dépendance à shadcn/dialog.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PauseCircle, XCircle, Play, RotateCcw, AlertTriangle } from 'lucide-react';
import {
  requestPauseAction,
  markProjectLostAction,
  resumeLifecycleAction,
  resurrectFromLostAction,
} from '@/app/(team)/projects/[id]/lifecycle-actions';

type Role = 'ceo' | 'chef_projet' | 'commercial' | string;
type Status = 'actif' | 'pause' | 'perdu' | 'termine';

const PAUSE_REASONS = [
  { code: 'financement_attendu', label: 'Financement attendu' },
  { code: 'sourcing_bloque', label: 'Sourcing bloqué' },
  { code: 'client_indisponible', label: 'Client indisponible' },
  { code: 'litige_partenaire', label: 'Litige partenaire' },
  { code: 'autre', label: 'Autre' },
] as const;

const LOST_REASONS = [
  { code: 'client_retire', label: 'Client retiré' },
  { code: 'concurrent', label: 'Concurrent' },
  { code: 'desaccord_contractuel', label: 'Désaccord contractuel' },
  { code: 'qualite_reprochee', label: 'Qualité reprochée' },
  { code: 'delai_excessif', label: 'Délai excessif' },
  { code: 'defaut_financement', label: 'Défaut de financement' },
  { code: 'autre', label: 'Autre' },
] as const;

const STATUS_BADGES: Record<Status, { bg: string; text: string; label: string }> = {
  actif:   { bg: 'bg-emerald-50 text-emerald-800 border-emerald-200', text: '', label: 'Actif' },
  pause:   { bg: 'bg-amber-50 text-amber-800 border-amber-200', text: '', label: 'En pause' },
  perdu:   { bg: 'bg-red-50 text-red-800 border-red-200', text: '', label: 'Perdu' },
  termine: { bg: 'bg-stoniz-gray-100 text-stoniz-gray-800 border-stoniz-gray-200', text: '', label: 'Terminé' },
};

type Mode = null | 'pause' | 'lost' | 'resume' | 'resurrect';

export function LifecycleControls({
  projectId,
  status,
  userRole,
  pauseReasonCode,
  lostReasonCode,
  expectedResumeAt,
}: {
  projectId: string;
  status: Status;
  userRole: Role;
  pauseReasonCode?: string | null;
  lostReasonCode?: string | null;
  expectedResumeAt?: string | null;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const router = useRouter();
  const isCeo = userRole === 'ceo';
  const canRequestPause = isCeo || userRole === 'chef_projet' || userRole === 'commercial';

  function close() { setMode(null); router.refresh(); }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge status={status} />

      {/* Boutons selon status */}
      {status === 'actif' && (
        <>
          {canRequestPause && (
            <button
              onClick={() => setMode('pause')}
              className="text-xs px-3 py-1.5 rounded border border-amber-300 text-amber-800 hover:bg-amber-50 flex items-center gap-1.5"
            >
              <PauseCircle className="w-3.5 h-3.5" />
              {isCeo ? 'Mettre en pause' : 'Demander pause'}
            </button>
          )}
          {isCeo && (
            <button
              onClick={() => setMode('lost')}
              className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-800 hover:bg-red-50 flex items-center gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5" />
              Marquer perdu
            </button>
          )}
        </>
      )}

      {status === 'pause' && (
        <>
          {pauseReasonCode && (
            <span className="text-xs text-amber-700">
              · {PAUSE_REASONS.find(r => r.code === pauseReasonCode)?.label ?? pauseReasonCode}
            </span>
          )}
          {expectedResumeAt && (
            <span className="text-xs text-stoniz-gray-500">
              · reprise prévue {new Date(expectedResumeAt).toLocaleDateString('fr-FR')}
            </span>
          )}
          {isCeo && (
            <button
              onClick={() => setMode('resume')}
              className="text-xs px-3 py-1.5 rounded border border-emerald-300 text-emerald-800 hover:bg-emerald-50 flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              Reprendre
            </button>
          )}
        </>
      )}

      {status === 'perdu' && (
        <>
          {lostReasonCode && (
            <span className="text-xs text-red-700">
              · {LOST_REASONS.find(r => r.code === lostReasonCode)?.label ?? lostReasonCode}
            </span>
          )}
          {isCeo && (
            <button
              onClick={() => setMode('resurrect')}
              className="text-xs px-3 py-1.5 rounded border border-stoniz-gray-300 text-stoniz-gray-700 hover:bg-stoniz-gray-50 flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Ressusciter
            </button>
          )}
        </>
      )}

      {/* Modals */}
      {mode === 'pause' && <PauseModal projectId={projectId} isCeo={isCeo} onClose={close} />}
      {mode === 'lost' && <LostModal projectId={projectId} onClose={close} />}
      {mode === 'resume' && <ResumeModal projectId={projectId} onClose={close} />}
      {mode === 'resurrect' && <ResurrectModal projectId={projectId} onClose={close} />}
    </div>
  );
}

function Badge({ status }: { status: Status }) {
  const s = STATUS_BADGES[status];
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full border ${s.bg} font-medium`}>
      {s.label}
    </span>
  );
}

// ─── Modals ─────────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-medium mb-4">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function PauseModal({ projectId, isCeo, onClose }: { projectId: string; isCeo: boolean; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string>('financement_attendu');
  const [resumeAt, setResumeAt] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [memo, setMemo] = useState('');

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.append('project_id', projectId);
    fd.append('reason_code', reason);
    fd.append('expected_resume_at', resumeAt);
    fd.append('memo', memo);
    start(async () => {
      const r = await requestPauseAction(fd);
      if (!r.ok) setError(r.error);
      else onClose();
    });
  }

  return (
    <ModalShell title={isCeo ? 'Mettre en pause' : 'Demander une mise en pause'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Raison">
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
            {PAUSE_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Date prévue de reprise">
          <input type="date" value={resumeAt} onChange={e => setResumeAt(e.target.value)}
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Mémo (contexte, ce que tu sais)">
          <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={3}
            placeholder="Ex: Client attend financement BMCE, revue dans 6 semaines"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
        </Field>
        {!isCeo && (
          <p className="text-xs text-stoniz-gray-500 bg-stoniz-gray-50 p-2 rounded">
            Cette demande sera envoyée au CEO pour validation. Tu seras notifié de la décision.
          </p>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
        <Buttons pending={pending} onCancel={onClose} onSubmit={submit}
          submitLabel={isCeo ? 'Mettre en pause' : 'Demander la pause'}
          disabled={memo.trim().length < 5} />
      </div>
    </ModalShell>
  );
}

function LostModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('client_retire');
  const [revenue, setRevenue] = useState('');
  const [lessons, setLessons] = useState('');
  const [memo, setMemo] = useState('');

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.append('project_id', projectId);
    fd.append('reason_code', reason);
    fd.append('lost_revenue_amount', revenue);
    fd.append('lessons_learned', lessons);
    fd.append('memo', memo);
    start(async () => {
      const r = await markProjectLostAction(fd);
      if (!r.ok) setError(r.error);
      else onClose();
    });
  }

  return (
    <ModalShell title="Marquer le projet comme perdu" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 text-xs text-red-800 bg-red-50 border border-red-200 p-3 rounded">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>Action définitive (réversible via "Ressusciter" mais nécessite justification). Les paiements en attente seront annulés.</span>
        </div>
        <Field label="Raison principale">
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
            {LOST_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Manque à gagner (honoraires perdus, €)">
          <input type="number" min="0" step="0.01" value={revenue} onChange={e => setRevenue(e.target.value)}
            placeholder="4200"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Leçons apprises (min 50 chars, ce qu'on retire)">
          <textarea value={lessons} onChange={e => setLessons(e.target.value)} rows={4}
            placeholder="Ex: Réagir plus vite quand le client mentionne plusieurs prestataires. Notre temps de réponse aux premiers contacts est trop long."
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          <span className="text-xs text-stoniz-gray-500">{lessons.length} / 50 caractères minimum</span>
        </Field>
        <Field label="Mémo (contexte rapide)">
          <input value={memo} onChange={e => setMemo(e.target.value)}
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
        </Field>
        {error && <p className="text-xs text-red-700">{error}</p>}
        <Buttons pending={pending} onCancel={onClose} onSubmit={submit}
          submitLabel="Marquer perdu" submitClass="bg-red-700 hover:bg-red-800"
          disabled={!revenue || lessons.length < 50 || memo.trim().length < 5} />
      </div>
    </ModalShell>
  );
}

function ResumeModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.append('project_id', projectId);
    start(async () => {
      const r = await resumeLifecycleAction(fd);
      if (!r.ok) setError(r.error);
      else onClose();
    });
  }

  return (
    <ModalShell title="Reprendre le projet" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-stoniz-gray-700">
          Le projet va repasser en <strong>actif</strong>. Les paiements gelés (on_hold) seront remis en pending, les notifications reprendront.
        </p>
        {error && <p className="text-xs text-red-700">{error}</p>}
        <Buttons pending={pending} onCancel={onClose} onSubmit={submit}
          submitLabel="Reprendre le projet"
          submitClass="bg-emerald-700 hover:bg-emerald-800" />
      </div>
    </ModalShell>
  );
}

function ResurrectModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justification, setJustification] = useState('');

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.append('project_id', projectId);
    fd.append('justification', justification);
    start(async () => {
      const r = await resurrectFromLostAction(fd);
      if (!r.ok) setError(r.error);
      else onClose();
    });
  }

  return (
    <ModalShell title="Ressusciter le projet" onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Action rare : un projet perdu redevient actif. Le système vérifiera que le bien associé est encore libre. Une justification de 50+ caractères est obligatoire.
          </span>
        </div>
        <Field label="Justification (min 50 chars)">
          <textarea value={justification} onChange={e => setJustification(e.target.value)} rows={4}
            placeholder="Ex: Le client est revenu vers nous après une mauvaise expérience chez le concurrent. Très forte intention d'achat confirmée par téléphone."
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          <span className="text-xs text-stoniz-gray-500">{justification.length} / 50 caractères minimum</span>
        </Field>
        {error && <p className="text-xs text-red-700">{error}</p>}
        <Buttons pending={pending} onCancel={onClose} onSubmit={submit}
          submitLabel="Ressusciter" submitClass="bg-stoniz-black hover:bg-stoniz-gray-800"
          disabled={justification.length < 50} />
      </div>
    </ModalShell>
  );
}

// ─── Atoms ──────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function Buttons({ pending, onCancel, onSubmit, submitLabel, submitClass, disabled }: {
  pending: boolean; onCancel: () => void; onSubmit: () => void;
  submitLabel: string; submitClass?: string; disabled?: boolean;
}) {
  return (
    <div className="flex gap-2 justify-end pt-2">
      <button onClick={onCancel} disabled={pending}
        className="px-4 py-2 text-sm border border-stoniz-gray-300 rounded hover:bg-stoniz-gray-50 disabled:opacity-40">
        Annuler
      </button>
      <button onClick={onSubmit} disabled={pending || disabled}
        className={`px-4 py-2 text-sm text-white rounded disabled:opacity-40 ${submitClass ?? 'bg-stoniz-black hover:bg-stoniz-gray-800'}`}>
        {pending ? '…' : submitLabel}
      </button>
    </div>
  );
}
