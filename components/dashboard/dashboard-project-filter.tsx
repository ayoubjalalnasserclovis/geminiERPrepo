'use client';

import { Suspense, useState, useMemo, useRef, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Filter, X, Search, Check } from 'lucide-react';

/**
 * Filtre projet pour les dashboards travaux + achats (CEO 2026-06-16).
 *
 * - Combobox avec checkboxes : sélection multiple libre
 * - Persisté dans l'URL via ?projects=id1,id2
 * - Par défaut (URL vide) : on garde le comportement "tous les projets actifs"
 *   piloté côté server component
 * - Actions rapides : Tout sélectionner / Désélectionner / Reset au défaut
 *
 * Le serveur lit `searchParams.projects` et filtre la liste avant de calculer
 * les KPI → tous les totaux/cartes/tableaux suivent la sélection.
 *
 * IMPORTANT : ce composant utilise `useSearchParams` qui IMPOSE un wrapper
 * <Suspense> autour pour éviter le crash "An error occurred in the Server
 * Components render" en prod (Next.js 14). On wrappe l'inner ici une bonne
 * fois pour toutes — l'exposition publique `DashboardProjectFilter` est sûre.
 */

type ProjectOption = {
  id: string;
  reference: string | null;
  client: string;
  status: string;
};

export function DashboardProjectFilter(props: {
  options: ProjectOption[];
  currentSelected: string[] | null;
}) {
  return (
    <Suspense fallback={<FilterButtonFallback selected={props.currentSelected} total={props.options.length} />}>
      <DashboardProjectFilterInner {...props} />
    </Suspense>
  );
}

function FilterButtonFallback({ selected, total }: { selected: string[] | null; total: number }) {
  const isFilterActive = selected !== null;
  const selectedCount = selected?.length ?? total;
  const buttonLabel = !isFilterActive
    ? `Tous les projets actifs (${total})`
    : selectedCount === 0
      ? 'Aucun projet sélectionné'
      : `${selectedCount} / ${total} projet${selectedCount > 1 ? 's' : ''}`;
  return (
    <button
      type="button"
      disabled
      className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border bg-stoniz-gray-50 border-stoniz-gray-300 text-stoniz-gray-500 cursor-wait"
    >
      <Filter className="w-3.5 h-3.5" />
      <span>{buttonLabel}</span>
    </button>
  );
}

function DashboardProjectFilterInner({
  options,
  currentSelected,
}: {
  options: ProjectOption[];
  /** IDs des projets actuellement sélectionnés (depuis l'URL). null = pas de filtre actif (défaut serveur) */
  currentSelected: string[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Sélection locale tampon — on l'applique au clic sur "Appliquer"
  const [draft, setDraft] = useState<Set<string>>(
    () => new Set(currentSelected ?? options.map((o) => o.id)),
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync local state si le param URL change (back/forward navigation)
  useEffect(() => {
    setDraft(new Set(currentSelected ?? options.map((o) => o.id)));
  }, [currentSelected, options]);

  // Fermeture au clic dehors
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.trim().toLowerCase();
    return options.filter(
      (o) =>
        (o.reference ?? '').toLowerCase().includes(q) ||
        o.client.toLowerCase().includes(q),
    );
  }, [options, search]);

  function toggle(id: string) {
    setDraft((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function selectAll() {
    setDraft(new Set(filtered.map((o) => o.id)));
  }

  function clearAll() {
    setDraft(new Set());
  }

  function apply() {
    const next = new URLSearchParams(params.toString());
    // Si on a sélectionné TOUT (= équivalent défaut), on enlève le param
    const allIds = options.map((o) => o.id);
    const draftArr = Array.from(draft);
    if (draftArr.length === allIds.length && allIds.every((id) => draft.has(id))) {
      next.delete('projects');
    } else if (draftArr.length === 0) {
      // Sélection vide = filtre actif sur 0 projet (rare mais légitime : "rien")
      next.set('projects', '_none');
    } else {
      next.set('projects', draftArr.join(','));
    }
    router.push(`${pathname}?${next.toString()}`);
    setOpen(false);
  }

  function reset() {
    const next = new URLSearchParams(params.toString());
    next.delete('projects');
    router.push(`${pathname}?${next.toString()}`);
    setOpen(false);
  }

  // Label compact pour le bouton
  const totalOptions = options.length;
  const isFilterActive = currentSelected !== null;
  const selectedCount = currentSelected?.length ?? totalOptions;
  const buttonLabel = !isFilterActive
    ? `Tous les projets actifs (${totalOptions})`
    : selectedCount === 0
      ? 'Aucun projet sélectionné'
      : `${selectedCount} / ${totalOptions} projet${selectedCount > 1 ? 's' : ''}`;

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
          isFilterActive
            ? 'bg-stoniz-black text-white border-stoniz-black'
            : 'bg-white border-stoniz-gray-300 hover:bg-stoniz-gray-50 text-stoniz-gray-800'
        }`}
      >
        <Filter className="w-3.5 h-3.5" />
        <span>{buttonLabel}</span>
        {isFilterActive && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              reset();
            }}
            className="ml-1 p-0.5 rounded hover:bg-white/20 inline-flex items-center"
            title="Réinitialiser le filtre"
            aria-label="Réinitialiser le filtre"
          >
            <X className="w-3 h-3" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-30 mt-2 right-0 w-[420px] bg-white border border-stoniz-gray-200 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-3 border-b border-stoniz-gray-200">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stoniz-gray-400" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par client ou référence…"
                className="w-full text-sm border border-stoniz-gray-300 rounded pl-7 pr-2 py-1.5 bg-white"
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-xs">
              <div className="text-stoniz-gray-500">
                {draft.size} / {options.length} sélectionné{draft.size > 1 ? 's' : ''}
              </div>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-stoniz-gray-600 hover:text-stoniz-black"
                >
                  Tout cocher
                </button>
                <span className="text-stoniz-gray-300">·</span>
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-stoniz-gray-600 hover:text-stoniz-black"
                >
                  Tout décocher
                </button>
              </div>
            </div>
          </div>

          <ul className="max-h-[320px] overflow-y-auto divide-y divide-stoniz-gray-100">
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-sm text-stoniz-gray-500 text-center italic">
                Aucun projet ne correspond
              </li>
            ) : (
              filtered.map((o) => {
                const checked = draft.has(o.id);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => toggle(o.id)}
                      className={`w-full px-3 py-2 text-left hover:bg-stoniz-gray-50 flex items-center gap-2.5 ${
                        checked ? 'bg-stoniz-gray-50/50' : ''
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          checked
                            ? 'bg-stoniz-black border-stoniz-black text-white'
                            : 'border-stoniz-gray-300 bg-white'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3" />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm truncate">{o.client}</span>
                        <span className="block text-[10px] text-stoniz-gray-500 truncate">
                          {o.reference ?? '—'}
                          {o.status !== 'actif' && (
                            <span className="ml-1.5 text-amber-700">· {o.status}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <div className="flex items-center justify-between gap-2 p-3 border-t border-stoniz-gray-200 bg-stoniz-gray-50">
            <button
              type="button"
              onClick={reset}
              className="text-xs text-stoniz-gray-600 hover:text-stoniz-black"
            >
              Réinitialiser
            </button>
            <div className="inline-flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm px-3 py-1.5 rounded border border-stoniz-gray-300 hover:bg-white"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={apply}
                className="text-sm px-3 py-1.5 rounded bg-stoniz-black text-white hover:bg-stoniz-gray-800"
              >
                Appliquer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// parseProjectFilter est désormais dans `dashboard-project-filter-utils.ts`
// (fichier server-safe sans 'use client') pour pouvoir l'importer depuis les
// Server Components des pages dashboard. Une fonction exportée par un fichier
// 'use client' est une "client reference" non exécutable côté serveur, ce qui
// faisait crasher /dashboard/travaux et /dashboard/achats en prod build.
