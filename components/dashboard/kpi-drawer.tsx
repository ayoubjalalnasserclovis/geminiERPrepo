'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { X, ChevronRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * Drill-down des KPIs du dashboard financier.
 *
 * KpiDrawerCard = même visuel qu'une KpiCard, mais cliquable : au clic, un
 * panneau latéral s'ouvre avec le détail ligne par ligne du chiffre affiché.
 * Objectif : visibilité. Aucune donnée n'est calculée ici — tout arrive déjà
 * agrégé/dérivé depuis le serveur (canon : dérivés jamais stockés ni recalculés
 * côté client).
 *
 * Règle couleur respectée : `tone='negative'` (rouge) réservé aux PERTES RÉELLES.
 * Un reste à encaisser/payer n'est pas une perte → tone 'default'.
 */

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'accent';
type Tone = 'default' | 'positive' | 'negative';

export type KpiDrawerRow = {
  /** Clé React stable. */
  id: string;
  /** Libellé principal (type de paiement, nom artisan, référence projet…). */
  label: string;
  /** Sous-libellé secondaire (projet + client, catégorie…). */
  sublabel?: string;
  /** Date déjà formatée (ex: "12 mars 2026"). */
  date?: string;
  /** Montant/valeur déjà formaté (ex: "5 000,00 €", "12 j"). Optionnel. */
  amount?: string;
  /** Couleur du montant. negative = perte réelle uniquement. */
  tone?: Tone;
  /** Lien optionnel vers la fiche projet. */
  href?: string;
};

export type KpiDrawerDetail = {
  /** Titre du panneau. */
  title: string;
  /** Sous-titre explicatif (méthode de calcul, périmètre…). */
  subtitle?: string;
  /** Chiffre mis en avant en haut du panneau (déjà formaté). */
  headline?: string;
  /** Couleur du headline. negative = perte réelle uniquement. */
  headlineTone?: Tone;
  /** Lignes de détail. */
  rows: KpiDrawerRow[];
  /** Texte affiché si aucune ligne. */
  emptyLabel?: string;
  /** Note de bas de panneau (ex: explication décomposition marge). */
  note?: string;
};

const variantBorder: Record<Variant, string> = {
  default: '',
  success: 'border-l-4 border-l-green-600',
  warning: 'border-l-4 border-l-orange-500',
  danger: 'border-l-4 border-l-red-600',
  accent: 'border-l-4 border-l-accent',
};

const toneText: Record<Tone, string> = {
  default: '',
  positive: 'text-green-700',
  negative: 'text-red-600',
};

export function KpiDrawerCard({
  label,
  value,
  hint,
  trend,
  variant = 'default',
  detail,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: { value: number; positive?: boolean };
  variant?: Variant;
  detail: KpiDrawerDetail;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`Voir le détail : ${label}`}
          className={cn(
            'group flex w-full cursor-pointer flex-col gap-1 text-left',
            'rounded-md border border-grey-line bg-white p-6 shadow-[0_1px_2px_rgba(10,10,10,0.04)]',
            'transition-shadow hover:shadow-[0_4px_12px_rgba(10,10,10,0.10)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-stoniz-black/40',
            variantBorder[variant],
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs uppercase text-stoniz-gray-500 tracking-wide">{label}</div>
            <ChevronRight className="h-4 w-4 shrink-0 text-stoniz-gray-300 transition-colors group-hover:text-stoniz-gray-600" />
          </div>
          <div className="font-display text-3xl">{value}</div>
          {hint && <div className="text-xs text-stoniz-gray-500">{hint}</div>}
          {trend && (
            <div className={cn('text-xs font-medium', trend.positive === false ? 'text-red-600' : 'text-green-700')}>
              {trend.positive === false ? '↘' : '↗'} {trend.value > 0 ? '+' : ''}{trend.value}%
            </div>
          )}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/30',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-xl',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-grey-line p-6">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-xl">{detail.title}</Dialog.Title>
              {detail.subtitle && (
                <Dialog.Description className="mt-1 text-sm text-stoniz-gray-500">
                  {detail.subtitle}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Fermer"
              className="rounded-md p-1 text-stoniz-gray-500 transition-colors hover:bg-stoniz-gray-100 hover:text-stoniz-gray-700"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {detail.headline && (
              <div className={cn('mb-5 font-display text-3xl', toneText[detail.headlineTone ?? 'default'])}>
                {detail.headline}
              </div>
            )}

            {detail.rows.length === 0 ? (
              <p className="text-sm text-stoniz-gray-500">
                {detail.emptyLabel ?? 'Aucune ligne à afficher.'}
              </p>
            ) : (
              <ul className="divide-y divide-grey-line text-sm">
                {detail.rows.map((row) => {
                  const inner = (
                    <>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{row.label}</div>
                        {row.sublabel && (
                          <div className="truncate text-xs text-stoniz-gray-500">{row.sublabel}</div>
                        )}
                        {row.date && (
                          <div className="text-xs text-stoniz-gray-400">{row.date}</div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {row.amount && (
                          <span className={cn('font-medium tabular-nums', toneText[row.tone ?? 'default'])}>
                            {row.amount}
                          </span>
                        )}
                        {row.href && (
                          <ArrowUpRight className="h-3.5 w-3.5 text-stoniz-gray-300 transition-colors group-hover/row:text-stoniz-gray-600" />
                        )}
                      </div>
                    </>
                  );

                  return (
                    <li key={row.id}>
                      {row.href ? (
                        <Link
                          href={row.href}
                          className="group/row flex items-center justify-between gap-3 py-3 transition-colors hover:bg-stoniz-gray-50"
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className="flex items-center justify-between gap-3 py-3">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {detail.note && (
              <p className="mt-5 border-t border-grey-line pt-4 text-xs text-stoniz-gray-500">
                {detail.note}
              </p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
