import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { createWalletAction } from './actions';
import { Wallet, TrendingDown, TrendingUp } from 'lucide-react';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, range, period, search, sort, type SP } from '@/lib/list-filters/parse';

function fmt(n: number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n)) + ' DH';
}

const STATUS_OPTIONS = [
  { v: 'active', label: 'Active' },
  { v: 'closed', label: 'Clôturée' },
];

export default async function CaisseListPage({
  searchParams,
}: { searchParams: SP }) {
  await requireRole(['ceo','developer','finance','assistante','propria']);
  const supabase = createClient();

  const [walletsRes, balancesRes, profRes] = await Promise.all([
    supabase.from('propria_wallets')
      .select('id, profile_id, label, opened_at, is_active, closed_at, notes')
      .order('opened_at', { ascending: false }),
    supabase.from('propria_wallet_balances').select('*'),
    supabase.from('profiles')
      .select('id, full_name, role')
      .eq('is_active', true)
      .in('role', ['ceo','chef_projet','finance','assistante','propria'])
      .order('full_name'),
  ]);

  const balances = new Map((balancesRes.data ?? []).map((b: any) => [b.wallet_id, b]));
  const profs = (profRes.data ?? []) as any[];
  const profMap = new Map(profs.map(p => [p.id, p]));

  const allWallets = (walletsRes.data ?? []) as any[];

  // ─── Parse toolbar ─────────────────────────────────────────────────────
  const q = search(searchParams);
  const collaborator = single(searchParams, 'collaborator');
  const statuses = multi(searchParams, 'status');
  const soldeRange = range(searchParams, 'solde');
  const { field: sortField, dir: sortDir } = sort(searchParams, 'opened_at', 'desc');

  // Filtrage côté serveur en mémoire (peu de wallets)
  let wallets = allWallets;
  if (collaborator) wallets = wallets.filter(w => w.profile_id === collaborator);
  if (statuses.length) {
    wallets = wallets.filter(w => {
      const isActive = w.is_active;
      return (statuses.includes('active') && isActive) || (statuses.includes('closed') && !isActive);
    });
  }
  if (q) {
    const needle = q.toLowerCase();
    wallets = wallets.filter(w => {
      const label = (w.label ?? '').toLowerCase();
      const notes = (w.notes ?? '').toLowerCase();
      const prof = profMap.get(w.profile_id) as any;
      const name = (prof?.full_name ?? '').toLowerCase();
      return label.includes(needle) || notes.includes(needle) || name.includes(needle);
    });
  }
  if (soldeRange.min != null) {
    wallets = wallets.filter(w => {
      const b = balances.get(w.id) as any;
      return Number(b?.solde_mad ?? 0) >= soldeRange.min!;
    });
  }
  if (soldeRange.max != null) {
    wallets = wallets.filter(w => {
      const b = balances.get(w.id) as any;
      return Number(b?.solde_mad ?? 0) <= soldeRange.max!;
    });
  }

  // Tri
  wallets = [...wallets].sort((a, b) => {
    let av: any;
    let bv: any;
    if (sortField === 'solde') {
      av = Number((balances.get(a.id) as any)?.solde_mad ?? 0);
      bv = Number((balances.get(b.id) as any)?.solde_mad ?? 0);
    } else if (sortField === 'opened_at') {
      av = a.opened_at ?? '';
      bv = b.opened_at ?? '';
    } else if (sortField === 'collaborator') {
      av = ((profMap.get(a.profile_id) as any)?.full_name ?? '').toLowerCase();
      bv = ((profMap.get(b.profile_id) as any)?.full_name ?? '').toLowerCase();
    } else {
      av = a[sortField] ?? '';
      bv = b[sortField] ?? '';
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totals = wallets.reduce((acc, w) => {
    const b = balances.get(w.id) as any;
    return {
      solde: acc.solde + Number(b?.solde_mad ?? 0),
      depenses: acc.depenses + Number(b?.total_expenses ?? 0),
      validees: acc.validees + Number(b?.total_validated ?? 0),
      non_validees: acc.non_validees + Number(b?.total_unvalidated ?? 0),
    };
  }, { solde: 0, depenses: 0, validees: 0, non_validees: 0 });

  // ─── Options dynamiques ─────────────────────────────────────────────
  const collaboratorOptions = profs.map(p => ({ v: p.id as string, label: p.full_name as string }));

  const filters: FilterDef[] = [
    { kind: 'single', key: 'collaborator', label: 'Collaborateur', options: collaboratorOptions },
    { kind: 'multi',  key: 'status',       label: 'Statut',        options: STATUS_OPTIONS },
    { kind: 'range',  key: 'solde',        label: 'Solde',         unit: 'DH' },
  ];

  return (
    <div className="max-w-7xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Caisses
          </div>
          <h1 className="text-2xl md:text-3xl font-display">Caisses collaborateurs</h1>
          <p className="text-sm text-stoniz-gray-600 mt-2">
            Wallets en MAD, dotations et remboursements. Solde calculé en temps réel.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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
      </div>

      {/* Nouvelle caisse */}
      <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
        <summary className="cursor-pointer font-medium">+ Ouvrir une nouvelle caisse</summary>
        <form action={async (fd) => { 'use server'; await createWalletAction(fd); }} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-stoniz-gray-600">Collaborateur *</label>
            <select
              name="profile_id"
              required
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="">— Sélectionner —</option>
              {profs.map(p => <option key={p.id} value={p.id}>{p.full_name} ({p.role})</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Label (optionnel)</label>
            <input
              name="label"
              placeholder="Caisse terrain Marrakech"
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

      {/* Toolbar unifiée */}
      <div className="mb-4">
        <ListToolbar
          moduleKey="propria-caisse"
          count={{ filtered: wallets.length, total: allWallets.length }}
          filters={filters}
          searchHint="label, collaborateur, observation"
        />
      </div>

      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-4 py-3 text-left">
                <SortableHeader field="collaborator">Collaborateur</SortableHeader>
              </th>
              <th className="px-4 py-3 text-left">Label</th>
              <th className="px-4 py-3 text-right">Dotations</th>
              <th className="px-4 py-3 text-right">Dépenses</th>
              <th className="px-4 py-3 text-right">Justifié</th>
              <th className="px-4 py-3 text-right">
                <SortableHeader field="solde">Solde</SortableHeader>
              </th>
              <th className="px-4 py-3 text-center">Statut</th>
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
                  <td className="px-4 py-3 text-right">
                    <Link href={`/propria/caisse/${w.id}`} className="text-xs hover:underline">
                      Détail →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {wallets.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-stoniz-gray-500 text-sm">
                Aucune caisse pour ces filtres.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
