import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TaskRow } from '@/components/tasks/task-row';
import { formatPhase } from '@/lib/utils/format';

import { requireRole } from '@/lib/auth/require';

const PHASE_ORDER = ['onboarding','sourcing','design','travaux','livraison','mise_en_location','termine'];

export default async function ProjectTasksPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','developer','commercial','finance','marketing','assistante','achats']);
  const supabase = createClient();
  const { data: project } = await supabase.from('projects')
    .select('id, reference, current_phase').eq('id', params.id).single();
  if (!project) notFound();

  const { data: tasks } = await supabase.from('tasks')
    .select('*, assignee:profiles!tasks_assigned_to_fkey(full_name)')
    .eq('project_id', params.id)
    .order('created_at');

  // Groupe par phase
  const byPhase: Record<string, any[]> = {};
  (tasks ?? []).forEach((t: any) => {
    const k = t.phase ?? 'autre';
    (byPhase[k] ??= []).push(t);
  });

  // Ordre d'affichage : phase courante en premier, puis phases suivantes,
  // puis phases passées (à la fin, pour référence).
  const currentIdx = PHASE_ORDER.indexOf(project.current_phase);
  const ordered: string[] = [];
  // 1. Phase courante
  if (byPhase[project.current_phase]) ordered.push(project.current_phase);
  // 2. Phases suivantes (croissant)
  for (let i = currentIdx + 1; i < PHASE_ORDER.length; i++) {
    if (byPhase[PHASE_ORDER[i]]) ordered.push(PHASE_ORDER[i]);
  }
  // 3. Phases passées (décroissant = plus récente en premier)
  for (let i = currentIdx - 1; i >= 0; i--) {
    if (byPhase[PHASE_ORDER[i]]) ordered.push(PHASE_ORDER[i]);
  }
  // 4. Reste (ex: 'autre')
  Object.keys(byPhase).forEach(k => { if (!ordered.includes(k)) ordered.push(k); });

  return (
    <div className="space-y-6">
      <Link href={`/projects/${params.id}`} className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" />
        Retour au projet {project.reference}
      </Link>

      <PageHeader title="Tâches" description={project.reference} />

      {ordered.map(phase => {
        const phaseTasks = byPhase[phase];
        const isCurrent = phase === project.current_phase;
        const isPast = PHASE_ORDER.indexOf(phase) < currentIdx;
        const openCount = phaseTasks.filter(t => t.status !== 'done').length;

        return (
          <Card key={phase} className={isCurrent ? 'border-accent border-2' : isPast ? 'opacity-75' : ''}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display text-lg">{formatPhase(phase)}</h3>
              <div className="flex items-center gap-2">
                {isCurrent && <Badge variant="warning">Phase en cours</Badge>}
                {isPast && <Badge variant="success">Phase terminée</Badge>}
                {openCount > 0 && <Badge>{openCount} ouverte{openCount > 1 ? 's' : ''}</Badge>}
              </div>
            </div>
            <ul className="space-y-1">
              {phaseTasks.map(t => <TaskRow key={t.id} task={t} />)}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
