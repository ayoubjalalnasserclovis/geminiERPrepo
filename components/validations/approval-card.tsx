import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ApprovalActions } from '@/components/validations/approval-actions';
import { ApprovalBreakdownPanel } from '@/components/validations/approval-breakdown-panel';
import {
  getApprovalBreakdown,
  type ApprovalForBreakdown,
} from '@/lib/finance/approval-breakdown';
import { formatDate } from '@/lib/utils/format';
import { payerAccountLabel } from '@/lib/finance/payer-account';

/**
 * Carte standalone d'une demande de validation. Réutilisée par :
 *   - /validations (page CEO/Finance pour traiter les demandes)
 *   - /mes-demandes-paiement (vue demandeur, B2)
 *
 * Affiche : montant + bénéficiaire + projet + statuts Finance/CEO,
 * un panel <details> dépliable avec breakdown lots/docs/acomptes,
 * et les actions (boutons Finance/CEO/marquer payé) selon le rôle.
 *
 * Server component asynchrone — charge le breakdown au render et le passe
 * à <ApprovalBreakdownPanel> (server). Wrap try/catch défensif : si le
 * helper plante (FK manquante, schéma cassé), la carte rend quand même.
 *
 * Signature stable — B2 (page Mes demandes) consommera tel quel.
 *
 * CEO 2026-06-25 (Phase B1).
 */

export type ApprovalWithMeta = {
  id: string;
  amount: number | string;
  currency: string;
  beneficiary_name: string;
  description: string | null;
  urgency: 'normal' | 'urgent';
  /** Compte payeur (achats/travaux, CEO 2026-07-08) — null pour honoraires + legacy. */
  payer_account: string | null;
  requested_at: string;
  request_notes: string | null;
  finance_status: 'pending' | 'approved' | 'rejected' | 'skipped';
  ceo_status: 'pending' | 'approved' | 'rejected';
  finance_notes: string | null;
  ceo_notes: string | null;
  paid_at: string | null;
  project_id: string | null;
  payment_id: string | null;
  travaux_payment_id: string | null;
  achats_payment_id: string | null;
  payment_batch_id: string | null;
  requester: { full_name: string; role: string } | null;
  project: {
    reference: string | null;
    client: { full_name: string | null } | null;
  } | null;
  finance_rev: { full_name: string | null } | null;
  ceo_rev: { full_name: string | null } | null;
};

export async function ApprovalCard({
  approval: a,
  currentUser,
}: {
  approval: ApprovalWithMeta;
  currentUser: { id: string; role: string };
}) {
  const isUrgent = a.urgency === 'urgent';

  // Charge le breakdown — défensif : si jamais le helper plante (ex. nouveau
  // bug d'intégration), on rend la carte sans le panel.
  let breakdownEl: React.ReactNode = null;
  try {
    const approvalForBreakdown: ApprovalForBreakdown = {
      id: a.id,
      payment_id: a.payment_id,
      travaux_payment_id: a.travaux_payment_id,
      achats_payment_id: a.achats_payment_id,
      payment_batch_id: a.payment_batch_id,
    };
    const breakdown = await getApprovalBreakdown(approvalForBreakdown);
    breakdownEl = <ApprovalBreakdownPanel breakdown={breakdown} />;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[approval-card] getApprovalBreakdown failed', a.id, e);
    breakdownEl = (
      <details className="mt-3 rounded-lg border border-stoniz-gray-200 bg-stoniz-gray-50/40">
        <summary className="cursor-pointer select-none text-xs font-medium text-stoniz-gray-500 px-3 py-2 list-none">
          Détail indisponible
        </summary>
      </details>
    );
  }

  return (
    <Card id={a.id} className={isUrgent ? 'border-red-400 border-2 bg-red-50/30' : ''}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isUrgent && <Badge variant="error">⚡ URGENT</Badge>}
            <span className="text-xl font-display font-medium">
              {new Intl.NumberFormat('fr-FR').format(Number(a.amount))} {a.currency}
            </span>
            <span className="text-stoniz-gray-500">→</span>
            <span className="font-medium">{a.beneficiary_name}</span>
            {payerAccountLabel(a.payer_account) && (
              <Badge variant="default">🏦 {payerAccountLabel(a.payer_account)}</Badge>
            )}
          </div>
          {a.description && (
            <p className="text-sm text-stoniz-gray-600">{a.description}</p>
          )}
          <div className="text-xs text-stoniz-gray-500 mt-2 flex items-center gap-3 flex-wrap">
            <span>
              Demandé par <strong>{a.requester?.full_name ?? '—'}</strong>
            </span>
            <span>· {formatDate(a.requested_at)}</span>
            {a.project?.reference && a.project_id && (
              <>
                <span>·</span>
                <Link href={`/projects/${a.project_id}`} className="underline">
                  {a.project.reference}
                  {a.project.client?.full_name ? ` · ${a.project.client.full_name}` : ''}
                </Link>
              </>
            )}
          </div>
          {a.request_notes && (
            <p className="text-xs italic mt-2 text-stoniz-gray-600">
              « {a.request_notes} »
            </p>
          )}

          {/* Statuts Finance / CEO / payé */}
          <div className="flex items-center gap-2 mt-3 flex-wrap text-xs">
            <span className="text-stoniz-gray-500">Finance :</span>
            <Badge
              variant={
                a.finance_status === 'approved'
                  ? 'success'
                  : a.finance_status === 'rejected'
                  ? 'error'
                  : a.finance_status === 'skipped'
                  ? 'default'
                  : 'warning'
              }
            >
              {a.finance_status === 'approved'
                ? `✓ ${a.finance_rev?.full_name ?? ''}`
                : a.finance_status === 'rejected'
                ? '✗ Rejeté'
                : a.finance_status === 'skipped'
                ? 'Court-circuité'
                : 'En attente'}
            </Badge>
            {a.finance_notes && (
              <span className="italic text-stoniz-gray-500">« {a.finance_notes} »</span>
            )}
            <span className="text-stoniz-gray-500 ml-3">CEO :</span>
            <Badge
              variant={
                a.ceo_status === 'approved'
                  ? 'success'
                  : a.ceo_status === 'rejected'
                  ? 'error'
                  : 'warning'
              }
            >
              {a.ceo_status === 'approved'
                ? `✓ ${a.ceo_rev?.full_name ?? ''}`
                : a.ceo_status === 'rejected'
                ? '✗ Rejeté'
                : 'En attente'}
            </Badge>
            {a.ceo_notes && (
              <span className="italic text-stoniz-gray-500">« {a.ceo_notes} »</span>
            )}
            {a.paid_at && (
              <>
                <span className="text-stoniz-gray-500 ml-3">·</span>
                <Badge variant="success">💸 Payé {formatDate(a.paid_at)}</Badge>
              </>
            )}
          </div>

          {/* Breakdown lots/docs/acomptes — repliable */}
          {breakdownEl}
        </div>

        <ApprovalActions
          approvalId={a.id}
          userRole={currentUser.role}
          financeStatus={a.finance_status}
          ceoStatus={a.ceo_status}
          isPaid={!!a.paid_at}
        />
      </div>
    </Card>
  );
}
