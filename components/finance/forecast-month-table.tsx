'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, CalendarClock } from 'lucide-react';
import { formatPhase } from '@/lib/utils/format';
import type { FeesBucketTotals } from '@/lib/finance/stoniz-fees-a-venir';

/**
 * Tableau "Prévisions par mois" avec drill-down (CEO 2026-08-31).
 *
 * Chaque ligne de mois est cliquable : elle déplie le détail des milestones
 * qui composent le total du mois (projet, client, phase, milestone, statut,
 * montant). Les données viennent déjà agrégées du serveur
 * (`FeesBucketTotals.by_forecast_month[].lines`) — aucun fetch client.
 *
 * Canon UX : pas de rouge ici (aucune perte réelle), le confirmé reste en vert.
 */

type MonthRow = FeesBucketTotals['by_forecast_month'][number];

function fmtEur(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €';
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  futur_pur: { label: 'Futur', className: 'bg-stoniz-gray-100 text-stoniz-gray-700' },
  planifie: { label: 'Planifié', className: 'bg-blue-100 text-blue-700' },
  partiel: { label: 'Partiel', className: 'bg-amber-100 text-amber-800' },
};

export function ForecastMonthTable({ months }: { months: MonthRow[] }) {
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());

  function toggle(month: string) {
    setOpenMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }

  const grandTotal = months.reduce((s, m) => s + m.amount_total, 0);
  const grandConfirmed = months.reduce((s, m) => s + m.amount_confirmed, 0);
  const grandCount = months.reduce((s, m) => s + m.count_milestones, 0);

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="w-4 h-4 text-stoniz-gray-500" />
        <h3 className="font-display text-base">Prévisions par mois</h3>
        <span className="text-[11px] text-stoniz-gray-500">
          — clique sur un mois pour voir le détail
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
            <tr>
              <th className="text-left py-2">Mois</th>
              <th className="text-right py-2">Milestones</th>
              <th className="text-right py-2">Total prévu</th>
              <th className="text-right py-2">Dont confirmé</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {months.map(m => {
              const isOpen = openMonths.has(m.month);
              return (
                <Fragment key={m.month}>
                  <tr
                    onClick={() => toggle(m.month)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle(m.month);
                      }
                    }}
                    className={`cursor-pointer hover:bg-stoniz-gray-50 ${isOpen ? 'bg-stoniz-gray-50' : ''}`}
                  >
                    <td className="py-2 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronRight
                          className={`w-3.5 h-3.5 text-stoniz-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        />
                        <span className="capitalize">{fmtMonth(m.month)}</span>
                      </span>
                    </td>
                    <td className="text-right py-2 text-stoniz-gray-600">{m.count_milestones}</td>
                    <td className="text-right py-2 font-medium">{fmtEur(m.amount_total)}</td>
                    <td className="text-right py-2 text-emerald-800">
                      {m.amount_confirmed > 0 ? fmtEur(m.amount_confirmed) : '—'}
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="bg-stoniz-gray-50/60">
                      <td colSpan={4} className="px-0 pb-4 pt-1">
                        <div className="mx-2 rounded-lg border border-stoniz-gray-200 bg-white overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-stoniz-gray-50 text-[10px] uppercase text-stoniz-gray-600">
                              <tr>
                                <th className="text-left px-3 py-2">Projet</th>
                                <th className="text-left px-3 py-2">Client</th>
                                <th className="text-left px-3 py-2">Phase</th>
                                <th className="text-left px-3 py-2">Milestone</th>
                                <th className="text-center px-3 py-2">Statut</th>
                                <th className="text-center px-3 py-2">Confirmé</th>
                                <th className="text-right px-3 py-2">Montant</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stoniz-gray-100">
                              {m.lines.map(l => {
                                const badge = STATUS_BADGE[l.status] ?? STATUS_BADGE.futur_pur;
                                return (
                                  <tr
                                    key={`${l.project_id}-${l.milestone_type}`}
                                    className={l.confirmed ? 'bg-emerald-50/40' : ''}
                                  >
                                    <td className="px-3 py-2 whitespace-nowrap">
                                      <Link
                                        href={`/projects/${l.project_id}/payments`}
                                        className="text-blue-600 hover:underline"
                                      >
                                        {l.reference}
                                      </Link>
                                    </td>
                                    <td className="px-3 py-2">{l.client_name}</td>
                                    <td className="px-3 py-2 text-stoniz-gray-600">
                                      {formatPhase(l.current_phase ?? '')}
                                    </td>
                                    <td className="px-3 py-2">{l.milestone_label}</td>
                                    <td className="px-3 py-2 text-center">
                                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${badge.className}`}>
                                        {badge.label}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      {l.confirmed ? (
                                        <span className="text-emerald-700">✓</span>
                                      ) : (
                                        <span className="text-stoniz-gray-400">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                                      {fmtEur(l.amount)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot className="bg-stoniz-gray-50 text-[11px]">
                              <tr>
                                <td colSpan={6} className="px-3 py-2 text-right text-stoniz-gray-600">
                                  Total {fmtMonth(m.month)}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                                  {fmtEur(m.amount_total)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {months.length > 1 && (
            <tfoot className="border-t-2 border-stoniz-gray-200 text-sm">
              <tr>
                <td className="py-2 font-medium">Total prévisions</td>
                <td className="text-right py-2 text-stoniz-gray-600">{grandCount}</td>
                <td className="text-right py-2 font-semibold">{fmtEur(grandTotal)}</td>
                <td className="text-right py-2 text-emerald-800 font-medium">
                  {grandConfirmed > 0 ? fmtEur(grandConfirmed) : '—'}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-[11px] text-stoniz-gray-500 mt-3">
        💡 Ces prévisions sont construites à partir des mois que tu saisis sous chaque
        milestone à venir dans le tableau ci-dessous. Un milestone sans mois saisi n&apos;apparaît pas ici.
      </p>
    </div>
  );
}
