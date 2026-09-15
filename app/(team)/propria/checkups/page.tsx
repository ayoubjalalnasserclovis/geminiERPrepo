import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { computeCheckupLateness } from '@/lib/propria/checkups-auto';
import { getCheckupStatusCounts, propriaCheckupsQuery } from '@/lib/propria/checkups-query';
import { CheckupAutomationsRunButton } from '@/components/propria/checkup-automations-run-button';

const STATUS_BADGE: Record<string, string> = {
  a_faire: 'bg-stoniz-gray-100 text-stoniz-gray-800',
  en_cours: 'bg-blue-100 text-blue-800',
  a_valider: 'bg-amber-100 text-amber-800',
  valide: 'bg-emerald-100 text-emerald-800',
  annule: 'bg-stoniz-gray-200 text-stoniz-gray-600',
};
const STATUS_LABELS: Record<string, string> = {
  a_faire: 'À faire', en_cours: 'En cours', a_valider: 'À valider',
  valide: 'Validé', annule: 'Annulé',
};

const ACTIVE_STATUSES = ['a_faire', 'en_cours', 'a_valider'];

// Badges des check-ups générés automatiquement (chantier 11.b)
const AUTO_SOURCE_BADGES: Record<string, { icon: string; label: string }> = {
  frequence: { icon: '🤖', label: 'Auto — fréquence (U27)' },
  aleatoire_bureau: { icon: '🎲', label: 'Auto — aléatoire bureau (U28)' },
  aleatoire_terrain: { icon: '🎲', label: 'Auto — aléatoire terrain (U28)' },
  logement_du_jour: { icon: '⭐', label: 'Auto — logement du jour (U29)' },
};

/**
 * Liste des check-ups logement (chantier 11.a — MVP).
 * Filtres statut + bouton création. Le « nb problèmes » est dérivé
 * (propria_checkup_items, jamais stocké — convention n°1).
 */
export default async function CheckupsListPage({
  searchParams,
}: { searchParams: { status?: string } }) {
  const user = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  // 2 requêtes séparées (chantier 1 CEO 2026-06-18) :
  //   - statusCounts : KPI sur la table entière (jamais filtré par UI)
  //   - listQuery    : liste effective filtrée
  // Cause du bug d'avant : un seul rows filtré + .filter(status===) → KPI à 0
  // dès qu'on cliquait sur un onglet ≠ "Tous".
  const [propsRes, unitsRes, profRes, lateness, statusCounts, listQuery] = await Promise.all([
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null),
    supabase.from('propria_units').select('id, code, order_index, property_id')
      .is('deleted_at', null).eq('is_active', true),
    supabase.from('profiles').select('id, full_name'),
    computeCheckupLateness(supabase), // retard vs fréquence — dérivé (U27)
    getCheckupStatusCounts(supabase), // compteurs sur table entière
    propriaCheckupsQuery(supabase, { statusFilter: searchParams.status, limit: 300 }),
  ]);
  const props = new Map((propsRes.data ?? []).map((p: any) => [p.id, p]));
  const unitsMap = new Map((unitsRes.data ?? []).map((u: any) => [u.id, { label: u.code ?? `Suite ${u.order_index}`, property_id: u.property_id }]));
  const profs = new Map((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  const checkupsRes = await listQuery;
  const rows = (checkupsRes.data ?? []) as any[];

  // Nb problèmes par check-up — dérivé à la lecture
  const ids = rows.map((r) => r.id);
  const problemsByCheckup = new Map<string, number>();
  if (ids.length > 0) {
    const { data: items } = await supabase
      .from('propria_checkup_items')
      .select('checkup_id')
      .in('checkup_id', ids)
      .eq('status', 'probleme')
      .is('deleted_at', null);
    for (const i of (items ?? []) as any[]) {
      problemsByCheckup.set(i.checkup_id, (problemsByCheckup.get(i.checkup_id) ?? 0) + 1);
    }
  }

  // KPI = compteurs sur la table entière (jamais sur rows filtré)
  const stats = {
    a_valider: statusCounts.a_valider,
    en_cours: statusCounts.en_cours,
    a_faire: statusCounts.a_faire,
  };

  const pill = (active: boolean, activeCls = 'bg-stoniz-black text-white') =>
    `px-3 py-1.5 rounded-full ${active ? activeCls : 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200'}`;

  return (
    <div className="max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Check-ups
          </div>
          <h1 className="text-2xl md:text-3xl font-display">🩺 Check-ups logement ({rows.length})</h1>
        </div>
        <div className="flex items-start gap-2">
          {['ceo', 'developer'].includes(user.role) && <CheckupAutomationsRunButton />}
          <Link
            href="/propria/checkups/new"
            className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 whitespace-nowrap"
          >
            + Nouveau check-up
          </Link>
        </div>
      </div>

      {/* Retard vs fréquence (U27) — dérivé : dernier validé + X mois < aujourd'hui */}
      {lateness.late.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 mb-6 text-sm">
          <p className="text-xs uppercase tracking-wider text-red-700 mb-1.5">
            ⏰ En retard vs fréquence ({lateness.everyMonths} mois)
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-red-900">
            {lateness.late.map((l) => (
              <span key={l.unitId} className="whitespace-nowrap">
                <span className="font-medium">{l.label}</span>
                {' '}— en retard de {l.daysLate} j
                {l.lastValidated && (
                  <span className="text-red-700/70"> (validé le {new Date(l.lastValidated + 'T00:00:00Z').toLocaleDateString('fr-FR')})</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Bandeau KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Link href="/propria/checkups?status=a_valider"
          className={`block rounded-md border-2 p-4 transition-colors ${
            stats.a_valider > 0 ? 'bg-amber-50 border-amber-300 hover:bg-amber-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}>
          <p className={`text-xs uppercase tracking-wider mb-1 ${stats.a_valider > 0 ? 'text-amber-700' : 'text-stoniz-gray-500'}`}>📋 À valider</p>
          <p className={`font-display text-3xl ${stats.a_valider > 0 ? 'text-amber-900' : 'text-stoniz-gray-400'}`}>{stats.a_valider}</p>
        </Link>
        <Link href="/propria/checkups?status=en_cours"
          className={`block rounded-md border-2 p-4 transition-colors ${
            stats.en_cours > 0 ? 'bg-blue-50 border-blue-300 hover:bg-blue-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}>
          <p className={`text-xs uppercase tracking-wider mb-1 ${stats.en_cours > 0 ? 'text-blue-700' : 'text-stoniz-gray-500'}`}>🔄 En cours</p>
          <p className={`font-display text-3xl ${stats.en_cours > 0 ? 'text-blue-900' : 'text-stoniz-gray-400'}`}>{stats.en_cours}</p>
        </Link>
        <Link href="/propria/checkups?status=a_faire"
          className={`block rounded-md border-2 p-4 transition-colors ${
            stats.a_faire > 0 ? 'bg-stoniz-gray-50 border-stoniz-gray-300 hover:bg-stoniz-gray-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}>
          <p className="text-xs uppercase tracking-wider mb-1 text-stoniz-gray-500">⏳ À faire</p>
          <p className={`font-display text-3xl ${stats.a_faire > 0 ? 'text-stoniz-gray-900' : 'text-stoniz-gray-400'}`}>{stats.a_faire}</p>
        </Link>
      </div>

      {/* Filtres statut */}
      <div className="flex flex-wrap gap-2 mb-5 text-xs">
        <Link href="/propria/checkups" className={pill(!searchParams.status)}>Tous</Link>
        <Link href="/propria/checkups?status=actifs" className={pill(searchParams.status === 'actifs')}>Actifs</Link>
        <Link href="/propria/checkups?status=a_faire" className={pill(searchParams.status === 'a_faire')}>⏳ À faire</Link>
        <Link href="/propria/checkups?status=en_cours" className={pill(searchParams.status === 'en_cours', 'bg-blue-600 text-white')}>🔄 En cours</Link>
        <Link href="/propria/checkups?status=a_valider" className={pill(searchParams.status === 'a_valider', 'bg-amber-500 text-white')}>📋 À valider</Link>
        <Link href="/propria/checkups?status=valide" className={pill(searchParams.status === 'valide', 'bg-emerald-600 text-white')}>✓ Validés</Link>
        <Link href="/propria/checkups?status=annule" className={pill(searchParams.status === 'annule')}>Annulés</Link>
      </div>

      {/* Tableau */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-3 text-left">Créé le</th>
              <th className="px-3 py-3 text-left">Échéance</th>
              <th className="px-3 py-3 text-left">Bien · Lot</th>
              <th className="px-3 py-3 text-left">Assigné à</th>
              <th className="px-3 py-3 text-center">Statut</th>
              <th className="px-3 py-3 text-center">Class.</th>
              <th className="px-3 py-3 text-center">Problèmes</th>
              <th className="px-3 py-3"></th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {rows.map((r) => {
              const unit = r.propria_unit_id ? (unitsMap.get(r.propria_unit_id) as any) : null;
              const bienId = unit ? unit.property_id : r.property_id;
              const bien = bienId ? (props.get(bienId) as any) : null;
              const bienCode = bien ? (bien.propria_internal_code ?? bien.name) : 'Bien';
              const scopeText = unit ? `${bienCode} · ${unit.label}` : (bien ? `${bienCode} · Bien entier` : '—');
              const nbProblems = problemsByCheckup.get(r.id) ?? 0;
              const isOverdue = r.due_date && r.due_date < new Date().toISOString().slice(0, 10)
                && !['valide', 'annule'].includes(r.status);
              return (
                <tr key={r.id} className="hover:bg-stoniz-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-stoniz-gray-600">
                    {new Date(r.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap text-xs ${isOverdue ? 'text-red-700 font-medium' : 'text-stoniz-gray-600'}`}>
                    {r.due_date ? new Date(r.due_date).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.auto_source && AUTO_SOURCE_BADGES[r.auto_source] && (
                      <span
                        title={AUTO_SOURCE_BADGES[r.auto_source].label}
                        className="mr-1.5 cursor-help"
                      >
                        {AUTO_SOURCE_BADGES[r.auto_source].icon}
                      </span>
                    )}
                    <Link href={`/propria/checkups/${r.id}`} className="hover:underline font-medium">{scopeText}</Link>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {profs.get(r.assigned_to_id) ?? <span className="text-orange-600">non assigné</span>}
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status] ?? ''}`}>
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {r.final_classification ? (
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full font-display text-sm ${
                        r.final_classification === 'A' ? 'bg-emerald-100 text-emerald-800' :
                        r.final_classification === 'B' ? 'bg-amber-100 text-amber-800' :
                        r.final_classification === 'C' ? 'bg-orange-100 text-orange-800' :
                        'bg-red-100 text-red-800'
                      }`}>{r.final_classification}</span>
                    ) : <span className="text-stoniz-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {nbProblems > 0
                      ? <span className="text-orange-700 font-medium">⚠ {nbProblems}</span>
                      : <span className="text-stoniz-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link href={`/propria/checkups/${r.id}`} className="text-xs hover:underline">Fiche →</Link>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link href={`/propria/checkups/${r.id}/rapport`} className="text-xs text-stoniz-gray-500 hover:underline">🖨 Rapport</Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                  Aucun check-up pour ces filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
