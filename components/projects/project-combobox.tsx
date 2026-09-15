'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';

export type ProjectOption = {
  id: string;
  reference: string;
  client_name: string | null;
};

/**
 * Combobox de recherche d'un projet existant.
 *
 * - Tape pour filtrer par nom client OU référence projet
 * - Clique pour sélectionner → renseigne un hidden input project_id
 * - Affiche au max 30 résultats à la fois
 *
 * Pas de création — il faut passer par /clients pour créer un nouveau projet.
 */
export function ProjectCombobox({
  projects,
  defaultProjectId = null,
  required = false,
  fieldName = 'project_id',
  placeholder = 'Rechercher un projet par nom client ou référence…',
  onSelect,
}: {
  projects: ProjectOption[];
  defaultProjectId?: string | null;
  required?: boolean;
  fieldName?: string;
  placeholder?: string;
  onSelect?: (projectId: string | null) => void;
}) {
  const initialSelected = useMemo(
    () => projects.find((p) => p.id === defaultProjectId) ?? null,
    [defaultProjectId, projects]
  );

  const [query, setQuery] = useState<string>(() =>
    initialSelected ? formatProjectLabel(initialSelected) : ''
  );
  const [selectedId, setSelectedId] = useState<string | null>(defaultProjectId);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Ferme le dropdown au clic en dehors
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return projects.slice(0, 30);
    return projects
      .filter((p) => {
        const haystack = `${p.client_name ?? ''} ${p.reference ?? ''}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 30);
  }, [projects, q]);

  function pick(p: ProjectOption) {
    setSelectedId(p.id);
    setQuery(formatProjectLabel(p));
    setOpen(false);
    onSelect?.(p.id);
  }

  function clear() {
    setSelectedId(null);
    setQuery('');
    setOpen(true);
    onSelect?.(null);
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stoniz-gray-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Désélectionne si l'utilisateur édite le texte
            if (selectedId && e.target.value !== formatProjectLabel(initialSelected!)) {
              setSelectedId(null);
            }
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full h-10 rounded-md border border-stoniz-gray-300 bg-white pl-10 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-stoniz-black/30"
          autoComplete="off"
        />
        {selectedId && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-stoniz-gray-400 hover:text-stoniz-black text-xs"
            title="Effacer la sélection"
          >
            ✕
          </button>
        )}
      </div>

      {/* Hidden input pour la soumission */}
      <input
        type="hidden"
        name={fieldName}
        value={selectedId ?? ''}
        required={required}
      />

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-stoniz-gray-300 rounded-md shadow-lg max-h-72 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-3 py-3 text-sm text-stoniz-gray-500">
              {q ? `Aucun projet ne contient « ${query} ».` : 'Aucun projet dans la base.'}
            </div>
          )}

          {filtered.length > 0 && (
            <ul className="py-1">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => pick(p)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stoniz-gray-50 ${
                      selectedId === p.id ? 'bg-stoniz-gray-50 font-medium' : ''
                    }`}
                  >
                    {selectedId === p.id && <Check className="w-3.5 h-3.5 text-stoniz-black flex-shrink-0" />}
                    <div className={`flex-1 ${selectedId === p.id ? '' : 'pl-5'}`}>
                      <div className="font-medium">{p.client_name ?? 'Sans client'}</div>
                      <div className="text-xs text-stoniz-gray-500 font-mono">{p.reference}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {projects.length > 30 && q.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-stoniz-gray-500 border-t bg-stoniz-gray-50">
              30 premiers résultats affichés. Tape pour filtrer parmi les {projects.length} projets.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatProjectLabel(p: ProjectOption): string {
  const name = p.client_name ?? 'Sans client';
  return `${name} · ${p.reference}`;
}
