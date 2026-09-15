import 'server-only';
import { createClient } from '@/lib/supabase/server';

export type PendingPv = {
  pv_id: string;
  project_id: string;
  project_reference: string;
  sent_to_client_at: string | null;
  reminder_count: number;
  days_since_sent: number | null;
};

/**
 * Récupère tous les PVs de réception en attente de signature pour le client connecté.
 * Utilisé pour les alertes persistantes (dashboard + fiche projet).
 *
 * Filtre :
 *   - status = 'sent_to_client' (en attente de signature électronique)
 *   - les projets visibles via RLS pour le client connecté
 */
export async function getPendingPvsForClient(): Promise<PendingPv[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('project_reception_pvs')
    .select(`
      id,
      project_id,
      sent_to_client_at,
      reminder_count,
      project:projects(reference)
    `)
    .eq('status', 'sent_to_client');

  if (!data) return [];

  const now = Date.now();
  return data.map((row: any) => {
    const sentAt = row.sent_to_client_at;
    const daysSinceSent = sentAt
      ? Math.floor((now - new Date(sentAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    return {
      pv_id: row.id,
      project_id: row.project_id,
      project_reference: row.project?.reference ?? '—',
      sent_to_client_at: sentAt,
      reminder_count: row.reminder_count ?? 0,
      days_since_sent: daysSinceSent,
    };
  });
}

/**
 * Variante : récupère uniquement le PV d'un projet spécifique (utilisé sur la fiche projet).
 */
export async function getPendingPvForProject(projectId: string): Promise<PendingPv | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('project_reception_pvs')
    .select(`
      id,
      project_id,
      sent_to_client_at,
      reminder_count,
      project:projects(reference)
    `)
    .eq('project_id', projectId)
    .eq('status', 'sent_to_client')
    .maybeSingle();

  if (!data) return null;
  const sentAt = (data as any).sent_to_client_at;
  const daysSinceSent = sentAt
    ? Math.floor((Date.now() - new Date(sentAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  return {
    pv_id: (data as any).id,
    project_id: (data as any).project_id,
    project_reference: (data as any).project?.reference ?? '—',
    sent_to_client_at: sentAt,
    reminder_count: (data as any).reminder_count ?? 0,
    days_since_sent: daysSinceSent,
  };
}
