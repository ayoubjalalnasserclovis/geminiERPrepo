'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { defaultChecklist, type ChecklistSection } from '@/lib/propria/maintenance-checklist';

export async function planVisitAction(visitId: string, scheduledAt: string, responsableId: string | null) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { data: visit } = await supabase
    .from('propria_maintenance_visits')
    .select('id, status')
    .eq('id', visitId)
    .maybeSingle();
  if (!visit) throw new Error('Visite introuvable');
  if (visit.status === 'realise') {
    throw new Error('Impossible de replanifier une visite déjà réalisée.');
  }

  const { error } = await supabase
    .from('propria_maintenance_visits')
    .update({
      status: 'planifie',
      scheduled_at: scheduledAt,
      responsable_id: responsableId || null,
      checklist: defaultChecklist(),
    } as any)
    .eq('id', visitId);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/maintenance');
  revalidatePath(`/propria/maintenance/${visitId}`);
}

export async function saveChecklistAction(
  visitId: string,
  checklist: ChecklistSection[],
  notes: string,
) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { data: visit } = await supabase
    .from('propria_maintenance_visits')
    .select('id, status')
    .eq('id', visitId)
    .maybeSingle();
  if (!visit) throw new Error('Visite introuvable');
  if (visit.status === 'realise') {
    throw new Error('Impossible de modifier la checklist d\'une visite déjà réalisée.');
  }

  const { error } = await supabase
    .from('propria_maintenance_visits')
    .update({ checklist, notes } as any)
    .eq('id', visitId);
  if (error) throw new Error(error.message);
  revalidatePath(`/propria/maintenance/${visitId}`);
}

export async function completeVisitAction(visitId: string) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { data: visit } = await supabase
    .from('propria_maintenance_visits')
    .select('id, status')
    .eq('id', visitId)
    .maybeSingle();
  if (!visit) throw new Error('Visite introuvable');
  if (visit.status === 'realise') {
    throw new Error('Cette visite est déjà réalisée.');
  }

  const { error } = await supabase
    .from('propria_maintenance_visits')
    .update({ status: 'realise', completed_at: new Date().toISOString() } as any)
    .eq('id', visitId);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/maintenance');
  revalidatePath(`/propria/maintenance/${visitId}`);
}

export async function generateQuarterlyVisitsAction() {
  // CEO 2026-06-10 : ouvert au rôle propria.
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { data, error } = await supabase.rpc('propria_generate_maintenance_visits');
  if (error) throw new Error(error.message);
  revalidatePath('/propria/maintenance');
  return { inserted: data ?? 0 };
}
