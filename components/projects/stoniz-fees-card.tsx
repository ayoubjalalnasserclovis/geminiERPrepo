import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import {
  STONIZ_FEE_SCHEDULE,
  standardAmountForType,
  resolveStonizLabel,
} from '@/lib/finance/stoniz-fees';
import { aggregatePaymentSummary } from '@/lib/finance/project-payment-summary-pure';
import { StonizScheduleEditButton } from '@/components/finance/stoniz-schedule-edit-button';

type PaymentRow = {
  id: string;
  type: string;
  amount_expected: number | string;
  amount_paid: number | string;
  due_date?: string | null;
  label?: string | null;
  status: string;
};

/**
 * Honoraires Stoniz — source unique : les échéances réelles (table payments)
 * AGRÉGÉES par type via `aggregatePaymentSummary`.
 *
 * Voir lib/finance/project-payment-summary.ts pour le contexte historique
 * (régression Boutira : ne plus jamais cacher des doublons par type via Map.set).
 */
export function StonizFeesCard({
  payments,
  reduction = 0,
  projectId,
  userRole = '',
}: {
  payments: PaymentRow[];
  reduction?: number | null;
  projectId: string;
  userRole?: string;
}) {
  // Source unique : on agrège par type via le helper pur (gère les doublons en SUM,
  // ne masque rien). Le filtre 'autre' est géré par l'agrégateur lui-même.
  const summary = aggregatePaymentSummary(
    payments
      .filter(p => p.type !== 'autre')
      .map(p => ({
        id: p.id,
        type: p.type,
        amount_expected: p.amount_expected,
        amount_paid: p.amount_paid,
        due_date: p.due_date ?? null,
      })),
  );
  const byTypeSummary = new Map(summary.byType.map(b => [b.type, b]));
  // Map type → première ligne brute (pour résoudre le label personnalisé)
  const rawByType = new Map<string, PaymentRow>();
  for (const p of payments) {
    if (p.type === 'autre') continue;
    if (!rawByType.has(p.type)) rawByType.set(p.type, p);
  }

  const totalPaid = summary.totalPaid;
  const totalExpected = summary.totalExpected;

  // Sur-mesure dès qu'un type EXISTANT s'écarte du barème.
  // (On utilise l'expected agrégé — donc un doublon qui somme à un montant non standard
  // est légitimement marqué "sur-mesure".)
  const isCustom = summary.byType.some(b => {
    if (b.paymentIds.length === 0) return false; // jalon pas encore déclenché
    return b.expected !== standardAmountForType(b.type);
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Honoraires Stoniz</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={isCustom ? 'warning' : 'default'}>
              {isCustom ? 'Sur-mesure' : 'Forfait fixe 21 000 €'}
            </Badge>
            <StonizScheduleEditButton
              projectId={projectId}
              payments={payments as any}
              userRole={userRole}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {summary.hasDuplicates && (
          <div className="mb-3 text-xs bg-yellow-50 border border-yellow-300 rounded px-2 py-1.5 text-yellow-900">
            ⚠ Au moins un jalon a plusieurs lignes en BDD — l'affichage est agrégé.
          </div>
        )}
        <ul className="space-y-1.5 text-sm">
          {STONIZ_FEE_SCHEDULE.map(m => {
            const row = byTypeSummary.get(m.type);
            const rawFirst = rawByType.get(m.type);
            const expected = row?.expected ?? standardAmountForType(m.type);
            const paid = row?.paid ?? 0;
            const upcoming = !row || row.paymentIds.length === 0;
            const isPaid = !upcoming && row?.status === 'paid';
            const isPartial = !upcoming && row?.status === 'partial';
            const isOverdue = !upcoming && row?.status === 'overdue';
            return (
              <li key={m.type} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <div className="flex items-center gap-2">
                  <span className={isPaid ? 'text-stoniz-gray-500 line-through' : upcoming ? 'text-stoniz-gray-400' : ''}>
                    {resolveStonizLabel(m.type, rawFirst?.label)}
                  </span>
                  {row?.hasDuplicates && (
                    <Badge variant="warning">⚠ {row.paymentIds.length} lignes</Badge>
                  )}
                  {isPaid && <Badge variant="success">Payé</Badge>}
                  {isPartial && <Badge variant="warning">Partiel ({Math.round(paid / Math.max(expected, 1) * 100)}%)</Badge>}
                  {isOverdue && <Badge variant="error">En retard</Badge>}
                  {upcoming && <Badge>À venir</Badge>}
                </div>
                <Money amount={expected} className={isPaid ? 'text-stoniz-gray-500 line-through' : 'font-medium'} />
              </li>
            );
          })}
        </ul>

        <div className="mt-4 pt-4 border-t space-y-1.5 text-sm">
          <div className="flex justify-between pt-1">
            <span className="font-medium">Total honoraires</span>
            <Money amount={totalExpected} className="font-display text-lg" />
          </div>
          {reduction && reduction > 0 ? (
            <div className="flex justify-between text-stoniz-gray-400 text-xs">
              <span>Réduction historique (legacy, non appliquée)</span>
              <span><Money amount={reduction} /></span>
            </div>
          ) : null}
          <div className="flex justify-between text-stoniz-gray-500 text-xs pt-1">
            <span>Déjà encaissé</span>
            <Money amount={totalPaid} />
          </div>
          {summary.remaining > 0 && (
            <div className="flex justify-between text-stoniz-gray-700 text-xs pt-1 font-medium">
              <span>Reste à percevoir</span>
              <Money amount={summary.remaining} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
