import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { ValidationRow } from './validation-row';
import { Clock, CheckCircle2 } from 'lucide-react';

const PAUSE_REASON_LABELS: Record<string, string> = {
  financement_attendu: 'Financement attendu',
  sourcing_bloque: 'Sourcing bloqué',
  client_indisponible: 'Client indisponible',
  litige_partenaire: 'Litige partenaire',
  autre: 'Autre',
};

export default async function ValidationsPage() {
  await requireRole(['ceo', 'developer']);
  const supabase = createClient();

  const { data: pendingRaw } = await supabase
    .from('project_lifecycle_transition')
    .select(`
      id, project_id, from_status, to_status, from_phase_snapshot,
      pause_reason_code_v, memo, expected_resume_at,
      requested_at, requested_by,
      requester:profiles!project_lifecycle_transition_requested_by_fkey(full_name, role),
      project:projects(code, reference, client:clients(full_name))
    `)
    .eq('workflow_status', 'pending')
    .order('requested_at', { ascending: true });

  const pending = pendingRaw ?? [];

  // Récap des 10 dernières transitions traitées (contexte historique)
  const { data: recentRaw } = await supabase
    .from('project_lifecycle_transition')
    .select(`
      id, workflow_status, from_status, to_status, validated_at,
      project:projects(code, reference, client:clients(full_name)),
      validator:profiles!project_lifecycle_transition_validated_by_fkey(full_name)
    `)
    .in('workflow_status', ['approved', 'rejected'])
    .order('validated_at', { ascending: false })
    .limit(10);

  const recent = recentRaw ?? [];

  return (
    <div>
      <PageHeader
        title="Validations en attente"
        description="Demandes de transitions lifecycle qui requièrent ton accord (CEO)."
      />

      {/* File pending */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-amber-600" />
          <h2 className="text-sm font-medium uppercase tracking-wide text-stoniz-gray-600">
            File d'attente · {pending.length}
          </h2>
        </div>

        {pending.length === 0 ? (
          <EmptyState
            title="Aucune validation en attente"
            description="Tu es à jour — les demandes pause/perdu arriveront ici."
          />
        ) : (
          <div className="space-y-3">
            {pending.map((t: any) => (
              <ValidationRow
                key={t.id}
                transitionId={t.id}
                projectId={t.project_id}
                projectCode={t.project?.code ?? t.project?.reference ?? '—'}
                clientName={t.project?.client?.full_name ?? '—'}
                requesterName={t.requester?.full_name ?? '—'}
                requesterRole={t.requester?.role ?? '—'}
                toStatus={t.to_status}
                phaseSnapshot={t.from_phase_snapshot}
                reasonLabel={PAUSE_REASON_LABELS[t.pause_reason_code_v] ?? t.pause_reason_code_v ?? '—'}
                memo={t.memo}
                expectedResumeAt={t.expected_resume_at}
                requestedAt={t.requested_at}
              />
            ))}
          </div>
        )}
      </section>

      {/* Récap historique */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="w-4 h-4 text-stoniz-gray-500" />
          <h2 className="text-sm font-medium uppercase tracking-wide text-stoniz-gray-600">
            10 dernières décisions
          </h2>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-stoniz-gray-500">Pas encore d'historique.</p>
        ) : (
          <Card className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-stoniz-gray-500 bg-stoniz-gray-50 border-b">
                <tr>
                  <th className="text-left py-2 px-3">Date</th>
                  <th className="text-left py-2 px-3">Projet</th>
                  <th className="text-left py-2 px-3">Client</th>
                  <th className="text-left py-2 px-3">Transition</th>
                  <th className="text-left py-2 px-3">Décision</th>
                  <th className="text-left py-2 px-3">Par</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recent.map((t: any) => (
                  <tr key={t.id}>
                    <td className="py-2 px-3 text-xs text-stoniz-gray-500">
                      {t.validated_at ? new Date(t.validated_at).toLocaleDateString('fr-FR') : '—'}
                    </td>
                    <td className="py-2 px-3 text-xs">
                      {t.project?.code ?? t.project?.reference ?? '—'}
                    </td>
                    <td className="py-2 px-3">{t.project?.client?.full_name ?? '—'}</td>
                    <td className="py-2 px-3 text-xs">
                      {t.from_status} → {t.to_status}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        t.workflow_status === 'approved' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                      }`}>
                        {t.workflow_status === 'approved' ? 'Approuvée' : 'Rejetée'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs">{t.validator?.full_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
