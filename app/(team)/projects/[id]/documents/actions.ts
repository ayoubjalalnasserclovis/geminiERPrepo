'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { sendDocumentToValidate, sendDocumentDeposited } from '@/lib/email/templates';
import { logFinanceAudit } from '@/lib/finance/audit';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

const DOC_TYPE_LABELS: Record<string, string> = {
  contrat_mission: 'Contrat de mission Stoniz',
  compromis: 'Compromis de vente',
  plans_3d: 'Plans 3D',
  lots_techniques: 'Lots techniques',
  shopping_list: 'Shopping list',
  devis_travaux: 'Devis travaux',
  permis_travaux: 'Permis de travaux',
  pv_livraison: 'PV de livraison',
  titre_foncier: 'Titre foncier',
  contrat_eau: 'Contrat eau',
  contrat_electricite: 'Contrat électricité',
  contrat_assurance: "Contrat d'assurance",
  contrat_internet: 'Contrat internet',
  autorisation_travaux: 'Autorisation de travaux',
  dossier_architecture: 'Dossier architecture',
  cahier_des_charges: 'Cahier des charges',
  autre: 'Document',
};

const ALLOWED_MIME = [
  'application/pdf','image/png','image/jpeg','image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // CEO 2026-08-19 (session C) : vidéos de suivi de chantier
  'video/mp4','video/quicktime','video/webm',
];
// CEO 2026-08-19 (session C) — limite portée à 1 Go (vidéos de chantier,
// plans lourds), alignée sur le bucket property-media. Le bucket documents
// est relevé à 1 Go par la migration 20260819150000. Les gros fichiers
// passent par createDocumentUploadUrlAction (presigned URL, upload direct
// navigateur → storage) puis recordDocumentAction — la limite Vercel des
// server actions ne s'applique pas. uploadDocumentAction reste dispo ≤ 25MB.
const MAX_SIZE = 1024 * 1024 * 1024;
const MAX_INLINE_SIZE = 25 * 1024 * 1024; // au-delà : presigned URL obligatoire

// ─── Notification client au dépôt (CEO 2026-08-19, session C) ──────────────
// Canon : CHAQUE document déposé par Stoniz et visible client déclenche un
// email (validation requise → sendDocumentToValidate, sinon →
// sendDocumentDeposited). Centralisé ici car le chemin presigned
// (recordDocumentAction) n'envoyait AUCUN email avant — même quand une
// validation était requise (bug latent corrigé au passage).
// Les garde-fous d'envoi (projet actif, non-legacy, non-préparation) sont
// appliqués par sendEmail via can_notify_for_project — rien à faire ici.
async function notifyClientOfDeposit(args: {
  project_id: string;
  doc_label: string;
  requires_client_validation: boolean;
}) {
  try {
    const admin = createAdminClient();
    const { data: proj } = await admin.from('projects')
      .select('reference, client:clients(email, full_name)')
      .eq('id', args.project_id).single();
    const client = (proj as any)?.client;
    if (!client?.email) return;
    const portal_url = `${APP_URL}/client/documents`;
    if (args.requires_client_validation) {
      await sendDocumentToValidate({
        to: client.email,
        client_name: client.full_name,
        doc_type_label: args.doc_label,
        portal_url: `${APP_URL}/client/projects/${args.project_id}`,
        project_id: args.project_id,
      });
    } else {
      await sendDocumentDeposited({
        to: client.email,
        client_name: client.full_name,
        doc_label: args.doc_label,
        project_reference: (proj as any)?.reference ?? '',
        portal_url,
        project_id: args.project_id,
      });
    }
  } catch (e) { console.warn('[notify-doc-deposit] echec', e); }
}

/** Tags saisis en texte libre "cuisine, plan, v2" → tableau propre. */
function parseTags(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
  return tags.length > 0 ? Array.from(new Set(tags)) : null;
}

export async function uploadDocumentAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  // Discipline server action : wrap intégral try/catch pour garantir une enveloppe
  // { ok, error } systématique. Un throw non catché renvoie `undefined` côté client
  // (Next 14, useTransition) → "Cannot read properties of undefined (reading 'ok')".
  try {
    const me = await assertRole(['ceo','chef_projet','sourcing','commercial','finance','assistante']);
    const supabase = createClient();

    const file = formData.get('file') as File;
    const project_id = formData.get('project_id') as string;
    const type = formData.get('type') as string;
    const is_visible_to_client = formData.get('is_visible_to_client') === 'on';
    const requires_client_validation = formData.get('requires_client_validation') === 'on';
    // CEO 2026-08-19 (session C) : libellé personnalisé + tags libres
    const label = ((formData.get('label') as string) ?? '').trim() || null;
    const tags = parseTags(formData.get('tags') as string | null);

    if (!file || !file.size) return { ok: false, error: 'Fichier manquant' };
    if (file.size > MAX_INLINE_SIZE) {
      return { ok: false, error: 'Fichier > 25 MB : utilise l\'upload direct (presigned URL). Réessaie via le nouveau bouton.' };
    }
    if (!ALLOWED_MIME.includes(file.type)) return { ok: false, error: `Type non supporté : ${file.type}` };

    const ext = file.name.split('.').pop();
    const path = `projects/${project_id}/${type}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadErr } = await supabase.storage.from('documents')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadErr) return { ok: false, error: uploadErr.message };

    const { data: inserted, error: insertErr } = await supabase.from('documents').insert({
      project_id,
      name: file.name,
      type,
      label,
      tags,
      uploaded_by: me.id,
      uploaded_by_role: 'stoniz',
      storage_path: path,
      size_bytes: file.size,
      mime_type: file.type,
      is_visible_to_client,
      requires_client_validation,
      client_validation_status: requires_client_validation ? 'pending' : null,
    }).select('id').single();

    if (insertErr) {
      await supabase.storage.from('documents').remove([path]);
      return { ok: false, error: insertErr.message };
    }

    // Audit log (CEO 2026-06-30) — création d'un doc projet
    await logFinanceAudit({
      table: 'documents',
      recordId: (inserted as any).id,
      action: 'create',
      actorId: me.id,
      label: `Document créé : ${DOC_TYPE_LABELS[type] ?? type} · ${file.name}`,
      payload: {
        type,
        project_id,
        name: file.name,
        size_bytes: file.size,
        mime_type: file.type,
        is_visible_to_client,
        requires_client_validation,
        upload_path: 'inline',
      },
    });

    // ─── Trigger paiement honoraires_3d à l'upload des plans 3D visibles ───
    // Le client va découvrir les plans → on rend le paiement dû à cette date.
    if (type === 'plans_3d' && is_visible_to_client) {
      try {
        const admin = createAdminClient();
        await admin.rpc('upsert_milestone_payment', {
          p_project_id: project_id,
          p_type: 'honoraires_3d',
          p_amount: 3800,
          p_due_date: new Date().toISOString().slice(0, 10),
          p_due_at_phase: 'design',
        });
      } catch (e) { console.warn('[honoraires-3d-trigger] echec', e); }
    }

    // CEO 2026-08-19 (session C) : notification à CHAQUE dépôt visible client
    // (validation requise ou non) — centralisée dans notifyClientOfDeposit.
    if (is_visible_to_client) {
      await notifyClientOfDeposit({
        project_id,
        doc_label: label ?? DOC_TYPE_LABELS[type] ?? 'Document',
        requires_client_validation,
      });
    }

    revalidatePath(`/projects/${project_id}/documents`);
    return { ok: true };
  } catch (e: any) {
    console.error('[uploadDocumentAction] throw non géré', e);
    return { ok: false, error: e?.message ?? 'Erreur serveur inattendue' };
  }
}

export async function getDocumentSignedUrl(documentId: string): Promise<{ url: string | null; error?: string }> {
  const supabase = createClient();

  // 1. On vérifie via le client utilisateur que la personne a bien le droit
  //    de voir ce doc (RLS filtre — clients voient seulement is_visible_to_client=true sur leurs projets).
  const { data: doc, error: selErr } = await supabase.from('documents')
    .select('id, storage_path, client_first_viewed_at').eq('id', documentId).maybeSingle();
  if (selErr) return { url: null, error: `Lecture doc échec : ${selErr.message}` };
  if (!doc) return { url: null, error: 'Document introuvable ou accès refusé.' };

  // CEO 2026-08-19 (session C) : première ouverture par le CLIENT → on la
  // trace (badge « Nouveau » du portail s'éteint pour ce document). Via admin
  // car le rôle client n'a pas de droit UPDATE sur documents.
  try {
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser && !(doc as any).client_first_viewed_at) {
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', authUser.id).maybeSingle();
      if ((profile as any)?.role === 'client') {
        const adminMark = createAdminClient();
        await adminMark.from('documents')
          .update({ client_first_viewed_at: new Date().toISOString() })
          .eq('id', documentId)
          .is('client_first_viewed_at', null);
      }
    }
  } catch (e) { console.warn('[doc-first-view] echec marquage', e); }

  // 2. Génération du signed URL via admin : les policies RLS sur storage.objects
  //    peuvent bloquer les rôles 'client' même quand ils ont accès au row documents.
  //    Le contrôle d'accès est déjà fait à l'étape 1.
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from('documents')
    .createSignedUrl(doc.storage_path, 3600);
  if (error) return { url: null, error: `Génération URL échec : ${error.message}` };
  return { url: data?.signedUrl ?? null };
}

// ─── Upload DIRECT (presigned URL) pour fichiers > 25MB jusqu'à 200MB ────
// CEO 2026-06-18 : Vercel limite les server actions à ~100MB. Pour permettre
// les gros fichiers (plans architecturaux, vidéos), le navigateur upload
// directement vers Supabase Storage via une signed URL, puis appelle
// recordDocumentAction() pour enregistrer les métadonnées.

export async function createDocumentUploadUrlAction(args: {
  project_id: string;
  type: string;
  filename: string;
  content_type: string;
  size_bytes: number;
}): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  // Wrap intégral try/catch — sinon un throw côté assertRole / createAdminClient
  // (env var manquant, role refusé, etc.) renvoie undefined côté client
  // → "Cannot read properties of undefined (reading 'ok')".
  try {
    await assertRole(['ceo','chef_projet','sourcing','commercial','finance','assistante']);
    if (args.size_bytes > MAX_SIZE) {
      return { ok: false, error: `Fichier trop volumineux (max ${Math.round(MAX_SIZE / 1024 / 1024)} MB)` };
    }
    if (!ALLOWED_MIME.includes(args.content_type)) {
      return { ok: false, error: `Type non supporté : ${args.content_type}` };
    }
    const ext = args.filename.split('.').pop() ?? 'bin';
    const safeExt = ext.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
    const path = `projects/${args.project_id}/${args.type}/${crypto.randomUUID()}.${safeExt}`;

    const admin = createAdminClient();
    const { data, error } = await admin.storage.from('documents').createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: error?.message ?? 'Génération URL échec' };
    return { ok: true, path, token: data.token };
  } catch (e: any) {
    console.error('[createDocumentUploadUrlAction] throw non géré', e);
    return { ok: false, error: e?.message ?? 'Erreur serveur inattendue' };
  }
}

export async function recordDocumentAction(args: {
  project_id: string;
  type: string;
  name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  is_visible_to_client?: boolean;
  requires_client_validation?: boolean;
  /** CEO 2026-08-19 (session C) : libellé personnalisé + tags libres. */
  label?: string | null;
  tags?: string[] | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Wrap intégral try/catch — discipline server action (cf. uploadDocumentAction).
  try {
    const me = await assertRole(['ceo','chef_projet','sourcing','commercial','finance','assistante']);
    const supabase = createClient();
    const label = (args.label ?? '').trim() || null;
    const tags = args.tags && args.tags.length > 0 ? args.tags : null;
    const { data: inserted, error: insertErr } = await supabase.from('documents').insert({
      project_id: args.project_id,
      name: args.name,
      type: args.type,
      label,
      tags,
      uploaded_by: me.id,
      uploaded_by_role: 'stoniz',
      storage_path: args.storage_path,
      size_bytes: args.size_bytes,
      mime_type: args.mime_type,
      is_visible_to_client: args.is_visible_to_client ?? false,
      requires_client_validation: args.requires_client_validation ?? false,
      client_validation_status: args.requires_client_validation ? 'pending' : null,
    }).select('id').single();
    if (insertErr) {
      // Rollback du fichier uploadé si l'insert échoue
      try {
        const admin = createAdminClient();
        await admin.storage.from('documents').remove([args.storage_path]);
      } catch (e) { console.warn('[recordDocumentAction] rollback storage échec', e); }
      return { ok: false, error: insertErr.message };
    }

    // Audit log (CEO 2026-06-30) — création d'un doc projet via upload direct
    await logFinanceAudit({
      table: 'documents',
      recordId: (inserted as any).id,
      action: 'create',
      actorId: me.id,
      label: `Document créé : ${DOC_TYPE_LABELS[args.type] ?? args.type} · ${args.name}`,
      payload: {
        type: args.type,
        project_id: args.project_id,
        name: args.name,
        size_bytes: args.size_bytes,
        mime_type: args.mime_type,
        is_visible_to_client: args.is_visible_to_client ?? false,
        requires_client_validation: args.requires_client_validation ?? false,
        upload_path: 'presigned',
      },
    });

    // CEO 2026-08-19 (session C) : le chemin presigned n'envoyait AUCUN email
    // (même pour une validation requise — bug latent). Désormais : notification
    // à chaque dépôt visible client, même logique que uploadDocumentAction.
    if (args.is_visible_to_client) {
      await notifyClientOfDeposit({
        project_id: args.project_id,
        doc_label: label ?? DOC_TYPE_LABELS[args.type] ?? 'Document',
        requires_client_validation: args.requires_client_validation ?? false,
      });
    }

    revalidatePath(`/projects/${args.project_id}/documents`);
    return { ok: true };
  } catch (e: any) {
    console.error('[recordDocumentAction] throw non géré', e);
    return { ok: false, error: e?.message ?? 'Erreur serveur inattendue' };
  }
}

// ─── Soft-delete d'un document projet (CEO 2026-06-30) ────────────────────
// Symétrique du pattern vendor_documents (cf. app/actions/vendor-documents.ts).
// Avant : un doc projet mal uploadé restait permanent. Désormais 4 rôles
// (CEO + chef_projet + achats + assistante) peuvent supprimer un doc, qui :
//   1. est décroché de payment_approvals.proof_doc_id si applicable ;
//   2. est soft-deleted (deleted_at = now()) — storage CONSERVÉ pour rollback ;
//   3. est tracé dans finance_audit_log (action='delete', table='documents').
// Le slot devient libre, ré-upload immédiat possible.

function isNextRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'digest' in e
    && typeof (e as any).digest === 'string'
    && (e as any).digest.startsWith('NEXT_REDIRECT');
}
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

export type DeleteProjectDocResult =
  | {
      ok: true;
      detached_from: Array<{ table: string; column: string; row_id: string }>;
    }
  | { ok: false; error: string };

export async function softDeleteProjectDocumentAction(
  docId: string,
  reason?: string,
): Promise<DeleteProjectDocResult> {
  try {
    // 4 rôles autorisés (canon CEO 2026-06-30, symétrique vendor_documents).
    const me = await assertRole(['ceo', 'chef_projet', 'achats', 'assistante']);
    const supabase = createClient();

    // 1. Snapshot du doc avant suppression
    const { data: doc, error: selErr } = await supabase
      .from('documents')
      .select('id, type, name, project_id, storage_path, deleted_at')
      .eq('id', docId)
      .maybeSingle();
    if (selErr) return { ok: false, error: selErr.message };
    if (!doc) return { ok: false, error: 'Document introuvable.' };
    if ((doc as any).deleted_at) return { ok: false, error: 'Document déjà supprimé.' };

    // 2. Décrocher les éventuelles FK (1 connue : payment_approvals.proof_doc_id)
    const detachedFrom: Array<{ table: string; column: string; row_id: string }> = [];
    const { data: approvals } = await supabase
      .from('payment_approvals').select('id').eq('proof_doc_id', docId);
    for (const r of (approvals ?? []) as any[]) {
      const { error: upErr } = await supabase
        .from('payment_approvals').update({ proof_doc_id: null } as any).eq('id', r.id);
      if (upErr) return { ok: false, error: `Décrochage payment_approvals.proof_doc_id : ${upErr.message}` };
      detachedFrom.push({ table: 'payment_approvals', column: 'proof_doc_id', row_id: r.id });
    }

    // 3. Soft-delete (storage CONSERVÉ pour rollback éventuel)
    const { error: delErr } = await supabase
      .from('documents')
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq('id', docId);
    if (delErr) return { ok: false, error: delErr.message };

    // 4. Audit log centralisé
    const typeLabel = DOC_TYPE_LABELS[(doc as any).type] ?? (doc as any).type ?? 'Document';
    await logFinanceAudit({
      table: 'documents',
      recordId: docId,
      action: 'delete',
      actorId: me.id,
      label: `Document supprimé : ${typeLabel}${(doc as any).name ? ` · ${(doc as any).name}` : ''}`,
      payload: {
        type: (doc as any).type,
        project_id: (doc as any).project_id,
        name: (doc as any).name,
        storage_path: (doc as any).storage_path,
        detached_from: detachedFrom,
        reason: reason ?? null,
      },
    });

    // 5. Revalidation
    const projectId = (doc as any).project_id as string | null;
    if (projectId) {
      revalidatePath(`/projects/${projectId}`);
      revalidatePath(`/projects/${projectId}/documents`);
    }

    return { ok: true, detached_from: detachedFrom };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}
