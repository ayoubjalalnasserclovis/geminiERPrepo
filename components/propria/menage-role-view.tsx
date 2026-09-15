import Link from 'next/link';
import { Play, CheckCircle2, Clock, AlertCircle, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/require';

/**
 * Vue simplifiée mobile-first pour le rôle `menage` (CEO 2026-06-10).
 *
 * Affiche uniquement les ménages :
 *   - assignés à la dame de ménage connectée (`assigned_to_id = me.id`)
 *   - encore actifs (a_traiter / en_cours / a_valider / refusee)
 *
 * Groupés en 3 sections : Aujourd'hui · Demain · À venir.
 * Sur chaque carte : gros bouton « Démarrer » ou « Continuer » qui ouvre
 * la fiche détail du ménage.
 *
 * UI mobile-first : cartes pleine largeur, gros boutons, infos essentielles.
 */

const URGENCY_BADGE: Record<string, { label: string; color: string }> = {
  critique: { label: '🔴 Critique', color: 'bg-red-100 text-red-800 border-red-300' },
  haute:    { label: '🟠 Haute',    color: 'bg-orange-100 text-orange-800 border-orange-300' },
  normale:  { label: '🟡 Normale',  color: 'bg-amber-50 text-amber-700 border-amber-200' },
  basse:    { label: '🟢 Basse',    color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  a_traiter: { label: 'À faire',     color: 'bg-stoniz-gray-100 text-stoniz-gray-800' },
  en_cours:  { label: 'En cours',    color: 'bg-blue-100 text-blue-800' },
  a_valider: { label: 'À valider',   color: 'bg-amber-100 text-amber-800' },
  refusee:   { label: 'Refusé',      color: 'bg-red-100 text-red-800' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' });
}

export async function MenageRoleView() {
  const me = await getSessionUser();
  if (!me) return null;
  const supabase = createClient();

  // Charge les ménages assignés à moi, actifs uniquement
  const [cleaningsRes, typesRes, unitsRes, propsRes] = await Promise.all([
    supabase
      .from('propria_cleanings')
      .select(`
        id, property_id, propria_unit_id, cleaning_type_id, description,
        occurred_at, due_date, urgency, status, started_at
      `)
      .eq('assigned_to_id', me.id)
      .in('status', ['a_traiter', 'en_cours', 'a_valider', 'refusee'])
      .is('deleted_at', null)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('occurred_at', { ascending: true }),
    supabase.from('propria_cleaning_types').select('id, name').eq('is_active', true),
    supabase.from('propria_units').select('id, code, property_id'),
    supabase.from('properties').select('id, name, propria_internal_code, address'),
  ]);

  const cleanings = (cleaningsRes.data ?? []) as any[];
  const typesMap = new Map((typesRes.data ?? []).map((t: any) => [t.id, t.name]));
  const unitsMap = new Map((unitsRes.data ?? []).map((u: any) => [u.id, u]));
  const propsMap = new Map((propsRes.data ?? []).map((p: any) => [p.id, p]));

  // Groupage par échéance
  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrowIso = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const groups: { key: 'today' | 'tomorrow' | 'later'; label: string; items: any[] }[] = [
    { key: 'today',    label: "📍 Aujourd'hui", items: [] },
    { key: 'tomorrow', label: '☀ Demain',       items: [] },
    { key: 'later',    label: '📅 À venir',     items: [] },
  ];

  for (const c of cleanings) {
    const date = c.due_date ?? c.occurred_at;
    if (date === todayIso || c.status === 'en_cours' || c.status === 'refusee') {
      groups[0].items.push(c);
    } else if (date === tomorrowIso) {
      groups[1].items.push(c);
    } else {
      groups[2].items.push(c);
    }
  }

  const total = cleanings.length;

  return (
    <div className="max-w-2xl mx-auto px-3 py-4 md:py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-display mb-1">🧹 Mes ménages</h1>
        <p className="text-sm text-stoniz-gray-600">
          Bonjour {me.full_name?.split(' ')[0] ?? 'à toi'} · {total} ménage{total > 1 ? 's' : ''} à faire
        </p>
      </div>

      {total === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
          <div className="text-emerald-900 font-medium">Aucun ménage à faire pour le moment</div>
          <p className="text-sm text-emerald-700 mt-1">Reviens plus tard pour voir tes nouvelles assignations.</p>
        </div>
      )}

      {groups.map((group) => {
        if (group.items.length === 0) return null;
        return (
          <div key={group.key} className="mb-6">
            <h2 className="text-sm font-medium text-stoniz-gray-700 uppercase tracking-wide mb-2">
              {group.label} <span className="text-stoniz-gray-400">({group.items.length})</span>
            </h2>
            <div className="space-y-3">
              {group.items.map((c) => {
                const unit = c.propria_unit_id ? unitsMap.get(c.propria_unit_id) as any : null;
                const prop = unit?.property_id ? propsMap.get(unit.property_id) as any
                              : c.property_id ? propsMap.get(c.property_id) as any : null;
                const type = typesMap.get(c.cleaning_type_id) ?? 'Ménage';
                const scope = unit ? `${prop?.name ?? '?'} · ${unit.code}` : prop?.name ?? '—';
                const urgencyBadge = URGENCY_BADGE[c.urgency] ?? URGENCY_BADGE.normale;
                const statusBadge = STATUS_BADGE[c.status] ?? STATUS_BADGE.a_traiter;
                const inProgress = !!c.started_at && c.status === 'en_cours';
                const isRefused = c.status === 'refusee';
                return (
                  <Link
                    key={c.id}
                    href={`/propria/menage/${c.id}`}
                    className={`block bg-white border-2 rounded-xl p-4 hover:border-stoniz-black transition-colors ${
                      isRefused ? 'border-red-300' : inProgress ? 'border-blue-300' : 'border-stoniz-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-base truncate">{scope}</div>
                        {prop?.address && (
                          <div className="text-xs text-stoniz-gray-500 truncate">{prop.address}</div>
                        )}
                      </div>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${statusBadge.color}`}>
                        {statusBadge.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap mb-3 text-xs">
                      <span className="bg-stoniz-gray-100 text-stoniz-gray-800 px-2 py-0.5 rounded">
                        {type}
                      </span>
                      {c.urgency && c.urgency !== 'normale' && (
                        <span className={`px-2 py-0.5 border rounded ${urgencyBadge.color}`}>
                          {urgencyBadge.label}
                        </span>
                      )}
                      {c.due_date && (
                        <span className="inline-flex items-center gap-1 text-stoniz-gray-600">
                          <Clock className="w-3 h-3" /> {fmtDate(c.due_date)}
                        </span>
                      )}
                    </div>

                    {c.description && (
                      <p className="text-sm text-stoniz-gray-700 mb-3 line-clamp-2">{c.description}</p>
                    )}

                    {isRefused && (
                      <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-800 mb-3 flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                        Ce ménage a été refusé. Refais-le et soumets à nouveau.
                      </div>
                    )}

                    <div className={`flex items-center justify-center gap-2 font-medium py-3 rounded-lg ${
                      inProgress
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : isRefused
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'bg-stoniz-black text-white hover:bg-stoniz-gray-800'
                    }`}>
                      <Play className="w-4 h-4" />
                      <span>
                        {inProgress ? 'Continuer le ménage' : isRefused ? 'Refaire le ménage' : 'Démarrer le ménage'}
                      </span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Footer aide */}
      <div className="mt-8 text-center text-xs text-stoniz-gray-500">
        Besoin d'aide ? Contacte ton responsable Propria.
      </div>
    </div>
  );
}
