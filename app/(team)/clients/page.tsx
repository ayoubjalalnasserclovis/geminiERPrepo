import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser, requireRole } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { DeleteClientButton } from '@/components/clients/delete-client-button';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, range, period, search, escapeIlike as parseEscapeIlike, sort, type SP } from '@/lib/list-filters/parse';

const PAGE_SIZES = [10, 25, 50, 100] as const;
type PageSize = typeof PAGE_SIZES[number];
const DEFAULT_SIZE: PageSize = 25;

function parseSize(raw: string | undefined): PageSize {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : DEFAULT_SIZE;
}

function parsePage(raw: string | undefined): number {
  const n = Math.max(1, Math.floor(Number(raw) || 1));
  return isFinite(n) ? n : 1;
}

/** Escape % et _ pour qu'ils ne soient pas interprétés comme wildcards ILIKE. */
function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, m => '\\' + m);
}

const PORTAL_OPTIONS = [
  { v: 'active', label: 'Actif (a un compte)' },
  { v: 'not_invited', label: 'Non invité' },
];
const SORT_FIELDS: Record<string, string> = {
  name: 'full_name',
  created_at: 'created_at',
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  await requireRole(['ceo','chef_projet','developer','commercial','finance','marketing','assistante']);
  const supabase = createClient();
  const me = await getSessionUser();
  const isCeo = me?.role === 'ceo';

  // ─── Parse filtres ─────────────────────────────────────────────────────
  const q = search(searchParams);
  const nationalities = multi(searchParams, 'nationality');
  const portal = single(searchParams, 'portal');
  const budgetR = range(searchParams, 'budget');
  const createdP = period(searchParams, 'created_period');
  const { field: sortField, dir: sortDir } = sort(searchParams, 'created_at', 'desc');
  const dbSortField = SORT_FIELDS[sortField] ?? 'created_at';

  const size = parseSize(single(searchParams, 'size') ?? undefined);
  const page = parsePage(single(searchParams, 'page') ?? undefined);
  const from = (page - 1) * size;
  const to = from + size - 1;

  // Options dynamiques : nationalités présentes
  const { data: natsRow } = await supabase
    .from('clients').select('nationality').is('deleted_at', null).not('nationality', 'is', null);
  const nationalityOptions = Array.from(new Set((natsRow ?? []).map((r: any) => r.nationality).filter(Boolean)))
    .sort().map(n => ({ v: n as string, label: n as string }));

  // Query principale
  let query = supabase
    .from('clients')
    .select('id, full_name, email, nationality, budget_min, budget_max, profile_id, created_at', { count: 'exact' })
    .is('deleted_at', null);

  if (q) {
    const safe = parseEscapeIlike(q);
    query = query.or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`);
  }
  if (nationalities.length) query = query.in('nationality', nationalities);
  if (portal === 'active') query = query.not('profile_id', 'is', null);
  else if (portal === 'not_invited') query = query.is('profile_id', null);
  if (budgetR.min != null) query = query.gte('budget_min', budgetR.min);
  if (budgetR.max != null) query = query.lte('budget_max', budgetR.max);
  if (createdP.from) query = query.gte('created_at', createdP.from);

  const { data: clients, count } = await query
    .order(dbSortField, { ascending: sortDir === 'asc' })
    .range(from, to);

  const { count: totalCount } = await supabase
    .from('clients').select('id', { count: 'exact', head: true }).is('deleted_at', null);

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(page, totalPages);
  const firstShown = total === 0 ? 0 : from + 1;
  const lastShown = Math.min(total, from + (clients?.length ?? 0));

  // Helper pour générer une URL avec params ajustés
  function urlFor(overrides: Partial<{ q: string; page: number; size: PageSize }>) {
    const params = new URLSearchParams();
    const nextQ = overrides.q !== undefined ? overrides.q : q;
    const nextPage = overrides.page !== undefined ? overrides.page : page;
    const nextSize = overrides.size !== undefined ? overrides.size : size;
    if (nextQ) params.set('q', nextQ);
    if (nextPage > 1) params.set('page', String(nextPage));
    if (nextSize !== DEFAULT_SIZE) params.set('size', String(nextSize));
    const s = params.toString();
    return s ? `/clients?${s}` : '/clients';
  }

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Gérez vos investisseurs et leurs cahiers des charges"
        action={<Link href="/clients/new"><Button>+ Nouveau client</Button></Link>}
      />

      <ListToolbar
        moduleKey="clients"
        filters={[
          { kind: 'multi',  key: 'nationality',    label: 'Nationalité', options: nationalityOptions },
          { kind: 'single', key: 'portal',         label: 'Portail',     options: PORTAL_OPTIONS },
          { kind: 'range',  key: 'budget',         label: 'Budget',      unit: '€', step: 10000 },
          { kind: 'period', key: 'created_period', label: 'Période création' },
        ] as FilterDef[]}
        searchHint="Rechercher (nom ou email)…   ⌘K"
        count={{ filtered: total, total: totalCount ?? 0 }}
      />

      <div className="flex items-center justify-end gap-2 text-sm text-stoniz-gray-600 mb-3">
        <span>Par page :</span>
        {PAGE_SIZES.map(s => (
          <Link
            key={s}
            href={urlFor({ size: s, page: 1 })}
            className={`px-2 py-1 rounded-md border ${
              s === size
                ? 'bg-stoniz-black text-white border-stoniz-black'
                : 'border-grey-line hover:bg-cream-soft'
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {!clients || clients.length === 0 ? (
        q ? (
          <EmptyState
            title={`Aucun client ne correspond à « ${q} »`}
            description="Essaie un autre mot-clé ou efface le filtre."
            action={<Link href={urlFor({ q: '', page: 1 })}><Button>Effacer le filtre</Button></Link>}
          />
        ) : (
          <EmptyState
            title="Aucun client pour le moment"
            description="Commencez par créer votre premier investisseur"
            action={<Link href="/clients/new"><Button>+ Créer un client</Button></Link>}
          />
        )
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <SortableHeader field="name">Nom</SortableHeader>
                <TH>Email</TH>
                <TH>Nationalité</TH>
                <TH>Budget</TH>
                <TH>Portail</TH>
                <SortableHeader field="created_at">Créé le</SortableHeader>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {clients.map(c => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.full_name}</TD>
                  <TD className="text-stoniz-gray-600">{c.email}</TD>
                  <TD>{c.nationality ?? '—'}</TD>
                  <TD>
                    {c.budget_min && c.budget_max
                      ? <span><Money amount={c.budget_min} /> — <Money amount={c.budget_max} /></span>
                      : '—'}
                  </TD>
                  <TD>
                    {c.profile_id
                      ? <Badge variant="success">Actif</Badge>
                      : <Badge>Non invité</Badge>}
                  </TD>
                  <TD className="text-xs text-stoniz-gray-500 whitespace-nowrap">
                    {c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR') : '—'}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2 justify-end">
                      <Link href={`/clients/${c.id}`} className="text-stoniz-black underline text-sm">
                        Voir
                      </Link>
                      {isCeo && (
                        <DeleteClientButton clientId={c.id} clientName={c.full_name} />
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 mt-4 flex-wrap">
              <div className="text-sm text-stoniz-gray-600">
                Page {safePage} sur {totalPages}
              </div>
              <div className="flex items-center gap-1">
                {safePage > 1 && (
                  <Link
                    href={urlFor({ page: safePage - 1 })}
                    className="px-3 py-1.5 rounded-md border border-grey-line hover:bg-cream-soft text-sm"
                  >
                    ← Précédent
                  </Link>
                )}

                {/* Numéros de pages : on affiche au max 7 entrées avec ellipses */}
                {paginationRange(safePage, totalPages).map((p, i) =>
                  p === '…' ? (
                    <span key={`gap-${i}`} className="px-2 text-stoniz-gray-400">…</span>
                  ) : (
                    <Link
                      key={p}
                      href={urlFor({ page: p })}
                      className={`px-3 py-1.5 rounded-md text-sm border ${
                        p === safePage
                          ? 'bg-stoniz-black text-white border-stoniz-black'
                          : 'border-grey-line hover:bg-cream-soft'
                      }`}
                    >
                      {p}
                    </Link>
                  )
                )}

                {safePage < totalPages && (
                  <Link
                    href={urlFor({ page: safePage + 1 })}
                    className="px-3 py-1.5 rounded-md border border-grey-line hover:bg-cream-soft text-sm"
                  >
                    Suivant →
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Génère une plage de pages compacte : 1 … current-1 current current+1 … last */
function paginationRange(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const range: Array<number | '…'> = [1];
  if (current > 3) range.push('…');
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    range.push(p);
  }
  if (current < total - 2) range.push('…');
  range.push(total);
  return range;
}
