import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Paiement Stoniz à recouvrer :
 *   • due_date <= aujourd'hui (donc inclut les paiements dus le jour même)
 *   • montant payé strictement inférieur au montant attendu (donc inclut "partial")
 *   • non supprimé
 *   • projet non perdu et non supprimé (règle métier 2026-05-30 :
 *     un projet perdu ne génère plus de créance à recouvrer)
 *
 * On NE se base PAS sur status='overdue' car aucun job ne met cette valeur
 * à jour de manière fiable — on recalcule à la volée à chaque rendu.
 *
 * NOTE 2026-06-23 : pour des totaux per-projet (total attendu / encaissé /
 * restant), passer par `getProjectPaymentSummary` (source unique, agrège
 * par SUM par type donc gère les doublons sans les cacher). Ce module
 * reste utilisé pour la vue **liste plate** des retards (cron daily,
 * alertes, dashboard financier) — il liste chaque ligne brute pour
 * pouvoir lier "Régler →" vers la fiche projet.
 */
export type OverduePayment = {
  id: string;
  project_id: string;
  type: string;
  amount_expected: number;
  amount_paid: number;
  remaining: number;
  due_date: string;
  days_late: number;
  project_reference: string | null;
  client_full_name: string | null;
  property_name: string | null;
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  acompte_stoniz: 'Acompte Stoniz',
  honoraires_compromis: 'Honoraires compromis',
  honoraires_3d: 'Honoraires design 3D',
  honoraires_chantier: 'Honoraires chantier',
  honoraires_livraison: 'Honoraires livraison',
};

export function formatPaymentLabel(type: string): string {
  return PAYMENT_TYPE_LABELS[type] ?? type;
}

/**
 * Renvoie tous les paiements honoraires Stoniz en retard, tous projets confondus.
 * Filtre via RLS — un chef de projet ne voit que ses projets, un CEO voit tout.
 */
export async function listOverduePayments(): Promise<OverduePayment[]> {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from('payments')
    .select(`
      id, project_id, type, amount_expected, amount_paid, due_date,
      project:projects(reference, status, deleted_at,
        client:clients(full_name),
        property:properties(name)
      )
    `)
    .lte('due_date', today)
    .is('deleted_at', null)
    .order('due_date', { ascending: true });

  const now = Date.now();
  return (data ?? [])
    // Exclut les paiements dont le projet est perdu ou supprimé
    .filter((p: any) => p.project && p.project.status !== 'perdu' && p.project.deleted_at == null)
    .filter((p: any) => Number(p.amount_paid ?? 0) < Number(p.amount_expected ?? 0))
    .map((p: any): OverduePayment => ({
      id: p.id,
      project_id: p.project_id,
      type: p.type,
      amount_expected: Number(p.amount_expected ?? 0),
      amount_paid: Number(p.amount_paid ?? 0),
      remaining: Number(p.amount_expected ?? 0) - Number(p.amount_paid ?? 0),
      due_date: p.due_date,
      days_late: Math.floor((now - new Date(p.due_date).getTime()) / 86_400_000),
      project_reference: p.project?.reference ?? null,
      client_full_name: p.project?.client?.full_name ?? null,
      property_name: p.project?.property?.name ?? null,
    }));
}

/**
 * Idem mais filtré sur un seul projet.
 */
export async function listOverduePaymentsForProject(projectId: string): Promise<OverduePayment[]> {
  const all = await listOverduePayments();
  return all.filter(p => p.project_id === projectId);
}
