import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PreparationTable } from './preparation-table';
import { MailWarning } from 'lucide-react';

export const dynamic = 'force-dynamic';

type SearchParams = {
  phase?: string;
  email_status?: string;
};

export default async function PreparationListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole(['ceo', 'developer']);
  const supabase = createClient();

  // Fetch tous les projets en préparation (ou legacy_imported) avec leurs relations
  let query = supabase
    .from('projects')
    .select(`
      id, code, reference, current_phase, status, is_preparation, legacy_imported,
      activated_at, created_at, notion_page_id,
      client:clients(id, full_name, email, phone),
      property:properties(id, name, quartier)
    `)
    .eq('is_preparation', true)
    .is('deleted_at', null)
    .order('current_phase', { ascending: true })
    .order('created_at', { ascending: false });

  if (searchParams.phase) {
    query = query.eq('current_phase', searchParams.phase);
  }

  const { data: projects } = await query;
  const allRows = (projects ?? []) as any[];

  // Compte les gates sautées par projet
  const projectIds = allRows.map(p => p.id);
  const { data: bypasses } = projectIds.length
    ? await supabase
        .from('project_phase_bypass_log')
        .select('project_id, gates_skipped')
        .in('project_id', projectIds)
    : { data: [] };
  const bypassCount = new Map<string, number>();
  for (const b of (bypasses ?? []) as any[]) {
    const cur = bypassCount.get(b.project_id) ?? 0;
    bypassCount.set(b.project_id, cur + (Array.isArray(b.gates_skipped) ? b.gates_skipped.length : 0));
  }

  // Enrichit les rows avec stats supplémentaires
  const rows = allRows.map(r => {
    const clientEmail: string = r.client?.email ?? '';
    const isPlaceholder = clientEmail.endsWith('@no-email.stoniz.local');
    return {
      ...r,
      _is_placeholder_email: isPlaceholder,
      _bypass_count: bypassCount.get(r.id) ?? 0,
    };
  });

  // Filtre côté serveur sur l'email (post-fetch parce que c'est dérivé)
  const filteredRows = searchParams.email_status === 'placeholder'
    ? rows.filter(r => r._is_placeholder_email)
    : searchParams.email_status === 'real'
      ? rows.filter(r => !r._is_placeholder_email)
      : rows;

  // KPIs pour les badges
  const totalPrep = rows.length;
  const placeholderCount = rows.filter(r => r._is_placeholder_email).length;
  const phaseCounts = new Map<string, number>();
  for (const r of rows) {
    phaseCounts.set(r.current_phase, (phaseCounts.get(r.current_phase) ?? 0) + 1);
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">Admin</div>
        <h1 className="text-3xl font-display">Préparation des espaces clients</h1>
        <p className="text-sm text-stoniz-gray-600 mt-2 max-w-3xl">
          Tous les projets en mode silencieux. Aucune notification ne part tant qu'un projet est marqué
          <code className="mx-1 px-1.5 py-0.5 bg-stoniz-beige rounded text-xs">is_preparation = true</code>.
          Active un client en cliquant sur "Activer" — ça crée son compte auth, lui envoie l'email d'invitation,
          et bascule le projet en mode normal.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Projets en prep</div>
          <div className="text-2xl font-display mt-1">{totalPrep}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Email placeholder</div>
          <div className={`text-2xl font-display mt-1 ${placeholderCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {placeholderCount}
          </div>
          {placeholderCount > 0 && (
            <Link href="?email_status=placeholder" className="text-[11px] text-amber-700 underline mt-1 inline-block">
              Voir uniquement
            </Link>
          )}
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Onboarding/Sourcing</div>
          <div className="text-2xl font-display mt-1">
            {(phaseCounts.get('onboarding') ?? 0) + (phaseCounts.get('sourcing') ?? 0)}
          </div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">En cours (design/travaux)</div>
          <div className="text-2xl font-display mt-1">
            {(phaseCounts.get('design') ?? 0) + (phaseCounts.get('travaux') ?? 0)}
          </div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Livraison/Termine</div>
          <div className="text-2xl font-display mt-1">
            {(phaseCounts.get('livraison') ?? 0) + (phaseCounts.get('mise_en_location') ?? 0) + (phaseCounts.get('termine') ?? 0)}
          </div>
        </div>
      </div>

      {/* Filtres chips */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <Link
          href="/admin/preparation"
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            !searchParams.phase && !searchParams.email_status
              ? 'bg-stoniz-black text-white border-stoniz-black'
              : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:border-stoniz-black'
          }`}
        >
          Tous ({totalPrep})
        </Link>
        <Link
          href="?email_status=placeholder"
          className={`text-xs px-3 py-1.5 rounded-full border transition flex items-center gap-1 ${
            searchParams.email_status === 'placeholder'
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:border-amber-500'
          }`}
        >
          <MailWarning className="w-3 h-3" />
          Email placeholder ({placeholderCount})
        </Link>
        {['onboarding','sourcing','design','travaux','livraison','termine'].map(ph => {
          const n = phaseCounts.get(ph) ?? 0;
          if (n === 0) return null;
          return (
            <Link
              key={ph}
              href={`?phase=${ph}`}
              className={`text-xs px-3 py-1.5 rounded-full border transition capitalize ${
                searchParams.phase === ph
                  ? 'bg-stoniz-black text-white border-stoniz-black'
                  : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:border-stoniz-black'
              }`}
            >
              {ph} ({n})
            </Link>
          );
        })}
      </div>

      {/* Table */}
      <PreparationTable rows={filteredRows} />
    </div>
  );
}
