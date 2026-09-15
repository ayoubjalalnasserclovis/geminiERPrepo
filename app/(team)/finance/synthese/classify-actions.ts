'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { logFinanceAudit } from '@/lib/finance/audit';

/**
 * Classifie manuellement un bénéficiaire récurrent (salaire, prestataire,
 * loyer, abonnement, autre, ignore). Impact les KPIs de projection et de
 * synthèse cabinet. CEO 2026-09-02.
 */
const schema = z.object({
  beneficiary: z.string().min(1),
  type: z.enum(['salaire', 'prestataire', 'loyer', 'abonnement', 'autre', 'ignore']),
});

/**
 * Doit être ALIGNÉ avec normalize() dans lib/finance/recurring-detector.ts
 * (UPPERCASE + strip non-alphanumérique). Sinon le lookup dans le helper
 * ne retrouve pas les classifications insérées ici.
 */
function normalize(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ');
}

export async function classifyRecurringAction(input: unknown) {
  try {
    await assertRole(['ceo', 'finance']);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: parsed.error.issues[0].message };
    }
    const supabase = createClient();
    const admin = createAdminClient();
    const norm = normalize(parsed.data.beneficiary);
    if (norm.length === 0) return { ok: false as const, error: 'Bénéficiaire vide' };

    // Snapshot avant pour audit
    const { data: before } = await admin
      .from('recurring_payment_classifications')
      .select('type')
      .eq('beneficiary_normalized', norm)
      .maybeSingle();
    const oldType = (before as any)?.type ?? null;

    const { data: userData } = await supabase.auth.getUser();
    const { error } = await admin
      .from('recurring_payment_classifications')
      .upsert(
        {
          beneficiary_normalized: norm,
          beneficiary_display: parsed.data.beneficiary.trim(),
          type: parsed.data.type,
          updated_at: new Date().toISOString(),
          updated_by: userData.user?.id ?? null,
        } as any,
        { onConflict: 'beneficiary_normalized' },
      );
    if (error) return { ok: false as const, error: error.message };

    // Log audit si changement
    if (oldType !== parsed.data.type) {
      await logFinanceAudit({
        table: 'bank_transactions', // pas de table dédiée dans l'enum, on log sous bank_transactions
        recordId: norm,
        action: 'update',
        actorId: userData.user?.id ?? null,
        label: `Classification récurrent : ${oldType ?? '(nouveau)'} → ${parsed.data.type} (${parsed.data.beneficiary})`,
        payload: {
          beneficiary: parsed.data.beneficiary,
          type: { before: oldType, after: parsed.data.type },
        },
      });
    }

    revalidatePath('/finance/synthese');
    revalidatePath('/finance/projection');
    revalidatePath('/finance/projection/mensuelle');
    return { ok: true as const };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'Erreur inconnue' };
  }
}
