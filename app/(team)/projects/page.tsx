import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser, requireRole } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { BookmarkButton } from '@/components/projects/bookmark-button';
import { formatDate, formatPhase } from '@/lib/utils/format';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, period, search, escapeIlike, sort, type SP } from '@/lib/list-filters/parse';

type ViewMode = 'grouped' | 'table';

const PHASE_ORDER = [
  'onboarding', 'sourcing', 'design', 'travaux',
  'livraison', 'mise_en_location', 'termine',
] as const;

const STATUS_OPTIONS = [
  { v: 'actif',   label: 'Actif' },
  { v: 'pause',   label: 'En pause' },
  { v: 'termine', label: 'Terminé' },
  { v: 'perdu',   label: 'Perdu' },
];
const PHASE_OPTIONS = [
  { v: 'onboarding',       label: 'Onboarding' },
  { v: 'sourcing',         label: 'Sourcing' },
  { v: 'design',           label: 'Design' },
  { v: 'travaux',          label: 'Travaux' },
  { v: 'livraison',        label: 'Livraison' },
  { v: 'mise_en_location', label: 'Mise en location' },
  { v: 'termine',          label: 'Terminé' },
];

const SORT_FIELDS: Record<string, string> = {
  client: 'client(full_name)',
  created_at: 'created_at',
  phase: 'current_phase',
  status: 'status',
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  await requireRole(['ceo','chef_projet','developer','commercial','finance','marketing','assistante','achats']);
  const view: ViewMode = single(searchParams, 'view') === 'table' ? 'table' : 'grouped';

  const supabase = createClient();

  // ─── Parse filtres ─────────────────────────────────────────────────────
  const qSearch = search(searchParams);
  const statuses = multi(searchParams, 'status');
  const phases = multi(searchParams, 'current_phase');
  const chefId = single(searchParams, 'chef');
  const clientId = single(searchParams, 'client');
  const sourcingP = period(searchParams, 'created_period');
  const { field: sortField, dir: sortDir } = sort(searchParams, 'created_at', 'desc');
  const dbSortField = SORT_FIELDS[sortField] ?? 'created_at';

  // Options dynamiques
  const [chefsRes, clientsRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name').eq('role', 'chef_projet').eq('is_active', true).order('full_name'),
    supabase.from('clients').select('id, full_name').is('deleted_at', null).order('full_name'),
  ]);
  const chefOptions = (chefsRes.data ?? []).map((c: any) => ({ v: c.id, label: c.full_name }));
  const clientOptions = (clientsRes.data ?? []).map((c: any) => ({ v: c.id, label: c.full_name }));

  let q = supabase
    .from('projects')
    .select(`
      id, reference, code, current_phase, status, created_at,
      travaux_budget, assigned_chef_projet, client_id,
      client:clients(full_name),
      chef:profiles!projects_assigned_chef_projet_fkey(full_name),
      property:properties(name, quartier)
    `, { count: 'exact' })
    .is('deleted_at', null)
    .order(dbSortField, { ascending: sortDir === 'asc' })
    .limit(200);

  // CEO 2026-06-18 : par défaut on masque les projets 'perdu' (pollution UX
  // — 8 projets perdus dans la base). L'utilisateur peut les afficher via
  // le filtre statut multi (qui inclut 'perdu' dans les options).
  if (statuses.length) q = q.in('status', statuses);
  else q = q.neq('status', 'perdu');
  if (phases.length) q = q.in('current_phase', phases);
  if (chefId) q = q.eq('assigned_chef_projet', chefId);
  if (clientId) q = q.eq('client_id', clientId);
  if (sourcingP.from) q = q.gte('created_at', sourcingP.from);
  if (qSearch) {
    const esc = escapeIlike(qSearch);
    q = q.or(`reference.ilike.%${esc}%,code.ilike.%${esc}%`);
  }
  const { data: projects, count } = await q;

  // Total non filtré pour compteur
  const { count: totalCount } = await supabase
    .from('projects').select('id', { count: 'exact', head: true }).is('deleted_at', null);

  // QA-BUG-007 : honoraires = source unique project_honoraires_totals
  // (la colonne legacy stoniz_fees_final divergeait sur 49 projets / 55).
  const projectIds = (projects ?? []).map((p: any) => p.id);
  const { data: honoraires } = projectIds.length
    ? await supabase.from('project_honoraires_totals')
        .select('project_id, honoraires_expected')
        .in('project_id', projectIds)
    : { data: [] as any[] };
  const honorairesMap = new Map((honoraires ?? []).map((h: any) => [h.project_id, Number(h.honoraires_expected)]));

  // Récupère les bookmarks de l'utilisateur courant
  const me = await getSessionUser();
  const { data: bookmarks } = me ? await supabase
    .from('project_bookmarks')
    .select('project_id')
    .eq('user_id', me.id) : { data: [] };
  const bookmarkedIds = new Set((bookmarks ?? []).map((b: any) => b.project_id));

  // Tri : favoris d'abord, puis ordre original (par created_at desc déjà appliqué)
  const sortedProjects = [...(projects ?? [])].sort((a: any, b: any) => {
    const aBm = bookmarkedIds.has(a.id) ? 0 : 1;
    const bBm = bookmarkedIds.has(b.id) ? 0 : 1;
    return aBm - bBm;
  });

  // Groupage par phase
  const byPhase = new Map<string, any[]>();
  PHASE_ORDER.forEach(p => byPhase.set(p, []));
  sortedProjects.forEach((p: any) => {
    const arr = byPhase.get(p.current_phase) ?? [];
    arr.push(p);
    byPhase.set(p.current_phase, arr);
  });

  return (
    <div>
      <PageHeader
        title="Projets"
        description="Tous les projets Clé en Main"
        action={<Link href="/projects/new"><Button>+ Nouveau projet</Button></Link>}
      />

      <ListToolbar
        moduleKey="projects"
        filters={[
          { kind: 'multi',  key: 'status',         label: 'Statut', options: STATUS_OPTIONS },
          { kind: 'multi',  key: 'current_phase',  label: 'Phase',  options: PHASE_OPTIONS },
          { kind: 'single', key: 'chef',           label: 'Chef',   options: chefOptions },
          { kind: 'single', key: 'client',         label: 'Client', options: clientOptions },
          { kind: 'period', key: 'created_period', label: 'Période création' },
        ] as FilterDef[]}
        searchHint="Rechercher (code, référence)…   ⌘K"
        count={{ filtered: count ?? 0, total: totalCount ?? 0 }}
      />

      <div className="flex justify-end mb-4">
        <div className="flex gap-1 border rounded-md p-0.5 bg-white">
          <Link
            href={`/projects?${new URLSearchParams({ ...flattenSP(searchParams), view: 'grouped' }).toString()}`}
            className={`text-sm px-3 py-1 rounded ${view === 'grouped' ? 'bg-stoniz-black text-white' : 'text-stoniz-gray-600'}`}>
            Par phase
          </Link>
          <Link
            href={`/projects?${new URLSearchParams({ ...flattenSP(searchParams), view: 'table' }).toString()}`}
            className={`text-sm px-3 py-1 rounded ${view === 'table' ? 'bg-stoniz-black text-white' : 'text-stoniz-gray-600'}`}>
            Tableau
          </Link>
        </div>
      </div>

      {!projects || projects.length === 0 ? (
        <EmptyState
          title="Aucun projet"
          description="Créez votre premier projet pour démarrer"
          action={<Link href="/projects/new"><Button>+ Créer</Button></Link>}
        />
      ) : view === 'grouped' ? (
        <div className="space-y-6">
          {PHASE_ORDER.map(phase => {
            const items = byPhase.get(phase) ?? [];
            if (items.length === 0) return null;
            return (
              <section key={phase}>
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant={phase as any}>{formatPhase(phase)}</Badge>
                  <span className="text-sm text-stoniz-gray-500">
                    {items.length} projet{items.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((p: any) => (
                    <Link key={p.id} href={`/projects/${p.id}`}>
                      <Card className={`hover:border-stoniz-black transition-colors cursor-pointer h-full ${
                        bookmarkedIds.has(p.id) ? 'border-yellow-300 bg-yellow-50/30' : ''
                      }`}>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0 flex items-start gap-2">
                            <BookmarkButton projectId={p.id} isBookmarked={bookmarkedIds.has(p.id)} size={16} />
                            <div className="min-w-0">
                              <div className="font-medium truncate">{p.client?.full_name ?? '—'}</div>
                              <div className="text-xs text-stoniz-gray-500">{p.code ?? p.reference}</div>
                            </div>
                          </div>
                          <Badge variant={p.status === 'actif' ? 'success' : p.status === 'perdu' ? 'error' : 'default'}>
                            {p.status}
                          </Badge>
                        </div>
                        {p.property && (
                          <div className="text-sm text-stoniz-gray-600 mb-2 truncate">
                            🏠 {p.property.name} {p.property.quartier && `· ${p.property.quartier}`}
                          </div>
                        )}
                        <div className="text-xs text-stoniz-gray-500 flex items-center justify-between mt-3 pt-3 border-t">
                          <span>Chef : {p.chef?.full_name ?? '—'}</span>
                          <span><Money amount={honorairesMap.get(p.id) ?? 0} /></span>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-stoniz-gray-500 border-b bg-stoniz-gray-50">
              <tr>
                <th className="text-left py-2 px-3">Code</th>
                <SortableHeader field="client" className="text-left py-2 px-3">Client</SortableHeader>
                <th className="text-left py-2 px-3">Bien</th>
                <th className="text-left py-2 px-3">Chef de projet</th>
                <SortableHeader field="phase" className="text-left py-2 px-3">Phase</SortableHeader>
                <SortableHeader field="status" className="text-left py-2 px-3">Statut</SortableHeader>
                <th className="text-left py-2 px-3">Honoraires</th>
                <SortableHeader field="created_at" className="text-left py-2 px-3">Créé le</SortableHeader>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {projects.map((p: any) => (
                <tr key={p.id} className="hover:bg-stoniz-gray-50">
                  <td className="py-2 px-3 text-xs">{p.code ?? p.reference}</td>
                  <td className="py-2 px-3">{p.client?.full_name}</td>
                  <td className="py-2 px-3 text-stoniz-gray-600">{p.property?.name ?? '—'}</td>
                  <td className="py-2 px-3">{p.chef?.full_name ?? '—'}</td>
                  <td className="py-2 px-3"><Badge variant={p.current_phase}>{formatPhase(p.current_phase)}</Badge></td>
                  <td className="py-2 px-3"><Badge variant={p.status === 'actif' ? 'success' : 'default'}>{p.status}</Badge></td>
                  <td className="py-2 px-3"><Money amount={honorairesMap.get(p.id) ?? 0} /></td>
                  <td className="py-2 px-3 text-stoniz-gray-500 text-xs">{formatDate(p.created_at)}</td>
                  <td className="py-2 px-3"><Link href={`/projects/${p.id}`} className="underline text-xs">Ouvrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function flattenSP(sp: SP): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    out[k] = Array.isArray(v) ? (v[0] ?? '') : v;
  }
  return out;
}
