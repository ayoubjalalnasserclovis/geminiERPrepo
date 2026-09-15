import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PostReviewKanban } from '@/components/propria/post-review-kanban';

type Search = {
  unit?: string;
  period?: string;        // 'm1' | 'm3' | 'all'
  date_from?: string;
  date_to?: string;
  review?: string;        // deep-link : ouvre la modale de cet avis
};

/**
 * Page Kanban 1 — Avis publiés (CEO 2026-06-10).
 *
 * Refonte (anciennement liste filtrable) en Kanban à 6 colonnes pour suivre
 * le cycle de vie d'une contestation :
 *   À traiter → 1er ticket ouvert → 1er ticket non résolu → 2ème ticket
 *   ouvert → Gagné / Perdu
 *
 * Auto-placement : tout avis < 5/5 atterrit en "À traiter".
 * Auto-bascule "Gagné" : si Hostaway pose `removed_at` (contestation Airbnb
 * réussie), la migration BDD a auto-basculé vers "Gagné".
 *
 * Filtres : période (mois dernier, 3 derniers mois, tout), suite, dates custom.
 */
export default async function PropriaReviewsKanbanPage({
  searchParams,
}: { searchParams: Search }) {
  const me = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const period = searchParams.period ?? 'm3';
  const unitId = searchParams.unit ?? '';
  const dateFrom = searchParams.date_from ?? '';
  const dateTo = searchParams.date_to ?? '';

  // Fenêtre temporelle (date custom prime sinon période)
  let fromDate: string | null = null;
  if (dateFrom) {
    fromDate = dateFrom;
  } else if (period === 'm1') {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    fromDate = d.toISOString();
  } else if (period === 'm3') {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    fromDate = d.toISOString();
  }
  const toDate = dateTo || null;

  // On ne charge que les avis < 5/5 (les 5/5 ne nécessitent aucun suivi)
  let q = supabase
    .from('hostaway_reviews')
    .select(`
      id, channel_name, guest_name, public_review, private_review, rating_normalized,
      submitted_at, removed_at, hostaway_reservation_id,
      kanban_column, ticket1_opened_at, ticket1_unresolved_at,
      ticket2_opened_at, won_at, lost_at,
      internal_notes, propria_unit_id, assignee_id
    `)
    .is('deleted_at', null)
    .lt('rating_normalized', 5)
    .order('submitted_at', { ascending: false })
    .limit(2000);

  if (fromDate) q = q.gte('submitted_at', fromDate);
  if (toDate) q = q.lte('submitted_at', toDate);
  if (unitId) q = q.eq('propria_unit_id', unitId);

  const { data: rawReviews } = await q;

  // Charge les suites pour enrichir + filtre
  const { data: units } = await supabase
    .from('propria_units')
    .select(`
      id, code,
      property:properties(name, propria_internal_code)
    `)
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('code');

  // CEO 2026-06-10 : assignés possibles = ceo + propria uniquement
  const { data: assignees } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['ceo', 'propria'])
    .eq('is_active', true)
    .order('full_name');

  // Profils mentionnables dans les commentaires (@) — tout le staff actif
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .neq('role', 'client')
    .eq('is_active', true)
    .order('full_name');

  const unitMap = new Map((units ?? []).map((u: any) => [u.id, u]));

  const reviews = (rawReviews ?? []).map((r: any) => {
    const u = r.propria_unit_id ? unitMap.get(r.propria_unit_id) as any : null;
    return {
      ...r,
      unit_code: u?.code ?? null,
      property_name: u?.property?.name ?? null,
    };
  });

  // KPI rapides
  const total = reviews.length;
  const gagne = reviews.filter((r: any) => r.kanban_column === 'gagne').length;
  const perdu = reviews.filter((r: any) => r.kanban_column === 'perdu').length;
  const en_cours = reviews.filter((r: any) => !['gagne','perdu'].includes(r.kanban_column)).length;
  const taux_gain = (gagne + perdu) > 0 ? (gagne / (gagne + perdu)) * 100 : null;

  function makeHref(params: Partial<Search>) {
    const merged: Record<string, string> = {};
    if (period && period !== 'm3') merged.period = period;
    if (unitId) merged.unit = unitId;
    if (dateFrom) merged.date_from = dateFrom;
    if (dateTo) merged.date_to = dateTo;
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') delete merged[k];
      else merged[k] = v;
    }
    const qs = new URLSearchParams(merged).toString();
    return `/propria/avis${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="max-w-[1500px]">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · Avis publiés (Kanban contestation)'}
      </div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-2">
        <h1 className="text-3xl font-display">⭐ Gestion des avis &lt; 5/5</h1>
        <Link
          href="/propria/avis/preventif"
          className="bg-stoniz-black text-white px-3 py-2 rounded text-xs hover:bg-stoniz-gray-800"
        >
          📋 Voir les avis préventifs →
        </Link>
      </div>
      <p className="text-sm text-stoniz-gray-600 mb-6">
        Pour chaque avis &lt; 5/5, suivre le cycle de contestation : ticket Airbnb 1 → 2 → résolution.
        Seuls les avis &lt; 5/5 apparaissent (les 5/5 ne nécessitent aucune action).
      </p>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Total &lt; 5/5</div>
          <div className="text-2xl font-display mt-1">{total}</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="text-xs text-amber-700 uppercase">En cours</div>
          <div className="text-2xl font-display mt-1 text-amber-800">{en_cours}</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="text-xs text-emerald-700 uppercase">Gagnés</div>
          <div className="text-2xl font-display mt-1 text-emerald-800">{gagne}</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="text-xs text-blue-700 uppercase">Taux de gain</div>
          <div className="text-2xl font-display mt-1 text-blue-800">
            {taux_gain != null ? taux_gain.toFixed(0) + '%' : '—'}
          </div>
          <div className="text-[10px] text-blue-600">{gagne}/{gagne + perdu} clos</div>
        </div>
      </div>

      {/* Filtres rapides période */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="text-stoniz-gray-500">Période :</span>
        <Link href={makeHref({ period: 'm1' })}
          className={`px-3 py-1.5 rounded-full ${period === 'm1' && !dateFrom ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
          Mois dernier
        </Link>
        <Link href={makeHref({ period: 'm3' })}
          className={`px-3 py-1.5 rounded-full ${period === 'm3' && !dateFrom ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
          3 derniers mois
        </Link>
        <Link href={makeHref({ period: 'all' })}
          className={`px-3 py-1.5 rounded-full ${period === 'all' && !dateFrom ? 'bg-stoniz-black text-white' : 'bg-stoniz-gray-100 text-stoniz-gray-700 hover:bg-stoniz-gray-200'}`}>
          Tout
        </Link>

        <span className="border-l border-stoniz-gray-300 mx-2 h-5" />

        {/* Filtre date custom */}
        <form action="/propria/avis" method="GET" className="flex items-center gap-1">
          {unitId && <input type="hidden" name="unit" value={unitId} />}
          <label className="text-stoniz-gray-500">Du :</label>
          <input type="date" name="date_from" defaultValue={dateFrom}
            className={`border rounded px-2 py-1 text-xs ${dateFrom ? 'border-blue-500 bg-blue-50' : 'border-stoniz-gray-300'}`} />
          <label className="text-stoniz-gray-500">au :</label>
          <input type="date" name="date_to" defaultValue={dateTo}
            className={`border rounded px-2 py-1 text-xs ${dateTo ? 'border-blue-500 bg-blue-50' : 'border-stoniz-gray-300'}`} />
          <button type="submit" className="bg-stoniz-black text-white px-2 py-1 rounded text-xs">OK</button>
          {(dateFrom || dateTo) && (
            <Link href={makeHref({ date_from: undefined, date_to: undefined })}
              className="text-stoniz-gray-500 hover:text-stoniz-black">✕</Link>
          )}
        </form>

        {/* Filtre par suite */}
        <span className="border-l border-stoniz-gray-300 mx-2 h-5" />
        <form action="/propria/avis" method="GET" className="flex items-center gap-1">
          {period !== 'm3' && <input type="hidden" name="period" value={period} />}
          {dateFrom && <input type="hidden" name="date_from" value={dateFrom} />}
          {dateTo && <input type="hidden" name="date_to" value={dateTo} />}
          <label className="text-stoniz-gray-500">Suite :</label>
          <select name="unit" defaultValue={unitId}
            className={`border rounded px-2 py-1 text-xs ${unitId ? 'border-blue-500 bg-blue-50' : 'border-stoniz-gray-300'}`}>
            <option value="">— Toutes —</option>
            {(units ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.code}</option>)}
          </select>
          <button type="submit" className="bg-stoniz-black text-white px-2 py-1 rounded text-xs">OK</button>
        </form>
      </div>

      <PostReviewKanban
        reviews={reviews as any}
        assignees={(assignees ?? []) as any}
        profiles={(profiles ?? []) as any}
        canDeleteComments={me.role === 'ceo'}
        openReviewId={searchParams.review ?? null}
      />
    </div>
  );
}
