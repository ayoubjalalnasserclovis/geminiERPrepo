import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireCronAuth } from '@/lib/cron/auth';

/**
 * Cron Propria — Maintenance préventive trimestrielle
 *
 * Tâches :
 *   1. Génère les visites manquantes pour le trimestre courant (1× par bien Propria).
 *   2. Marque "en_retard" les visites encore non réalisées dont la due_date est passée.
 *
 * Programmé chaque jour à 06:00 UTC via vercel.json.
 * Authentifié via Authorization: Bearer ${CRON_SECRET}.
 */
export async function GET(req: Request) {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const supabase = createAdminClient();

  // 1. Génération
  const { data: insertedCount, error: rpcErr } = await supabase
    .rpc('propria_generate_maintenance_visits');
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  // 2. Marquage des retards
  const today = new Date().toISOString().slice(0, 10);
  const { data: overdueRows, error: overdueErr } = await supabase
    .from('propria_maintenance_visits')
    .update({ status: 'en_retard' })
    .lt('due_date', today)
    .in('status', ['a_planifier','planifie'])
    .is('deleted_at', null)
    .select('id');

  if (overdueErr) {
    return NextResponse.json({ error: overdueErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    inserted: insertedCount ?? 0,
    marked_overdue: overdueRows?.length ?? 0,
    ran_at: new Date().toISOString(),
  });
}
