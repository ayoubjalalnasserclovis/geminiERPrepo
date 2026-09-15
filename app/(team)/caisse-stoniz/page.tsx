import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { createStonizWalletAction } from './actions';
import { Wallet, TrendingDown, TrendingUp, FolderKanban } from 'lucide-react';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, range, search, sort, period as periodParse, type SP } from '@/lib/list-filters/parse';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';
import { EditExpenseModal } from '@/components/caisse-stoniz/edit-expense-modal';
import { DeleteExpenseButton } from '@/components/caisse-stoniz/delete-expense-button';
import { RestoreExpenseButton } from '@/components/caisse-stoniz/restore-expense-button';

function fmt(n: number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n)) + ' DH';
}
function fmtDate(d: any): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR');
}

const STATUS_OPTIONS = [
  { v: 'active', label: 'Active' },
  { v: 'closed', label: 'Clôturée' },
];

const SORT_FIELDS: Record<string, string> = {
  created_at: 'created_at',
  closed_at:  'closed_at',
  label:      'label',
};

const EXPENSE_TYPE_OPTIONS = [
  { v: 'achat',   label: '🛒 Achat' },
  { v: 'travaux', label: '🔨 Travaux' },
  { v: 'autre',   label: '· Autre' },
];

const EXPENSE_TYPE_LABEL: Record<string, string> = {
  achat: '🛒 Achat',
  travaux: '🔨 Travaux',
  autre: '· Autre',
};

// Tri colonnes section dépenses
const EXP_SORT_FIELDS: Record<string, (a: any, b: any) => number> = {
  spent_at:    (a, b) => String(a.spent_at).localeCompare(String(b.spent_at)),
  amount_mad:  (a, b) => Number(a.amount_mad ?? 0) - Number(b.amount_mad ?? 0),
  category:    (a, b) => String(a.category ?? '').localeCompare(String(b.category ?? '')),
};

// Composant serveur : lien de tri pour la table dépenses (utilise exp_sort / exp_dir
// pour ne pas entrer en collision avec le tri SortableHeader de la 1re table).
function ExpSortLink({
  field, current, dir, sp, children,
}: {
  field: string;
  current: string;
  dir: string;
  sp: SP;
  children: React.ReactNode;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp as Record<string, any>)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val != null && val !== '') params.set(k, String(val));
  }
  const isActive = current === field;
  let nextDir: 'asc' | 'desc' | null = 'desc';
  if (isActive) {
    if (dir === 'desc') nextDir = 'asc';
    else nextDir = null;
  }
  if (nextDir === null) {
    params.delete('exp_sort');
    params.delete('exp_dir');
  } else {
    params.set('exp_sort', field);
    params.set('exp_dir', nextDir);
  }
  const arrow = !isActive ? '↕' : (dir === 'asc' ? '↑' : '↓');
  return (
    <a
      href={`/caisse-stoniz?${params.toString()}`}
      className={`inline-flex items-center gap-1 hover:text-stoniz-black transition-colors ${
        isActive ? 'text-stoniz-black font-semibold' : 'text-stoniz-gray-600'
      }`}
    >
      {children}
      <span className="text-[10px]">{arrow}</span>
    </a>
  );
}

export default async function CaisseStonizListPage({ searchParams }: { searchParams: SP }) {
  const user = await requireRole(['ceo','chef_projet','developer','finance','assistante','achats','sourcing']);
  const isCeo = user.role === 'ceo';
  const supabase = createClient();

  // ─── Parse filtres (wallets — préfixe 'w_' pour éviter collision avec ceux de la liste dépenses)
  const q = search(searchParams);
  const statuses = multi(searchParams, 'status');
  const profileId = single(searchParams, 'profile');
  const soldeR = range(searchParams, 'solde');
  const { field: sortField, dir: sortDir } = sort(searchParams, 'created_at', 'desc');
  const dbSortField = SORT_FIELDS[sortField] ?? 'created_at';

  // ─── Parse filtres (section dépenses)
  const expType        = single(searchParams, 'exp_type');
  const expCategories  = multi(searchParams, 'exp_cat');
  const expResponsable = multi(searchParams, 'exp_resp');
  const expPeriod      = periodParse(searchParams, 'exp_period');
  const expSortField   = single(searchParams, 'exp_sort') ?? 'spent_at';
  const expSortDir     = single(searchParams, 'exp_dir') ?? 'desc';
  const showDeleted    = single(searchParams, 'exp_deleted') === '1';

  // ─── Options dynamiques + données globales ─────────────────────────────
  const [walletsRes, balancesRes, profRes, plRes] = await Promise.all([
    supabase.from('stoniz_wallets')
      .select('id, profile_id, label, is_active, closed_at, created_at')
      .order(dbSortField, { ascending: sortDir === 'asc' }),
    supabase.from('stoniz_wallet_balances').select('*'),
    // Collaborateurs uniquement (jamais de client)
    supabase.from('profiles').select('id, full_name, role')
      .eq('is_active', true).neq('role', 'client').order('full_name'),
    // P&L cash par projet
    supabase.from('stoniz_project_cash_pl').select('*'),
  ]);

  const balances = new Map((balancesRes.data ?? []).map((b: any) => [b.wallet_id, b]));
  const profs = (profRes.data ?? []) as any[];
  const profMap = new Map(profs.map(p => [p.id, p]));
  let wallets = (walletsRes.data ?? []) as any[];

  // Filtrage application (la table profiles est jointe en mémoire, donc on filtre côté serveur)
  if (statuses.length) {
    const wantActive = statuses.includes('active');
    const wantClosed = statuses.includes('closed');
    wallets = wallets.filter(w => (wantActive && w.is_active) || (wantClosed && !w.is_active));
  }
  if (profileId) wallets = wallets.filter(w => w.profile_id === profileId);
  if (q) {
    const needle = q.toLowerCase();
    wallets = wallets.filter(w => {
      const label = (w.label ?? '').toLowerCase();
      const collab = ((profMap.get(w.profile_id) as any)?.full_name ?? '').toLowerCase();
      return label.includes(needle) || collab.includes(needle);
    });
  }
  if (soldeR.min != null || soldeR.max != null) {
    wallets = wallets.filter(w => {
      const b = balances.get(w.id) as any;
      const solde = Number(b?.solde_mad ?? 0);
      if (soldeR.min != null && solde < soldeR.min) return false;
      if (soldeR.max != null && solde > soldeR.max) return false;
      return true;
    });
  }

  const totalCount = (walletsRes.data ?? []).length;

  // KPIs globaux (calculés sur ce qui est affiché)
  const totals = wallets.reduce((acc, w) => {
    const b = balances.get(w.id) as any;
    return {
      solde: acc.solde + Number(b?.solde_mad ?? 0),
      depenses: acc.depenses + Number(b?.total_expenses ?? 0),
      validees: acc.validees + Number(b?.total_validated ?? 0),
      non_validees: acc.non_validees + Number(b?.total_unvalidated ?? 0),
    };
  }, { solde: 0, depenses: 0, validees: 0, non_validees: 0 });

  // P&L par projet (top 5 plus dépensés)
  const projectPl = ((plRes.data ?? []) as any[])
    .map(p => ({ ...p, total: Number(p.cash_total_mad ?? 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Charge les références projets pour les afficher dans la liste P&L
  const projectIds = projectPl.map(p => p.project_id).filter(Boolean);
  const { data: projects } = projectIds.length
    ? await supabase.from('projects').select('id, reference, code, client:clients(full_name)').in('id', projectIds)
    : { data: [] };
  const projectRefMap = new Map((projects ?? []).map((p: any) => {
    const clientName = p.client?.full_name ?? '—';
    const label = p.code ? `${p.code} · ${clientName}` : `${clientName} (${p.reference})`;
    return [p.id, label];
  }));

  const filters: FilterDef[] = [
    { kind: 'multi',  key: 'status',  label: 'Statut', options: STATUS_OPTIONS },
    {
      kind: 'single',
      key: 'profile',
      label: 'Collaborateur',
      options: profs.map(p => ({ v: p.id as string, label: `${p.full_name} (${p.role})` })),
    },
    { kind: 'range', key: 'solde', label: 'Solde', unit: 'DH', step: 100 },
  ];

  // ─── Section "Toutes les dépenses" ────────────────────────────────────
  // Fetch toutes les expenses (cachées les supprimées sauf showDeleted=1 CEO)
  let expQuery = supabase
    .from('stoniz_wallet_expenses')
    .select('id, wallet_id, spent_at, project_id, expense_type, category, description, amount_mad, receipt_path, is_validated, created_by, created_at, deleted_at')
    .order('spent_at', { ascending: false })
    .limit(500);

  if (!(showDeleted && isCeo)) {
    expQuery = expQuery.is('deleted_at', null);
  }

  const { data: expensesRaw } = await expQuery;
  let expenses = (expensesRaw ?? []) as any[];

  // Catégories distinctes (pour le filtre + le modal)
  const distinctCategories = Array.from(new Set(
    expenses.map((e) => (e.category ?? '').trim()).filter(Boolean) as string[]
  )).sort();

  // Responsables distincts (created_by qui ont au moins une dépense)
  const responsableIds = Array.from(new Set(
    expenses.map((e) => e.created_by).filter(Boolean) as string[]
  ));

  // Application des filtres section dépenses
  if (expType) expenses = expenses.filter(e => e.expense_type === expType);
  if (expCategories.length) expenses = expenses.filter(e => expCategories.includes(e.category ?? ''));
  if (expResponsable.length) expenses = expenses.filter(e => expResponsable.includes(e.created_by));
  if (expPeriod.from) expenses = expenses.filter(e => String(e.spent_at) >= expPeriod.from!);
  if (expPeriod.to)   expenses = expenses.filter(e => String(e.spent_at) <= expPeriod.to!);

  // Tri section dépenses
  const cmp = EXP_SORT_FIELDS[expSortField] ?? EXP_SORT_FIELDS.spent_at;
  expenses = [...expenses].sort((a, b) => {
    const r = cmp(a, b);
    return expSortDir === 'asc' ? r : -r;
  });

  // Map wallet_id → profile_id + label pour affichage colonne "Caisse"
  const walletMap = new Map((walletsRes.data ?? []).map((w: any) => [w.id, w]));

  const expensesTotalCount = (expensesRaw ?? []).length;

  // Filtres section dépenses
  const expenseFilters: FilterDef[] = [
    {
      kind: 'single',
      key: 'exp_type',
      label: 'Type',
      options: EXPENSE_TYPE_OPTIONS,
    },
    {
      kind: 'multi',
      key: 'exp_cat',
      label: 'Catégorie',
      options: distinctCategories.map((c) => ({ v: c, label: c })),
    },
    {
      kind: 'multi',
      key: 'exp_resp',
      label: 'Responsable',
      options: responsableIds.map((id) => ({
        v: id,
        label: (profMap.get(id) as any)?.full_name ?? id.slice(0, 8),
      })),
    },
    { kind: 'period', key: 'exp_period', label: 'Période' },
  ];

  return (
    <div className="max-w-7xl">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-display">Caisse STONIZ</h1>
          <p className="text-sm text-stoniz-gray-600 mt-2">
            Cash distribué pour les <strong>projets clients</strong> (achats + travaux).
            Distinct de la caisse Propria (conciergerie).
          </p>
        </div>
        {isCeo && (
          <Link
            href="/admin/caisse-stoniz-historique"
            className="text-xs text-stoniz-gray-600 hover:text-stoniz-black border border-stoniz-gray-300 rounded px-3 py-1.5"
          >
            📜 Historique global (admin)
          </Link>
        )}
      </div>

      {/* ─── KPIs globaux ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <Wallet className="w-4 h-4 text-emerald-500 mb-2" />
          <div className="text-2xl font-display">{fmt(totals.solde)}</div>
          <div className="text-xs text-stoniz-gray-600">Solde total caisses</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <TrendingDown className="w-4 h-4 text-orange-500 mb-2" />
          <div className="text-2xl font-display">{fmt(totals.non_validees)}</div>
          <div className="text-xs text-stoniz-gray-600">Dépenses non justifiées</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <TrendingUp className="w-4 h-4 text-blue-500 mb-2" />
          <div className="text-2xl font-display">{fmt(totals.validees)}</div>
          <div className="text-xs text-stoniz-gray-600">Total justifié à date</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <FolderKanban className="w-4 h-4 text-stoniz-gray-500 mb-2" />
          <div className="text-2xl font-display">{fmt(totals.depenses)}</div>
          <div className="text-xs text-stoniz-gray-600">Total cash distribué</div>
        </div>
      </div>

      {/* ─── P&L cash par projet ──────────────────────────────────────── */}
      {projectPl.length > 0 && (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
          <h2 className="text-sm uppercase tracking-wider text-stoniz-gray-600 mb-3">
            💰 Cash distribué par projet (top 5)
          </h2>
          <table className="w-full text-sm">
            <thead className="text-xs text-stoniz-gray-500">
              <tr>
                <th className="text-left py-1">Projet</th>
                <th className="text-right py-1">Achat</th>
                <th className="text-right py-1">Travaux</th>
                <th className="text-right py-1">Autre</th>
                <th className="text-right py-1">Total</th>
                <th className="text-right py-1">Justifié</th>
              </tr>
            </thead>
            <tbody>
              {projectPl.map(p => (
                <tr key={p.project_id} className="border-t border-stoniz-gray-100">
                  <td className="py-2 font-mono text-xs">
                    {projectRefMap.get(p.project_id) ?? '—'}
                  </td>
                  <td className="py-2 text-right text-xs">{fmt(p.cash_achat_mad)}</td>
                  <td className="py-2 text-right text-xs">{fmt(p.cash_travaux_mad)}</td>
                  <td className="py-2 text-right text-xs text-stoniz-gray-500">{fmt(p.cash_autre_mad)}</td>
                  <td className="py-2 text-right font-medium">{fmt(p.cash_total_mad)}</td>
                  <td className="py-2 text-right text-xs text-emerald-700">{fmt(p.cash_total_validated_mad)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Nouvelle caisse ──────────────────────────────────────────── */}
      <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
        <summary className="cursor-pointer font-medium">+ Ouvrir une nouvelle caisse STONIZ</summary>
        <form action={createStonizWalletAction} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-stoniz-gray-600">Collaborateur *</label>
            <select
              name="profile_id"
              required
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="">— Sélectionner —</option>
              {profs.map(p => (
                <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Label (optionnel)</label>
            <input
              name="label"
              placeholder="ex: Caisse achats chantier"
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button className="w-full bg-stoniz-black text-white py-2 rounded text-sm hover:bg-stoniz-gray-800">
              Créer la caisse
            </button>
          </div>
        </form>
      </details>

      <ListToolbar
        moduleKey="caisse-stoniz"
        filters={filters}
        searchHint="Rechercher (label, collaborateur)… ⌘K"
        count={{ filtered: wallets.length, total: totalCount }}
      />

      {/* ─── Liste des caisses ────────────────────────────────────────── */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-4 py-3 text-left">Collaborateur</th>
              <SortableHeader field="label" className="px-4 py-3 text-left">Label</SortableHeader>
              <th className="px-4 py-3 text-right">Dotations</th>
              <th className="px-4 py-3 text-right">Dépenses</th>
              <th className="px-4 py-3 text-right">Justifié</th>
              <th className="px-4 py-3 text-right">Solde</th>
              <th className="px-4 py-3 text-center">Statut</th>
              <SortableHeader field="created_at" className="px-4 py-3 text-right">Ouvert le</SortableHeader>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {wallets.map(w => {
              const b = balances.get(w.id) as any;
              const prof = profMap.get(w.profile_id) as any;
              const solde = Number(b?.solde_mad ?? 0);
              return (
                <tr key={w.id} className={`hover:bg-stoniz-gray-50 ${!w.is_active ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 font-medium">{prof?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-stoniz-gray-600">{w.label ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-xs">{fmt(b?.total_dotations)}</td>
                  <td className="px-4 py-3 text-right text-xs">{fmt(b?.total_expenses)}</td>
                  <td className="px-4 py-3 text-right text-xs">{fmt(b?.total_validated)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${solde < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {fmt(solde)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {w.is_active ? (
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">Active</span>
                    ) : (
                      <span className="text-[10px] bg-stoniz-gray-200 text-stoniz-gray-700 px-2 py-0.5 rounded-full">Clôturée</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-stoniz-gray-500">
                    {w.created_at ? new Date(w.created_at).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/caisse-stoniz/${w.id}`} className="text-xs hover:underline">
                      Détail →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {wallets.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-stoniz-gray-500 text-sm">
                Aucune caisse STONIZ ne correspond aux filtres.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Section "Toutes les dépenses" ──────────────────────────────── */}
      {/* Construction du toggle "Afficher supprimées" (CEO only) */}
      <div className="mt-10 mb-3 flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-display text-xl">Toutes les dépenses</h2>
        {isCeo && (() => {
          const params = new URLSearchParams();
          for (const [k, v] of Object.entries(searchParams as Record<string, any>)) {
            const val = Array.isArray(v) ? v[0] : v;
            if (val != null && val !== '' && k !== 'exp_deleted') params.set(k, String(val));
          }
          if (!showDeleted) params.set('exp_deleted', '1');
          return (
            <Link
              href={`/caisse-stoniz?${params.toString()}`}
              className={`text-[11px] px-2 py-1 rounded-full border ${
                showDeleted
                  ? 'bg-stoniz-black text-white border-stoniz-black'
                  : 'border-stoniz-gray-300 hover:bg-stoniz-gray-50'
              }`}
            >
              {showDeleted ? '🗑 Affiche supprimées' : 'Afficher supprimées'}
            </Link>
          );
        })()}
      </div>

      <ListToolbar
        moduleKey="caisse-stoniz-expenses"
        filters={expenseFilters}
        searchHint="(la recherche se fait sur les caisses, pas les dépenses)"
        count={{ filtered: expenses.length, total: expensesTotalCount }}
      />

      {/* Tri custom via ExpSortLink (collision interdite avec sort/dir de la 1re table) */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">
                <ExpSortLink field="spent_at" current={expSortField} dir={expSortDir} sp={searchParams}>
                  Date
                </ExpSortLink>
              </th>
              <th className="px-3 py-2 text-left">Caisse</th>
              <th className="px-3 py-2 text-center">Type</th>
              <th className="px-3 py-2 text-left">
                <ExpSortLink field="category" current={expSortField} dir={expSortDir} sp={searchParams}>
                  Catégorie
                </ExpSortLink>
              </th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">
                <ExpSortLink field="amount_mad" current={expSortField} dir={expSortDir} sp={searchParams}>
                  Montant
                </ExpSortLink>
              </th>
              <th className="px-3 py-2 text-center">PJ</th>
              <th className="px-3 py-2 text-left">Responsable</th>
              <th className="px-3 py-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {expenses.map((e) => {
              const wallet = walletMap.get(e.wallet_id) as any;
              const walletProf = wallet ? (profMap.get(wallet.profile_id) as any) : null;
              const creator = e.created_by ? (profMap.get(e.created_by) as any) : null;
              const canEdit = isCeo || (user.id && e.created_by === user.id);
              const isDeleted = !!e.deleted_at;
              return (
                <tr
                  key={e.id}
                  className={`${isDeleted ? 'opacity-50 line-through' : e.is_validated ? 'bg-emerald-50/30' : ''}`}
                >
                  <td className="px-3 py-2 text-xs">{fmtDate(e.spent_at)}</td>
                  <td className="px-3 py-2 text-xs">
                    <Link
                      href={`/caisse-stoniz/${e.wallet_id}`}
                      className="hover:underline text-stoniz-gray-700"
                    >
                      {walletProf?.full_name ?? wallet?.label ?? '—'}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {EXPENSE_TYPE_LABEL[e.expense_type] ?? e.expense_type}
                  </td>
                  <td className="px-3 py-2 text-xs">{e.category ?? '—'}</td>
                  <td className="px-3 py-2 text-xs max-w-xs truncate" title={e.description}>
                    {e.description}
                  </td>
                  <td className="px-3 py-2 text-right">{fmt(e.amount_mad)}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    {e.receipt_path ? (
                      <a
                        href={`/api/caisse-stoniz/expense-receipt?path=${encodeURIComponent(e.receipt_path)}`}
                        target="_blank"
                        rel="noopener"
                        className="text-blue-600 hover:underline"
                      >
                        📎
                      </a>
                    ) : (
                      <span className="text-orange-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {creator?.full_name ?? <span className="text-stoniz-gray-400 italic">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex items-center gap-2">
                      {canEdit && !isDeleted && (
                        <EditExpenseModal
                          expense={{
                            id: e.id,
                            amount_mad: e.amount_mad,
                            description: e.description,
                            category: e.category,
                          }}
                          categories={distinctCategories}
                        />
                      )}
                      {canEdit && !isDeleted && (
                        <DeleteExpenseButton
                          expenseId={e.id}
                          label={e.description ?? ''}
                        />
                      )}
                      {/* CEO 2026-06-22 : bouton Restaurer quand la dépense est
                          soft-deletée et que le toggle "Afficher supprimées"
                          est actif. CEO uniquement (server action garde le check). */}
                      {isCeo && isDeleted && (
                        <RestoreExpenseButton
                          expenseId={e.id}
                          label={e.description ?? ''}
                        />
                      )}
                      <FinanceAuditButton
                        table="stoniz_wallet_expenses"
                        recordId={e.id}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                  Aucune dépense ne correspond aux filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
