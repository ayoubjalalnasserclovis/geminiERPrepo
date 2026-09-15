import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';

/**
 * Export CSV du stock Propria — CEO 2026-07-13.
 * Accès : ceo, finance, propria (finance en a besoin pour clôturer les
 * inventaires et rapprocher les valeurs comptables).
 *
 * Renvoie la vue `propria_stock_status` telle qu'affichée dans /propria/stock,
 * plus un en-tête BOM UTF-8 pour qu'Excel ouvre correctement les accents.
 */
export async function GET() {
  try {
    await requireRole(['ceo', 'finance', 'propria']);
  } catch {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('propria_stock_status')
    .select('*')
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    return new NextResponse(`Erreur BDD : ${error.message}`, { status: 500 });
  }

  const rows = (data ?? []) as any[];

  // ─── Génération CSV ────────────────────────────────────────────────────
  // Colonnes ordonnées pour lecture métier (référence en premier, prix/valeur
  // en fin, statut en dernier). Nombres formatés en point décimal (Excel FR
  // accepte les deux si la locale est FR ; on garde le point pour l'export
  // international propre).
  const columns: Array<{ key: string; label: string; type?: 'number' | 'text' }> = [
    { key: 'reference',        label: 'Référence',           type: 'text' },
    { key: 'name',             label: 'Nom',                 type: 'text' },
    { key: 'category',         label: 'Catégorie',           type: 'text' },
    { key: 'supplier',         label: 'Fournisseur',         type: 'text' },
    { key: 'unit',             label: 'Unité',               type: 'text' },
    { key: 'initial_stock',    label: 'Stock initial',       type: 'number' },
    { key: 'total_entries',    label: 'Entrées cumulées',    type: 'number' },
    { key: 'total_exits',      label: 'Sorties cumulées',    type: 'number' },
    { key: 'current_stock',    label: 'Stock actuel',        type: 'number' },
    { key: 'min_threshold',    label: 'Seuil minimum',       type: 'number' },
    { key: 'qty_to_order',     label: 'Quantité à commander',type: 'number' },
    { key: 'default_order_qty',label: 'Quantité cmd. défaut',type: 'number' },
    { key: 'unit_price_mad',   label: 'Prix unitaire (MAD)', type: 'number' },
    { key: 'stock_value_mad',  label: 'Valeur stock (MAD)',  type: 'number' },
    { key: 'status',           label: 'Statut',              type: 'text' },
  ];

  function escapeCsv(value: unknown): string {
    if (value == null) return '';
    const s = String(value);
    // Si la valeur contient guillemet, virgule ou retour ligne, on l'échappe.
    if (/["\n,;\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function formatValue(row: any, col: (typeof columns)[number]): string {
    const raw = row[col.key];
    if (raw == null || raw === '') return '';
    if (col.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return '';
      // On garde 2 décimales pour la lisibilité, sans trailing zeros inutiles.
      return Number.isInteger(n) ? String(n) : n.toFixed(2);
    }
    return escapeCsv(raw);
  }

  const header = columns.map(c => escapeCsv(c.label)).join(',');
  const lines = rows.map(r => columns.map(c => formatValue(r, c)).join(','));
  // BOM UTF-8 (﻿) pour qu'Excel Windows ouvre bien les caractères
  // accentués sans mojibake. CRLF pour compatibilité maximale.
  const csv = '﻿' + [header, ...lines].join('\r\n');

  const today = new Date().toISOString().slice(0, 10);
  const filename = `stock-propria-${today}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Pas de cache : le CEO / finance / propria veut toujours la donnée fraîche.
      'Cache-Control': 'no-store',
    },
  });
}
