import { createClient } from '@/lib/supabase/server';
import { PauseCircle, XCircle, Play, RotateCcw, CheckCircle2, Clock, XOctagon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { LifecycleValidateInline } from './lifecycle-validate-inline';

/**
 * Timeline server component qui lit project_lifecycle_transition pour un projet.
 * Affichage chronologique avec acteurs, raisons, manque à gagner, leçons.
 *
 * Affiché seulement s'il y a au moins 1 ligne dans l'audit.
 */

const PAUSE_REASON_LABELS: Record<string, string> = {
  financement_attendu: 'Financement attendu',
  sourcing_bloque: 'Sourcing bloqué',
  client_indisponible: 'Client indisponible',
  litige_partenaire: 'Litige partenaire',
  autre: 'Autre',
};

const LOST_REASON_LABELS: Record<string, string> = {
  client_retire: 'Client retiré',
  concurrent: 'Concurrent',
  desaccord_contractuel: 'Désaccord contractuel',
  qualite_reprochee: 'Qualité reprochée',
  delai_excessif: 'Délai excessif',
  defaut_financement: 'Défaut de financement',
  autre: 'Autre',
};

function iconForTransition(toStatus: string, workflowStatus: string) {
  if (workflowStatus === 'pending') return { Icon: Clock, color: 'text-amber-600 bg-amber-50' };
  if (workflowStatus === 'rejected') return { Icon: XOctagon, color: 'text-stoniz-gray-500 bg-stoniz-gray-100' };
  if (toStatus === 'pause') return { Icon: PauseCircle, color: 'text-amber-700 bg-amber-50' };
  if (toStatus === 'perdu') return { Icon: XCircle, color: 'text-red-700 bg-red-50' };
  if (toStatus === 'actif') return { Icon: Play, color: 'text-emerald-700 bg-emerald-50' };
  return { Icon: CheckCircle2, color: 'text-stoniz-gray-700 bg-stoniz-gray-100' };
}

function formatMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

export async function LifecycleTimeline({ projectId, userRole }: { projectId: string; userRole?: string }) {
  const supabase = createClient();
  const { data: transitions } = await supabase
    .from('project_lifecycle_transition')
    .select(`
      id, workflow_status, from_status, to_status, from_phase_snapshot,
      pause_reason_code_v, lost_reason_code_v, memo,
      lost_revenue_snapshot, lessons_learned, expected_resume_at,
      requested_at, validated_at, validation_decision_memo,
      requester:profiles!project_lifecycle_transition_requested_by_fkey(full_name, role),
      validator:profiles!project_lifecycle_transition_validated_by_fkey(full_name)
    `)
    .eq('project_id', projectId)
    .order('requested_at', { ascending: false });

  if (!transitions || transitions.length === 0) return null;

  return (
    <Card>
      <div className="px-5 py-4 border-b border-stoniz-gray-100">
        <h3 className="font-medium">Historique lifecycle</h3>
        <p className="text-xs text-stoniz-gray-500 mt-0.5">
          {transitions.length} transition{transitions.length > 1 ? 's' : ''} enregistrée{transitions.length > 1 ? 's' : ''}
        </p>
      </div>
      <div className="px-5 py-4">
        <ol className="relative border-l border-stoniz-gray-200 ml-4 space-y-5">
          {transitions.map((t: any) => {
            const { Icon, color } = iconForTransition(t.to_status, t.workflow_status);
            const reason = t.lost_reason_code_v
              ? LOST_REASON_LABELS[t.lost_reason_code_v]
              : (t.pause_reason_code_v ? PAUSE_REASON_LABELS[t.pause_reason_code_v] : null);

            const dateLabel = t.validated_at ?? t.requested_at;
            const isPending = t.workflow_status === 'pending';

            return (
              <li key={t.id} className="ml-6">
                <span className={`absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ${color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </span>

                <div className="flex flex-wrap items-baseline gap-2 mb-1">
                  <span className="text-sm font-medium">
                    {t.from_status} → {t.to_status}
                  </span>
                  {reason && (
                    <span className="text-xs text-stoniz-gray-600">· {reason}</span>
                  )}
                  {t.from_phase_snapshot && (t.to_status === 'pause' || t.to_status === 'perdu') && (
                    <span className="text-xs text-stoniz-gray-500">· phase {t.from_phase_snapshot}</span>
                  )}
                </div>

                <div className="text-xs text-stoniz-gray-500 mb-1">
                  {new Date(dateLabel).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  {' · '}
                  {isPending ? (
                    <span className="text-amber-700">en attente de validation</span>
                  ) : t.workflow_status === 'rejected' ? (
                    <span className="text-stoniz-gray-500">rejetée par {t.validator?.full_name ?? '—'}</span>
                  ) : (
                    <span>par {t.validator?.full_name ?? t.requester?.full_name ?? '—'}</span>
                  )}
                  {t.requester && t.validator && t.requester.full_name !== t.validator?.full_name && (
                    <span> · demandée par {t.requester.full_name}</span>
                  )}
                </div>

                {t.memo && (
                  <p className="text-xs italic text-stoniz-gray-600 mb-1 bg-stoniz-gray-50 p-2 rounded">
                    « {t.memo} »
                  </p>
                )}

                {t.lost_revenue_snapshot !== null && t.lost_revenue_snapshot !== undefined && (
                  <p className="text-xs text-red-700 mb-1">
                    Manque à gagner : {formatMoney(Number(t.lost_revenue_snapshot))}
                  </p>
                )}

                {t.lessons_learned && (
                  <p className="text-xs text-stoniz-gray-700 mt-1 border-l-2 border-amber-300 pl-2">
                    <span className="font-medium text-amber-900">Leçon : </span>
                    {t.lessons_learned}
                  </p>
                )}

                {t.expected_resume_at && t.to_status === 'pause' && isPending && (
                  <p className="text-xs text-stoniz-gray-500 mt-1">
                    Reprise prévue {new Date(t.expected_resume_at).toLocaleDateString('fr-FR')}
                  </p>
                )}

                {t.validation_decision_memo && (
                  <p className="text-xs text-stoniz-gray-500 mt-1 italic">
                    Décision : « {t.validation_decision_memo} »
                  </p>
                )}

                {/* CEO 2026-08-17 : validation inline pour éviter d'aller sur
                    /admin/validations pour chaque demande. CEO uniquement,
                    filtré côté composant client. */}
                {isPending && userRole === 'ceo' && (
                  <LifecycleValidateInline
                    transitionId={t.id}
                    toStatus={t.to_status}
                    userRole={userRole}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </Card>
  );
}
