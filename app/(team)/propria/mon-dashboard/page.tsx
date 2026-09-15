import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';

/**
 * Mon dashboard — U18 marathon Propria (décision CEO A4, P1 transverse).
 *
 * « Tout ce qui est assigné à MOI, en un écran » : ménages, tâches et
 * interventions, litiges, avis publiés, préventifs, mentions récentes.
 * Tout est dérivé en lecture (zéro table, zéro migration) — max 10 lignes
 * par section + lien "Voir tout" vers la page filtrée du module.
 *
 * Rouge UNIQUEMENT si retard réel : ménage en retard de date
 * (is_overdue) ou intervention en urgence critique.
 */

const URG_LABELS: Record<string, string> = {
  critique: '🔴 Critique', haute: '🟠 Haute', normale: '🟡 Normale', basse: '🟢 Basse',
};

const STATUS_LABELS: Record<string, string> = {
  a_traiter: 'À faire', en_cours: 'En cours', a_valider: 'À valider',
  refusee: 'Refusé', cloture: 'Clôturé', annule: 'Annulé',
};

// Valeurs réelles de propria_litiges.kanban_column (migration 20260610270000)
const LITIGE_COL_LABELS: Record<string, string> = {
  ouvrir_ticket: 'Ouvrir le ticket', ticket_ouvert: 'Ticket ouvert', appel: 'Appel',
  gagne: 'Gagné', perdu: 'Perdu',
};

// Valeurs réelles de hostaway_reviews.kanban_column (migration 20260610250000)
const AVIS_COL_LABELS: Record<string, string> = {
  a_traiter: 'À traiter', ticket1_ouvert: '1er ticket ouvert',
  ticket1_non_resolu: '1er ticket non résolu', ticket2_ouvert: '2ème ticket ouvert',
  gagne: 'Gagné', perdu: 'Perdu',
};

// Valeurs réelles de hostaway_pre_review_tracking.kanban_status (migration 20260610250000)
const PREV_STATUS_LABELS: Record<string, string> = {
  nouveau: 'Nouveau', risque: 'Risque', bon: 'Bon',
  action_lancee: 'Action lancée', accomplie: 'Accomplie', ratee: 'Ratée',
};

const LITIGE_TYPE_LABELS: Record<string, string> = {
  caution: '🛡️ Caution', degats: '🔨 Dégâts', frais_contestes: '💶 Frais contestés',
  annulation_tardive: '⏰ Annulation tardive', tapage: '📢 Tapage', menage: '🧹 Ménage', autre: '🔧 Autre',
};

const COMMENT_ENTITY_META: Record<string, { label: string; href: (id: string) => string }> = {
  litige: { label: 'Litige', href: () => '/propria/litiges' },
  avis: { label: 'Avis', href: (id) => `/propria/avis?review=${id}` },
  incident: { label: 'Incident', href: () => '/propria/menage/incidents' },
};

function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString('fr-FR') : '—';
}

export default async function MonDashboardPage() {
  const me = await requireRole(['ceo', 'developer', 'assistante', 'propria', 'menage']);
  const supabase = createClient();
  const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [
    cleanRes, intRes, intCritRes, litigesRes, avisRes, prevRes, comRes,
    propsRes, unitsRes, profilesRes,
  ] = await Promise.all([
    // 1. Mes ménages (statuts non clos), tri échéance — vue enrichie (exclut deleted_at)
    supabase
      .from('propria_cleanings_enriched')
      .select('id, property_id, propria_unit_id, cleaning_type_name, description, due_date, urgency, status, is_overdue', { count: 'exact' })
      .eq('assigned_to_id', me.id)
      .not('status', 'in', '(cloture,annule)')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(10),
    // 2. Mes tâches & interventions ouvertes — vue enrichie (exclut deleted_at)
    supabase
      .from('propria_interventions_enriched')
      .select('id, property_id, propria_unit_id, kind, type_label, description, urgency, status, due_date, is_overdue', { count: 'exact' })
      .eq('assigned_to_id', me.id)
      .in('status', ['a_traiter', 'en_cours'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(10),
    // 2bis. Compteur interventions critiques (badge rouge = retard réel)
    supabase
      .from('propria_interventions_enriched')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to_id', me.id)
      .in('status', ['a_traiter', 'en_cours'])
      .eq('urgency', 'critique'),
    // 3. Mes litiges en cours
    supabase
      .from('propria_litiges')
      .select('id, type, description, amount, currency, kanban_column, opened_at, propria_unit_id', { count: 'exact' })
      .eq('assignee_id', me.id)
      .not('kanban_column', 'in', '(gagne,perdu)')
      .is('deleted_at', null)
      .order('opened_at', { ascending: true })
      .limit(10),
    // 4. Mes avis assignés (colonnes kanban non closes)
    supabase
      .from('hostaway_reviews')
      .select('id, guest_name, channel_name, rating_normalized, kanban_column, submitted_at, propria_unit_id', { count: 'exact' })
      .eq('assignee_id', me.id)
      .not('kanban_column', 'in', '(gagne,perdu)')
      .is('deleted_at', null)
      .order('submitted_at', { ascending: false })
      .limit(10),
    // 5. Mes préventifs assignés (statuts non clos)
    supabase
      .from('hostaway_pre_review_tracking')
      .select('id, hostaway_reservation_id, sentiment, kanban_status, propria_unit_id, created_at', { count: 'exact' })
      .eq('assignee_id', me.id)
      .not('kanban_status', 'in', '(accomplie,ratee)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10),
    // 6. Mentions des 7 derniers jours
    supabase
      .from('propria_comments')
      .select('id, entity_type, entity_id, body, author_id, created_at', { count: 'exact' })
      .contains('mentions', [me.id])
      .gte('created_at', since7d)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10),
    // Lookups (libellés bien / suite / auteur)
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null),
    supabase.from('propria_units').select('id, code, order_index, property_id')
      .is('deleted_at', null),
    supabase.from('profiles').select('id, full_name'),
  ]);

  const props = new Map((propsRes.data ?? []).map((p: any) => [p.id, p]));
  const unitsMap = new Map((unitsRes.data ?? []).map((u: any) => [
    u.id, { label: u.code ?? `Suite ${u.order_index}`, property_id: u.property_id },
  ]));
  const profiles = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  function scopeLabel(propertyId: string | null, unitId: string | null): string {
    const unit = unitId ? (unitsMap.get(unitId) as any) : null;
    const bienId = unit ? unit.property_id : propertyId;
    const bien = bienId ? (props.get(bienId) as any) : null;
    const bienCode = bien ? (bien.propria_internal_code ?? bien.name) : null;
    if (unit && bienCode) return `${bienCode} · ${unit.label}`;
    if (unit) return unit.label;
    return bienCode ?? '—';
  }

  const cleanings = (cleanRes.data ?? []) as any[];
  const interventions = (intRes.data ?? []) as any[];
  const litiges = (litigesRes.data ?? []) as any[];
  const avis = (avisRes.data ?? []) as any[];
  const preventifs = (prevRes.data ?? []) as any[];
  const mentions = (comRes.data ?? []) as any[];

  const counts = {
    cleanings: cleanRes.count ?? cleanings.length,
    interventions: intRes.count ?? interventions.length,
    litiges: litigesRes.count ?? litiges.length,
    avis: avisRes.count ?? avis.length,
    preventifs: prevRes.count ?? preventifs.length,
    mentions: comRes.count ?? mentions.length,
  };

  // Retard réel uniquement (CEO) : ménage en retard de date, intervention critique.
  const cleaningsLate = cleanings.some((c) => c.is_overdue);
  const interventionsCritical = (intCritRes.count ?? 0) > 0;

  const kpis: { id: string; label: string; count: number; alert: boolean }[] = [
    { id: 'menages',       label: 'Mes ménages',       count: counts.cleanings,     alert: cleaningsLate },
    { id: 'interventions', label: 'Mes interventions', count: counts.interventions, alert: interventionsCritical },
    { id: 'litiges',       label: 'Mes litiges',       count: counts.litiges,       alert: false },
    { id: 'avis',          label: 'Mes avis',          count: counts.avis,          alert: false },
    { id: 'preventifs',    label: 'Mes préventifs',    count: counts.preventifs,    alert: false },
    { id: 'mentions',      label: 'Mentions 7j',       count: counts.mentions,      alert: false },
  ];

  function Section({
    id, title, count, viewAllHref, children,
  }: { id: string; title: string; count: number; viewAllHref?: string; children: React.ReactNode }) {
    return (
      <section id={id} className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            {title}
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-stoniz-gray-100 text-stoniz-gray-700">{count}</span>
          </h2>
          {viewAllHref && count > 10 && (
            <Link href={viewAllHref} className="text-xs text-stoniz-gray-500 hover:text-stoniz-black">
              Voir tout →
            </Link>
          )}
        </div>
        {children}
      </section>
    );
  }

  function Empty({ text }: { text: string }) {
    return <p className="text-sm text-stoniz-gray-400 py-2">{text}</p>;
  }

  const rowClass = 'flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded-lg hover:bg-stoniz-gray-50 text-sm';

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Personnel
        </div>
        <h1 className="text-3xl font-display">Mon dashboard</h1>
        <p className="text-sm text-stoniz-gray-600 mt-1">
          Tout ce qui est assigné à {me.full_name?.split(' ')[0] ?? 'moi'}, en un écran.
        </p>
      </div>

      {/* Bandeau compteurs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {kpis.map((k) => (
          <a
            key={k.id}
            href={`#${k.id}`}
            className={`rounded-xl border p-3 text-center transition-colors ${
              k.alert
                ? 'bg-red-50 border-red-300 hover:border-red-400'
                : 'bg-white border-stoniz-gray-200 hover:border-stoniz-gray-400'
            }`}
          >
            <div className={`text-2xl font-display ${k.alert ? 'text-red-700' : ''}`}>{k.count}</div>
            <div className={`text-[11px] mt-0.5 ${k.alert ? 'text-red-700' : 'text-stoniz-gray-600'}`}>{k.label}</div>
          </a>
        ))}
      </div>

      <div className="space-y-4">
        {/* 1. Mes ménages */}
        <Section
          id="menages"
          title="🧹 Mes ménages à venir / en cours"
          count={counts.cleanings}
          viewAllHref={`/propria/menage?assigned=${me.id}&status=actives&window=all`}
        >
          {cleanings.length === 0 ? <Empty text="Aucun ménage assigné." /> : (
            <div className="divide-y divide-stoniz-gray-100">
              {cleanings.map((c) => (
                <Link key={c.id} href={`/propria/menage/${c.id}`} className={rowClass}>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{scopeLabel(c.property_id, c.propria_unit_id)}</div>
                    <div className="text-xs text-stoniz-gray-500 truncate">
                      {c.cleaning_type_name ?? 'Ménage'}{c.description ? ` · ${c.description}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-xs ${c.is_overdue ? 'text-red-700 font-medium' : 'text-stoniz-gray-600'}`}>
                      {c.is_overdue ? '⚠ En retard · ' : ''}{fmtDate(c.due_date)}
                    </div>
                    <div className="text-[10px] text-stoniz-gray-500">{STATUS_LABELS[c.status] ?? c.status}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* 2. Mes tâches & interventions */}
        <Section
          id="interventions"
          title="🔧 Mes tâches et interventions ouvertes"
          count={counts.interventions}
          viewAllHref={`/propria/interventions?assigned=${me.id}&status=actives`}
        >
          {interventions.length === 0 ? <Empty text="Aucune tâche ni intervention ouverte." /> : (
            <div className="divide-y divide-stoniz-gray-100">
              {interventions.map((i) => (
                <Link key={i.id} href={`/propria/interventions/${i.id}`} className={rowClass}>
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      <span className="mr-1">{i.kind === 'tache' ? '📋' : '🔧'}</span>
                      {scopeLabel(i.property_id, i.propria_unit_id)}
                    </div>
                    <div className="text-xs text-stoniz-gray-500 truncate">{i.type_label ?? ''}{i.type_label && i.description ? ' · ' : ''}{i.description}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs">{URG_LABELS[i.urgency] ?? i.urgency}</div>
                    <div className={`text-[10px] ${i.is_overdue ? 'text-red-700 font-medium' : 'text-stoniz-gray-500'}`}>
                      {i.due_date ? `Échéance ${fmtDate(i.due_date)}` : STATUS_LABELS[i.status] ?? i.status}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* 3. Mes litiges */}
        <Section id="litiges" title="🛡️ Mes litiges en cours" count={counts.litiges} viewAllHref="/propria/litiges">
          {litiges.length === 0 ? <Empty text="Aucun litige en cours assigné." /> : (
            <div className="divide-y divide-stoniz-gray-100">
              {litiges.map((l) => (
                <Link key={l.id} href="/propria/litiges" className={rowClass}>
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {LITIGE_TYPE_LABELS[l.type] ?? l.type} · {scopeLabel(null, l.propria_unit_id)}
                    </div>
                    <div className="text-xs text-stoniz-gray-500 truncate">{l.description ?? ''}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs">{LITIGE_COL_LABELS[l.kanban_column] ?? l.kanban_column}</div>
                    <div className="text-[10px] text-stoniz-gray-500">
                      {l.amount != null ? `${Number(l.amount).toLocaleString('fr-FR')} ${l.currency ?? 'MAD'} · ` : ''}Ouvert le {fmtDate(l.opened_at)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* 4. Mes avis assignés */}
        <Section id="avis" title="⭐ Mes avis assignés" count={counts.avis} viewAllHref="/propria/avis">
          {avis.length === 0 ? <Empty text="Aucun avis assigné." /> : (
            <div className="divide-y divide-stoniz-gray-100">
              {avis.map((a) => (
                <Link key={a.id} href={`/propria/avis?review=${a.id}`} className={rowClass}>
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {a.rating_normalized != null ? `${Number(a.rating_normalized).toFixed(1)}/5` : '—'} · {a.guest_name ?? 'Voyageur'}
                    </div>
                    <div className="text-xs text-stoniz-gray-500 truncate">
                      {scopeLabel(null, a.propria_unit_id)}{a.channel_name ? ` · ${a.channel_name}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs">{AVIS_COL_LABELS[a.kanban_column] ?? a.kanban_column}</div>
                    <div className="text-[10px] text-stoniz-gray-500">{fmtDate(a.submitted_at)}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* 5. Mes préventifs */}
        <Section id="preventifs" title="🚨 Mes préventifs assignés" count={counts.preventifs} viewAllHref="/propria/avis/preventif">
          {preventifs.length === 0 ? <Empty text="Aucun préventif assigné." /> : (
            <div className="divide-y divide-stoniz-gray-100">
              {preventifs.map((p) => (
                <Link key={p.id} href="/propria/avis/preventif" className={rowClass}>
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      Résa {p.hostaway_reservation_id} · {scopeLabel(null, p.propria_unit_id)}
                    </div>
                    <div className="text-xs text-stoniz-gray-500">
                      Sentiment : {p.sentiment ?? 'non renseigné'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs">{PREV_STATUS_LABELS[p.kanban_status] ?? p.kanban_status}</div>
                    <div className="text-[10px] text-stoniz-gray-500">{fmtDate(p.created_at)}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Section>

        {/* 6. Mentions récentes */}
        <Section id="mentions" title="💬 Mes mentions (7 derniers jours)" count={counts.mentions}>
          {mentions.length === 0 ? <Empty text="Aucune mention récente." /> : (
            <div className="divide-y divide-stoniz-gray-100">
              {mentions.map((m) => {
                const meta = COMMENT_ENTITY_META[m.entity_type] ?? { label: m.entity_type, href: () => '/propria' };
                return (
                  <Link key={m.id} href={meta.href(m.entity_id)} className={rowClass}>
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {(m.author_id ? profiles.get(m.author_id) : null) ?? 'Quelqu\'un'}
                        <span className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-stoniz-gray-100 text-stoniz-gray-700">{meta.label}</span>
                      </div>
                      <div className="text-xs text-stoniz-gray-500 truncate">{m.body}</div>
                    </div>
                    <div className="text-[10px] text-stoniz-gray-500 shrink-0">{fmtDate(m.created_at)}</div>
                  </Link>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
