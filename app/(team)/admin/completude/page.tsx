import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import {
  computeProjectCompleteness,
} from '@/lib/completude/projets-completude';
import { computeArtisansCompletude } from '@/lib/completude/artisans-completude';
import { computePartnersCompletude } from '@/lib/completude/partenaires-completude';
import { ProjetsTab, type ProjetsTabSearchParams } from '@/components/completude/projets-tab';
import { ArtisansTab, type ArtisansTabSearchParams } from '@/components/completude/artisans-tab';
import { PartenairesTab, type PartenairesTabSearchParams } from '@/components/completude/partenaires-tab';

export const dynamic = 'force-dynamic';

/**
 * /admin/completude — page admin unifiée à 3 tabs (CEO 2026-06-24, phase B2).
 *
 * Tabs : projets (défaut), artisans, partenaires.
 * Les params spécifiques au tab actif sont relayés au composant tab via une
 * closure `buildHref` qui préserve les autres params (notamment `tab`).
 *
 * Permissions : CEO + chef_projet + assistante + developer
 * (héritage de l'ancien /admin/completude-projets — developer ajouté pour la
 * cohérence "lecture quasi totale" du rôle).
 */

type Tab = 'projets' | 'artisans' | 'partenaires';

type SearchParams = ProjetsTabSearchParams & ArtisansTabSearchParams & PartenairesTabSearchParams & {
  tab?: string;
};

function isTab(v: string | undefined): v is Tab {
  return v === 'projets' || v === 'artisans' || v === 'partenaires';
}

const TAB_LABELS: Record<Tab, string> = {
  projets: 'Projets',
  artisans: 'Artisans',
  partenaires: 'Partenaires',
};

export default async function CompletudePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole(['ceo', 'chef_projet', 'developer', 'assistante']);

  const tab: Tab = isTab(searchParams.tab) ? searchParams.tab : 'projets';

  // ── Compteurs "à traiter" pour la nav (rouge + orange) ────────────────
  // On compute les 3 en parallèle. Sur un dataset petit (~50 artisans /
  // ~50 partenaires / ~100 projets) c'est rapide ; on cache pas car les
  // données peuvent bouger entre deux navigations.
  const [projetsAll, artisansAll, partnersAll] = await Promise.all([
    // Projets : on demande la liste sans historique (= scope par défaut tab projets).
    // Si l'utilisateur active "historique=1" on recharge dans le tab uniquement.
    computeProjectCompleteness(undefined, false),
    computeArtisansCompletude({ mode: 'weighted', businessScope: 'all' }),
    computePartnersCompletude({ partnerType: 'all' }),
  ]);

  const projetsACount = projetsAll.filter(r => r.criticality === 'rouge' || r.criticality === 'orange').length;
  const artisansACount = artisansAll.stats.red + artisansAll.stats.orange;
  const partenairesACount = partnersAll.stats.red + partnersAll.stats.orange;

  // ── Helper buildHref : préserve `tab` + tous params actuels, applique patch.
  // Pour patch={tab:'X'}, on retire les params spécifiques aux autres tabs.
  function buildHref(patch: Record<string, string | undefined>): string {
    const merged: Record<string, string | undefined> = { ...searchParams, ...patch, tab };
    // Si on switche de tab via patch.tab, drop les params spécifiques
    const newTab = patch.tab && isTab(patch.tab) ? patch.tab : tab;
    if (newTab !== tab) {
      merged.tab = newTab;
      // Drop les params propres au tab quitté
      if (tab === 'projets') {
        delete merged.criticality;
        delete merged.phase;
        delete merged.chef;
        delete merged.open;
        delete merged.historique;
      }
      if (tab === 'artisans') {
        delete merged.mode;
        delete merged.scope;
      }
      if (tab === 'partenaires') {
        delete merged.partnerType;
      }
    }
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== '' && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `/admin/completude?${qs}` : '/admin/completude';
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-2">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">Admin</div>
        <h1 className="text-3xl font-display">Complétude ERP</h1>
      </div>

      {/* Nav tabs avec compteurs "à traiter" */}
      <div className="border-b border-stoniz-gray-200 mb-6">
        <nav className="flex gap-1 -mb-px" aria-label="Tabs complétude">
          {(['projets', 'artisans', 'partenaires'] as const).map(t => {
            const active = tab === t;
            const count =
              t === 'projets' ? projetsACount
              : t === 'artisans' ? artisansACount
              : partenairesACount;
            return (
              <Link
                key={t}
                href={buildHref({ tab: t })}
                className={`px-4 py-2.5 text-sm border-b-2 transition flex items-center gap-2 ${
                  active
                    ? 'border-stoniz-black text-stoniz-black font-medium'
                    : 'border-transparent text-stoniz-gray-600 hover:text-stoniz-black hover:border-stoniz-gray-300'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <span>{TAB_LABELS[t]}</span>
                {count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-mono ${
                    active
                      ? 'bg-red-100 text-red-800'
                      : 'bg-stoniz-gray-100 text-stoniz-gray-700'
                  }`}>
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Body : tab actif */}
      {tab === 'projets' && (
        <ProjetsTab searchParams={searchParams} buildHref={buildHref} />
      )}
      {tab === 'artisans' && (
        <ArtisansTab searchParams={searchParams} buildHref={buildHref} />
      )}
      {tab === 'partenaires' && (
        <PartenairesTab searchParams={searchParams} buildHref={buildHref} />
      )}
    </div>
  );
}
