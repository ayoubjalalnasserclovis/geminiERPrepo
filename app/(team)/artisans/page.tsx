import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  ARTISAN_TYPE_LABELS,
  ARTISAN_SPECIALITIES,
  ARTISAN_STATUSES,
  ARTISAN_CATEGORIES,
} from '@/lib/finance/artisans-constants';
import { requireRole } from '@/lib/auth/require';
import { ArtisanRowDeleteButton } from './row-delete-button';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, search, escapeIlike as parseEscapeIlike, sort, type SP } from '@/lib/list-filters/parse';
import { computeArtisansCompletude } from '@/lib/completude/artisans-completude';
import { CompletudeBanner } from '@/components/completude/completude-banner';

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

const SORT_FIELDS: Record<string, string> = {
  name: 'name',
  created_at: 'created_at',
};

export default async function ArtisansPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const user = await requireRole(['ceo','chef_projet','developer','finance','assistante','achats']);
  const canDelete = user.role === 'ceo' || user.role === 'chef_projet';
  const supabase = createClient();

  // ─── Parse filtres ─────────────────────────────────────────────────────
  const q = search(searchParams);
  const specialities = multi(searchParams, 'speciality');
  const statuses = multi(searchParams, 'status');
  const catKey = single(searchParams, 'cat');
  const typesInCat = catKey && ARTISAN_CATEGORIES[catKey] ? ARTISAN_CATEGORIES[catKey].types : undefined;
  const { field: sortField, dir: sortDir } = sort(searchParams, 'name', 'asc');
  const dbSortField = SORT_FIELDS[sortField] ?? 'name';

  const size = parseSize(single(searchParams, 'size') ?? undefined);
  const page = parsePage(single(searchParams, 'page') ?? undefined);
  const from = (page - 1) * size;
  const to = from + size - 1;

  let query = supabase
    .from('artisans')
    .select(
      'id, name, type, speciality, status, evaluation, contact_name, phone, email, city, nb_lots_total, ca_total_mad',
      { count: 'exact' }
    )
    .is('deleted_at', null);

  if (statuses.length) query = query.in('status', statuses);
  if (specialities.length) query = query.in('speciality', specialities);
  if (typesInCat) query = query.in('type', typesInCat);
  if (q.length > 0) {
    const safe = parseEscapeIlike(q);
    query = query.or(`name.ilike.%${safe}%,contact_name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const { data: artisans, count } = await query
    .order(dbSortField, { ascending: sortDir === 'asc' })
    .range(from, to);

  // Total non filtré pour le compteur global
  const { count: totalCount } = await supabase
    .from('artisans').select('id', { count: 'exact', head: true }).is('deleted_at', null);

  // ─── Bandeau complétude (B3) ──────────────────────────────────────────
  // On compute en mode pondéré pour avoir red/orange/avgScoreWeighted.
  // Try/catch défensif : un crash du helper ne doit pas casser la liste.
  let completudeStats: { total: number; red: number; orange: number; avgScore: number } | null = null;
  try {
    const { stats } = await computeArtisansCompletude({ mode: 'weighted', businessScope: 'all' });
    completudeStats = {
      total: stats.total,
      red: stats.red,
      orange: stats.orange,
      avgScore: stats.avgScoreWeighted,
    };
  } catch (e) {
    // silencieux : pas de bandeau plutôt que crash de /artisans
    completudeStats = null;
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(page, totalPages);
  const firstShown = total === 0 ? 0 : from + 1;
  const lastShown = Math.min(total, from + (artisans?.length ?? 0));

  function urlFor(overrides: Partial<{ page: number; size: PageSize; cat: string }>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v == null || k === 'page' || k === 'size') continue;
      if (overrides.cat !== undefined && k === 'cat') continue;
      params.set(k, Array.isArray(v) ? (v[0] ?? '') : v);
    }
    if (overrides.cat !== undefined && overrides.cat) params.set('cat', overrides.cat);
    const nextPage = overrides.page !== undefined ? overrides.page : page;
    const nextSize = overrides.size !== undefined ? overrides.size : size;
    if (nextPage > 1) params.set('page', String(nextPage));
    if (nextSize !== DEFAULT_SIZE) params.set('size', String(nextSize));
    const s = params.toString();
    return s ? `/artisans?${s}` : '/artisans';
  }

  const filters: FilterDef[] = [
    {
      kind: 'multi',
      key: 'speciality',
      label: 'Spécialité',
      options: Object.entries(ARTISAN_SPECIALITIES).map(([v, label]) => ({ v, label })),
    },
    {
      kind: 'multi',
      key: 'status',
      label: 'Statut',
      options: Object.entries(ARTISAN_STATUSES).map(([v, label]) => ({ v, label })),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Artisans, entreprises et fournisseurs"
        description="Base de données des sociétés et prestataires"
        action={<Link href="/artisans/new"><Button>+ Nouveau</Button></Link>}
      />

      {/* Bandeau complétude (B3) — au-dessus de la toolbar, invisible si rien à signaler */}
      {completudeStats && completudeStats.total > 0 && (completudeStats.red + completudeStats.orange) > 0 && (
        <CompletudeBanner
          title="Complétude des artisans"
          total={completudeStats.total}
          red={completudeStats.red}
          orange={completudeStats.orange}
          avgScore={completudeStats.avgScore}
          ctaLabel="Voir le détail"
          ctaHref="/admin/completude?tab=artisans"
        />
      )}

      {/* Chips de filtre catégorie (groupements métier, conservés en plus de la toolbar) */}
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <span className="text-xs uppercase text-stoniz-gray-500 mr-1">Catégorie :</span>
        <Link
          href={urlFor({ cat: '', page: 1 })}
          className={`text-sm px-3 py-1 rounded-full border ${
            !catKey ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white border-grey-line hover:bg-cream-soft'
          }`}
        >
          Tous
        </Link>
        {Object.entries(ARTISAN_CATEGORIES).map(([key, c]) => (
          <Link
            key={key}
            href={urlFor({ cat: key, page: 1 })}
            className={`text-sm px-3 py-1 rounded-full border ${
              catKey === key ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white border-grey-line hover:bg-cream-soft'
            }`}
          >
            {c.label}
          </Link>
        ))}
      </div>

      <ListToolbar
        moduleKey="artisans"
        filters={filters}
        searchHint="Rechercher (nom, contact, téléphone, email)… ⌘K"
        count={{ filtered: total, total: totalCount ?? 0 }}
      />

      <div className="flex items-center justify-end gap-2 text-sm text-stoniz-gray-600 mb-3">
        <span>Par page :</span>
        {PAGE_SIZES.map(s => (
          <Link key={s} href={urlFor({ size: s, page: 1 })} className={`px-2 py-1 rounded-md border ${
            s === size ? 'bg-stoniz-black text-white border-stoniz-black' : 'border-grey-line hover:bg-cream-soft'
          }`}>{s}</Link>
        ))}
      </div>

      {!artisans || artisans.length === 0 ? (
        <EmptyState
          title="Aucun résultat"
          description="Essaie d'autres critères ou ajoute un prestataire."
          action={<Link href="/artisans/new"><Button>+ Créer</Button></Link>}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <SortableHeader field="name">Nom</SortableHeader>
                <TH>Type</TH>
                <TH>Spécialité</TH>
                <TH>Contact</TH>
                <TH>Ville</TH>
                <TH className="text-right">Lots</TH>
                <TH className="text-right">CA total (MAD)</TH>
                <TH>Statut</TH>
                <TH>Éval.</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {artisans.map((a: any) => (
                <TR key={a.id}>
                  <TD className="font-medium">{a.name}</TD>
                  <TD className="text-sm">{ARTISAN_TYPE_LABELS[a.type] ?? a.type}</TD>
                  <TD className="text-sm">
                    {a.speciality ? ARTISAN_SPECIALITIES[a.speciality] ?? a.speciality : '—'}
                  </TD>
                  <TD className="text-sm">
                    {a.contact_name ? <div>{a.contact_name}</div> : null}
                    {a.phone ? <div className="text-xs text-stoniz-gray-500">{a.phone}</div> : null}
                    {!a.contact_name && !a.phone && '—'}
                  </TD>
                  <TD className="text-sm">{a.city ?? '—'}</TD>
                  <TD className="text-right">{a.nb_lots_total ?? 0}</TD>
                  <TD className="text-right">
                    {a.ca_total_mad ? new Intl.NumberFormat('fr-FR').format(Math.round(a.ca_total_mad)) : '—'}
                  </TD>
                  <TD>
                    <Badge variant={
                      a.status === 'actif' ? 'success' :
                      a.status === 'blacklist' ? 'error' :
                      a.status === 'prospect' ? 'warning' : 'default'
                    }>{ARTISAN_STATUSES[a.status]}</Badge>
                  </TD>
                  <TD>{a.evaluation ? '⭐'.repeat(a.evaluation) : '—'}</TD>
                  <TD>
                    <div className="flex items-center gap-1 justify-end">
                      <Link href={`/artisans/${a.id}`} className="underline text-sm">Voir</Link>
                      {canDelete && (
                        <ArtisanRowDeleteButton artisanId={a.id} artisanName={a.name} />
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 mt-4 flex-wrap">
              <div className="text-sm text-stoniz-gray-600">Page {safePage} sur {totalPages}</div>
              <div className="flex items-center gap-1">
                {safePage > 1 && (
                  <Link href={urlFor({ page: safePage - 1 })} className="px-3 py-1.5 rounded-md border border-grey-line hover:bg-cream-soft text-sm">
                    ← Précédent
                  </Link>
                )}
                {paginationRange(safePage, totalPages).map((p, i) =>
                  p === '…' ? (
                    <span key={`gap-${i}`} className="px-2 text-stoniz-gray-400">…</span>
                  ) : (
                    <Link
                      key={p}
                      href={urlFor({ page: p })}
                      className={`px-3 py-1.5 rounded-md text-sm border ${
                        p === safePage ? 'bg-stoniz-black text-white border-stoniz-black' : 'border-grey-line hover:bg-cream-soft'
                      }`}
                    >
                      {p}
                    </Link>
                  )
                )}
                {safePage < totalPages && (
                  <Link href={urlFor({ page: safePage + 1 })} className="px-3 py-1.5 rounded-md border border-grey-line hover:bg-cream-soft text-sm">
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

function paginationRange(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const range: Array<number | '…'> = [1];
  if (current > 3) range.push('…');
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) range.push(p);
  if (current < total - 2) range.push('…');
  range.push(total);
  return range;
}
