import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { DELETABLE_TABLES } from '@/lib/propria/deletable-tables';
import { confirmDeletionAction, restoreDeletionAction } from '../deletion-actions';

function fmtDate(d: any): string {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default async function SuppressionsPage() {
  const user = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const isCeo = user.role === 'ceo';
  const supabase = createClient();

  const [pendingRes, profRes] = await Promise.all([
    supabase.from('propria_deletions').select('*')
      .eq('status', 'pending').order('created_at', { ascending: false }).limit(200),
    supabase.from('profiles').select('id, full_name'),
  ]);

  const rows = (pendingRes.data ?? []) as any[];
  const profMap = new Map((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Suppressions
        </div>
        <h1 className="text-2xl md:text-3xl font-display">Suppressions à valider ({rows.length})</h1>
        <p className="text-sm text-stoniz-gray-600 mt-1">
          Lignes supprimées par les équipes, en attente de ta validation. Confirme (définitif) ou restaure.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-10 text-center text-stoniz-gray-500 text-sm">
          Aucune suppression en attente. 🎉
        </div>
      ) : (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
              <tr>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Motif</th>
                <th className="px-4 py-3 text-left">Supprimée par</th>
                <th className="px-4 py-3 text-left">Quand</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stoniz-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-stoniz-gray-50">
                  <td className="px-4 py-3">{DELETABLE_TABLES[r.entity_table]?.label ?? r.entity_table}</td>
                  <td className="px-4 py-3 text-stoniz-gray-700">{r.reason || <span className="text-stoniz-gray-400 italic">—</span>}</td>
                  <td className="px-4 py-3 text-xs">{profMap.get(r.deleted_by) ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-stoniz-gray-600">{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {isCeo ? (
                      <div className="flex gap-2 justify-end">
                        <form action={async () => { 'use server'; await confirmDeletionAction(r.id); }}>
                          <button className="text-xs bg-stoniz-black text-white px-3 py-1.5 rounded hover:bg-stoniz-gray-800">
                            Confirmer
                          </button>
                        </form>
                        <form action={async () => { 'use server'; await restoreDeletionAction(r.id); }}>
                          <button className="text-xs border border-stoniz-gray-300 px-3 py-1.5 rounded hover:bg-stoniz-gray-50">
                            Restaurer
                          </button>
                        </form>
                      </div>
                    ) : (
                      <span className="text-xs text-stoniz-gray-400">CEO uniquement</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
