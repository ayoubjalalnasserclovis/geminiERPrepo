'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Filter, Search, X, ChevronDown, RotateCcw, Bookmark } from 'lucide-react';

/**
 * Toolbar générique pour les listes (CEO 2026-06-18).
 *
 * Utilisée par : /properties, /projects, /clients
 *
 * Features :
 *   - Recherche unifiée (debounce 250ms, ⌘K focus)
 *   - Filtres déclaratifs : single / multi / range numérique / period
 *   - URL state (partageable, bookmarkable)
 *   - Compteur "X sur Y affichés" si rendu côté serveur
 *   - Reset global
 *   - Filtres sauvegardés (localStorage par module)
 *
 * Toute la logique de filtrage côté serveur lit les searchParams.
 * Helper : lib/list-filters/apply-filters.ts (côté serveur).
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type FilterDef =
  | { kind: 'single'; key: string; label: string; options: Array<{ v: string; label: string }> }
  | { kind: 'multi'; key: string; label: string; options: Array<{ v: string; label: string }> }
  | { kind: 'range'; key: string; label: string; unit?: string; step?: number }
  | { kind: 'period'; key: string; label: string };

export type ToolbarProps = {
  /** Identifiant du module (ex: 'properties') — utilisé pour localStorage filtres sauvegardés */
  moduleKey: string;
  /** Compteur "X sur Y" (calculé côté serveur, passé en prop) */
  count?: { filtered: number; total: number };
  /** Liste des filtres à afficher */
  filters: FilterDef[];
  /** Liste des champs de recherche libre (pour le hint placeholder) */
  searchHint?: string;
  /** Si fourni, écrase le pathname utilisé pour push — sinon usePathname() */
  basePath?: string;
};

const PERIODS: Array<{ v: string; label: string }> = [
  { v: 'current_month', label: 'Ce mois' },
  { v: 'last_3_months', label: '3 mois' },
  { v: 'last_12_months', label: '12 mois' },
  { v: 'all', label: 'Tout' },
];

// ─── Composant principal ─────────────────────────────────────────────────

export function ListToolbar(props: ToolbarProps) {
  return (
    <Suspense fallback={null}>
      <ListToolbarInner {...props} />
    </Suspense>
  );
}

function ListToolbarInner({ moduleKey, count, filters, searchHint, basePath }: ToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const path = basePath ?? pathname;
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  // ─── Recherche (debounce) ─────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState(sp.get('q') ?? '');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setSearchInput(sp.get('q') ?? ''); }, [sp]);

  // Cmd+K focus
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      const current = sp.get('q') ?? '';
      if (searchInput !== current) {
        updateUrl({ q: searchInput || null });
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // ─── Helper URL ──────────────────────────────────────────────────────
  function updateUrl(updates: Record<string, string | null>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === '') params.delete(k);
      else params.set(k, v);
    }
    // Reset pagination si on change un filtre
    if (!('page' in updates)) params.delete('page');
    startTransition(() => {
      router.push(`${path}?${params.toString()}`, { scroll: false });
    });
  }

  function reset() {
    setSearchInput('');
    startTransition(() => router.push(path, { scroll: false }));
  }

  // ─── Filtres sauvegardés (localStorage) ──────────────────────────────
  const storageKey = `stoniz_saved_filters_${moduleKey}`;
  type SavedFilter = { name: string; query: string };
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setSaved(JSON.parse(raw));
    } catch {}
  }, [storageKey]);

  function saveSnapshot() {
    const name = prompt('Nom de ce filtre sauvegardé :');
    if (!name?.trim()) return;
    const query = sp.toString();
    const next = [...saved.filter(s => s.name !== name), { name: name.trim(), query }];
    localStorage.setItem(storageKey, JSON.stringify(next));
    setSaved(next);
  }

  function loadSaved(s: SavedFilter) {
    startTransition(() => router.push(`${path}?${s.query}`, { scroll: false }));
    setShowSaved(false);
  }

  function deleteSaved(name: string) {
    if (!confirm(`Supprimer le filtre "${name}" ?`)) return;
    const next = saved.filter(s => s.name !== name);
    localStorage.setItem(storageKey, JSON.stringify(next));
    setSaved(next);
  }

  // ─── État actif ──────────────────────────────────────────────────────
  const hasAny = useMemo(() => {
    for (const f of filters) {
      if (f.kind === 'range') {
        if (sp.get(`${f.key}_min`) || sp.get(`${f.key}_max`)) return true;
      } else if (sp.get(f.key)) return true;
    }
    if (sp.get('q')) return true;
    if (sp.get('sort')) return true;
    return false;
  }, [sp, filters]);

  return (
    <div className="mb-4 space-y-2">
      {/* Ligne 1 : recherche + actions globales */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stoniz-gray-400" />
          <input
            ref={searchRef}
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={searchHint ?? 'Rechercher… (⌘K)'}
            className="w-full pl-9 pr-9 py-2 text-sm border border-stoniz-gray-300 rounded-md focus:outline-none focus:border-stoniz-black"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-stoniz-gray-400 hover:text-stoniz-gray-700"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {saved.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSaved(s => !s)}
              className="flex items-center gap-1 px-3 py-2 text-sm border border-stoniz-gray-300 rounded-md hover:bg-stoniz-gray-50"
            >
              <Bookmark className="w-4 h-4" /> Mes filtres ({saved.length})
              <ChevronDown className="w-3 h-3" />
            </button>
            {showSaved && (
              <div className="absolute right-0 mt-1 bg-white border rounded-md shadow-lg p-2 z-10 min-w-[220px]">
                {saved.map(s => (
                  <div key={s.name} className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-stoniz-gray-50 rounded">
                    <button type="button" onClick={() => loadSaved(s)} className="text-sm text-left flex-1 truncate">
                      {s.name}
                    </button>
                    <button type="button" onClick={() => deleteSaved(s.name)} className="text-stoniz-gray-400 hover:text-red-600">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {hasAny && (
          <>
            <button
              type="button"
              onClick={saveSnapshot}
              className="flex items-center gap-1 px-3 py-2 text-sm border border-stoniz-gray-300 rounded-md hover:bg-stoniz-gray-50"
              title="Sauvegarder cette combinaison de filtres"
            >
              <Bookmark className="w-4 h-4" /> Sauvegarder
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 px-3 py-2 text-sm border border-stoniz-gray-300 rounded-md hover:bg-stoniz-gray-50"
            >
              <RotateCcw className="w-4 h-4" /> Réinitialiser
            </button>
          </>
        )}

        {count && (
          <div className="text-sm text-stoniz-gray-600 ml-auto">
            <strong>{count.filtered}</strong>
            {count.filtered !== count.total && <> sur {count.total}</>}
            {' '}affiché{count.filtered > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Ligne 2+ : filtres chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-stoniz-gray-500 flex-shrink-0" />
        {filters.map(f => (
          <FilterChip key={f.key} def={f} sp={sp} updateUrl={updateUrl} />
        ))}
      </div>
    </div>
  );
}

// ─── Chip par type de filtre ────────────────────────────────────────

function FilterChip({
  def, sp, updateUrl,
}: {
  def: FilterDef;
  sp: URLSearchParams;
  updateUrl: (u: Record<string, string | null>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (def.kind === 'single') {
    const value = sp.get(def.key);
    const selectedLabel = value ? def.options.find(o => o.v === value)?.label : null;
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border ${
            value ? 'bg-stoniz-black text-white border-stoniz-black' : 'border-stoniz-gray-300 hover:bg-stoniz-gray-50'
          }`}
        >
          {def.label}{selectedLabel ? ` : ${selectedLabel}` : ''}
          <ChevronDown className="w-3 h-3" />
        </button>
        {open && (
          <div className="absolute mt-1 bg-white border rounded-md shadow-lg p-2 z-10 min-w-[180px] max-h-[300px] overflow-y-auto">
            <button type="button" onClick={() => { updateUrl({ [def.key]: null }); setOpen(false); }}
              className="block w-full text-left text-sm px-2 py-1 rounded hover:bg-stoniz-gray-100 text-stoniz-gray-500">
              Tous
            </button>
            {def.options.map(o => (
              <button key={o.v} type="button"
                onClick={() => { updateUrl({ [def.key]: o.v }); setOpen(false); }}
                className={`block w-full text-left text-sm px-2 py-1 rounded hover:bg-stoniz-gray-100 ${
                  value === o.v ? 'font-medium' : ''
                }`}>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (def.kind === 'multi') {
    const value = (sp.get(def.key) ?? '').split(',').filter(Boolean);
    const summary = value.length === 0 ? '' : value.length === 1
      ? ` : ${def.options.find(o => o.v === value[0])?.label ?? value[0]}`
      : ` : ${value.length}`;
    function toggle(v: string) {
      const next = value.includes(v) ? value.filter(x => x !== v) : [...value, v];
      updateUrl({ [def.key]: next.length > 0 ? next.join(',') : null });
    }
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border ${
            value.length > 0 ? 'bg-stoniz-black text-white border-stoniz-black' : 'border-stoniz-gray-300 hover:bg-stoniz-gray-50'
          }`}
        >
          {def.label}{summary}
          <ChevronDown className="w-3 h-3" />
        </button>
        {open && (
          <div className="absolute mt-1 bg-white border rounded-md shadow-lg p-2 z-10 min-w-[200px] max-h-[300px] overflow-y-auto">
            {def.options.map(o => (
              <label key={o.v} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-stoniz-gray-100 cursor-pointer">
                <input type="checkbox" checked={value.includes(o.v)} onChange={() => toggle(o.v)} />
                {o.label}
              </label>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (def.kind === 'range') {
    const min = sp.get(`${def.key}_min`) ?? '';
    const max = sp.get(`${def.key}_max`) ?? '';
    const active = min || max;
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border ${
            active ? 'bg-stoniz-black text-white border-stoniz-black' : 'border-stoniz-gray-300 hover:bg-stoniz-gray-50'
          }`}
        >
          {def.label}
          {active && <span> : {min || '–'}{def.unit ?? ''} → {max || '–'}{def.unit ?? ''}</span>}
          <ChevronDown className="w-3 h-3" />
        </button>
        {open && (
          <div className="absolute mt-1 bg-white border rounded-md shadow-lg p-3 z-10 w-[260px]">
            <div className="flex items-center gap-2">
              <input type="number" step={def.step ?? 1} placeholder="Min" defaultValue={min}
                onBlur={(e) => updateUrl({ [`${def.key}_min`]: e.target.value || null })}
                className="w-full text-sm border rounded px-2 py-1" />
              <span className="text-stoniz-gray-400">→</span>
              <input type="number" step={def.step ?? 1} placeholder="Max" defaultValue={max}
                onBlur={(e) => updateUrl({ [`${def.key}_max`]: e.target.value || null })}
                className="w-full text-sm border rounded px-2 py-1" />
            </div>
            {def.unit && <p className="text-xs text-stoniz-gray-500 mt-1">Unité : {def.unit}</p>}
          </div>
        )}
      </div>
    );
  }

  if (def.kind === 'period') {
    const value = sp.get(def.key) ?? '';
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border ${
            value ? 'bg-stoniz-black text-white border-stoniz-black' : 'border-stoniz-gray-300 hover:bg-stoniz-gray-50'
          }`}
        >
          {def.label}{value ? ` : ${PERIODS.find(p => p.v === value)?.label ?? value}` : ''}
          <ChevronDown className="w-3 h-3" />
        </button>
        {open && (
          <div className="absolute mt-1 bg-white border rounded-md shadow-lg p-2 z-10 min-w-[160px]">
            <button type="button" onClick={() => { updateUrl({ [def.key]: null }); setOpen(false); }}
              className="block w-full text-left text-sm px-2 py-1 rounded hover:bg-stoniz-gray-100 text-stoniz-gray-500">
              Toutes périodes
            </button>
            {PERIODS.map(p => (
              <button key={p.v} type="button"
                onClick={() => { updateUrl({ [def.key]: p.v }); setOpen(false); }}
                className={`block w-full text-left text-sm px-2 py-1 rounded hover:bg-stoniz-gray-100 ${
                  value === p.v ? 'font-medium' : ''
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}
