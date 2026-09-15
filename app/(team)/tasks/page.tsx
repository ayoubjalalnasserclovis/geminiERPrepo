import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { TaskRow } from '@/components/tasks/task-row';
import { EmptyState } from '@/components/ui/empty-state';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { single, multi, search, escapeIlike as parseEscapeIlike, sort, type SP } from '@/lib/list-filters/parse';

const STATUS_OPTIONS = [
  { v: 'todo',        label: 'À faire' },
  { v: 'in_progress', label: 'En cours' },
  { v: 'done',        label: 'Fait' },
];

const PHASE_OPTIONS = [
  { v: 'sourcing',         label: 'Sourcing' },
  { v: 'onboarding',       label: 'Onboarding' },
  { v: 'design',           label: 'Design' },
  { v: 'travaux',          label: 'Travaux' },
  { v: 'livraison',        label: 'Livraison' },
  { v: 'mise_en_location', label: 'Mise en location' },
];

const PRIORITY_OPTIONS = [
  { v: 'low',    label: 'Basse' },
  { v: 'normal', label: 'Normale' },
  { v: 'medium', label: 'Moyenne' },
  { v: 'high',   label: 'Haute' },
];

const BLOCKING_OPTIONS = [
  { v: 'yes', label: 'Oui' },
  { v: 'no',  label: 'Non' },
];

const SORT_FIELDS: Record<string, string> = {
  due_date:   'due_date',
  priority:   'priority',
  created_at: 'created_at',
};

export default async function TasksPage({ searchParams }: { searchParams: SP }) {
  const user = await getSessionUser();
  if (!user) return null;
  const filter = single(searchParams, 'filter') ?? 'mine';

  const supabase = createClient();

  // ─── Parse filtres ─────────────────────────────────────────────────────
  const q = search(searchParams);
  const statuses = multi(searchParams, 'status');
  const phases = multi(searchParams, 'phase');
  const priorities = multi(searchParams, 'priority');
  const chefId = single(searchParams, 'chef');
  const blocking = single(searchParams, 'is_blocking');
  const { field: sortField, dir: sortDir } = sort(searchParams, 'due_date', 'asc');
  const dbSortField = SORT_FIELDS[sortField] ?? 'due_date';

  // ─── Options dynamiques : chefs de projet ──────────────────────────────
  const { data: chefsListRes } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'chef_projet')
    .eq('is_active', true)
    .order('full_name');
  const chefOptions = (chefsListRes ?? []).map((c: any) => ({ v: c.id, label: c.full_name }));

  // ─── Query principale ──────────────────────────────────────────────────
  let qb = supabase.from('tasks').select(`
    *, assignee:profiles!tasks_assigned_to_fkey(full_name),
    project:projects(reference)
  `, { count: 'exact' });

  if (filter === 'mine') qb = qb.eq('assigned_to', user.id);
  if (statuses.length) qb = qb.in('status', statuses);
  else qb = qb.neq('status', 'done'); // par défaut on cache les terminées
  if (phases.length) qb = qb.in('phase', phases);
  if (priorities.length) qb = qb.in('priority', priorities);
  if (chefId) qb = qb.eq('assigned_to', chefId);
  if (blocking === 'yes') qb = qb.eq('is_blocking', true);
  else if (blocking === 'no') qb = qb.eq('is_blocking', false);
  if (q) {
    const esc = parseEscapeIlike(q);
    qb = qb.or(`title.ilike.%${esc}%,description.ilike.%${esc}%`);
  }

  qb = qb.order(dbSortField, { ascending: sortDir === 'asc', nullsFirst: false });

  const { data: tasks, count } = await qb;

  // Total non filtré (toutes tâches non done par défaut)
  const { count: totalCount } = await supabase
    .from('tasks').select('id', { count: 'exact', head: true });

  const filters: FilterDef[] = [
    { kind: 'multi',  key: 'status',      label: 'Statut',   options: STATUS_OPTIONS },
    { kind: 'multi',  key: 'phase',       label: 'Phase',    options: PHASE_OPTIONS },
    { kind: 'multi',  key: 'priority',    label: 'Priorité', options: PRIORITY_OPTIONS },
    { kind: 'single', key: 'chef',        label: 'Chef',     options: chefOptions },
    { kind: 'single', key: 'is_blocking', label: 'Bloquant', options: BLOCKING_OPTIONS },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tâches"
        description={filter === 'mine' ? 'Mes tâches en cours' : 'Toutes les tâches'}
      />
      <div className="flex gap-2 text-sm">
        <a href="/tasks?filter=mine" className={`px-3 py-1 rounded-full border ${filter==='mine' ? 'bg-stoniz-black text-white' : 'bg-white'}`}>Mes tâches</a>
        <a href="/tasks?filter=all" className={`px-3 py-1 rounded-full border ${filter==='all' ? 'bg-stoniz-black text-white' : 'bg-white'}`}>Toutes</a>
      </div>

      <ListToolbar
        moduleKey="tasks"
        filters={filters}
        searchHint="Rechercher (titre, description)… ⌘K"
        count={{ filtered: count ?? 0, total: totalCount ?? 0 }}
      />

      {!tasks || tasks.length === 0 ? (
        <EmptyState title="Aucune tâche" description="Aucun résultat avec ces filtres." />
      ) : (
        <Card>
          <ul>
            {tasks.map((t: any) => (
              <li key={t.id}>
                <div className="text-xs text-stoniz-gray-500 mt-2">{t.project?.reference}</div>
                <TaskRow task={t} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
