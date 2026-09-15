import Link from 'next/link';
import { Stethoscope } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { computeCheckupLateness } from '@/lib/propria/checkups-auto';

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

// Badges des check-ups générés automatiquement (chantier 11.b)
const AUTO_SOURCE_BADGES: Record<string, { icon: string; label: string }> = {
  frequence: { icon: '🤖', label: 'Auto — fréquence' },
  aleatoire_bureau: { icon: '🎲', label: 'Auto — aléatoire bureau' },
  aleatoire_terrain: { icon: '🎲', label: 'Auto — aléatoire terrain' },
  logement_du_jour: { icon: '⭐', label: 'Auto — logement du jour' },
};

/**
 * Section « Check-ups » de la fiche bien Propria (chantier 11.a — MVP).
 * Derniers check-ups du bien (bien entier + tous ses lots) : date, statut,
 * nb problèmes (dérivé), liens fiche + rapport. Server Component.
 */
export async function PropriaBienCheckupsSection({ propertyId }: { propertyId: string }) {
  const supabase = createClient();

  const { data: units } = await supabase
    .from('propria_units')
    .select('id, code, order_index')
    .eq('property_id', propertyId)
    .is('deleted_at', null);
  const unitIds = ((units ?? []) as any[]).map((u) => u.id);
  const unitsMap = new Map(((units ?? []) as any[]).map((u) => [u.id, u.code ?? `Suite ${u.order_index}`]));

  const filters = [`property_id.eq.${propertyId}`];
  if (unitIds.length) filters.push(`propria_unit_id.in.(${unitIds.join(',')})`);

  const { data: checkups } = await supabase
    .from('propria_checkups')
    .select('id, propria_unit_id, status, due_date, submitted_at, validated_at, created_at, auto_source')
    .or(filters.join(','))
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5);
  const rows = (checkups ?? []) as any[];

  // Nb problèmes — dérivé à la lecture (convention n°1)
  const problemsByCheckup = new Map<string, number>();
  if (rows.length > 0) {
    const { data: items } = await supabase
      .from('propria_checkup_items')
      .select('checkup_id')
      .in('checkup_id', rows.map((r) => r.id))
      .eq('status', 'probleme')
      .is('deleted_at', null);
    for (const i of (items ?? []) as any[]) {
      problemsByCheckup.set(i.checkup_id, (problemsByCheckup.get(i.checkup_id) ?? 0) + 1);
    }
  }

  // Retard vs fréquence (U27, chantier 11.b) — dérivé à la lecture,
  // filtré sur les lots de CE bien.
  const lateness = await computeCheckupLateness(supabase);
  const lateHere = lateness.late.filter((l) => l.propertyId === propertyId);

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg inline-flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-stoniz-gray-500" /> Check-ups
        </h2>
        <div className="flex gap-2">
          <Link href="/propria/checkups/new"
            className="text-xs border border-stoniz-gray-300 px-3 py-1.5 rounded-md hover:bg-stoniz-gray-50">
            + Nouveau
          </Link>
          <Link href="/propria/checkups"
            className="text-xs text-stoniz-gray-500 hover:text-stoniz-black px-1.5 py-1.5">
            Tous →
          </Link>
        </div>
      </div>

      {lateHere.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 mb-3 text-xs text-red-900">
          ⏰ {lateHere.map((l, i) => (
            <span key={l.unitId}>
              {i > 0 && ' · '}
              <span className="font-medium">{l.label}</span> en retard de {l.daysLate} j vs fréquence {lateness.everyMonths} mois
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-stoniz-gray-500">Aucun check-up sur ce bien pour l’instant.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const nbProblems = problemsByCheckup.get(r.id) ?? 0;
            const lotLabel = r.propria_unit_id ? (unitsMap.get(r.propria_unit_id) ?? 'Lot') : 'Bien entier';
            const date = r.due_date ?? r.submitted_at ?? r.created_at;
            return (
              <div key={r.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-stoniz-gray-200 rounded-lg px-3 py-2 text-sm">
                <span className="text-xs text-stoniz-gray-600 whitespace-nowrap">
                  {new Date(date).toLocaleDateString('fr-FR')}
                </span>
                <span className="font-medium">
                  {r.auto_source && AUTO_SOURCE_BADGES[r.auto_source] && (
                    <span title={AUTO_SOURCE_BADGES[r.auto_source].label} className="mr-1 cursor-help">
                      {AUTO_SOURCE_BADGES[r.auto_source].icon}
                    </span>
                  )}
                  {lotLabel}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status] ?? ''}`}>
                  {STATUS_LABELS[r.status] ?? r.status}
                </span>
                {nbProblems > 0
                  ? <span className="text-xs text-orange-700 font-medium">⚠ {nbProblems} problème{nbProblems > 1 ? 's' : ''}</span>
                  : <span className="text-xs text-stoniz-gray-400">aucun problème</span>}
                <span className="ml-auto flex gap-3">
                  <Link href={`/propria/checkups/${r.id}`} className="text-xs hover:underline">Fiche →</Link>
                  <Link href={`/propria/checkups/${r.id}/rapport`} className="text-xs text-stoniz-gray-500 hover:underline">🖨 Rapport</Link>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
