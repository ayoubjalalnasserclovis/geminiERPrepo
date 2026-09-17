import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { ApprovalCard } from '@/components/validations/approval-card';
import { CeoBulkPanel } from '@/components/validations/ceo-bulk-panel';

const TABS = [
  { v: 'finance_pending', l: 'En attente Finance' },
  { v: 'ceo_pending',     l: 'En attente CEO' },
  { v: 'to_pay',          l: 'Approuvés à payer' },
  { v: 'history',         l: 'Historique' },
] as const;

export default async function ValidationsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const me = await requireRole(['ceo','chef_projet','developer','sourcing','commercial','finance','assistante']);
  const tab = (TABS.find(t => t.v === searchParams.tab)?.v) ?? 'finance_pending';
  const supabase = createClient();

  let q = supabase.from('payment_approvals')
    .select(`
      *,
      requester:profiles!payment_approvals_requested_by_fkey(full_name, role),
      project:projects(reference, client:clients(full_name)),
      finance_rev:profiles!payment_approvals_finance_reviewer_fkey(full_name),
      ceo_rev:profiles!payment_approvals_ceo_reviewer_fkey(full_name)
    `);

  if (tab === 'finance_pending') {
    q = q.eq('finance_status', 'pending').is('paid_at', null).is('deleted_at', null);
  } else if (tab === 'ceo_pending') {
    q = q.eq('ceo_status', 'pending').neq('finance_status', 'rejected').is('paid_at', null).is('deleted_at', null);
  } else if (tab === 'to_pay') {
    q = q.eq('final_status', 'approved').is('paid_at', null).is('deleted_at', null);
  } else {
    // Historique : inclut les rejetes soft-deleted ET les payes
    q = q.order('updated_at', { ascending: false });
  }

  const { data: approvals } = await q.order('urgency', { ascending: false }).order('requested_at', { ascending: false });

  // Counts pour les badges des onglets
  const [c1, c2, c3] = await Promise.all([
    supabase.from('payment_approvals').select('id', { count: 'exact', head: true })
      .eq('finance_status', 'pending').is('paid_at', null).is('deleted_at', null),
    supabase.from('payment_approvals').select('id', { count: 'exact', head: true })
      .eq('ceo_status', 'pending').neq('finance_status', 'rejected').is('paid_at', null).is('deleted_at', null),
    supabase.from('payment_approvals').select('id', { count: 'exact', head: true })
      .eq('final_status', 'approved').is('paid_at', null).is('deleted_at', null),
  ]);
  const counts: Record<string, number> = {
    finance_pending: c1.count ?? 0,
    ceo_pending: c2.count ?? 0,
    to_pay: c3.count ?? 0,
    history: 0,
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Validations de paiement" description="Workflow Finance → CEO → Virement" />

      <div className="flex gap-2 flex-wrap border-b">
        {TABS.map(t => (
          <Link key={t.v} href={`/validations?tab=${t.v}`}
            className={`text-sm px-4 py-2 -mb-px border-b-2 ${
              tab === t.v ? 'border-stoniz-black font-medium' : 'border-transparent text-stoniz-gray-500'
            }`}>
            {t.l}
            {counts[t.v] > 0 && (
              <span className={`ml-2 inline-block min-w-5 text-center px-1.5 py-0.5 rounded-full text-xs ${
                t.v === 'finance_pending' ? 'bg-orange-100 text-orange-700' :
                t.v === 'ceo_pending' ? 'bg-red-100 text-red-700' :
                'bg-green-100 text-green-700'
              }`}>{counts[t.v]}</span>
            )}
          </Link>
        ))}
      </div>

      {!approvals || approvals.length === 0 ? (
        <EmptyState
          title={tab === 'finance_pending' ? 'Aucune demande en attente Finance'
            : tab === 'ceo_pending' ? 'Aucune demande à approuver'
            : tab === 'to_pay' ? 'Aucun virement à effectuer'
            : 'Aucune demande dans l\'historique'}
          description="Les demandes apparaîtront ici dès qu'elles seront créées depuis les pages paiements / travaux / achats."
        />
      ) : (tab === 'ceo_pending' || tab === 'to_pay') && me.role === 'ceo' ? (
        <CeoBulkPanel
          mode={tab === 'to_pay' ? 'pay' : 'approve'}
          approvals={approvals.map((a: any) => ({
            id: a.id,
            amount: Number(a.amount ?? 0),
            currency: a.currency ?? 'MAD',
            beneficiary_name: a.beneficiary_name ?? null,
            description: a.description ?? null,
            urgency: a.urgency ?? 'normal',
          }))}
        >
          {approvals.map((a: any) => (
            <ApprovalCard key={a.id} approval={a} currentUser={{ id: me.id, role: me.role }} />
          ))}
        </CeoBulkPanel>
      ) : (
        <div className="space-y-3">
          {approvals.map((a: any) => (
            <ApprovalCard key={a.id} approval={a} currentUser={{ id: me.id, role: me.role }} />
          ))}
        </div>
      )}
    </div>
  );
}
