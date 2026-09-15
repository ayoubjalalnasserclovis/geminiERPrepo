import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ApprovalCard, type ApprovalWithMeta } from '@/components/validations/approval-card';

export const dynamic = 'force-dynamic';

/**
 * /mes-demandes-paiement — vue demandeur (B2).
 *
 * Filtre auto : requested_by = me.id. Page accessible aux 8 rôles
 * initiateurs (ceo, chef_projet, sourcing, commercial, finance,
 * assistante, achats, developer). Les autres rôles sont redirigés
 * par requireRole.
 *
 * 4 chips de filtre URL state (?status=active|paid|rejected|all) :
 *   - active   : pending OU approved et pas encore payée
 *   - paid     : paid_at IS NOT NULL (toujours visible même si soft-delete)
 *   - rejected : final_status = 'rejected'
 *   - all      : aucune restriction
 *
 * NB : la colonne final_status (GENERATED) ne contient PAS 'paid' — on
 *      détecte le payé via paid_at IS NOT NULL.
 *
 * Réutilise ApprovalCard B1 — zéro duplication. Les actions Finance/CEO
 * n'apparaissent pas pour le requester (sauf si le requester est lui-même
 * reviewer, ex. CEO qui demande), c'est ApprovalActions qui gère.
 *
 * CEO 2026-06-25 (Phase B2).
 */

type StatusFilter = 'active' | 'paid' | 'rejected' | 'all';
const VALID_STATUS: StatusFilter[] = ['active', 'paid', 'rejected', 'all'];

const TABS: Array<{ v: StatusFilter; l: string }> = [
  { v: 'active',   l: 'Actives' },
  { v: 'paid',     l: 'Payées' },
  { v: 'rejected', l: 'Rejetées' },
  { v: 'all',      l: 'Toutes' },
];

export default async function MesDemandesPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const me = await requireRole([
    'ceo', 'chef_projet', 'sourcing', 'commercial',
    'finance', 'assistante', 'achats', 'developer',
  ]);
  const supabase = createClient();

  const status: StatusFilter = VALID_STATUS.includes(searchParams.status as StatusFilter)
    ? (searchParams.status as StatusFilter)
    : 'active';

  // ─── Liste filtrée ────────────────────────────────────────────────
  let q = supabase
    .from('payment_approvals')
    .select(`
      *,
      requester:profiles!payment_approvals_requested_by_fkey(full_name, role),
      project:projects(reference, client:clients(full_name)),
      finance_rev:profiles!payment_approvals_finance_reviewer_fkey(full_name),
      ceo_rev:profiles!payment_approvals_ceo_reviewer_fkey(full_name)
    `)
    .eq('requested_by', me.id);

  if (status === 'active') {
    // Pas encore payée, pas rejetée, pas soft-deleted
    q = q.is('paid_at', null).neq('final_status', 'rejected').is('deleted_at', null);
  } else if (status === 'paid') {
    // Payée — affichée même si soft-deleted (historique)
    q = q.not('paid_at', 'is', null);
  } else if (status === 'rejected') {
    // Rejetée — affichée même si soft-deleted
    q = q.eq('final_status', 'rejected');
  } else {
    // 'all' : toutes (y compris soft-deleted)
  }

  let approvals: ApprovalWithMeta[] = [];
  try {
    const { data, error } = await q.order('requested_at', { ascending: false });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[mes-demandes-paiement] approvals query error', error);
    } else {
      approvals = (data ?? []) as unknown as ApprovalWithMeta[];
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[mes-demandes-paiement] approvals query exception', e);
  }

  // ─── Compteurs pour les chips (Promise.all) ──────────────────────
  const countQueries = [
    // Actives
    supabase
      .from('payment_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('requested_by', me.id)
      .is('paid_at', null)
      .neq('final_status', 'rejected')
      .is('deleted_at', null),
    // Payées
    supabase
      .from('payment_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('requested_by', me.id)
      .not('paid_at', 'is', null),
    // Rejetées
    supabase
      .from('payment_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('requested_by', me.id)
      .eq('final_status', 'rejected'),
    // Toutes
    supabase
      .from('payment_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('requested_by', me.id),
  ];

  let counts: Record<StatusFilter, number> = { active: 0, paid: 0, rejected: 0, all: 0 };
  try {
    const [a, p, r, all] = await Promise.all(countQueries);
    counts = {
      active:   a.count ?? 0,
      paid:     p.count ?? 0,
      rejected: r.count ?? 0,
      all:      all.count ?? 0,
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[mes-demandes-paiement] counts query exception', e);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mes demandes de paiement"
        description="Suivi de mes demandes envoyées au workflow Finance → CEO → Virement"
      />

      {/* Onglets de filtre — alignés sur /validations */}
      <div className="flex gap-2 flex-wrap border-b">
        {TABS.map(t => (
          <Link
            key={t.v}
            href={`/mes-demandes-paiement?status=${t.v}`}
            className={`text-sm px-4 py-2 -mb-px border-b-2 ${
              status === t.v
                ? 'border-stoniz-black font-medium'
                : 'border-transparent text-stoniz-gray-500'
            }`}
          >
            {t.l}
            {counts[t.v] > 0 && (
              <span
                className={`ml-2 inline-block min-w-5 text-center px-1.5 py-0.5 rounded-full text-xs ${
                  t.v === 'active'
                    ? 'bg-amber-100 text-amber-700'
                    : t.v === 'paid'
                    ? 'bg-green-100 text-green-700'
                    : t.v === 'rejected'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-stoniz-gray-200 text-stoniz-gray-700'
                }`}
              >
                {counts[t.v]}
              </span>
            )}
          </Link>
        ))}
      </div>

      {approvals.length === 0 ? (
        <EmptyState
          title={
            status === 'active'
              ? '📭 Aucune demande active'
              : status === 'paid'
              ? '💸 Aucune demande payée'
              : status === 'rejected'
              ? '✗ Aucune demande rejetée'
              : '📭 Vous n\'avez pas encore initié de demande de paiement'
          }
          description="Pour créer une demande, ouvrez un lot achats ou travaux et cliquez sur « Demander paiement »."
        />
      ) : (
        <div className="space-y-3">
          {approvals.map(a => (
            <ApprovalCard
              key={a.id}
              approval={a}
              currentUser={{ id: me.id, role: me.role }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
