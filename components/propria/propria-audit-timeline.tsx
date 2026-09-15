import { createClient } from '@/lib/supabase/server';

/**
 * Timeline d'historique Propria — affichée en bas des fiches détail
 * (bien, lot, caisse, article stock…).
 *
 * Lit `propria_audit_log` filtré par (table_name, record_id) et affiche
 * un fil chronologique : qui a fait quoi à quelle date.
 *
 * Le log est INSERT-only (cf migration 20260610200000) donc 100% fiable.
 *
 * Usage :
 *   <PropriaAuditTimeline table="properties" recordId={propertyId} />
 */

const ACTION_LABEL: Record<string, string> = {
  create:        'Création',
  update:        'Modification',
  delete:        'Suppression',
  restore:       'Restauration',
  validate:      'Validation',
  status_change: 'Changement de statut',
  assign:        'Assignation',
  custom:        'Action',
};

const ACTION_COLOR: Record<string, string> = {
  create:        'bg-green-100 text-green-800 border-green-200',
  update:        'bg-blue-100 text-blue-800 border-blue-200',
  delete:        'bg-red-100 text-red-800 border-red-200',
  restore:       'bg-emerald-100 text-emerald-800 border-emerald-200',
  validate:      'bg-purple-100 text-purple-800 border-purple-200',
  status_change: 'bg-amber-100 text-amber-800 border-amber-200',
  assign:        'bg-indigo-100 text-indigo-800 border-indigo-200',
  custom:        'bg-stoniz-gray-100 text-stoniz-gray-700 border-stoniz-gray-200',
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Format compact d'un payload JSON pour preview dans la timeline.
 * Limite à 3 entrées + tronque les valeurs longues.
 */
function formatPayloadPreview(payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const entries = Object.entries(payload).slice(0, 3);
  if (entries.length === 0) return null;
  const parts = entries.map(([k, v]) => {
    // diff { from, to } pattern
    if (v && typeof v === 'object' && 'from' in v && 'to' in v) {
      const from = String((v as any).from ?? '∅').slice(0, 30);
      const to = String((v as any).to ?? '∅').slice(0, 30);
      return `${k}: « ${from} » → « ${to} »`;
    }
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return `${k}: ${String(s).slice(0, 50)}`;
  });
  const more = Object.keys(payload).length - entries.length;
  return parts.join(' · ') + (more > 0 ? ` · +${more} autre${more > 1 ? 's' : ''}` : '');
}

export async function PropriaAuditTimeline({
  table,
  recordId,
  limit = 50,
  title = 'Historique des modifications',
}: {
  table: string;
  recordId: string;
  limit?: number;
  title?: string;
}) {
  const supabase = createClient();
  const { data: logs } = await supabase
    .from('propria_audit_log')
    .select('id, action, label, payload, created_at, actor_id, profiles:actor_id(full_name, email)')
    .eq('table_name', table)
    .eq('record_id', recordId)
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (logs ?? []) as any[];

  return (
    <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mt-6">
      <summary className="cursor-pointer font-medium text-stoniz-gray-900 flex items-center gap-2">
        <span>{title}</span>
        <span className="text-xs text-stoniz-gray-500 font-normal">
          ({rows.length} entrée{rows.length !== 1 ? 's' : ''})
        </span>
      </summary>

      {rows.length === 0 ? (
        <p className="text-sm text-stoniz-gray-500 mt-4">
          Aucune modification enregistrée pour le moment.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => {
            const actor = r.profiles?.full_name || r.profiles?.email || '—';
            const preview = formatPayloadPreview(r.payload);
            return (
              <li
                key={r.id}
                className="flex gap-3 pl-3 border-l-2 border-stoniz-gray-200 hover:border-stoniz-gray-400 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded border ${
                        ACTION_COLOR[r.action] ?? ACTION_COLOR.custom
                      }`}
                    >
                      {ACTION_LABEL[r.action] ?? r.action}
                    </span>
                    <span className="text-sm text-stoniz-gray-900">
                      {r.label ?? '—'}
                    </span>
                  </div>
                  {preview && (
                    <div className="text-xs text-stoniz-gray-600 mt-1 font-mono break-all">
                      {preview}
                    </div>
                  )}
                  <div className="text-xs text-stoniz-gray-500 mt-1">
                    <span className="font-medium">{actor}</span>
                    <span className="mx-1">·</span>
                    <span>{fmtDate(r.created_at)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
