import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { LitigesKanban } from '@/components/propria/litiges-kanban';
import { LitigeCreateModal } from '@/components/propria/litige-create-modal';

const TYPE_LABEL: Record<string, string> = {
  caution: '🛡️ Caution',
  degats: '🔨 Dégâts matériels',
  frais_contestes: '💶 Frais contestés',
  annulation_tardive: '⏰ Annulation tardive',
  tapage: '📢 Tapage',
  menage: '🧹 Ménage',
  autre: '🔧 Autre',
};

/**
 * Page Litiges Airbnb (CEO 2026-06-10).
 *
 * Kanban dédié pour les litiges proactifs (caution, dégâts, frais contestés…)
 * liés à une réservation Hostaway. 5 colonnes : Ouvrir le ticket → Ticket
 * ouvert → Appel → Gagné / Perdu.
 *
 * KPI réutilisés de la structure Kanban 2 préventif :
 * cards taux, tableau par type, évolution mensuelle, drill-down membre.
 */
export default async function PropriaLitigesPage() {
  const sessionUser = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const [litigesRes, suitesRes, profilesRes, assigneesRes, actionsRes, totalsRes] = await Promise.all([
    supabase
      .from('propria_litiges')
      .select(`
        id, type, description, amount, currency, aircover_reference,
        kanban_column, ticket_opened_at, call_started_at, won_at, lost_at, opened_at,
        assignee_id, internal_notes, attachment_path,
        hostaway_reservation_id, hostaway_listing_db_id, propria_unit_id
      `)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('propria_units')
      .select(`
        id, code,
        property:properties(name)
      `)
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('code'),
    supabase.from('profiles').select('id, full_name, role'),
    supabase.from('profiles').select('id, full_name, role')
      .in('role', ['ceo', 'propria']).eq('is_active', true).order('full_name'),
    supabase.from('propria_litiges_actions')
      .select('litige_id, performed_by')
      .is('deleted_at', null),
    // Totaux dérivés des lignes (décision B4) — jamais stockés.
    supabase.from('propria_litiges_totals')
      .select('litige_id, nb_items, total_cost_real_mad, total_claimed_mad, marge_mad'),
  ]);

  const litigesRaw = (litigesRes.data ?? []) as any[];
  const suites = (suitesRes.data ?? []) as any[];
  const profileMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p.full_name]));
  const assignees = (assigneesRes.data ?? []) as any[];
  const actions = (actionsRes.data ?? []) as any[];
  const totalsMap = new Map(((totalsRes.data ?? []) as any[]).map((t) => [t.litige_id, t]));

  // Charge les résa Hostaway des 12 derniers mois pour les listings matchés
  const since = new Date(); since.setMonth(since.getMonth() - 12);
  const { data: resasAll } = await supabase
    .from('hostaway_reservations')
    .select(`
      hostaway_id, hostaway_listing_db_id, guest_name, channel_name,
      arrival_date, departure_date, total_price, currency
    `)
    .in('status', ['new','modified'])
    .gte('arrival_date', since.toISOString().slice(0, 10))
    .is('deleted_at', null)
    .order('arrival_date', { ascending: false });

  // Map listing → unit pour résoudre les résa par suite
  const { data: listings } = await supabase
    .from('hostaway_listings')
    .select('id, propria_unit_id')
    .is('deleted_at', null);
  const listingToUnit = new Map<string, string | null>();
  for (const l of (listings ?? []) as any[]) listingToUnit.set(l.id, l.propria_unit_id);

  // Grouper les résa par unit_id (pour la modale création)
  const resasByUnit: Record<string, any[]> = {};
  for (const r of (resasAll ?? []) as any[]) {
    const unitId = listingToUnit.get(r.hostaway_listing_db_id);
    if (!unitId) continue;
    if (!resasByUnit[unitId]) resasByUnit[unitId] = [];
    resasByUnit[unitId].push({
      hostaway_id: r.hostaway_id,
      guest_name: r.guest_name,
      arrival_date: r.arrival_date,
      departure_date: r.departure_date,
      channel_name: r.channel_name,
      total_price: r.total_price,
      currency: r.currency,
    });
  }

  // Suites disponibles pour la modale (uniquement les matchées avec >0 résa)
  const suitesForModal = suites
    .filter((s: any) => resasByUnit[s.id] && resasByUnit[s.id].length > 0)
    .map((s: any) => ({
      id: s.id,
      code: s.code,
      property_name: s.property?.name ?? null,
    }));

  // Enrichit chaque litige avec données résa + suite
  const resaMap = new Map<number, any>();
  for (const r of (resasAll ?? []) as any[]) resaMap.set(r.hostaway_id, r);
  const unitsMap = new Map(suites.map((s: any) => [s.id, s]));

  const actionsByLitige = new Map<string, any[]>();
  for (const a of actions) {
    if (!actionsByLitige.has(a.litige_id)) actionsByLitige.set(a.litige_id, []);
    actionsByLitige.get(a.litige_id)!.push(a);
  }

  const litiges = litigesRaw.map((l) => {
    const resa = resaMap.get(l.hostaway_reservation_id) as any;
    const unit = l.propria_unit_id ? unitsMap.get(l.propria_unit_id) as any : null;
    const totals = totalsMap.get(l.id) as any;
    return {
      ...l,
      guest_name: resa?.guest_name ?? null,
      channel_name: resa?.channel_name ?? null,
      arrival_date: resa?.arrival_date ?? '',
      departure_date: resa?.departure_date ?? '',
      unit_code: unit?.code ?? null,
      property_name: unit?.property?.name ?? null,
      nb_actions: (actionsByLitige.get(l.id) ?? []).length,
      nb_items: Number(totals?.nb_items ?? 0),
      total_claimed_mad: Number(totals?.total_claimed_mad ?? 0),
      total_cost_real_mad: Number(totals?.total_cost_real_mad ?? 0),
      marge_mad: Number(totals?.marge_mad ?? 0),
    };
  });

  // KPI calculs
  const total = litiges.length;
  const gagne = litiges.filter((l: any) => l.kanban_column === 'gagne').length;
  const perdu = litiges.filter((l: any) => l.kanban_column === 'perdu').length;
  const closed = gagne + perdu;
  const en_cours = total - closed;
  const tauxGain = closed > 0 ? (gagne / closed) * 100 : null;

  // Synthèse par type
  const byType: Record<string, { total: number; gagne: number; perdu: number }> = {};
  for (const l of litiges) {
    if (!byType[l.type]) byType[l.type] = { total: 0, gagne: 0, perdu: 0 };
    byType[l.type].total++;
    if (l.kanban_column === 'gagne') byType[l.type].gagne++;
    else if (l.kanban_column === 'perdu') byType[l.type].perdu++;
  }

  // Évolution mensuelle 6 mois
  const monthly = new Map<string, { gagne: number; perdu: number }>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthly.set(key, { gagne: 0, perdu: 0 });
  }
  for (const l of litiges) {
    const closedDate = l.won_at || l.lost_at;
    if (!closedDate) continue;
    const d = new Date(closedDate);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const cur = monthly.get(key);
    if (!cur) continue;
    if (l.kanban_column === 'gagne') cur.gagne++;
    else cur.perdu++;
  }
  const monthlyArr = Array.from(monthly.entries());

  // Drill-down membre
  const perMember = new Map<string, { actions: number; closed: number; gagne: number }>();
  for (const a of actions) {
    if (!a.performed_by) continue;
    const cur = perMember.get(a.performed_by) ?? { actions: 0, closed: 0, gagne: 0 };
    cur.actions++;
    perMember.set(a.performed_by, cur);
  }
  for (const l of litiges) {
    if (l.kanban_column !== 'gagne' && l.kanban_column !== 'perdu') continue;
    const acts = actionsByLitige.get(l.id) ?? [];
    const memberIds = new Set(acts.map((a: any) => a.performed_by).filter(Boolean));
    for (const mid of memberIds) {
      const cur = perMember.get(mid) ?? { actions: 0, closed: 0, gagne: 0 };
      cur.closed++;
      if (l.kanban_column === 'gagne') cur.gagne++;
      perMember.set(mid, cur);
    }
  }
  const memberRows = Array.from(perMember.entries())
    .map(([id, s]) => ({
      id,
      name: profileMap.get(id) ?? '—',
      actions: s.actions,
      closed: s.closed,
      gagne: s.gagne,
      rate: s.closed > 0 ? (s.gagne / s.closed) * 100 : null,
    }))
    .sort((a, b) => b.actions - a.actions);

  return (
    <div className="max-w-[1500px]">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · Litiges Airbnb'}
      </div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-2">
        <h1 className="text-3xl font-display">⚖️ Litiges Airbnb</h1>
        <LitigeCreateModal suites={suitesForModal as any} resasByUnit={resasByUnit} />
      </div>
      <p className="text-sm text-stoniz-gray-600 mb-6">
        Litiges proactifs ouverts auprès d'Airbnb (caution, dégâts, frais contestés…).
        5 colonnes : ouverture du ticket → traitement → résolution.
      </p>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Total litiges</div>
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
            {tauxGain != null ? tauxGain.toFixed(0) + ' %' : '—'}
          </div>
          <div className="text-[10px] text-blue-600">{gagne}/{closed} clos</div>
        </div>
      </div>

      {/* Tableau synthèse par type */}
      {total > 0 && (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-6">
          <div className="text-sm font-medium mb-3">Synthèse par type de litige</div>
          <table className="w-full text-xs">
            <thead className="text-stoniz-gray-600 uppercase">
              <tr>
                <th className="text-left py-1.5">Type</th>
                <th className="text-right py-1.5">Total</th>
                <th className="text-right py-1.5">✅ Gagnés</th>
                <th className="text-right py-1.5">❌ Perdus</th>
                <th className="text-right py-1.5">Taux</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stoniz-gray-100">
              {Object.entries(byType).map(([type, s]) => {
                const c = s.gagne + s.perdu;
                const rate = c > 0 ? (s.gagne / c) * 100 : null;
                return (
                  <tr key={type}>
                    <td className="py-1.5">{TYPE_LABEL[type] ?? type}</td>
                    <td className="text-right">{s.total}</td>
                    <td className="text-right text-emerald-700">{s.gagne}</td>
                    <td className="text-right text-red-700">{s.perdu}</td>
                    <td className="text-right font-medium">{rate != null ? rate.toFixed(0) + '%' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Évolution mensuelle */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-6">
        <div className="text-sm font-medium mb-3">Évolution mensuelle (6 derniers mois)</div>
        <div className="flex items-end gap-1 h-32">
          {monthlyArr.map(([key, s]) => {
            const totalM = s.gagne + s.perdu;
            const max = Math.max(...monthlyArr.map(([, x]) => x.gagne + x.perdu), 1);
            const okH = totalM > 0 ? (s.gagne / max) * 100 : 0;
            const koH = totalM > 0 ? (s.perdu / max) * 100 : 0;
            const rate = totalM > 0 ? (s.gagne / totalM) * 100 : 0;
            return (
              <div key={key} className="flex-1 flex flex-col items-center gap-1">
                <div className="text-[10px] text-stoniz-gray-600 font-medium">
                  {totalM > 0 ? rate.toFixed(0) + '%' : '—'}
                </div>
                <div className="w-full flex flex-col-reverse h-24 bg-stoniz-gray-50 rounded">
                  {s.gagne > 0 && <div style={{ height: `${okH}%` }} className="bg-emerald-500 rounded-t" title={`${s.gagne} gagnés`} />}
                  {s.perdu > 0 && <div style={{ height: `${koH}%` }} className="bg-red-400" title={`${s.perdu} perdus`} />}
                </div>
                <div className="text-[10px] text-stoniz-gray-500">{key.slice(5)}</div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-center gap-3 text-[10px] text-stoniz-gray-600 mt-2">
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded" /> Gagnés</span>
          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-red-400 rounded" /> Perdus</span>
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
                <th className="text-right py-1.5">Litiges clos</th>
                <th className="text-right py-1.5">✅ Gagnés</th>
                <th className="text-right py-1.5">Taux</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stoniz-gray-100">
              {memberRows.map((m) => (
                <tr key={m.id}>
                  <td className="py-1.5">{m.name}</td>
                  <td className="text-right">{m.actions}</td>
                  <td className="text-right">{m.closed}</td>
                  <td className="text-right text-emerald-700">{m.gagne}</td>
                  <td className="text-right font-medium">{m.rate != null ? m.rate.toFixed(0) + '%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Kanban */}
      <LitigesKanban
        litiges={litiges as any}
        assignees={assignees as any}
        profiles={((profilesRes.data ?? []) as any[])
          .filter((p) => p.role !== 'client')
          .map((p) => ({ id: p.id, full_name: p.full_name })) as any}
        canDeleteComments={sessionUser.role === 'ceo'}
      />
    </div>
  );
}
