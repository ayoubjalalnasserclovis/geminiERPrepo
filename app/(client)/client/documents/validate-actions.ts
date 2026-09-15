'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { sendDocumentValidatedToTeam, sendDesignMilestoneToClient } from '@/lib/email/templates';

const DESIGN_MILESTONE_TYPES = new Set(['plans_3d', 'lots_techniques', 'shopping_list', 'devis_travaux']);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const DOC_LABELS: Record<string, string> = {
  plans_3d: 'Plans 3D',
  lots_techniques: 'Lots techniques',
  shopping_list: 'Shopping list',
  devis_travaux: 'Devis travaux',
  plan_bet: 'Plan bureau d\'études',
  compromis: 'Compromis de vente',
  contrat_mission: 'Contrat de mission',
  cahier_des_charges: 'Cahier des charges',
};

export async function validateDocumentAction(
  documentId: string,
  action: 'validated' | 'refused' | 'more_info',
  comment?: string,
) {
  await assertRole(['client']);
  const supabase = createClient();

  const { error } = await supabase
    .from('documents')
    .update({
      client_validation_status: action,
      client_validation_at: new Date().toISOString(),
      client_validation_comment: comment ?? null,
    })
    .eq('id', documentId);

  if (error) return { ok: false, error: error.message };

  // Auto-complète la tâche associée si on valide des plans 3D / lots techniques
  if (action === 'validated') {
    const admin = createAdminClient();
    const { data: doc } = await admin
      .from('documents')
      .select('project_id, type')
      .eq('id', documentId)
      .single();

    if (doc) {
      const titleByType: Record<string, string> = {
        plans_3d: 'Valider les 3D avec le client',
        lots_techniques: 'Valider les 3D avec le client',
      };
      const taskTitle = titleByType[doc.type];
      if (taskTitle) {
        await admin
          .from('tasks')
          .update({
            status: 'done',
            completed_at: new Date().toISOString(),
          })
          .eq('project_id', doc.project_id)
          .eq('title', taskTitle)
          .neq('status', 'done');
      }
    }
  }

  // Email à l'équipe (chef + CEO) + email félicitations au client si jalon design
  try {
    const adminEmail = createAdminClient();
    const { data: doc } = await adminEmail.from('documents')
      .select('project_id, type, project:projects(reference, assigned_chef_projet, client:clients(full_name, email))')
      .eq('id', documentId).single();
    if (doc) {
      const proj: any = (doc as any).project;
      const recipients: { email: string; full_name: string }[] = [];
      if (proj?.assigned_chef_projet) {
        const { data: chef } = await adminEmail.from('profiles')
          .select('email, full_name').eq('id', proj.assigned_chef_projet).single();
        if (chef?.email) recipients.push(chef);
      }
      const { data: ceos } = await adminEmail.from('profiles')
        .select('email, full_name').eq('role', 'ceo').eq('is_active', true);
      (ceos ?? []).forEach((c: any) => {
        if (!recipients.find(r => r.email === c.email)) recipients.push(c);
      });
      for (const r of recipients) {
        await sendDocumentValidatedToTeam({
          to: r.email,
          chef_name: r.full_name,
          client_name: proj?.client?.full_name ?? '',
          doc_type_label: DOC_LABELS[doc.type] ?? doc.type,
          decision: action,
          comment: comment ?? null,
          project_url: `${APP_URL}/projects/${doc.project_id}/documents`,
          project_id: doc.project_id,
        });
      }

      // ─── Félicitations client si c'est un jalon design validé ────────────
      if (action === 'validated' && DESIGN_MILESTONE_TYPES.has(doc.type) && proj?.client?.email) {
        await sendDesignMilestoneToClient({
          to: proj.client.email,
          client_name: proj.client.full_name ?? '',
          milestone: doc.type as 'plans_3d' | 'lots_techniques' | 'shopping_list' | 'devis_travaux',
          portal_url: `${APP_URL}/client/projects/${doc.project_id}`,
          project_id: doc.project_id,
          document_id: documentId,
        });
      }
    }
  } catch (e) { console.warn('[email-doc-validated] echec', e); }

  revalidatePath('/client', 'layout');
  return { ok: true };
}
