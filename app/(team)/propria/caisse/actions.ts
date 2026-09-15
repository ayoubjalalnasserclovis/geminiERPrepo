'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { normalizeFormData as clean, optionalUuid } from '@/lib/validators/zod-helpers';
import { logPropriaAudit } from '@/lib/propria/audit';

// ─── Helpers défensifs (session expirée) ────────────────────────────────────

function isNextRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'digest' in e && typeof (e as any).digest === 'string' && (e as any).digest.startsWith('NEXT_REDIRECT');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

type ActionResult = { ok: true } | { ok: false; error: string };

// ─── Wallets ────────────────────────────────────────────────────────────────

const walletSchema = z.object({
  profile_id: z.string().uuid(),
  label: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function createWalletAction(formData: FormData): Promise<ActionResult> {
  try {
    await assertRole(['ceo','finance']);
    const data = walletSchema.parse(clean(Object.fromEntries(formData)));
    const supabase = createClient();
    const { data: row, error } = await supabase
      .from('propria_wallets')
      .insert(data as any)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    revalidatePath('/propria/caisse');
    redirect(`/propria/caisse/${row.id}`);
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function closeWalletAction(walletId: string): Promise<ActionResult> {
  try {
    await assertRole(['ceo','finance']);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_wallets')
      .update({ is_active: false, closed_at: new Date().toISOString().slice(0, 10) } as any)
      .eq('id', walletId);
    if (error) throw new Error(error.message);
    revalidatePath('/propria/caisse');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Dotations ──────────────────────────────────────────────────────────────

const dotationSchema = z.object({
  wallet_id: z.string().uuid(),
  given_at: z.string(),
  amount_mad: z.coerce.number().positive(),
  type: z.enum(['dotation','rechargement']),
  note: z.string().optional().nullable(),
});

export async function createDotationAction(formData: FormData): Promise<ActionResult> {
  try {
    // Dotations réservées au CEO : c'est lui qui distribue le cash
    const user = await assertRole(['ceo']);
    const data = dotationSchema.parse(clean(Object.fromEntries(formData)));
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_wallet_dotations')
      .insert({ ...data, given_by: user.id } as any);
    if (error) throw new Error(error.message);
    revalidatePath(`/propria/caisse/${data.wallet_id}`);
    revalidatePath('/propria/caisse');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Dépenses ───────────────────────────────────────────────────────────────

const expenseSchema = z.object({
  wallet_id: z.string().uuid(),
  spent_at: z.string().min(1, 'Date requise'),
  propria_unit_id: optionalUuid,
  category: z.string().nullable().optional(),
  description: z.string().min(2),
  amount_mad: z.coerce.number().positive(),
  receipt_path: z.string().optional().nullable(),
  charge_to: z.enum(['client','propria','copropriete']).optional().nullable(),
  observations: z.string().optional().nullable(),
});

export async function createExpenseAction(formData: FormData): Promise<ActionResult> {
  try {
    // Le terrain (propria) saisit ses propres dépenses depuis sa caisse cash.
    // CEO/finance/assistante peuvent aussi (saisie rétroactive).
    const user = await assertRole(['ceo','finance','assistante','propria']);

    // Sépare le fichier (zod ne valide pas un File) avant de parser le reste
    const receiptFile = formData.get('receipt_file') as File | null;
    formData.delete('receipt_file');

    const data = expenseSchema.parse(clean(Object.fromEntries(formData)));
    const supabase = createClient();

    // 1) Crée la dépense pour obtenir son id (nécessaire pour le storage path)
    const { data: row, error } = await supabase
      .from('propria_wallet_expenses')
      .insert(data as any)
      .select('id')
      .single();
    if (error) {
      // Persist en BDD pour debug — les vrais messages d'erreur sont masqués
      // en prod par Next.js dans Server Actions.
      try {
        await supabase.from('app_error_logs').insert({
          source: 'createExpenseAction:insert',
          message: error.message,
          details: { code: (error as any).code, hint: (error as any).hint, details: (error as any).details },
          payload: data,
        } as any);
      } catch { /* ignore */ }
      throw new Error(`Création dépense : ${error.message}`);
    }

    // 2) Si un justificatif a été fourni, on l'upload et on met à jour receipt_path
    if (receiptFile && receiptFile.size > 0) {
      if (receiptFile.size > MAX_RECEIPT_SIZE) {
        throw new Error('Justificatif trop volumineux (max 10 MB)');
      }
      if (!ALLOWED_RECEIPT_MIME.includes(receiptFile.type)) {
        throw new Error(`Type de justificatif non supporté : ${receiptFile.type}`);
      }
      const ext = (receiptFile.name.split('.').pop() ?? 'bin').toLowerCase();
      const path = `propria/wallets/${data.wallet_id}/expenses/${row.id}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, receiptFile, { contentType: receiptFile.type, upsert: false });
      if (upErr) throw new Error(upErr.message);

      const { error: dbErr } = await supabase
        .from('propria_wallet_expenses')
        .update({ receipt_path: path } as any)
        .eq('id', row.id);
      if (dbErr) {
        // Rollback storage si l'update DB échoue
        await supabase.storage.from('documents').remove([path]);
        throw new Error(dbErr.message);
      }
    }

    await logPropriaAudit({
      supabase, table: 'propria_wallet_expenses', recordId: row.id,
      actorId: user.id, action: 'create',
      label: `Dépense saisie : ${data.description} (${data.amount_mad} MAD)`,
      payload: { wallet_id: data.wallet_id, description: data.description, amount_mad: data.amount_mad, category: data.category },
    });
    // Trace aussi sur la caisse pour timeline caisse
    await logPropriaAudit({
      supabase, table: 'propria_wallets', recordId: data.wallet_id,
      actorId: user.id, action: 'create',
      label: `Dépense ${data.amount_mad} MAD : ${data.description}`,
      payload: { expense_id: row.id, amount_mad: data.amount_mad },
    });

    revalidatePath(`/propria/caisse/${data.wallet_id}`);
    revalidatePath('/propria/caisse');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function markExpenseReimbursedAction(expenseId: string, walletId: string): Promise<ActionResult> {
  try {
    const user = await assertRole(['ceo','finance']);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_wallet_expenses')
      .update({
        reimbursed_at: new Date().toISOString().slice(0, 10),
        reimbursed_by: user.id,
      } as any)
      .eq('id', expenseId)
      .is('deleted_at', null);
    if (error) throw new Error(error.message);
    revalidatePath(`/propria/caisse/${walletId}`);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function validateExpenseAction(expenseId: string, walletId: string): Promise<ActionResult> {
  try {
    // CEO 2026-06-10 : validation = CEO + assistante (PAS propria — exception Q1
    // pour éviter qu'un propria valide ses propres dépenses).
    const user = await assertRole(['ceo','assistante']);
    const supabase = createClient();

    // Vérifie la présence d'un justificatif (PJ optionnelle à la création mais
    // requise pour valider — pas de validation sans preuve).
    const { data: exp } = await supabase
      .from('propria_wallet_expenses')
      .select('id, receipt_path')
      .eq('id', expenseId).is('deleted_at', null).maybeSingle();
    if (!exp) throw new Error('Dépense introuvable');
    if (!exp.receipt_path) {
      throw new Error('Impossible de valider sans justificatif (PJ requise).');
    }

    const { error } = await supabase
      .from('propria_wallet_expenses')
      .update({
        is_validated: true,
        validated_at: new Date().toISOString(),
        validated_by: user.id,
      } as any)
      .eq('id', expenseId)
      .is('deleted_at', null);
    if (error) throw new Error(error.message);

    await logPropriaAudit({
      supabase, table: 'propria_wallet_expenses', recordId: expenseId,
      actorId: user.id, action: 'validate',
      label: `Validation de la dépense`,
      payload: { wallet_id: walletId },
    });
    await logPropriaAudit({
      supabase, table: 'propria_wallets', recordId: walletId,
      actorId: user.id, action: 'validate',
      label: `Validation d'une dépense`,
      payload: { expense_id: expenseId },
    });

    revalidatePath(`/propria/caisse/${walletId}`);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Validation en bulk : valide toutes les dépenses non-validées d'une caisse
 * qui ont déjà une PJ. Les dépenses sans PJ sont ignorées et listées en retour.
 */
export async function validateAllExpensesForWalletAction(
  walletId: string,
): Promise<
  | { ok: true; validated: number; skipped_no_receipt: number; skipped: string[] }
  | { ok: false; error: string }
> {
  try {
    // CEO 2026-06-10 : validation = CEO + assistante (PAS propria).
    const user = await assertRole(['ceo','assistante']);
    const supabase = createClient();

    const { data: candidates } = await supabase
      .from('propria_wallet_expenses')
      .select('id, receipt_path, description, amount_mad')
      .eq('wallet_id', walletId)
      .is('deleted_at', null)
      .eq('is_validated', false);

    const withReceipt = (candidates ?? []).filter(c => c.receipt_path);
    const withoutReceipt = (candidates ?? []).filter(c => !c.receipt_path);

    if (withReceipt.length > 0) {
      const { error } = await supabase
        .from('propria_wallet_expenses')
        .update({
          is_validated: true,
          validated_at: new Date().toISOString(),
          validated_by: user.id,
        } as any)
        .in('id', withReceipt.map(c => c.id));
      if (error) throw new Error(error.message);
    }

    revalidatePath(`/propria/caisse/${walletId}`);
    return {
      ok: true,
      validated: withReceipt.length,
      skipped_no_receipt: withoutReceipt.length,
      skipped: withoutReceipt.map(c => `${c.description} (${c.amount_mad} DH)`),
    };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Upload justificatif (PJ) sur une dépense ─────────────────────────────

const ALLOWED_RECEIPT_MIME = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
];
const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;

export async function uploadExpenseReceiptAction(formData: FormData): Promise<ActionResult> {
  try {
    await assertRole(['ceo','finance','assistante','propria']);
    const supabase = createClient();

    const file = formData.get('file') as File | null;
    const expenseId = String(formData.get('expense_id') ?? '');
    const walletId = String(formData.get('wallet_id') ?? '');

    if (!file || !file.size) throw new Error('Fichier requis');
    if (file.size > MAX_RECEIPT_SIZE) throw new Error('Fichier trop volumineux (max 10 MB)');
    if (!ALLOWED_RECEIPT_MIME.includes(file.type)) {
      throw new Error(`Type non supporté : ${file.type}`);
    }

    const ext = file.name.split('.').pop();
    const path = `propria/wallets/${walletId}/expenses/${expenseId}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { error: dbErr } = await supabase
      .from('propria_wallet_expenses')
      .update({ receipt_path: path } as any)
      .eq('id', expenseId)
      .is('deleted_at', null);
    if (dbErr) {
      await supabase.storage.from('documents').remove([path]);
      throw new Error(dbErr.message);
    }

    revalidatePath(`/propria/caisse/${walletId}`);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function getExpenseReceiptSignedUrl(
  receiptPath: string,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  try {
    await assertRole(['ceo','finance','assistante','propria']);
    const supabase = createClient();
    const { data } = await supabase.storage.from('documents').createSignedUrl(receiptPath, 3600);
    return { ok: true, url: data?.signedUrl ?? null };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}
