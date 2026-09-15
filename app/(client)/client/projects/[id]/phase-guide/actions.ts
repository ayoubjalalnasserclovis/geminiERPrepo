'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { sendPhaseGuideAcknowledged } from '@/lib/email/templates';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

const PHASES = ['sourcing', 'design', 'travaux', 'mise_en_location'] as const;

const schema = z.object({
  project_id: z.string().uuid(),
  phase: z.enum(PHASES),
});

export async function acknowledgePhaseGuideAction(input: unknown) {
  await assertRole(['client']);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const { project_id, phase } = parsed.data;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Non authentifié.' };

  // Capture IP / user-agent pour audit
  const h = headers();
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null;
  const ua = h.get('user-agent') ?? null;

  // 1. Insert idempotent (UNIQUE project_id + phase)
  const { error: insErr } = await supabase.from('phase_acknowledgments').insert({
    project_id,
    phase,
    acknowledged_by: user.id,
    ip_address: ip,
    user_agent: ua,
  });

  // Si déjà acquitté, on accepte (idempotence)
  if (insErr && !/duplicate key|unique constraint/i.test(insErr.message)) {
    return { ok: false, error: insErr.message };
  }

  // 2. Email au client avec lien vers le PDF
  try {
    const admin = createAdminClient();
    const { data: project } = await admin
      .from('projects')
      .select(`
        reference,
        client:clients(full_name, email)
      `)
      .eq('id', project_id).single();

    const clientEmail = (project as any)?.client?.email;
    const clientName = (project as any)?.client?.full_name ?? 'Cher client';

    if (clientEmail) {
      await sendPhaseGuideAcknowledged({
        to: clientEmail,
        client_name: clientName,
        phase,
        portal_url: `${APP_URL}/client/projects/${project_id}`,
        pdf_url: `${APP_URL}/guides/stoniz-guide-${pdfSlug(phase)}.pdf`,
        project_id,
      });
    }
  } catch (e) {
    console.warn('[email-phase-guide-ack] echec', e);
  }

  revalidatePath(`/client/projects/${project_id}`);
  return { ok: true };
}

function pdfSlug(phase: string): string {
  if (phase === 'mise_en_location') return 'mise-en-location';
  return phase;
}
