import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionUser, requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  createDotationAction,
  createExpenseAction,
  validateExpenseAction,
  validateAllExpensesForWalletAction,
  closeWalletAction,
} from '../actions';
import { BackLink } from '@/components/ui/back-link';
import { ExpenseReceiptUpload } from '@/components/propria/expense-receipt-upload';
import { getActiveLotOptions, getLotLabelMap } from '@/lib/propria/lots';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { PropriaBulkDeleteForm } from '@/components/propria/propria-bulk-delete-form';
import { CaisseSaisieForms } from '@/components/propria/caisse-saisie';
import { CloseWalletButton } from '@/components/propria/close-wallet-button';
import { ValidateExpenseButton } from '@/components/propria/validate-expense-button';
import { PropriaAuditTimeline } from '@/components/propria/propria-audit-timeline';

function fmt(n: any) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n)) + ' DH';
}

// Wrapper qui capture TOUT crash de WalletDetailPage et l'écrit en BDD.
// En prod, Next.js efface error.message — sans cette persistance on est aveugle.
export default async function WalletDetailPageOuter({ params }: { params: { walletId: string } }) {
  try {
    return await WalletDetailPage({ params });
  } catch (e: any) {
    if (e?.digest === 'NEXT_NOT_FOUND' || e?.digest?.startsWith?.('NEXT_REDIRECT')) {
      throw e; // notFound() / redirect() — comportement attendu de Next, on ne les loggue pas
    }
    try {
      const sb = createClient();
      const u = await getSessionUser().catch(() => null);
      await sb.from('app_error_logs').insert({
        source: 'WalletDetailPage',
        user_id: u?.id ?? null,
        message: (e?.message ?? 'unknown render error').slice(0, 1000),
        details: { stack: (e?.stack ?? '').slice(0, 4000), name: e?.name ?? null },
        payload: { walletId: params.walletId, role: u?.role ?? null },
      } as any);
    } catch { /* never let logger break error path */ }
    throw e;
  }
}

async function WalletDetailPage({ params }: { params: { walletId: string } }) {
  await requireRole(['ceo','developer','finance','assistante','propria']);
  const me = await getSessionUser();
  const supabase = createClient();

  // Helper local : persiste l'erreur en BDD avant tout throw. Indispensable
  // parce que Next.js masque error.message en prod (on ne voit que la phrase
  // générique côté UI) et les logs Vercel ont une rétention très courte.
  async function logCaisseError(message: string, details?: any) {
    try {
      await supabase.from('app_error_logs').insert({
        source: 'WalletDetailPage',
        user_id: me?.id ?? null,
        message: message?.slice(0, 1000) ?? null,
        details: details ?? null,
        payload: { walletId: params.walletId, role: me?.role ?? null },
      } as any);
    } catch {
      // ignore — never let the logger break the actual error path
    }
  }

  // Chaque requête est instrumentée : si une plante, on log explicitement
  // quelle source pose problème (les logs Vercel ont une rétention courte,
  // donc on capture immédiatement). Toute erreur Supabase est propagée pour
  // déclencher le boundary error.tsx avec un message lisible.
  async function safe<R extends { data: unknown; error: unknown }>(label: string, p: PromiseLike<R>): Promise<R> {
    try {
      const res = await p;
      if ((res as any).error) {
        console.error(`[caisse/${params.walletId}] ${label} error`, (res as any).error);
      }
      return res;
    } catch (e: any) {
      console.error(`[caisse/${params.walletId}] ${label} threw`, e?.message);
      return { data: null, error: { message: e?.message ?? 'unknown' } } as unknown as R;
    }
  }

  const [walletRes, balRes, dotRes, expRes, profRes, lotOptions, lotLabels] = await Promise.all([
    safe('wallet', supabase.from('propria_wallets').select('*').eq('id', params.walletId).single()),
    safe('balance', supabase.from('propria_wallet_balances').select('*').eq('wallet_id', params.walletId).maybeSingle()),
    safe('dotations', supabase.from('propria_wallet_dotations').select('*')
      .eq('wallet_id', params.walletId).order('given_at', { ascending: false })),
    safe('expenses', supabase.from('propria_wallet_expenses').select('*')
      .eq('wallet_id', params.walletId)
      .is('deleted_at', null)
      .order('spent_at', { ascending: false })),
    safe('profiles', supabase.from('profiles').select('id, full_name')),
    getActiveLotOptions().catch((e) => { console.error('[caisse] lotOptions threw', e?.message); return [] as any[]; }),
    getLotLabelMap().catch((e) => { console.error('[caisse] lotLabels threw', e?.message); return new Map<string,string>(); }),
  ]);

  // Première vérif : si une lecture critique a planté, on remonte un message
  // explicite plutôt que de laisser exploser le render plus bas.
  const fetchErrors: { label: string; err: any }[] = [];
  if ((walletRes as any).error) fetchErrors.push({ label: 'wallet', err: (walletRes as any).error });
  if ((balRes as any).error) fetchErrors.push({ label: 'balance', err: (balRes as any).error });
  if ((dotRes as any).error) fetchErrors.push({ label: 'dotations', err: (dotRes as any).error });
  if ((expRes as any).error) fetchErrors.push({ label: 'expenses', err: (expRes as any).error });
  if ((profRes as any).error) fetchErrors.push({ label: 'profiles', err: (profRes as any).error });
  if (fetchErrors.length > 0) {
    await logCaisseError(
      `Lecture impossible : ${fetchErrors.map((e) => `${e.label}=${e.err?.message}`).join(' | ')}`,
      fetchErrors,
    );
    throw new Error(`Caisse — lecture impossible : ${fetchErrors[0].err?.message ?? 'erreur Supabase'}`);
  }

  if (!walletRes.data) {
    await logCaisseError(`Wallet introuvable : ${params.walletId}`);
    notFound();
  }
  const wallet = walletRes.data;
  const bal = balRes.data;
  const dotations = (dotRes.data ?? []) as any[];
  const expenses = (expRes.data ?? []) as any[];
  const profMap = new Map(((profRes.data ?? []) as any[]).map((p: any) => [p.id, p.full_name]));

  const lotName = (id: string | null) => (id ? (lotLabels.get(id) ?? null) : null);

  // Sentinelle BDD : si elle apparaît dans app_error_logs avec source
  // 'WalletDetailPage:fetched-ok', le fetch et la dérivation marchent —
  // un éventuel crash plus tard vient donc du rendu JSX (sous-composant
  // client SSR, server action inline, etc.).
  try {
    await supabase.from('app_error_logs').insert({
      source: 'WalletDetailPage:fetched-ok',
      user_id: me?.id ?? null,
      message: 'fetch+derived OK, starting JSX',
      details: {
        n_dotations: dotations.length,
        n_expenses: expenses.length,
        n_lotOptions: (lotOptions as any[])?.length ?? 0,
        n_lotLabels: (lotLabels as any)?.size ?? 0,
        wallet_active: wallet.is_active,
        any_expense_has_receipt: expenses.some((e) => !e.is_validated && e.receipt_path),
      },
      payload: { walletId: params.walletId, role: me?.role ?? null },
    } as any);
  } catch { /* ignore */ }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria/caisse" className="hover:text-stoniz-black">Caisses</Link>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-display">
              {profMap.get(wallet.profile_id) ?? '—'}
            </h1>
            {wallet.label && <p className="text-sm text-stoniz-gray-600 mt-1">{wallet.label}</p>}
          </div>
          {wallet.is_active && <CloseWalletButton walletId={params.walletId} />}
        </div>
      </div>

      {/* Solde */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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

      <CaisseSaisieForms walletId={params.walletId} lotOptions={lotOptions as any} />

      {/* Dotations */}
      <h2 className="font-display text-lg mb-3">Historique des dotations</h2>
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto mb-8">
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
                <td className="px-3 py-2 text-xs">{new Date(d.given_at).toLocaleDateString('fr-FR')}</td>
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

      {/* Dépenses */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-display text-lg">Historique des dépenses</h2>
        {expenses.some(e => !e.is_validated && e.receipt_path) && (
          <form action={async () => { 'use server'; await validateAllExpensesForWalletAction(params.walletId); }}>
            <button className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700">
              ✓ Tout valider (avec PJ)
            </button>
          </form>
        )}
      </div>
      {/* Wrapper PropriaBulkDeleteForm temporairement retiré — soupçonné de
          provoquer un crash render JSX sur cette page. À réintroduire après
          isolation. */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-2 py-2"></th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Lot</th>
              <th className="px-3 py-2 text-left">Catégorie</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">Montant</th>
              <th className="px-3 py-2 text-center">Charge</th>
              <th className="px-3 py-2 text-center">Justificatif (PJ)</th>
              <th className="px-3 py-2 text-center">Justifié</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {expenses.map(e => (
              <tr key={e.id} className={e.is_validated ? 'bg-emerald-50/30' : ''}>
                <td className="px-2 py-2 text-center"><input type="checkbox" data-bulk-id={e.id} /></td>
                <td className="px-3 py-2 text-xs">{new Date(e.spent_at).toLocaleDateString('fr-FR')}</td>
                <td className="px-3 py-2 text-xs">{lotName(e.propria_unit_id) ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{e.category ?? '—'}</td>
                <td className="px-3 py-2 text-xs max-w-xs truncate" title={e.description}>{e.description}</td>
                <td className="px-3 py-2 text-right">{fmt(e.amount_mad)}</td>
                <td className="px-3 py-2 text-center text-xs">
                  {e.charge_to === 'client' && '👤 Client'}
                  {e.charge_to === 'propria' && '🏢 Propria'}
                  {e.charge_to === 'copropriete' && '🏘 Copro'}
                </td>
                <td className="px-3 py-2 text-center">
                  {e.receipt_path ? (
                    <a href={`/api/propria/expense-receipt?path=${encodeURIComponent(e.receipt_path)}`}
                       target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline">
                      📎 voir
                    </a>
                  ) : (
                    <ExpenseReceiptUpload expenseId={e.id} walletId={params.walletId} />
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  {e.is_validated ? (
                    <span className="text-emerald-600 text-xs" title={`Validé le ${new Date(e.validated_at).toLocaleDateString('fr-FR')}`}>
                      ✓ justifié
                    </span>
                  ) : e.receipt_path ? (
                    <ValidateExpenseButton expenseId={e.id} walletId={params.walletId} />
                  ) : (
                    <span className="text-xs text-orange-700">PJ manquante</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center">
                  <PropriaDeleteButton table="propria_wallet_expenses" id={e.id} />
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-stoniz-gray-500 text-xs">
                Aucune dépense enregistrée.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Historique des modifications — qui a fait quoi sur cette caisse */}
      <PropriaAuditTimeline table="propria_wallets" recordId={params.walletId} />
    </div>
  );
}
