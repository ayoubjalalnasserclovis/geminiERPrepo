import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { MaintenanceChecklistEditor } from '@/components/propria/maintenance-checklist-editor';
import {
  planVisitAction,
  saveChecklistAction,
  completeVisitAction,
} from '../actions';

export default async function MaintenanceVisitDetailPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  const [visitRes, unitsRes, profRes] = await Promise.all([
    supabase.from('propria_maintenance_visits').select('*').eq('id', params.id).single(),
    supabase.from('propria_units_enriched').select('unit_id, display_label, property_id'),
    supabase.from('profiles').select('id, full_name').eq('is_active', true).neq('role', 'client').order('full_name'),
  ]);

  if (!visitRes.data) notFound();
  const visit = visitRes.data;
  const unit = (unitsRes.data ?? []).find((u: any) => u.unit_id === visit.propria_unit_id);
  const profs = profRes.data ?? [];

  const isLocked = visit.status === 'realise';

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria/maintenance" className="hover:text-stoniz-black">Maintenance préventive</Link>
        </div>
        <h1 className="text-2xl md:text-3xl font-display">
          Visite {visit.quarter}
          {unit && <> · <Link href={`/propria/biens/${(unit as any).property_id}`} className="hover:underline">{(unit as any).display_label}</Link></>}
        </h1>
        <p className="text-sm text-stoniz-gray-600 mt-1">
          Échéance : {new Date(visit.due_date).toLocaleDateString('fr-FR')}
          {visit.scheduled_at && <> · Planifiée le {new Date(visit.scheduled_at).toLocaleDateString('fr-FR')}</>}
          {visit.completed_at && <> · ✓ Réalisée le {new Date(visit.completed_at).toLocaleDateString('fr-FR')}</>}
        </p>
      </div>

      {visit.status === 'a_planifier' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-5">
          <h3 className="font-medium mb-3">Planifier la visite</h3>
          <form
            action={async (fd: FormData) => {
              'use server';
              await planVisitAction(
                params.id,
                fd.get('scheduled_at') as string,
                (fd.get('responsable_id') as string) || null,
              );
            }}
            className="flex gap-3 items-end flex-wrap"
          >
            <div>
              <label className="text-xs text-stoniz-gray-600">Date prévue</label>
              <input
                name="scheduled_at"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="block mt-1 border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-stoniz-gray-600">Responsable</label>
              <select
                name="responsable_id"
                className="block mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {profs.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </div>
            <button className="bg-stoniz-black text-white px-5 py-2 rounded-md text-sm">
              Planifier
            </button>
          </form>
        </div>
      )}

      {visit.status !== 'a_planifier' && (
        <MaintenanceChecklistEditor
          visitId={params.id}
          initial={Array.isArray(visit.checklist) ? (visit.checklist as any) : null}
          initialNotes={visit.notes}
          saveAction={saveChecklistAction}
          completeAction={completeVisitAction}
          canComplete={!isLocked}
        />
      )}
    </div>
  );
}
