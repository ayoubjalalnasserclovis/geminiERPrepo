import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils/format';
import { UserCheck } from 'lucide-react';

/**
 * Bannière ambre affichée en haut de la fiche projet quand le bien final a été
 * validé par le chef de projet AU NOM du client (indisponibilité). CEO 2026-08-31.
 *
 * Auto-hidden si :
 *   - aucun bien lié au projet
 *   - le bien final n'a pas été validé par procuration
 *   - le projet est déjà en phase termine (feature devient historique — visible
 *     uniquement dans l'audit log à ce stade, on garde la fiche épurée)
 */
export async function PropertyOnBehalfBanner({ projectId }: { projectId: string }) {
  const supabase = createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('property_id, current_phase')
    .eq('id', projectId)
    .maybeSingle();

  if (!project?.property_id) return null;
  if (project.current_phase === 'termine') return null;

  const { data: proposal } = await supabase
    .from('property_proposals')
    .select('selected_on_behalf, selected_on_behalf_reason, selected_as_final_at, selected_by')
    .eq('project_id', projectId)
    .eq('property_id', project.property_id)
    .eq('selected_on_behalf', true)
    .not('selected_as_final_at', 'is', null)
    .order('selected_as_final_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!proposal) return null;

  // Récupère le nom du chef qui a validé (best-effort)
  let chefName: string | null = null;
  if (proposal.selected_by) {
    const { data: chef } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', proposal.selected_by)
      .maybeSingle();
    chefName = (chef as any)?.full_name ?? null;
  }

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <UserCheck className="w-5 h-5 text-amber-700" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-amber-900">
            Bien validé par le chef de projet au nom du client
          </div>
          <div className="text-sm text-amber-800 mt-0.5">
            {chefName ? <><strong>{chefName}</strong> a validé</> : 'Validé'}
            {proposal.selected_as_final_at && (
              <> le <strong>{formatDate(proposal.selected_as_final_at)}</strong></>
            )}
            {' '}à la place du client, faute de réponse de sa part dans son espace.
          </div>
          {proposal.selected_on_behalf_reason && (
            <div className="mt-2 text-sm text-amber-900 bg-amber-100/60 rounded px-3 py-2 border border-amber-200">
              <span className="font-medium">Motif :</span> {proposal.selected_on_behalf_reason}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
