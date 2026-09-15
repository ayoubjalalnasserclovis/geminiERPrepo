import { createClient } from '@/lib/supabase/server';

/**
 * Timeline d'audit AGRÉGÉE sur une section (CEO 2026-06-18).
 *
 * À distinguer de <FinanceAuditButton> qui est un bouton par ligne avec modal.
 * Ce composant-ci agrège TOUS les events d'une section (ex : tous les
 * travaux d'un projet = lots + acomptes + encaissements) et les affiche
 * en bas de la section dans un panneau dépliable, comme PropriaAuditTimeline.
 *
 * Usage typique :
 *   <FinanceSectionAuditTimeline
 *     tables={['travaux_lots', 'travaux_payments', 'travaux_encaissements']}
 *     recordIds={[...allTravauxIds]}
 *     title="Historique des actions travaux"
 *   />
 */

const ACTION_LABEL: Record<string, string> = {
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
  status_change: 'Changement de statut',
  allocate: 'Allocation banque',
  unallocate: 'Désallocation banque',
  validate: 'Validation',
  attach_doc: 'Document attaché',
  bulk_update: 'Action en masse',
  category_change: 'Changement catégorie',
};

const ACTION_COLOR: Record<string, string> = {
  create: 'bg-green-100 text-green-800 border-green-200',
  update: 'bg-blue-100 text-blue-800 border-blue-200',
  delete: 'bg-red-100 text-red-800 border-red-200',
  status_change: 'bg-amber-100 text-amber-800 border-amber-200',
  allocate: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  unallocate: 'bg-orange-100 text-orange-800 border-orange-200',
  validate: 'bg-purple-100 text-purple-800 border-purple-200',
  attach_doc: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  bulk_update: 'bg-pink-100 text-pink-800 border-pink-200',
  category_change: 'bg-teal-100 text-teal-800 border-teal-200',
};

const TABLE_HUMAN: Record<string, string> = {
  travaux_lots: 'Lot travaux',
  travaux_payments: 'Acompte travaux',
  travaux_encaissements: 'Encaissement travaux',
  achats_lots: 'Lot achats',
  achats_payments: 'Acompte achats',
  achats_encaissements: 'Encaissement achats',
  payments: 'Honoraires',
  bank_transactions: 'Transaction bancaire',
  bank_transaction_allocations: 'Allocation banque',
  bank_balances: 'Solde bancaire',
  bank_accounts: 'Compte bancaire',
  bank_companies: 'Société bancaire',
  bank_category_mappings: 'Mapping catégorie',
  vendor_documents: 'Document fournisseur',
  services_lots: 'Lot services',
  services_payments: 'Paiement services',
  stoniz_wallet_expenses: 'Dépense caisse STONIZ',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatPayloadPreview(payload: any): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const entries = Object.entries(payload).slice(0, 3);
  if (entries.length === 0) return null;
  const parts = entries.map(([k, v]) => {
    if (v && typeof v === 'object' && ('before' in v || 'after' in v)) {
      const from = String((v as any).before ?? '∅').slice(0, 30);
      const to = String((v as any).after ?? '∅').slice(0, 30);
      return `${k}: « ${from} » → « ${to} »`;
    }
    if (v && typeof v === 'object' && 'from' in v && 'to' in v) {
      const from = String((v as any).from ?? '∅').slice(0, 30);
      const to = String((v as any).to ?? '∅').slice(0, 30);
      return `${k}: « ${from} » → « ${to} »`;
    }
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return `${k}: ${String(s).slice(0, 50)}`;
  });
  const more = Object.keys(payload).length - entries.length;
  return parts.join(' · ') + (more > 0 ? ` · +${more}` : '');
}

type Props = {
  tables: string[];
  /**
   * Liste explicite de record_ids à filtrer. Si omis OU si `tablesOnly=true`,
   * le filtre porte uniquement sur `table_name` (mode agrégé global, utilisé
   * par /finance/tresorerie pour voir tous les events bank_balances/accounts
   * /companies/category_mappings, sans avoir à précharger la liste des ids).
   */
  recordIds?: string[];
  /**
   * Si true, on ignore `recordIds` et on filtre uniquement par `table_name`.
   * Utile pour les sections où les ids ne sont pas pré-fetchés.
   */
  tablesOnly?: boolean;
  limit?: number;
  title?: string;
  defaultOpen?: boolean;
};

export async function FinanceSectionAuditTimeline({
  tables, recordIds,
  tablesOnly = false,
  limit = 100,
  title = 'Historique des modifications',
  defaultOpen = false,
}: Props) {
  if (tables.length === 0) return null;
  // Mode "recordIds explicites" : si on n'est pas en tablesOnly, et qu'on a
  // fourni recordIds (même vide), on garde le comportement historique.
  const useTablesOnly = tablesOnly || recordIds == null;
  if (!useTablesOnly && (recordIds?.length ?? 0) === 0) return null;

  const supabase = createClient();
  let query = supabase
    .from('finance_audit_log')
    .select('id, table_name, record_id, action, label, payload, occurred_at, actor_id, profiles:actor_id(full_name, email)')
    .in('table_name', tables);
  if (!useTablesOnly && recordIds && recordIds.length > 0) {
    query = query.in('record_id', recordIds);
  }
  const { data: logs } = await query
    .order('occurred_at', { ascending: false })
    .limit(limit);

  const rows = (logs ?? []) as any[];

  return (
    <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mt-4" open={defaultOpen}>
      <summary className="cursor-pointer font-medium text-stoniz-gray-900 flex items-center gap-2">
        <span>{title}</span>
        <span className="text-xs text-stoniz-gray-500 font-normal">
          ({rows.length} entrée{rows.length !== 1 ? 's' : ''})
        </span>
      </summary>

      {rows.length === 0 ? (
        <p className="text-sm text-stoniz-gray-500 mt-4">
          Aucune action enregistrée pour le moment.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => {
            const actor = r.profiles?.full_name || r.profiles?.email || '—';
            const preview = formatPayloadPreview(r.payload);
            const tableHuman = TABLE_HUMAN[r.table_name] ?? r.table_name;
            return (
              <li
                key={r.id}
                className="flex gap-3 pl-3 border-l-2 border-stoniz-gray-200 hover:border-stoniz-gray-400 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded border ${
                        ACTION_COLOR[r.action] ?? 'bg-stoniz-gray-100 text-stoniz-gray-700 border-stoniz-gray-200'
                      }`}
                    >
                      {ACTION_LABEL[r.action] ?? r.action}
                    </span>
                    <span className="text-[10px] text-stoniz-gray-500 font-mono">
                      {tableHuman}
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
                    <span>{fmtDate(r.occurred_at)}</span>
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
