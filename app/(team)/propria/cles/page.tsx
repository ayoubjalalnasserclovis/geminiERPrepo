// ─── Chantier 1 marathon — Module transverse Gestion des Clés ───────────────
// Vue parc : statut clés de chaque lot (compteurs dérivés), alertes de seuil
// (bureau 🔴 ≤1 / ⚠ =2, armoire <2, cible 4 jeux), derniers mouvements.

import Link from 'next/link';
import { KeyRound, AlertTriangle } from 'lucide-react';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, search, sort, type SP } from '@/lib/list-filters/parse';

export const dynamic = 'force-dynamic';

const LOCATION_LABELS: Record<string, string> = {
  boite_voyageur: 'Boîte voyageur',
  armoire_logement: 'Armoire logement',
  bureau: 'Bureau',
  externe: 'Externe',
  perdue: 'Perdue',
};

const ALERT_OPTIONS = [
  { v: 'critique', label: '🔴 Critique' },
  { v: 'warn',     label: '⚠ Seuil bas' },
  { v: 'ok',       label: 'OK' },
];

const LOCATION_OPTIONS = [
  { v: 'has_externe', label: 'A des clés externes' },
  { v: 'has_perdue',  label: 'A des clés perdues' },
  { v: 'incomplet',   label: 'Moins de 4 jeux' },
];

// CEO 2026-06-22 : tri sur les colonnes numériques + alertes
type SortField =
  | 'lot' | 'total' | 'boite' | 'armoire' | 'bureau' | 'perdues' | 'alerte';
const SORT_FIELDS: Record<SortField, (r: any) => number | string> = {
  lot:     (r) => (r.code ?? r.unit?.code ?? '').toLowerCase(),
  total:   (r) => Number(r.nb_total ?? 0),
  boite:   (r) => Number(r.nb_boite_voyageur ?? 0),
  armoire: (r) => Number(r.nb_armoire ?? 0),
  bureau:  (r) => Number(r.nb_bureau ?? 0),
  perdues: (r) => Number(r.nb_perdues ?? 0),
  alerte:  (r) => r.bureau_alert === 'critique' ? 0 : r.bureau_alert === 'warn' ? 1 : r.armoire_alert === 'warn' ? 2 : 3,
};

function AlertCell({ level }: { level: string }) {
  if (level === 'critique') return <span className="text-red-600 font-medium">🔴 critique</span>;
  if (level === 'warn') return <span className="text-amber-600">⚠ seuil bas</span>;
  return <span className="text-emerald-600">ok</span>;
}

export default async function PropriaClesPage({
  searchParams,
}: { searchParams: SP }) {
  await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const [statusRes, unitsRes, propsRes, movementsRes] = await Promise.all([
    supabase.from('propria_unit_keys_status').select('*'),
    supabase
      .from('propria_units')
      .select('id, code, property_id, properties(name)')
      .is('deleted_at', null)
      .eq('is_active', true),
    supabase
      .from('properties')
      .select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null)
      .is('deleted_at', null),
    supabase
      .from('propria_key_movements')
      .select('id, to_location, from_location, reason, created_at, propria_keys(key_number, propria_unit_id), moved_by')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const units = (unitsRes.data ?? []) as any[];
  const unitById = new Map(units.map((u) => [u.id, u]));
  const allRows = ((statusRes.data ?? []) as any[])
    .map((s) => ({ ...s, unit: unitById.get(s.propria_unit_id) }))
    .filter((s) => s.unit)
    .sort((a, b) => {
      const rank = (r: any) =>
        r.bureau_alert === 'critique' ? 0 : r.bureau_alert === 'warn' ? 1 : r.armoire_alert === 'warn' ? 2 : 3;
      return rank(a) - rank(b);
    });

  // ─── Parse toolbar ─────────────────────────────────────────────────────
  const q = search(searchParams);
  const propertyId = single(searchParams, 'property');
  const alerts = multi(searchParams, 'alert');
  const flags = multi(searchParams, 'flags');

  let rows = allRows;
  if (propertyId) rows = rows.filter(r => r.unit?.property_id === propertyId);
  if (alerts.length) {
    rows = rows.filter(r => alerts.includes(r.bureau_alert) || alerts.includes(r.armoire_alert));
  }
  if (flags.includes('has_externe')) rows = rows.filter(r => Number(r.nb_externe ?? 0) > 0);
  if (flags.includes('has_perdue')) rows = rows.filter(r => Number(r.nb_perdues ?? 0) > 0);
  if (flags.includes('incomplet')) rows = rows.filter(r => Number(r.nb_total ?? 0) < 4);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(r => {
      const code = (r.code ?? r.unit?.code ?? '').toLowerCase();
      const propName = (r.unit?.properties?.name ?? '').toLowerCase();
      return code.includes(needle) || propName.includes(needle);
    });
  }

  // Tri (CEO 2026-06-22) — sinon, tri par défaut sur l'urgence (critique d'abord)
  const sortState = sort(searchParams, '', 'desc');
  if (sortState.field && sortState.field in SORT_FIELDS) {
    const accessor = SORT_FIELDS[sortState.field as SortField];
    rows = [...rows].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortState.dir === 'asc' ? va - vb : vb - va;
      }
      return sortState.dir === 'asc'
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }

  const nbCritique = rows.filter((r) => r.bureau_alert === 'critique').length;
  const nbWarn = rows.filter((r) => r.bureau_alert === 'warn' || r.armoire_alert === 'warn').length;
  const movements = (movementsRes.data ?? []) as any[];

  // ─── Options dynamiques ─────────────────────────────────────────────
  const propertyOptions = [...(propsRes.data ?? [])]
    .sort((a: any, b: any) =>
      (a.propria_internal_code ?? a.name).localeCompare(b.propria_internal_code ?? b.name))
    .map((p: any) => ({ v: p.id, label: p.propria_internal_code ?? p.name }));

  const filters: FilterDef[] = [
    { kind: 'single', key: 'property', label: 'Bien',          options: propertyOptions },
    { kind: 'multi',  key: 'alert',    label: 'Niveau alerte', options: ALERT_OPTIONS },
    { kind: 'multi',  key: 'flags',    label: 'Particularités',options: LOCATION_OPTIONS },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-display flex items-center gap-2">
          <KeyRound className="w-6 h-6" /> Gestion des Clés
        </h1>
        <p className="text-sm text-stoniz-gray-600 mt-1">
          Compteurs calculés depuis les mouvements physiques — rien n&apos;est saisi à la main.
          Ajout et déplacement des jeux : depuis la fiche de chaque lot.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xl font-display">{rows.length}</div>
          <div className="text-xs text-stoniz-gray-600">lots suivis</div>
        </div>
        <div className={`border rounded-lg p-4 ${nbCritique > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-stoniz-gray-200'}`}>
          <div className="text-xl font-display">{nbCritique}</div>
          <div className="text-xs text-stoniz-gray-600">stock bureau critique (≤ 1 jeu)</div>
        </div>
        <div className={`border rounded-lg p-4 ${nbWarn > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-stoniz-gray-200'}`}>
          <div className="text-xl font-display">{nbWarn}</div>
          <div className="text-xs text-stoniz-gray-600">seuils bas (bureau ou armoire)</div>
        </div>
      </div>

      {/* Toolbar unifiée */}
      <div className="mb-4">
        <ListToolbar
          moduleKey="propria-cles"
          count={{ filtered: rows.length, total: allRows.length }}
          filters={filters}
          searchHint="code lot, nom bien"
        />
      </div>

      <div className="bg-white border border-stoniz-gray-200 rounded-lg overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stoniz-gray-500 bg-stoniz-gray-50 border-b border-stoniz-gray-200">
              <SortableHeader field="lot" className="px-4 py-2">Lot</SortableHeader>
              <SortableHeader field="total" className="px-2 py-2 text-center">Total</SortableHeader>
              <SortableHeader field="boite" className="px-2 py-2 text-center">Boîte voy.</SortableHeader>
              <SortableHeader field="armoire" className="px-2 py-2 text-center">Armoire</SortableHeader>
              <SortableHeader field="bureau" className="px-2 py-2 text-center">Bureau</SortableHeader>
              <SortableHeader field="perdues" className="px-2 py-2 text-center">Perdues</SortableHeader>
              <SortableHeader field="alerte" className="px-2 py-2">Alerte bureau</SortableHeader>
              <th className="px-2 py-2">Alerte armoire</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-xs text-stoniz-gray-400">
                Aucun lot pour ces filtres.
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.propria_unit_id} className="border-b border-stoniz-gray-100 hover:bg-stoniz-gray-50">
                <td className="px-4 py-2">
                  <Link href={`/propria/biens/${r.unit.property_id}`} className="hover:underline">
                    <span className="font-medium">{r.code ?? r.unit.code ?? '—'}</span>
                    <span className="text-xs text-stoniz-gray-500"> · {r.unit.properties?.name ?? ''}</span>
                  </Link>
                  {r.nb_total < 4 && (
                    <span className="ml-2 text-[10px] text-amber-600 inline-flex items-center gap-0.5">
                      <AlertTriangle className="w-3 h-3" /> {r.nb_total}/4 jeux
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-center font-display">{r.nb_total}</td>
                <td className="px-2 py-2 text-center">{r.nb_boite_voyageur}</td>
                <td className="px-2 py-2 text-center">{r.nb_armoire}</td>
                <td className="px-2 py-2 text-center">{r.nb_bureau}</td>
                <td className="px-2 py-2 text-center">{r.nb_perdues > 0 ? <span className="text-red-600">{r.nb_perdues}</span> : 0}</td>
                <td className="px-2 py-2 text-xs"><AlertCell level={r.bureau_alert} /></td>
                <td className="px-2 py-2 text-xs"><AlertCell level={r.armoire_alert} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-display text-lg mb-3">Derniers mouvements</h2>
      <div className="bg-white border border-stoniz-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stoniz-gray-500 bg-stoniz-gray-50 border-b border-stoniz-gray-200">
              <th className="px-4 py-2">Date</th>
              <th className="px-2 py-2">Jeu</th>
              <th className="px-2 py-2">De → vers</th>
              <th className="px-2 py-2">Raison</th>
            </tr>
          </thead>
          <tbody>
            {movements.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-stoniz-gray-400">Aucun mouvement.</td></tr>
            )}
            {movements.map((m) => (
              <tr key={m.id} className="border-b border-stoniz-gray-100">
                <td className="px-4 py-2 text-xs text-stoniz-gray-600">
                  {new Date(m.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-2 py-2 text-xs font-mono">#{m.propria_keys?.key_number ?? '?'}</td>
                <td className="px-2 py-2 text-xs">
                  {(m.from_location && LOCATION_LABELS[m.from_location]) ?? '—'} → <strong>{LOCATION_LABELS[m.to_location] ?? m.to_location}</strong>
                </td>
                <td className="px-2 py-2 text-xs text-stoniz-gray-600">{m.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
