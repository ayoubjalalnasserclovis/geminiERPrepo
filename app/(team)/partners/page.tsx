import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { requireRole } from '@/lib/auth/require';
import { PartnerRowDeleteButton } from './row-delete-button';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, period, search, escapeIlike as parseEscapeIlike, sort, type SP } from '@/lib/list-filters/parse';
import { computePartnersCompletude } from '@/lib/completude/partenaires-completude';
import { CompletudeBanner } from '@/components/completude/completude-banner';

const PAGE_SIZES = [10, 25, 50, 100] as const;
type PageSize = typeof PAGE_SIZES[number];
const DEFAULT_SIZE: PageSize = 25;

// Statuts standard pour les partenaires (chips de filtre)
const PARTNER_STATUSES = ['actif', 'prospect', 'inactif'] as const;
const PARTNER_STATUS_LABELS: Record<string, string> = {
  actif: 'Actif',
  prospect: 'Prospect',
  inactif: 'Inactif',
};

function parseSize(raw: string | undefined): PageSize {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : DEFAULT_SIZE;
}
function parsePage(raw: string | undefined): number {
  const n = Math.max(1, Math.floor(Number(raw) || 1));
  return isFinite(n) ? n : 1;
}
function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, m => '\\' + m);
}

const SORT_FIELDS: Record<string, string> = {
  agency_name: 'agency_name',
  created_at: 'created_at',
  last_contact_at: 'last_contact_at',
  evaluation: 'evaluation',
};

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const user = await requireRole(['ceo','chef_projet','developer','sourcing','commercial','assistante']);
  const canDelete = user.role === 'ceo' || user.role === 'chef_projet';
  const supabase = createClient();

  const q = search(searchParams);
  const statuses = multi(searchParams, 'status');
  const contactPeriod = period(searchParams, 'contact_period');
  const { field: sortField, dir: sortDir } = sort(searchParams, 'created_at', 'desc');
  const dbSortField = SORT_FIELDS[sortField] ?? 'created_at';

  const size = parseSize(single(searchParams, 'size') ?? undefined);
  const page = parsePage(single(searchParams, 'page') ?? undefined);
  const from = (page - 1) * size;
  const to = from + size - 1;

  let query = supabase
    .from('partners')
    .select('id, agency_name, contact_name, phone, status, evaluation, last_contact_at, created_at, quartiers_covered', { count: 'exact' })
    .is('deleted_at', null);

  if (statuses.length) query = query.in('status', statuses);
  if (q) {
    const safe = parseEscapeIlike(q);
    query = query.or(`agency_name.ilike.%${safe}%,contact_name.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }
  if (contactPeriod.from) query = query.gte('last_contact_at', contactPeriod.from);

  const { data: partners, count } = await query
    .order(dbSortField, { ascending: sortDir === 'asc' })
    .range(from, to);

  const { count: totalCount } = await supabase
    .from('partners').select('id', { count: 'exact', head: true }).is('deleted_at', null);

  // ─── Bandeau complétude (B3) ──────────────────────────────────────────
  // Try/catch défensif : un crash du helper ne doit pas casser la liste.
  let completudeStats: {
    total: number; red: number; orange: number; avgScore: number; withoutPartnerType: number;
  } | null = null;
  try {
    const { stats } = await computePartnersCompletude({ partnerType: 'all' });
    completudeStats = {
      total: stats.total,
      red: stats.red,
      orange: stats.orange,
      avgScore: stats.avgScoreWeighted,
      withoutPartnerType: stats.withoutPartnerType,
    };
  } catch (e) {
    completudeStats = null;
  }

  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(page, totalPages);
  const firstShown = total === 0 ? 0 : from + 1;
  const lastShown = Math.min(total, from + (partners?.length ?? 0));

  function urlFor(overrides: Partial<{ page: number; size: PageSize }>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v == null || k === 'page' || k === 'size') continue;
      params.set(k, Array.isArray(v) ? (v[0] ?? '') : v);
    }
    const nextPage = overrides.page !== undefined ? overrides.page : page;
    const nextSize = overrides.size !== undefined ? overrides.size : size;
    if (nextPage > 1) params.set('page', String(nextPage));
    if (nextSize !== DEFAULT_SIZE) params.set('size', String(nextSize));
    const s = params.toString();
    return s ? `/partners?${s}` : '/partners';
  }

  return (
    <div>
      <PageHeader
        title="Partenaires"
        description="Agences immobilières et agents sourceurs"
        action={<Link href="/partners/new"><Button>+ Nouveau partenaire</Button></Link>}
      />

      {/* Bandeau complétude (B3) — invisible si rien à signaler */}
      {completudeStats && completudeStats.total > 0 && (
        (completudeStats.red + completudeStats.orange) > 0 || completudeStats.withoutPartnerType > 0
      ) && (
        <CompletudeBanner
          title="Complétude des partenaires"
          total={completudeStats.total}
          red={completudeStats.red}
          orange={completudeStats.orange}
          avgScore={completudeStats.avgScore}
          ctaLabel="Voir le détail"
          ctaHref="/admin/completude?tab=partenaires"
          subtitle={
            completudeStats.withoutPartnerType > 0
              ? `${completudeStats.withoutPartnerType} partenaire${completudeStats.withoutPartnerType > 1 ? 's' : ''} sans type — à classer en priorité`
              : undefined
          }
        />
      )}

      <ListToolbar
        moduleKey="partners"
        filters={[
          { kind: 'multi', key: 'status', label: 'Statut', options: PARTNER_STATUSES.map(s => ({ v: s, label: PARTNER_STATUS_LABELS[s] })) },
          { kind: 'period', key: 'contact_period', label: 'Dernier contact' },
        ] as FilterDef[]}
        searchHint="Rechercher (agence, contact, téléphone)… ⌘K"
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

      {!partners || partners.length === 0 ? (
        <EmptyState
          title="Aucun résultat"
          description="Essaie d'autres critères ou ajoute un partenaire."
          action={<Link href="/partners/new"><Button>+ Créer</Button></Link>}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <SortableHeader field="agency_name">Agence</SortableHeader>
                <TH>Contact</TH>
                <TH>Téléphone</TH>
                <TH>Statut</TH>
                <SortableHeader field="evaluation">Évaluation</SortableHeader>
                <SortableHeader field="last_contact_at">Dernier contact</SortableHeader>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {partners.map(p => (
                <TR key={p.id}>
                  <TD className="font-medium">{p.agency_name}</TD>
                  <TD>{p.contact_name ?? '—'}</TD>
                  <TD>{p.phone ?? '—'}</TD>
                  <TD><Badge variant={p.status === 'actif' ? 'success' : 'default'}>{PARTNER_STATUS_LABELS[p.status] ?? p.status}</Badge></TD>
                  <TD>{p.evaluation ? '⭐'.repeat(p.evaluation) : '—'}</TD>
                  <TD className="text-xs text-stoniz-gray-500">{p.last_contact_at ? new Date(p.last_contact_at).toLocaleDateString('fr-FR') : '—'}</TD>
                  <TD>
                    <div className="flex items-center gap-1 justify-end">
                      <Link href={`/partners/${p.id}`} className="underline text-sm">Voir</Link>
                      {canDelete && (
                        <PartnerRowDeleteButton partnerId={p.id} partnerName={p.agency_name} />
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
