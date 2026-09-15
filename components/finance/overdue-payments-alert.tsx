import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Money } from '@/components/ui/money';
import { formatPaymentLabel, type OverduePayment } from '@/lib/finance/overdue-payments';

/**
 * Bloc d'alerte rouge listant les paiements honoraires Stoniz en retard.
 * - Variant 'project'  : ne montre PAS le projet (utilisé sur les pages projet)
 * - Variant 'global'   : montre le projet + le client (dashboards globaux)
 */
export function OverduePaymentsAlert({
  payments,
  variant = 'project',
  title,
}: {
  payments: OverduePayment[];
  variant?: 'project' | 'global';
  title?: string;
}) {
  if (!payments || payments.length === 0) return null;

  const totalDue = payments.reduce((s, p) => s + p.remaining, 0);
  const heading = title ?? (variant === 'global'
    ? `${payments.length} paiement${payments.length > 1 ? 's' : ''} client${payments.length > 1 ? 's' : ''} à recouvrer`
    : `${payments.length} paiement${payments.length > 1 ? 's' : ''} à recouvrer sur ce projet`);

  return (
    <div className="bg-red-50 border-2 border-red-300 rounded-md p-5">
      <div className="flex items-start gap-3 mb-3">
        <AlertTriangle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg text-red-900">
            {heading}
          </h3>
          <p className="text-sm text-red-800 mt-0.5">
            Total à recouvrer : <strong><Money amount={totalDue} /></strong>
          </p>
        </div>
      </div>

      <ul className="space-y-2 mt-3">
        {payments.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-3 bg-white border border-red-200 rounded-sm px-3 py-2 flex-wrap"
          >
            <div className="flex-1 min-w-[200px]">
              <div className="font-medium text-sm">
                {formatPaymentLabel(p.type)}
                {variant === 'global' && (
                  <span className="text-grey-text font-normal">
                    {' '}— {p.client_full_name ?? '—'}
                    {p.project_reference ? ` · ${p.project_reference}` : ''}
                  </span>
                )}
              </div>
              <div className="text-xs text-grey-text mt-0.5">
                Échéance {new Date(p.due_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                {' '}— <strong className="text-red-700">
                  {p.days_late <= 0
                    ? "à encaisser aujourd'hui"
                    : `en retard de ${p.days_late} jour${p.days_late > 1 ? 's' : ''}`}
                </strong>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-semibold text-sm">
                  <Money amount={p.remaining} />
                </div>
                {p.amount_paid > 0 && (
                  <div className="text-[11px] text-grey-text">
                    déjà encaissé <Money amount={p.amount_paid} />
                  </div>
                )}
              </div>
              <Link
                href={`/projects/${p.project_id}/payments`}
                className="text-xs underline underline-offset-4 text-red-900 hover:text-red-700 whitespace-nowrap"
              >
                Régler →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
