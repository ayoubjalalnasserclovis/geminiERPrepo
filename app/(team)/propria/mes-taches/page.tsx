import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';

const URG_LABELS: Record<string, string> = {
  critique: '🔴 Critique', haute: '🟠 Haute', normale: '🟡 Normale', basse: '🟢 Basse',
};
const STATUS_META: Record<string, { label: string; badge: string; cta: string }> = {
  a_traiter: { label: 'À faire',     badge: 'bg-stoniz-gray-100 text-stoniz-gray-800', cta: 'Démarrer' },
  refusee:   { label: 'À refaire',   badge: 'bg-red-100 text-red-800',                 cta: 'Reprendre' },
  en_cours:  { label: 'En cours',    badge: 'bg-blue-100 text-blue-800',               cta: 'Déposer la preuve' },
  a_valider: { label: 'En validation', badge: 'bg-amber-100 text-amber-800',           cta: 'Voir' },
};

// Tâches que le terrain doit voir : tout sauf validé / annulé.
const ACTIVE = ['a_traiter', 'refusee', 'en_cours', 'a_valider'];

export default async function MesTachesPage() {
  const user = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const [intsRes, propsRes, unitsRes] = await Promise.all([
    supabase
      .from('propria_interventions_enriched')
      .select(`
        id, property_id, propria_unit_id, type_label, intervention_type_id, description, urgency, status,
        due_date, is_overdue, refusal_reason
      `)
      .eq('assigned_to_id', user.id)
      .in('status', ACTIVE)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(300),
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null),
    supabase.from('propria_units').select('id, code, order_index, property_id')
      .is('deleted_at', null).eq('is_active', true),
  ]);

  const props = new Map((propsRes.data ?? []).map((p: any) => [p.id, p]));
  const unitsMap = new Map((unitsRes.data ?? []).map((u: any) => [u.id, { label: u.code ?? `Suite ${u.order_index}`, property_id: u.property_id }]));
  const rows = (intsRes.data ?? []) as any[];

  // À traiter en priorité : à refaire + à faire + en cours d'abord, validation ensuite.
  const todo = rows.filter(r => r.status !== 'a_valider');
  const waiting = rows.filter(r => r.status === 'a_valider');

  function Card({ r }: { r: any }) {
    const unit = r.propria_unit_id ? (unitsMap.get(r.propria_unit_id) as any) : null;
    const bienId = unit ? unit.property_id : r.property_id;
    const bien = bienId ? (props.get(bienId) as any) : null;
    const bienCode = bien ? (bien.propria_internal_code ?? bien.name) : 'Bien';
    const scopeText = unit ? `${bienCode} · ${unit.label}` : (bien ? `${bienCode} · Bien entier` : 'Bien');
    const meta = STATUS_META[r.status] ?? { label: r.status, badge: 'bg-stoniz-gray-100', cta: 'Ouvrir' };
    return (
      <Link
        href={`/propria/interventions/${r.id}`}
        className="block bg-white border border-stoniz-gray-200 rounded-xl p-4 hover:border-stoniz-gray-400 transition-colors"
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="text-sm font-medium">{scopeText}</div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${meta.badge}`}>{meta.label}</span>
        </div>
        <p className="text-sm text-stoniz-gray-800">{r.description}</p>
        {r.status === 'refusee' && r.refusal_reason && (
          <p className="mt-1 text-xs text-red-700">Motif : {r.refusal_reason}</p>
        )}
        <div className="flex items-center justify-between mt-3 text-xs">
          <span className="text-stoniz-gray-600">{URG_LABELS[r.urgency] ?? r.urgency}</span>
          <span className={r.is_overdue ? 'text-red-700 font-medium' : 'text-stoniz-gray-600'}>
            {r.due_date ? `Échéance ${new Date(r.due_date).toLocaleDateString('fr-FR')}` : 'Sans échéance'}
          </span>
        </div>
        <div className="mt-3 text-center bg-stoniz-black text-white rounded-md py-2 text-sm">
          {meta.cta} →
        </div>
      </Link>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Terrain
        </div>
        <h1 className="text-3xl font-display">Mes tâches</h1>
        <p className="text-sm text-stoniz-gray-600 mt-1">
          {todo.length} à faire · {waiting.length} en attente de validation
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-10 text-center text-stoniz-gray-500 text-sm">
          Aucune tâche assignée pour le moment. 🎉
        </div>
      ) : (
        <div className="space-y-6">
          {todo.length > 0 && (
            <div className="space-y-3">
              {todo.map(r => <Card key={r.id} r={r} />)}
            </div>
          )}
          {waiting.length > 0 && (
            <div>
              <h2 className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">En attente de validation</h2>
              <div className="space-y-3 opacity-80">
                {waiting.map(r => <Card key={r.id} r={r} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
