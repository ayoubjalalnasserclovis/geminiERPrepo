import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require';
import { collectFeesAVenir } from '@/lib/finance/stoniz-fees-a-venir';
import { formatPhase } from '@/lib/utils/format';

/**
 * Export CSV — Honoraires à percevoir (CEO 2026-08-17).
 * Accès : ceo, finance (idem page).
 *
 * Format : 1 ligne par milestone à venir (donc N lignes par projet). Le CEO ou
 * la finance peuvent trier / pivoter côté Excel selon leurs besoins (par
 * projet, par milestone, par phase). CSV avec BOM UTF-8 pour Excel Windows.
 */
export async function GET() {
  try {
    await requireRole(['ceo', 'finance']);
  } catch {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const data = await collectFeesAVenir();

  const columns: Array<{ label: string }> = [
    { label: 'Bucket' },
    { label: 'Statut projet' },
    { label: 'Référence projet' },
    { label: 'Client' },
    { label: 'Phase courante' },
    { label: 'Projet confirmé' },
    { label: 'Forfait réel (EUR)' },
    { label: 'Déjà encaissé (EUR)' },
    { label: 'Reste global projet (EUR)' },
    { label: 'Milestone' },
    { label: 'Statut milestone' },
    { label: 'Montant à percevoir (EUR)' },
    { label: 'Barème standard (EUR)' },
    { label: 'Déjà payé sur ce milestone (EUR)' },
    { label: "Date d'échéance" },
    { label: 'Mois prévisionnel' },
  ];

  const STATUS_LABEL: Record<string, string> = {
    futur_pur: 'Futur (jamais déclenché)',
    planifie: 'Planifié (créé, non payé)',
    partiel: 'Partiellement payé',
  };

  function escapeCsv(v: unknown): string {
    if (v == null) return '';
    const s = String(v);
    if (/["\n,;\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  function fmtNum(n: number | null | undefined): string {
    if (n == null) return '';
    if (!Number.isFinite(n)) return '';
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  const header = columns.map(c => escapeCsv(c.label)).join(',');
  const lines: string[] = [];

  function emitBucket(bucket: 'Actif' | 'Pause', projects: typeof data.active.projects) {
    for (const p of projects) {
      for (const m of p.milestones_a_venir) {
        lines.push([
          escapeCsv(bucket),
          escapeCsv(p.status ?? ''),
          escapeCsv(p.reference),
          escapeCsv(p.client_name),
          escapeCsv(formatPhase(p.current_phase ?? '')),
          escapeCsv(p.honoraires_confirmed ? 'Oui' : 'Non'),
          fmtNum(p.forfait_reel),
          fmtNum(p.deja_encaisse),
          fmtNum(p.reste_global),
          escapeCsv(m.label),
          escapeCsv(STATUS_LABEL[m.status] ?? m.status),
          fmtNum(m.amount_a_percevoir),
          fmtNum(m.bareme_amount),
          fmtNum(m.amount_paid_so_far),
          escapeCsv(m.due_date ?? ''),
          escapeCsv(m.forecast_month ?? ''),
        ].join(','));
      }
    }
  }

  emitBucket('Actif', data.active.projects);
  emitBucket('Pause', data.paused.projects);

  const csv = '﻿' + [header, ...lines].join('\r\n');
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="honoraires-a-percevoir-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
