'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { logFinanceAudit } from '@/lib/finance/audit';

/**
 * Actions sur la table `vendor_documents` (factures + devis fournisseur/artisan).
 * Réutilisé par les modules Achats et Travaux.
 *
 * CEO 2026-06-10.
 */

const docSchema = z.object({
  doc_type: z.enum(['facture', 'devis', 'bon_commande']),
  vendor_kind: z.enum(['partner', 'artisan']),
  partner_id: z.string().uuid().optional().nullable(),
  artisan_id: z.string().uuid().optional().nullable(),
  vendor_label: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  document_date: z.string().optional().nullable(),
  total_amount: z.coerce.number().optional().nullable(),
  currency: z.string().optional().default('MAD'),
  notes: z.string().optional().nullable(),
});

const ALLOWED_MIME = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function createVendorDocumentAction(formData: FormData): Promise<
  | { ok: true; id: string }
  | { ok: false; error: string }
> {
  // CEO 2026-06-18 : chef_projet ajouté (incohérent avec les autres actions
  // du module achats qui l'autorisent).
  const user = await assertRole(['ceo', 'chef_projet', 'finance', 'assistante', 'achats', 'developer']);

  // Sépare le fichier (zod ne valide pas un File)
  const file = formData.get('file') as File | null;
  formData.delete('file');

  const parsed = docSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  // Au moins un vendor doit être fourni
  if (!data.partner_id && !data.artisan_id && !data.vendor_label) {
    return { ok: false, error: 'Choisis un fournisseur ou un artisan.' };
  }

  const supabase = createClient();

  // CEO 2026-06-22 : auto-resolve artisan_id depuis vendor_label si la FK est
  // manquante mais le label correspond exactement à un artisan actif. Évite
  // les documents orphelins (cause (c) du diag : label libre sans lien FK).
  // Stratégie matching : LOWER(TRIM(name)) exact match, puis fallback ILIKE
  // sur un seul résultat unique. Si plusieurs matchs, on laisse l'artisan_id
  // null pour ne pas attribuer à tort.
  let resolvedArtisanId = data.artisan_id ?? null;
  if (!resolvedArtisanId && !data.partner_id && data.vendor_label && data.vendor_kind === 'artisan') {
    const label = data.vendor_label.trim();
    if (label.length >= 2) {
      const { data: candidates } = await supabase
        .from('artisans')
        .select('id, name')
        .ilike('name', label)
        .is('deleted_at', null)
        .limit(2);
      if (candidates && candidates.length === 1) {
        resolvedArtisanId = (candidates[0] as any).id;
      }
    }
  }

  // 1. Insert sans fichier pour récupérer l'id
  const { data: row, error } = await supabase
    .from('vendor_documents')
    .insert({
      doc_type: data.doc_type,
      vendor_kind: data.vendor_kind,
      partner_id: data.partner_id ?? null,
      artisan_id: resolvedArtisanId,
      vendor_label: data.vendor_label ?? null,
      reference: data.reference ?? null,
      document_date: data.document_date ?? null,
      total_amount: data.total_amount ?? null,
      currency: data.currency ?? 'MAD',
      notes: data.notes ?? null,
      created_by: user.id,
    } as any)
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };

  // 2. Upload optionnel
  if (file && file.size > 0) {
    if (file.size > MAX_FILE_SIZE) return { ok: false, error: 'Fichier trop volumineux (max 10 MB).' };
    if (!ALLOWED_MIME.includes(file.type)) return { ok: false, error: `Type non supporté : ${file.type}` };
    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
    const path = `vendor-documents/${row.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      // Rollback : supprime le doc créé
      await supabase.from('vendor_documents').delete().eq('id', row.id);
      return { ok: false, error: upErr.message };
    }
    const { error: dbErr } = await supabase
      .from('vendor_documents')
      .update({ file_path: path } as any)
      .eq('id', row.id);
    if (dbErr) {
      await supabase.storage.from('documents').remove([path]);
      await supabase.from('vendor_documents').delete().eq('id', row.id);
      return { ok: false, error: dbErr.message };
    }
  }

  await logFinanceAudit({
    table: 'vendor_documents',
    recordId: row.id,
    action: 'create',
    actorId: user.id,
    label: `${data.doc_type === 'facture' ? 'Facture' : 'Devis'} créé · ${data.vendor_label ?? data.reference ?? row.id}`,
    payload: {
      doc_type: data.doc_type,
      vendor_kind: data.vendor_kind,
      vendor_label: data.vendor_label,
      reference: data.reference,
      total_amount: data.total_amount,
      currency: data.currency,
      has_file: !!(file && file.size > 0),
    },
  });

  return { ok: true, id: row.id };
}

export async function getVendorDocumentSignedUrlAction(filePath: string): Promise<string | null> {
  await assertRole(['ceo', 'finance', 'assistante', 'achats', 'chef_projet', 'developer']);
  const supabase = createClient();
  const { data } = await supabase.storage.from('documents').createSignedUrl(filePath, 3600);
  return data?.signedUrl ?? null;
}

/**
 * CEO 2026-06-25 : helper canonique pour ouvrir une facture/devis/BC fournisseur
 * depuis le module Achats (et tout autre viewer). Prend un `docId` (uuid),
 * vérifie l'existence en BDD, contrôle le `file_path`, génère une signed URL
 * via Supabase Storage. Toujours retourne `{ok, ...}` — jamais de throw —
 * pour qu'un 404 réseau ne fuite pas dans le navigateur de l'utilisateur.
 *
 * Cause racine du 404 du 25/06 : `achat-lot-documents.tsx` pointait vers
 * `/api/vendor-documents/{id}/download` qui n'existe pas (jamais créé). Le
 * fix : ce helper + bouton `<button onClick>` côté composant, qui appelle
 * cette action puis `window.open(url)`.
 */
export async function getVendorDocumentSignedUrlByIdAction(
  docId: string,
): Promise<
  | { ok: true; url: string; fileName: string | null }
  | { ok: false; error: 'no_perm' | 'not_found' | 'no_file' | 'storage_error' | 'unknown' }
> {
  try {
    await assertRole(['ceo', 'finance', 'assistante', 'achats', 'chef_projet', 'developer']);
  } catch {
    return { ok: false, error: 'no_perm' };
  }
  const supabase = createClient();
  const { data: doc, error: selErr } = await supabase
    .from('vendor_documents')
    .select('id, file_path, reference, doc_type')
    .eq('id', docId)
    .is('deleted_at', null)
    .maybeSingle();
  if (selErr) return { ok: false, error: 'unknown' };
  if (!doc) return { ok: false, error: 'not_found' };
  const filePath = (doc as any).file_path as string | null;
  if (!filePath) return { ok: false, error: 'no_file' };
  const { data: signed, error: sigErr } = await supabase
    .storage
    .from('documents')
    .createSignedUrl(filePath, 3600);
  if (sigErr || !signed?.signedUrl) return { ok: false, error: 'storage_error' };
  const fileName = filePath.split('/').pop() ?? null;
  return { ok: true, url: signed.signedUrl, fileName };
}

// ─── Soft-delete d'un vendor_documents (CEO 2026-06-30) ───────────────────
// Avant ce fix, un document uploadé devenait permanent : un mauvais fichier
// nécessitait une intervention BDD pour ré-uploader. Désormais, les rôles
// CEO / chef_projet / achats / assistante peuvent supprimer un doc, qui :
//   1. est décroché de tous les lots qui le référencent (5 FK) ;
//   2. est soft-deleted (deleted_at = now()) — le storage est CONSERVÉ pour
//      pouvoir restaurer en cas d'erreur ;
//   3. est tracé dans finance_audit_log (action='delete').
// Le slot devient libre, ré-upload immédiat possible.

function isNextRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'digest' in e
    && typeof (e as any).digest === 'string'
    && (e as any).digest.startsWith('NEXT_REDIRECT');
}
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

export type DeleteVendorDocResult =
  | {
      ok: true;
      detached_from: Array<{ table: string; column: string; row_id: string }>;
    }
  | { ok: false; error: string };

export async function softDeleteVendorDocumentAction(
  docId: string,
  reason?: string,
): Promise<DeleteVendorDocResult> {
  try {
    // CEO 2026-06-30 : ouvert à 4 rôles métier (CEO + chef_projet + achats +
    // assistante). Finance/developer/sourcing/menage restent hors scope.
    const me = await assertRole(['ceo', 'chef_projet', 'achats', 'assistante']);
    const supabase = createClient();

    // 1. Snapshot du doc avant suppression
    const { data: doc, error: selErr } = await supabase
      .from('vendor_documents')
      .select('id, doc_type, vendor_kind, vendor_label, reference, file_path, artisan_id, partner_id, deleted_at')
      .eq('id', docId)
      .maybeSingle();
    if (selErr) return { ok: false, error: selErr.message };
    if (!doc) return { ok: false, error: 'Document introuvable.' };
    if ((doc as any).deleted_at) return { ok: false, error: 'Document déjà supprimé.' };

    // 2. Identifier les lots qui pointent vers ce doc (5 FK) et les décrocher
    const detachedFrom: Array<{ table: string; column: string; row_id: string }> = [];

    // 2a. achats_lots.quote_doc_id
    const { data: achatsQuote } = await supabase
      .from('achats_lots').select('id').eq('quote_doc_id', docId);
    for (const r of (achatsQuote ?? []) as any[]) {
      const { error: upErr } = await supabase
        .from('achats_lots').update({ quote_doc_id: null } as any).eq('id', r.id);
      if (upErr) return { ok: false, error: `Décrochage achats_lots.quote_doc_id : ${upErr.message}` };
      detachedFrom.push({ table: 'achats_lots', column: 'quote_doc_id', row_id: r.id });
    }

    // 2b. achats_lots.invoice_doc_id
    const { data: achatsInvoice } = await supabase
      .from('achats_lots').select('id').eq('invoice_doc_id', docId);
    for (const r of (achatsInvoice ?? []) as any[]) {
      const { error: upErr } = await supabase
        .from('achats_lots').update({ invoice_doc_id: null } as any).eq('id', r.id);
      if (upErr) return { ok: false, error: `Décrochage achats_lots.invoice_doc_id : ${upErr.message}` };
      detachedFrom.push({ table: 'achats_lots', column: 'invoice_doc_id', row_id: r.id });
    }

    // 2c. achats_lots.purchase_order_doc_id
    const { data: achatsPO } = await supabase
      .from('achats_lots').select('id').eq('purchase_order_doc_id', docId);
    for (const r of (achatsPO ?? []) as any[]) {
      const { error: upErr } = await supabase
        .from('achats_lots').update({ purchase_order_doc_id: null } as any).eq('id', r.id);
      if (upErr) return { ok: false, error: `Décrochage achats_lots.purchase_order_doc_id : ${upErr.message}` };
      detachedFrom.push({ table: 'achats_lots', column: 'purchase_order_doc_id', row_id: r.id });
    }

    // 2d. travaux_lots.quote_doc_id
    const { data: travauxQuote } = await supabase
      .from('travaux_lots').select('id').eq('quote_doc_id', docId);
    for (const r of (travauxQuote ?? []) as any[]) {
      const { error: upErr } = await supabase
        .from('travaux_lots').update({ quote_doc_id: null } as any).eq('id', r.id);
      if (upErr) return { ok: false, error: `Décrochage travaux_lots.quote_doc_id : ${upErr.message}` };
      detachedFrom.push({ table: 'travaux_lots', column: 'quote_doc_id', row_id: r.id });
    }

    // 2e. travaux_payments.invoice_doc_id
    const { data: travauxInvoice } = await supabase
      .from('travaux_payments').select('id').eq('invoice_doc_id', docId);
    for (const r of (travauxInvoice ?? []) as any[]) {
      const { error: upErr } = await supabase
        .from('travaux_payments').update({ invoice_doc_id: null } as any).eq('id', r.id);
      if (upErr) return { ok: false, error: `Décrochage travaux_payments.invoice_doc_id : ${upErr.message}` };
      detachedFrom.push({ table: 'travaux_payments', column: 'invoice_doc_id', row_id: r.id });
    }

    // 3. Soft-delete du document (storage CONSERVÉ pour rollback éventuel)
    const { error: delErr } = await supabase
      .from('vendor_documents')
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq('id', docId);
    if (delErr) return { ok: false, error: delErr.message };

    // 4. Audit log centralisé
    const docTypeLabel =
      (doc as any).doc_type === 'facture' ? 'Facture'
      : (doc as any).doc_type === 'devis' ? 'Devis'
      : 'Bon de commande';
    const vendorName = (doc as any).vendor_label ?? null;
    await logFinanceAudit({
      table: 'vendor_documents',
      recordId: docId,
      action: 'delete',
      actorId: me.id,
      label: `${docTypeLabel} supprimé${vendorName ? ` · ${vendorName}` : ''}`,
      payload: {
        doc_type: (doc as any).doc_type,
        vendor_kind: (doc as any).vendor_kind,
        vendor_label: vendorName,
        reference: (doc as any).reference,
        file_path: (doc as any).file_path,
        detached_from: detachedFrom,
        reason: reason ?? null,
      },
    });

    // 5. Revalidate générique (achats + travaux + dashboards)
    revalidatePath('/dashboard/achats');
    revalidatePath('/dashboard/travaux');
    // Best-effort : on touche les projets impactés par les détachements
    const impactedProjectIds = new Set<string>();
    if (detachedFrom.length > 0) {
      const achatsLotIds = detachedFrom
        .filter((d) => d.table === 'achats_lots').map((d) => d.row_id);
      const travauxLotIds = detachedFrom
        .filter((d) => d.table === 'travaux_lots').map((d) => d.row_id);
      const travauxPaymentIds = detachedFrom
        .filter((d) => d.table === 'travaux_payments').map((d) => d.row_id);
      if (achatsLotIds.length > 0) {
        const { data } = await supabase.from('achats_lots').select('project_id').in('id', achatsLotIds);
        for (const r of (data ?? []) as any[]) if (r.project_id) impactedProjectIds.add(r.project_id);
      }
      if (travauxLotIds.length > 0) {
        const { data } = await supabase.from('travaux_lots').select('project_id').in('id', travauxLotIds);
        for (const r of (data ?? []) as any[]) if (r.project_id) impactedProjectIds.add(r.project_id);
      }
      if (travauxPaymentIds.length > 0) {
        const { data } = await supabase.from('travaux_payments').select('project_id').in('id', travauxPaymentIds);
        for (const r of (data ?? []) as any[]) if (r.project_id) impactedProjectIds.add(r.project_id);
      }
    }
    for (const pid of impactedProjectIds) {
      revalidatePath(`/projects/${pid}/achats`);
      revalidatePath(`/projects/${pid}/travaux`);
    }

    return { ok: true, detached_from: detachedFrom };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}
