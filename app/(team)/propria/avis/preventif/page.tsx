import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PreReviewKanban } from '@/components/propria/pre-review-kanban';

/**
 * Page Kanban 2 — Avis préventifs (CEO 2026-06-10).
 *
 * Pour chaque réservation dont le check-out a eu lieu dans les 14 derniers
 * jours (fenêtre Airbnb pour poster un avis), on suit l'action de l'équipe
 * pour soit chercher un 5/5, soit éviter un mauvais avis.
 *
 * Bascule auto via cron Hostaway (lib/propria/pre-review-tracking.ts).
 *
 * KPI séparés : taux de sauvetage (sentiment mauvais) vs taux de conversion
 * (sentiment bon) + tableau synthèse + évolution mensuelle + drill-down membre.
 */
export default async function PreReviewKanbanPage() {
  const me = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const todayIso = new Date().toISOString().slice(0, 10);

  // Charge les trackings + données de jointure
  const [trackingsRes, unitsRes, profilesRes] = await Promise.all([
    supabase
      .from('hostaway_pre_review_tracking')
      .select(`
        id, hostaway_reservation_id, sentiment, kanban_status, main_cause,
        related_review_id, completed_at, completion_reason, internal_notes,
        propria_unit_id, assignee_id, sentiment_set_by,
        created_at
      `)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('propria_units').select(`
      id, code,
      property:properties(name)
    `).is('deleted_at', null).order('code'),
    supabase.from('profiles').select('id, full_name').neq('role', 'client'),
  ]);

  // CEO 2026-06-10 : assignés possibles = ceo + propria uniquement
  const { data: assignees } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['ceo', 'propria'])
    .eq('is_active', true)
    .order('full_name');

  const trackingsRaw = (trackingsRes.data ?? []) as any[];
  const unitMap = new Map((unitsRes.data ?? []).map((u: any) => [u.id, u]));
  const profileMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  // Enrichit avec les résa, reviews et actions
  const resaIds = trackingsRaw.map((t) => t.hostaway_reservation_id);
  const reviewIds = trackingsRaw.map((t) => t.related_review_id).filter(Boolean);

  const [resasRes, reviewsRes, actionsRes] = await Promise.all([
    supabase.from('hostaway_reservations')
      .select('hostaway_id, guest_name, guest_email, guest_phone, channel_name, arrival_date, departure_date')
      .in('hostaway_id', resaIds),
    reviewIds.length > 0
      ? supabase.from('hostaway_reviews')
          .select('id, rating_normalized, public_review')
          .in('id', reviewIds)
      : Promise.resolve({ data: [] } as any),
    supabase.from('hostaway_pre_review_actions')
      .select('tracking_id, action_type, performed_by, performed_at')
      .in('tracking_id', trackingsRaw.map((t) => t.id))
      .is('deleted_at', null),
  ]);

  const resaMap = new Map((resasRes.data ?? []).map((r: any) => [r.hostaway_id, r]));
  const reviewMap = new Map((reviewsRes.data ?? []).map((r: any) => [r.id, r]));
  const actionsByTracking = new Map<string, any[]>();
  for (const a of (actionsRes.data ?? []) as any[]) {
    if (!actionsByTracking.has(a.tracking_id)) actionsByTracking.set(a.tracking_id, []);
    actionsByTracking.get(a.tracking_id)!.push(a);
  }

  const trackings = trackingsRaw.map((t) => {
    const resa = resaMap.get(t.hostaway_reservation_id) as any;
    const review = t.related_review_id ? reviewMap.get(t.related_review_id) as any : null;
    const unit = t.propria_unit_id ? unitMap.get(t.propria_unit_id) as any : null;
    const trackingActions = actionsByTracking.get(t.id) ?? [];
    const days_left = resa
      ? Math.max(0, 14 - Math.floor((Date.now() - new Date(resa.departure_date + 'T00:00:00Z').getTime()) / (24 * 60 * 60 * 1000)))
      : 0;
    return {
      ...t,
      guest_name: resa?.guest_name ?? null,
      guest_email: resa?.guest_email ?? null,
      guest_phone: resa?.guest_phone ?? null,
      channel_name: resa?.channel_name ?? null,
      arrival_date: resa?.arrival_date ?? '',
      departure_date: resa?.departure_date ?? '',
      unit_code: unit?.code ?? null,
      property_name: unit?.property?.name ?? null,
      review_rating: review?.rating_normalized != null ? Number(review.rating_normalized) : null,
      review_comment: review?.public_review ?? null,
      nb_actions: trackingActions.length,
      days_left,
      actions: trackingActions,
    };
  });

  // KPI calculs sur les trackings clos (accomplie ou ratée)
  const closed = trackings.filter((t) => t.kanban_status === 'accomplie' || t.kanban_status === 'ratee');
  const bySent: Record<'mauvais' | 'bon' | 'neutre' | 'null', { ok: number; ko: number; total: number }> = {
    mauvais: { ok: 0, ko: 0, total: 0 },
    bon:     { ok: 0, ko: 0, total: 0 },
    neutre:  { ok: 0, ko: 0, total: 0 },
    null:    { ok: 0, ko: 0, total: 0 },
  };
  for (const t of closed) {
    const key = (t.sentiment ?? 'null') as keyof typeof bySent;
    if (t.kanban_status === 'accomplie') bySent[key].ok++;
    else bySent[key].ko++;
    bySent[key].total++;
  }
  const tauxSauvetage = bySent.mauvais.total > 0 ? (bySent.mauvais.ok / bySent.mauvais.total) * 100 : null;
  const tauxConversion = bySent.bon.total > 0 ? (bySent.bon.ok / bySent.bon.total) * 100 : null;
  const tauxGlobal = closed.length > 0
    ? (closed.filter((t) => t.kanban_status === 'accomplie').length / closed.length) * 100
    : null;

  // Évolution mensuelle (6 derniers mois) — accomplies vs ratées par mois
  const monthlyStats = new Map<string, { ok: number; ko: number }>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyStats.set(key, { ok: 0, ko: 0 });
  }
  for (const t of closed) {
    if (!t.completed_at) continue;
    const d = new Date(t.completed_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const cur = monthlyStats.get(key);
    if (!cur) continue;
    if (t.kanban_status === 'accomplie') cur.ok++;
    else cur.ko++;
  }
  const monthlyArr = Array.from(monthlyStats.entries());

  // Drill-down par membre : qui a fait combien d'actions / taux de réussite
  const allActions = (actionsRes.data ?? []) as any[];
  const perMember = new Map<string, { actions: number; closed: number; ok: number }>();
  for (const a of allActions) {
    if (!a.performed_by) continue;
    const cur = perMember.get(a.performed_by) ?? { actions: 0, closed: 0, ok: 0 };
    cur.actions++;
    perMember.set(a.performed_by, cur);
  }
  // Pour chaque tracking clos, on attribue le résultat au membre qui a fait l'action
  for (const t of closed) {
    const acts = actionsByTracking.get(t.id) ?? [];
    const memberIds = new Set(acts.map((a: any) => a.performed_by).filter(Boolean));
    for (const mid of memberIds) {
      const cur = perMember.get(mid) ?? { actions: 0, closed: 0, ok: 0 };
      cur.closed++;
      if (t.kanban_status === 'accomplie') cur.ok++;
      perMember.set(mid, cur);
    }
  }
  const memberRows = Array.from(perMember.entries())
    .map(([id, s]) => ({
      id,
      name: profileMap.get(id) ?? '—',
      actions: s.actions,
      closed: s.closed,
      ok: s.ok,
      rate: s.closed > 0 ? (s.ok / s.closed) * 100 : null,
    }))
    .sort((a, b) => b.actions - a.actions);

  return (
    <div className="max-w-[1500px]">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · '}
        <Link href="/propria/avis" className="hover:text-stoniz-black">Avis</Link>
        {' · Préventif'}
      </div>
      <h1 className="text-3xl font-display mb-2">🎯 Avis préventifs (Kanban 2)</h1>
      <p className="text-sm text-stoniz-gray-600 mb-6">
        Fenêtre 14 jours après checkout : voyageurs peuvent encore poster un avis.
        L'équipe classe le sentiment et agit pour transformer chaque tentative en succès.
      </p>

      {/* KPI séparés */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="text-xs text-red-700 uppercase">🔴 Taux de sauvetage</div>
          <div className="text-3xl font-display mt-1 text-red-800">
            {tauxSauvetage != null ? tauxSauvetage.toFixed(0) + ' %' : '—'}
          </div>
          <div className="text-[10px] text-red-600">{bySent.mauvais.ok}/{bySent.mauvais.total} risques sauvés</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="text-xs text-emerald-700 uppercase">🟢 Taux de conversion 5/5</div>
          <div className="text-3xl font-display mt-1 text-emerald-800">
            {tauxConversion != null ? tauxConversion.toFixed(0) + ' %' : '—'}
          </div>
          <div className="text-[10px] text-emerald-600">{bySent.bon.ok}/{bySent.bon.total} bons retours confirmés</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="text-xs text-blue-700 uppercase">📊 Taux global</div>
          <div className="text-3xl font-display mt-1 text-blue-800">
            {tauxGlobal != null ? tauxGlobal.toFixed(0) + ' %' : '—'}
          </div>
          <div className="text-[10px] text-blue-600">{closed.filter((t) => t.kanban_status === 'accomplie').length}/{closed.length} missions</div>
        </div>
      </div>

      {/* Tableau synthèse */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-6">
        <div className="text-sm font-medium mb-3">Synthèse par sentiment initial</div>
        <table className="w-full text-xs">
          <thead className="text-stoniz-gray-600 uppercase">
            <tr>
              <th className="text-left py-1.5">Sentiment initial</th>
              <th className="text-right py-1.5">Total</th>
              <th className="text-right py-1.5">✅ Accomplies</th>
              <th className="text-right py-1.5">❌ Ratées</th>
              <th className="text-right py-1.5">Taux</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            <tr>
              <td className="py-1.5">🔴 Risque mauvais avis</td>
              <td className="text-right">{bySent.mauvais.total}</td>
              <td className="text-right text-emerald-700">{bySent.mauvais.ok}</td>
              <td className="text-right text-red-700">{bySent.mauvais.ko}</td>
              <td className="text-right font-medium">{tauxSauvetage != null ? tauxSauvetage.toFixed(0) + '%' : '—'}</td>
            </tr>
            <tr>
              <td className="py-1.5">🟢 Bon retour attendu</td>
              <td className="text-right">{bySent.bon.total}</td>
              <td className="text-right text-emerald-700">{bySent.bon.ok}</td>
              <td className="text-right text-red-700">{bySent.bon.ko}</td>
              <td className="text-right font-medium">{tauxConversion != null ? tauxConversion.toFixed(0) + '%' : '—'}</td>
            </tr>
            <tr>
              <td className="py-1.5">🟡 Neutre</td>
              <td className="text-right">{bySent.neutre.total}</td>
              <td className="text-right text-emerald-700">{bySent.neutre.ok}</td>
              <td className="text-right text-red-700">{bySent.neutre.ko}</td>
              <td className="text-right font-medium">
                {bySent.neutre.total > 0 ? ((bySent.neutre.ok / bySent.neutre.total) * 100).toFixed(0) + '%' : '—'}
              </td>
            </tr>
            <tr className="font-medium border-t-2 border-stoniz-gray-200">
              <td className="py-2">Total</td>
              <td className="text-right">{closed.length}</td>
              <td className="text-right text-emerald-700">{closed.filter((t) => t.kanban_status === 'accomplie').length}</td>
              <td className="text-right text-red-700">{closed.filter((t) => t.kanban_status === 'ratee').length}</td>
              <td className="text-right">{tauxGlobal != null ? tauxGlobal.toFixed(0) + '%' : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Évolution mensuelle */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-6">
        <div className="text-sm font-medium mb-3">Évolution mensuelle (6 derniers mois)</div>
        <div className="flex items-end gap-1 h-32">
          {monthlyArr.map(([key, s]) => {
            const total = s.ok + s.ko;
            const max = Math.max(...monthlyArr.map(([, x]) => x.ok + x.ko), 1);
            const okH = total > 0 ? (s.ok / max) * 100 : 0;
            const koH = total > 0 ? (s.ko / max) * 100 : 0;
            const rate = total > 0 ? (s.ok / total) * 100 : 0;
            return (
              <div key={key} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-[10px] text-stoniz-gray-600 font-medium">
                  {total > 0 ? rate.toFixed(0) + '%' : '—'}
                </div>
                <div className="w-full flex flex-col-reverse h-24 bg-stoniz-gray-50 rounded">
                  {s.ok > 0 && <div style={{ height: `${okH}%` }} className="bg-emerald-500 rounded-t" title={`${s.ok} accomplies`} />}
                  {s.ko > 0 && <div style={{ height: `${koH}%` }} className="bg-red-400" title={`${s.ko} ratées`} />}
                </div>
                <div className="text-[10px] text-stoniz-gray-500">{key.slice(5)}</div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-center gap-3 text-[10px] text-stoniz-gray-600 mt-2">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded" /> Accomplies</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-red-400 rounded" /> Ratées</span>
        </div>
      </div>

      {/* Drill-down par membre */}
      {memberRows.length > 0 && (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-6">
          <div className="text-sm font-medium mb-3">Performance par membre</div>
          <table className="w-full text-xs">
            <thead className="text-stoniz-gray-600 uppercase">
              <tr>
                <th className="text-left py-1.5">Membre</th>
                <th className="text-right py-1.5">Actions</th>
                <th className="text-right py-1.5">Missions closes</th>
                <th className="text-right py-1.5">✅ Accomplies</th>
                <th className="text-right py-1.5">Taux</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stoniz-gray-100">
              {memberRows.map((m) => (
                <tr key={m.id}>
                  <td className="py-1.5">{m.name}</td>
                  <td className="text-right">{m.actions}</td>
                  <td className="text-right">{m.closed}</td>
                  <td className="text-right text-emerald-700">{m.ok}</td>
                  <td className="text-right font-medium">{m.rate != null ? m.rate.toFixed(0) + '%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Kanban */}
      <PreReviewKanban
        trackings={trackings as any}
        assignees={(assignees ?? []) as any}
        profiles={(profilesRes.data ?? []) as any}
        canDeleteComments={me.role === 'ceo'}
      />
    </div>
  );
}
