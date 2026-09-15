import { formatMoney } from '@/lib/utils/format';

export function Money({ amount, currency = 'EUR', locale = 'fr-FR', className }: {
  amount: number | null | undefined;
  currency?: string;
  locale?: string;
  className?: string;
}) {
  return <span className={className}>{formatMoney(amount, currency, locale)}</span>;
}
