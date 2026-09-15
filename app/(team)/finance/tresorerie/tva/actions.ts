'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { logFinanceAudit } from '@/lib/finance/audit';
import { normalizeBeneficiary } from '@/lib/finance/tva';

/**
 * Server action pour override le traitement TVA d'une transaction bancaire.
 * CEO + finance (developer en lecture seulement).
 *
 * Option `remember_for_beneficiary` (CEO 2026-09-02) : upsert la règle dans
 * vendor_tva_defaults pour que les futures transactions du même bénéficiaire
 * bénéficient automatiquement du même traitement + taux.
 */
const schema = z.object({
  transaction_id: z.string().uuid(),
  treatment: z.enum(['auto', 'collectee', 'deductible', 'exoneree', 'a_qualifier']),
  tva_rate: z.number().min(0).max(30).nullable().optional(),
  remember_for_beneficiary: z.boolean().optional().default(false),
});

export async function updateTvaTreatmentAction(input: unknown) {
  try {
    await assertRole(['ceo', 'finance']);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: parsed.error.issues[0].message };
    }
    const supabase = createClient();

    // Snapshot avant pour audit
    const { data: before } = await supabase
      .from('bank_transactions')
      .select('tva_treatment, tva_rate, label, beneficiary, credit_mad, debit_mad')
      .eq('id', parsed.data.transaction_id)
      .maybeSingle();
    const oldTreatment = (before as any)?.tva_treatment ?? 'auto';
    const oldRate = (before as any)?.tva_rate ?? null;
    const beneficiary = (before as any)?.beneficiary as string | null;

    const { error } = await supabase
      .from('bank_transactions')
      .update({
        tva_treatment: parsed.data.treatment,
        tva_rate: parsed.data.tva_rate ?? null,
      } as any)
      .eq('id', parsed.data.transaction_id);
    if (error) return { ok: false as const, error: error.message };

    // Auto-apprentissage : mémorise pour le bénéficiaire si demandé
    let remembered = false;
    if (parsed.data.remember_for_beneficiary && beneficiary) {
      const norm = normalizeBeneficiary(beneficiary);
      if (norm) {
        const admin = createAdminClient();
        const { data: userData } = await supabase.auth.getUser();
        const { error: upErr } = await admin
          .from('vendor_tva_defaults')
          .upsert(
            {
              beneficiary_normalized: norm,
              beneficiary_display: beneficiary.trim(),
              tva_treatment: parsed.data.treatment,
              tva_rate: parsed.data.tva_rate ?? null,
              updated_at: new Date().toISOString(),
              updated_by: userData.user?.id ?? null,
            } as any,
            { onConflict: 'beneficiary_normalized' },
          );
        remembered = !upErr;
      }
    }

    // Log audit si changement effectif
    if (oldTreatment !== parsed.data.treatment || oldRate !== (parsed.data.tva_rate ?? null)) {
      const { data: user } = await supabase.auth.getUser();
      await logFinanceAudit({
        table: 'bank_transactions',
        recordId: parsed.data.transaction_id,
        action: 'update',
        actorId: user.user?.id ?? null,
        label: `TVA : ${oldTreatment}${oldRate ? ` ${oldRate}%` : ''} → ${parsed.data.treatment}${parsed.data.tva_rate ? ` ${parsed.data.tva_rate}%` : ''} (${(before as any)?.label ?? '—'})`,
        payload: {
          tva_treatment: { before: oldTreatment, after: parsed.data.treatment },
          tva_rate: { before: oldRate, after: parsed.data.tva_rate ?? null },
          amount_ttc: Number((before as any)?.credit_mad ?? 0) + Number((before as any)?.debit_mad ?? 0),
          remembered_for_beneficiary: remembered ? beneficiary : null,
        },
      });
    }

    revalidatePath('/finance/tresorerie/tva');
    return { ok: true as const, remembered };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'Erreur inconnue' };
  }
}
