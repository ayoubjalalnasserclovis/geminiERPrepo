'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, RotateCcw, AlertCircle } from 'lucide-react';
import { activateProjectAction, rollbackActivationAction } from '../actions';

type DryRunSummary = {
  ok: boolean;
  project?: any;
  counts?: {
    documents_total: number;
    documents_internal: number;
    documents_exposed: number;
    payments: number;
    tasks_open: number;
    tasks_blocking_open: number;
  };
  bypasses?: any[];
  will_send_invitation_email?: boolean;
  will_create_auth_user?: boolean;
  error?: string;
} | null;

export function ProjectActivationPanel({
  projectId,
  isPreparation,
  isLegacy,
  activatedAt,
  isPlaceholderEmail,
  dryRunSummary,
}: {
  projectId: string;
  isPreparation: boolean;
  isLegacy: boolean;
  activatedAt: string | null;
  isPlaceholderEmail: boolean;
  dryRunSummary: DryRunSummary;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const router = useRouter();

  function onActivate() {
    const msg = isPlaceholderEmail
      ? `⚠ Email placeholder détecté.\n\nActiver quand même ? L'invitation ne partira pas (faute d'email valide), mais le projet sera visible côté staff comme normal. Tu pourras corriger l'email et renvoyer une invite plus tard.\n\nConfirmer ?`
      : `Activer ce projet ?\n\nÇa va :\n  1. Créer le compte auth du client\n  2. Lier son profile au client\n  3. Flip is_preparation=false + activated_at=now()\n  4. Envoyer l'email d'invitation\n\nConfirmer ?`;
    if (!window.confirm(msg)) return;

    setResult(null);
    const fd = new FormData();
    fd.append('project_id', projectId);
    fd.append('send_invitation_email', 'true');
    start(async () => {
      const r = await activateProjectAction(fd);
      if (r.ok) {
        setResult('Activé. Email d\'invitation programmé.');
        router.refresh();
      } else {
        setResult(`Erreur : ${r.error}`);
      }
    });
  }

  function onRollback() {
    if (!window.confirm('Rollback de l\'activation ?\n\nÇa va supprimer le compte auth créé et remettre le projet en is_preparation=true. À n\'utiliser qu\'en cas d\'erreur (mauvais client activé par exemple).')) return;
    setResult(null);
    const fd = new FormData();
    fd.append('project_id', projectId);
    start(async () => {
      try {
        await rollbackActivationAction(fd);
        setResult('Rollback effectué.');
        router.refresh();
      } catch (e: any) {
        setResult(`Erreur : ${e.message}`);
      }
    });
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 sticky top-4">
      <h2 className="font-medium mb-3">Activation</h2>

      {!isPreparation && activatedAt ? (
        <>
          <div className="bg-emerald-50 border border-emerald-200 rounded p-3 mb-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-emerald-900">
              <CheckCircle2 className="w-4 h-4" />
              Projet activé
            </div>
            <div className="text-emerald-800 text-xs mt-1">
              Activé le {new Date(activatedAt).toLocaleString('fr-FR')}
            </div>
          </div>
          <button
            onClick={onRollback}
            disabled={pending}
            className="w-full border border-red-300 text-red-700 px-3 py-2 rounded text-sm hover:bg-red-50 disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {pending ? '…' : 'Rollback activation'}
          </button>
        </>
      ) : (
        <>
          {/* Aperçu dry-run */}
          {dryRunSummary?.ok && dryRunSummary.counts && (
            <div className="space-y-2 text-sm mb-4 pb-4 border-b border-stoniz-gray-100">
              <div className="text-xs text-stoniz-gray-500 uppercase">Ce que verra le client</div>
              <div className="text-stoniz-gray-700">
                {dryRunSummary.counts.documents_exposed} document(s) visible(s)
                {dryRunSummary.counts.documents_internal > 0 && (
                  <span className="text-stoniz-gray-500"> ({dryRunSummary.counts.documents_internal} interne(s))</span>
                )}
              </div>
              <div className="text-stoniz-gray-700">
                {dryRunSummary.counts.payments} paiement(s) jalonné(s)
              </div>
              <div className="text-stoniz-gray-700">
                {dryRunSummary.counts.tasks_open} tâche(s) ouverte(s)
                {dryRunSummary.counts.tasks_blocking_open > 0 && (
                  <span className="text-amber-700"> ({dryRunSummary.counts.tasks_blocking_open} bloquante(s))</span>
                )}
              </div>
              <div className="text-xs text-stoniz-gray-500 mt-3">
                {dryRunSummary.will_create_auth_user
                  ? '→ Création d\'un nouveau compte auth'
                  : '→ Pas de création (auth user déjà existant)'}
              </div>
              <div className="text-xs text-stoniz-gray-500">
                {dryRunSummary.will_send_invitation_email
                  ? '→ Email d\'invitation envoyé au client'
                  : '→ Pas d\'invitation (projet legacy ou kill switch)'}
              </div>
            </div>
          )}

          {isPlaceholderEmail && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2 mb-3 text-xs text-amber-800 flex gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Email placeholder — invitation impossible tant que tu n'as pas fixé l'email.</span>
            </div>
          )}

          <button
            onClick={onActivate}
            disabled={pending}
            className="w-full bg-stoniz-black text-white px-3 py-2 rounded text-sm hover:bg-stoniz-gray-800 disabled:opacity-40 flex items-center justify-center gap-1.5 mb-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            {pending ? '…' : 'Activer le projet'}
          </button>

          <div className="text-[11px] text-stoniz-gray-500 mt-3 text-center">
            L'activation est réversible via "Rollback".
          </div>
        </>
      )}

      {result && (
        <div className={`mt-3 p-2 rounded text-xs ${result.startsWith('Erreur') ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {result}
        </div>
      )}
    </div>
  );
}
