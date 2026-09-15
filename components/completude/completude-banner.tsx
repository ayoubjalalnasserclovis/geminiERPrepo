import Link from 'next/link';
import { ClipboardCheck, AlertTriangle, Info } from 'lucide-react';

/**
 * Bandeau compact de complétude affiché en haut des listings /artisans
 * et /partners. (CEO 2026-06-24 — phase B3.)
 *
 * Règles :
 *   - red > 0      → fond ambre, icône AlertTriangle (alerte active)
 *   - orange only  → fond gris léger, icône Info (informatif)
 *   - red+orange=0 → ne PAS afficher (caller gère).
 *
 * Sous-titre optionnel (subtitle) : utilisé pour signaler les "62 partenaires
 * sans type" sur /partners. Couleur rouge soutenue car cas dominant au launch.
 *
 * Canon couleurs (mémoire stoniz_ux_canon) : rouge réservé pertes réelles,
 * ambre pour alerte active, gris pour info passive.
 */

type CompletudeBannerProps = {
  total: number;
  red: number;
  orange: number;
  avgScore: number;
  ctaLabel: string;
  ctaHref: string;
  title: string;
  /** Sous-titre rouge optionnel (ex. "62 sans type — à classer en priorité") */
  subtitle?: string;
};

export function CompletudeBanner({
  total,
  red,
  orange,
  avgScore,
  ctaLabel,
  ctaHref,
  title,
  subtitle,
}: CompletudeBannerProps) {
  // Sécurité défensive : si rien à signaler ET pas de sous-titre, ne pas afficher.
  if (red + orange === 0 && !subtitle) return null;
  if (total === 0) return null;

  const isAmber = red > 0;
  const containerCls = isAmber
    ? 'bg-amber-50 border-amber-200'
    : 'bg-stoniz-gray-50 border-stoniz-gray-200';
  const iconCls = isAmber ? 'text-amber-600' : 'text-stoniz-gray-500';
  const Icon = isAmber ? AlertTriangle : Info;

  return (
    <div className={`border rounded-lg px-4 py-3 mb-4 ${containerCls}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${iconCls}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="font-medium text-sm text-stoniz-gray-900">{title}</div>
            <div className="text-xs text-stoniz-gray-700 mt-0.5">
              <span className={red > 0 ? 'font-medium text-amber-900' : 'text-stoniz-gray-700'}>
                {red} rouge{red > 1 ? 's' : ''}
              </span>
              <span className="mx-1.5 text-stoniz-gray-400">·</span>
              <span>
                {orange} orange{orange > 1 ? 's' : ''}
              </span>
              <span className="mx-1.5 text-stoniz-gray-400">·</span>
              <span>
                Score moyen <strong>{avgScore}%</strong>
              </span>
              <span className="mx-1.5 text-stoniz-gray-400">·</span>
              <span className="text-stoniz-gray-500">
                {total} fiche{total > 1 ? 's' : ''} active{total > 1 ? 's' : ''}
              </span>
            </div>
            {subtitle && (
              <div className="mt-1 text-xs font-medium text-red-700">
                {subtitle}
              </div>
            )}
          </div>
        </div>

        <Link
          href={ctaHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium bg-white border border-stoniz-gray-300 rounded-md px-3 py-1.5 hover:bg-cream-soft text-stoniz-gray-900 flex-shrink-0"
        >
          <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
