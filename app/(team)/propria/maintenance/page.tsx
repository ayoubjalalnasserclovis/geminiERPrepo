import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { generateQuarterlyVisitsAction } from './actions';
import { CalendarCheck, AlertTriangle } from 'lucide-react';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';

const STATUS_BADGE: Record<string, string> = {
  a_planifier: 'bg-amber-100 text-amber-800',
  planifie: 'bg-blue-100 text-blue-800',
  realise: 'bg-emerald-100 text-emerald-800',
  en_retard: 'bg-red-100 text-red-800',
};
const STATUS_LABELS: Record<string, string> = {
  a_planifier: 'À planifier', planifie: 'Planifié', realise: '✓ Réalisé', en_retard: '⚠ En retard',
};

export default async function MaintenanceListPage({
  searchParams,
}: { searchParams: { unit?: string; quarter?: string } }) {
  await requireRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  let q = supabase
    .from('propria_maintenance_visits')
    .select(`
      id, propria_unit_id, quarter, due_date, scheduled_at, status, completed_at,
      responsable_id, checklist, notes
    `)
    .is('deleted_at', null)
    .order('due_date', { ascending: false })
    .limit(500);

  if (searchParams.unit) q = q.eq('propria_unit_id', searchParams.unit);
  if (searchParams.quarter) q = q.eq('quarter', searchParams.quarter);

  const [visitsRes, unitsRes, profRes] = await Promise.all([
    q,
    supabase.from('propria_units_enriched').select('unit_id, display_label, property_id'),
    supabase.from('profiles').select('id, full_name').eq('is_active', true).neq('role', 'client'),
  ]);

  const unitMap = new Map((unitsRes.data ?? []).map((u: any) => [u.unit_id, u]));
  const profs = new Map((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  const visits = (visitsRes.data ?? []) as any[];

  const grouped = visits.reduce((acc: Record<string, any[]>, v: any) => {
    (acc[v.quarter] ??= []).push(v);
    return acc;
  }, {});

  const enRetard = visits.filter(v => v.status === 'en_retard').length;
  const aPlanifier = visits.filter(v => v.status === 'a_planifier').length;

  return (
    <div className="max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Maintenance préventive
          </div>
          <h1 className="text-2xl md:text-3xl font-display">Maintenance préventive (trimestrielle)</h1>
          <p className="text-sm text-stoniz-gray-600 mt-2">
            Une visite par trimestre par lot (listing) — obligatoire. Les visites manquantes sont générées chaque début de trimestre.
          </p>
        </div>
        <form action={async () => {
          'use server';
          await generateQuarterlyVisitsAction();
        }}>
          <button className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800">
            ↻ Générer les visites du trimestre
          </button>
        </form>
      </div>

      {enRetard > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
          <div className="text-sm text-red-900">
            <strong>{enRetard} visite(s) en retard</strong> — il faut intervenir rapidement.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <CalendarCheck className="w-4 h-4 text-stoniz-gray-500 mb-2" />
          <div className="text-2xl font-display">{aPlanifier}</div>
          <div className="text-xs text-stoniz-gray-600">À planifier</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <CalendarCheck className="w-4 h-4 text-blue-500 mb-2" />
          <div className="text-2xl font-display">{visits.filter(v => v.status === 'planifie').length}</div>
          <div className="text-xs text-stoniz-gray-600">Planifiées</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <CalendarCheck className="w-4 h-4 text-emerald-500 mb-2" />
          <div className="text-2xl font-display">{visits.filter(v => v.status === 'realise').length}</div>
          <div className="text-xs text-stoniz-gray-600">Réalisées</div>
        </div>
      </div>

      {Object.keys(grouped).sort().reverse().map(quarter => (
        <section key={quarter} className="mb-8">
          <h2 className="font-display text-lg mb-3">Trimestre {quarter}</h2>
          <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">Lot</th>
                  <th className="px-3 py-2 text-center">Échéance</th>
                  <th className="px-3 py-2 text-center">Statut</th>
                  <th className="px-3 py-2 text-left">Responsable</th>
                  <th className="px-3 py-2 text-center">Avancement</th>
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stoniz-gray-100">
                {grouped[quarter].map((v: any) => {
                  const unit = unitMap.get(v.propria_unit_id) as any;
                  const checklist = Array.isArray(v.checklist) ? v.checklist : [];
                  const total = checklist.reduce((n: number, s: any) => n + (s.items?.length ?? 0), 0);
                  const done = checklist.reduce((n: number, s: any) =>
                    n + (s.items?.filter((i: any) => i.done).length ?? 0), 0);
                  const pct = total ? Math.round((done / total) * 100) : 0;
                  return (
                    <tr key={v.id} className="hover:bg-stoniz-gray-50">
                      <td className="px-3 py-2">
                        {unit ? (
                          <Link href={`/propria/biens/${unit.property_id}`} className="hover:underline">
                            {unit.display_label}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        {new Date(v.due_date).toLocaleDateString('fr-FR')}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGE[v.status]}`}>
                          {STATUS_LABELS[v.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{profs.get(v.responsable_id) ?? '—'}</td>
                      <td className="px-3 py-2 text-center text-xs">
                        {total > 0 ? (
                          <div className="flex items-center gap-2 justify-center">
                            <div className="w-16 h-1.5 bg-stoniz-gray-200 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px]">{done}/{total}</span>
                          </div>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link href={`/propria/maintenance/${v.id}`} className="text-xs hover:underline">→</Link>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <PropriaDeleteButton table="propria_maintenance_visits" id={v.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {visits.length === 0 && (
        <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center">
          <CalendarCheck className="w-10 h-10 mx-auto text-stoniz-gray-400 mb-3" />
          <div className="font-medium mb-1">Aucune visite de maintenance pour l'instant</div>
          <div className="text-sm text-stoniz-gray-600 mb-4">
            Clique sur "Générer les visites du trimestre" pour créer automatiquement une ligne par lot (listing).
          </div>
        </div>
      )}
    </div>
  );
}
