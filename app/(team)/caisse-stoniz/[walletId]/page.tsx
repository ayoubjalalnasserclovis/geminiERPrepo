import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  createStonizDotationAction,
  createStonizExpenseAction,
  validateStonizExpenseAction,
  validateAllStonizExpensesForWalletAction,
  closeStonizWalletAction,
  reopenStonizWalletAction,
} from '../actions';
import { BackLink } from '@/components/ui/back-link';
import { StonizExpenseReceiptUpload } from '@/components/caisse-stoniz/stoniz-expense-receipt-upload';
import { EditExpenseModal } from '@/components/caisse-stoniz/edit-expense-modal';
import { DeleteExpenseButton } from '@/components/caisse-stoniz/delete-expense-button';
import { RestoreExpenseButton } from '@/components/caisse-stoniz/restore-expense-button';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';

function fmt(n: any) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n)) + ' DH';
}
function fmtDate(d: any): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR');
}

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  achat: '🛒 Achat',
  travaux: '🔨 Travaux',
  autre: '· Autre',
};

export default async function StonizWalletDetailPage({
  params,
  searchParams,
}: {
  params: { walletId: string };
  searchParams?: { exp_deleted?: string };
}) {
  // CEO 2026-06-22 : 'achats' ajouté pour aligner avec l'extension des permissions
  // RLS de stoniz_wallet_expenses (migration 20260622400000_caisse_stoniz_extend.sql)
  // CEO 2026-07-02 : 'sourcing' ajouté pour lecture + écriture dépenses (symétrie).
  // CEO 2026-07-10 : parité features Propria — édition + suppression + restauration
  // + audit + toggle "afficher supprimées" (CEO). RLS SELECT alignée sur cette liste
  // via migration 20260710120000_caisse_stoniz_rls_add_sourcing.sql.
  const user = await requireRole(['ceo','chef_projet','developer','finance','assistante','achats','sourcing']);
  const isCeo = user.role === 'ceo';
  const supabase = createClient();

  // Toggle "Afficher supprimées" (CEO only, symétrie avec la landing page)
  const showDeleted = searchParams?.exp_deleted === '1' && isCeo;

  let expQuery = supabase
    .from('stoniz_wallet_expenses')
    .select('*')
    .eq('wallet_id', params.walletId)
    .order('spent_at', { ascending: false });
  if (!showDeleted) {
    expQuery = expQuery.is('deleted_at', null);
  }

  const [walletRes, balRes, dotRes, expRes, projRes, profRes] = await Promise.all([
    supabase.from('stoniz_wallets').select('*').eq('id', params.walletId).single(),
    supabase.from('stoniz_wallet_balances').select('*').eq('wallet_id', params.walletId).single(),
    supabase.from('stoniz_wallet_dotations').select('*')
      .eq('wallet_id', params.walletId).order('given_at', { ascending: false }),
    expQuery,
    supabase.from('projects').select('id, reference, code, status, client:clients(id, full_name)')
      .neq('status', 'perdu').is('deleted_at', null).order('code'), // QA-BUG-004 : canon = ≠ perdu (garde pause/termine)
    supabase.from('profiles').select('id, full_name').neq('role', 'client'),
  ]);

  if (!walletRes.data) notFound();
  const wallet = walletRes.data;
  const bal = balRes.data;
  const dotations = (dotRes.data ?? []) as any[];
  const expenses = (expRes.data ?? []) as any[];
  const projects = (projRes.data ?? []) as any[];
  const projectMap = new Map(projects.map((p: any) => [p.id, p]));
  const profMap = new Map((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  // Catégories distinctes pour la modale d'édition (parité avec landing page)
  const distinctCategories = Array.from(new Set(
    expenses.map((e) => (e.category ?? '').trim()).filter(Boolean) as string[]
  )).sort();

  // URL pour toggle "Afficher supprimées" (CEO uniquement)
  const toggleDeletedHref = showDeleted
    ? `/caisse-stoniz/${params.walletId}`
    : `/caisse-stoniz/${params.walletId}?exp_deleted=1`;

  return (
    <div className="max-w-5xl">
      <BackLink href="/caisse-stoniz" label="Retour aux caisses STONIZ" />

      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/caisse-stoniz" className="hover:text-stoniz-black">Caisse STONIZ</Link>
          </div>
          <h1 className="text-3xl font-display">
            {profMap.get(wallet.profile_id) ?? '—'}
          </h1>
          {wallet.label && <p className="text-sm text-stoniz-gray-600 mt-1">{wallet.label}</p>}
        </div>
        {wallet.is_active ? (
          <form action={async () => { 'use server'; await closeStonizWalletAction(params.walletId); }}>
            <button className="text-xs text-red-700 hover:underline">Clôturer la caisse</button>
          </form>
        ) : (
          <div className="text-right">
            <span className="text-[10px] bg-stoniz-gray-200 text-stoniz-gray-700 px-2 py-0.5 rounded-full">
              Clôturée le {fmtDate(wallet.closed_at)}
            </span>
            <form
              className="mt-2"
              action={async () => { 'use server'; await reopenStonizWalletAction(params.walletId); }}
            >
              <button className="text-xs text-stoniz-black hover:underline">Rouvrir la caisse</button>
            </form>
          </div>
        )}
      </div>

      {/* Solde */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-600">Dotations</div>
          <div className="text-xl font-display mt-1">{fmt(bal?.total_dotations)}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-600">Dépenses</div>
          <div className="text-xl font-display mt-1">{fmt(bal?.total_expenses)}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-600">Justifié</div>
          <div className="text-xl font-display mt-1">{fmt(bal?.total_validated)}</div>
          {Number(bal?.total_unvalidated ?? 0) > 0 && (
            <div className="text-[11px] text-orange-700 mt-1">
              ⚠ {fmt(bal?.total_unvalidated)} en attente
            </div>
          )}
        </div>
        <div className="bg-stoniz-black text-white rounded-lg p-4">
          <div className="text-xs text-white/80">Solde disponible</div>
          <div className="text-xl font-display mt-1 text-white">{fmt(bal?.solde_mad)}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* ─── Nouvelle dotation (CEO uniquement) ───────────────────── */}
        <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <summary className="cursor-pointer font-medium">
            + Ajouter une dotation
            {!isCeo && <span className="text-xs text-stoniz-gray-500 ml-2">(CEO uniquement)</span>}
          </summary>
          <form action={createStonizDotationAction} className="mt-4 space-y-3">
            <input type="hidden" name="wallet_id" value={params.walletId} />
            <div className="grid grid-cols-2 gap-3">
              <input
                name="given_at" type="date" required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
              <input
                name="amount_mad" type="number" step="0.01" required placeholder="Montant MAD"
                className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <select
              name="type" defaultValue="dotation"
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="dotation">Dotation initiale</option>
              <option value="rechargement">Rechargement</option>
            </select>
            <input
              name="note" placeholder="Note (optionnel)"
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
            <button
              disabled={!isCeo}
              className="w-full bg-stoniz-black text-white py-2 rounded text-sm disabled:opacity-50"
            >
              Ajouter la dotation
            </button>
          </form>
        </details>

        {/* ─── Nouvelle dépense ─────────────────────────────────────── */}
        <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <summary className="cursor-pointer font-medium">+ Enregistrer une dépense</summary>
          <form action={createStonizExpenseAction} className="mt-4 space-y-3">
            <input type="hidden" name="wallet_id" value={params.walletId} />
            <div className="grid grid-cols-2 gap-3">
              <input
                name="spent_at" type="date" required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
              <input
                name="amount_mad" type="number" step="0.01" required placeholder="Montant MAD"
                className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                name="project_id"
                className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              >
                <option value="">— Projet (optionnel) —</option>
                {projects.map((p: any) => {
                  const clientName = p.client?.full_name ?? '—';
                  const label = p.code
                    ? `${p.code} · ${clientName}`
                    : `${clientName} (${p.reference})`;
                  return (
                    <option key={p.id} value={p.id}>{label}</option>
                  );
                })}
              </select>
              <select
                name="expense_type" required defaultValue="achat"
                className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              >
                <option value="achat">🛒 Achat</option>
                <option value="travaux">🔨 Travaux</option>
                <option value="autre">· Autre</option>
              </select>
            </div>
            <input
              name="category" placeholder="Catégorie (Quincaillerie, Plans, ...)"
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
            <input
              name="description" required placeholder="Description courte *"
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
            <div>
              <label className="text-xs text-stoniz-gray-600 block mb-1">
                Justificatif <span className="text-stoniz-gray-500">(optionnel · PDF/JPG/PNG · max 10 MB)</span>
              </label>
              <input
                name="receipt_file"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
                className="w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-stoniz-gray-100 file:text-stoniz-gray-800 file:text-xs file:font-medium hover:file:bg-stoniz-gray-200 file:cursor-pointer"
              />
            </div>
            <button className="w-full bg-stoniz-black text-white py-2 rounded text-sm">
              Enregistrer la dépense
            </button>
          </form>
        </details>
      </div>

      {/* ─── Historique dotations ─────────────────────────────────── */}
      <h2 className="font-display text-lg mb-3">Historique des dotations</h2>
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2 text-left">Remis par</th>
              <th className="px-3 py-2 text-left">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {dotations.map(d => (
              <tr key={d.id}>
                <td className="px-3 py-2 text-xs">{fmtDate(d.given_at)}</td>
                <td className="px-3 py-2 text-xs">{d.type === 'dotation' ? 'Dotation' : 'Rechargement'}</td>
                <td className="px-3 py-2 text-right font-medium">{fmt(d.amount_mad)}</td>
                <td className="px-3 py-2 text-xs">{profMap.get(d.given_by) ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{d.note ?? '—'}</td>
              </tr>
            ))}
            {dotations.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-stoniz-gray-500 text-xs">
                Aucune dotation pour l'instant.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Historique dépenses ──────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="font-display text-lg">Historique des dépenses</h2>
        <div className="flex items-center gap-2">
          {/* Toggle "Afficher supprimées" — CEO uniquement (parité landing page) */}
          {isCeo && (
            <Link
              href={toggleDeletedHref}
              className={`text-[11px] px-2 py-1 rounded-full border ${
                showDeleted
                  ? 'bg-stoniz-black text-white border-stoniz-black'
                  : 'border-stoniz-gray-300 hover:bg-stoniz-gray-50'
              }`}
            >
              {showDeleted ? '🗑 Affiche supprimées' : 'Afficher supprimées'}
            </Link>
          )}
          {expenses.some(e => !e.is_validated && e.receipt_path && !e.deleted_at) && isCeo && (
            <form action={async () => { 'use server';
              await validateAllStonizExpensesForWalletAction(params.walletId);
            }}>
              <button className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700">
                ✓ Tout valider (avec PJ)
              </button>
            </form>
          )}
        </div>
      </div>
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Projet</th>
              <th className="px-3 py-2 text-center">Type</th>
              <th className="px-3 py-2 text-left">Catégorie</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2 text-center">Justificatif (PJ)</th>
              <th className="px-3 py-2 text-center">Justifié</th>
              <th className="px-3 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {expenses.map(e => {
              const isDeleted = !!e.deleted_at;
              // Parité Propria : auteur ou CEO peut éditer/supprimer une ligne
              // non-supprimée. Sur ligne validée, la RLS bloquera si non-CEO,
              // les composants d'édition affichent le message d'erreur.
              const canEdit = isCeo || (user.id && e.created_by === user.id);
              return (
                <tr
                  key={e.id}
                  className={`${isDeleted ? 'opacity-50 line-through' : e.is_validated ? 'bg-emerald-50/30' : ''}`}
                >
                  <td className="px-3 py-2 text-xs">{fmtDate(e.spent_at)}</td>
                  <td className="px-3 py-2 text-xs">
                    {(() => {
                      const p = projectMap.get(e.project_id) as any;
                      if (!p) return '—';
                      return p.code ?? p.reference;
                    })()}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {EXPENSE_TYPE_LABEL[e.expense_type] ?? e.expense_type}
                  </td>
                  <td className="px-3 py-2 text-xs">{e.category ?? '—'}</td>
                  <td className="px-3 py-2 text-xs max-w-xs truncate" title={e.description}>{e.description}</td>
                  <td className="px-3 py-2 text-right">{fmt(e.amount_mad)}</td>
                  <td className="px-3 py-2 text-center">
                    {e.receipt_path ? (
                      <a href={`/api/caisse-stoniz/expense-receipt?path=${encodeURIComponent(e.receipt_path)}`}
                         target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline">
                        📎 voir
                      </a>
                    ) : !isDeleted ? (
                      <StonizExpenseReceiptUpload expenseId={e.id} walletId={params.walletId} />
                    ) : (
                      <span className="text-xs text-stoniz-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {e.is_validated ? (
                      <span className="text-emerald-600 text-xs" title={`Validé le ${fmtDate(e.validated_at)}`}>
                        ✓ justifié
                      </span>
                    ) : e.receipt_path && !isDeleted ? (
                      isCeo ? (
                        <form action={async () => { 'use server';
                          await validateStonizExpenseAction(e.id, params.walletId);
                        }}>
                          <button className="text-xs text-stoniz-black hover:underline font-semibold">
                            valider
                          </button>
                        </form>
                      ) : (
                        <span className="text-xs text-stoniz-gray-400">CEO uniquement</span>
                      )
                    ) : !isDeleted ? (
                      <span className="text-xs text-orange-700">PJ manquante</span>
                    ) : (
                      <span className="text-xs text-stoniz-gray-400">—</span>
                    )}
                  </td>
                  {/* Actions : Éditer + Supprimer + Restaurer + Audit (parité Propria + landing) */}
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex items-center gap-2">
                      {canEdit && !isDeleted && (
                        <EditExpenseModal
                          expense={{
                            id: e.id,
                            amount_mad: e.amount_mad,
                            description: e.description,
                            category: e.category,
                          }}
                          categories={distinctCategories}
                        />
                      )}
                      {canEdit && !isDeleted && (
                        <DeleteExpenseButton
                          expenseId={e.id}
                          label={e.description ?? ''}
                        />
                      )}
                      {isCeo && isDeleted && (
                        <RestoreExpenseButton
                          expenseId={e.id}
                          label={e.description ?? ''}
                        />
                      )}
                      <FinanceAuditButton
                        table="stoniz_wallet_expenses"
                        recordId={e.id}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {expenses.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-stoniz-gray-500 text-xs">
                Aucune dépense enregistrée.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
