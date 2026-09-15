'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { createProviderMinimalAction } from '@/app/(team)/projects/[id]/services/actions';

export type Provider = {
  id: string;
  name: string;
  provider_type: 'artisan_travaux' | 'fournisseur_achats' | 'prestataire_service';
  service_category: string | null;
};

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  artisan_travaux: 'Artisans travaux',
  fournisseur_achats: 'Fournisseurs achats',
  prestataire_service: 'Prestataires services',
};

/**
 * Combobox de prestataire avec filtre par type et catégorie.
 *
 * Pour le pôle Services on filtre automatiquement sur provider_type='prestataire_service'.
 * Si serviceCategory fourni, on filtre aussi par catégorie pour ne montrer que les
 * prestataires pertinents (ex: architectes uniquement).
 *
 * Création inline si pas de match : crée un nouvel artisan avec le bon
 * provider_type et la bonne service_category.
 */
export function ProviderCombobox({
  providers,
  defaultProviderId = null,
  defaultProviderName = '',
  providerType = 'prestataire_service',
  serviceCategory = null,
  required = false,
  idFieldName = 'provider_id',
  nameFieldName = 'provider_name',
  placeholder,
}: {
  providers: Provider[];
  defaultProviderId?: string | null;
  defaultProviderName?: string;
  providerType?: 'artisan_travaux' | 'fournisseur_achats' | 'prestataire_service' | 'all';
  serviceCategory?: string | null;
  required?: boolean;
  idFieldName?: string;
  nameFieldName?: string;
  placeholder?: string;
}) {
  // Filtre par type
  const baseList = useMemo(
    () =>
      providerType === 'all'
        ? providers
        : providers.filter((p) => p.provider_type === providerType),
    [providers, providerType]
  );

  // Filtre additionnel par catégorie de service si demandé
  const filteredByCategory = useMemo(() => {
    if (!serviceCategory || providerType !== 'prestataire_service') return baseList;
    return baseList.filter((p) => p.service_category === serviceCategory);
  }, [baseList, serviceCategory, providerType]);

  const [query, setQuery] = useState<string>(defaultProviderName);
  const [selectedId, setSelectedId] = useState<string | null>(defaultProviderId);
  const [selectedName, setSelectedName] = useState<string>(defaultProviderName);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

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
    if (!q) return filteredByCategory.slice(0, 30);
    return filteredByCategory
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [filteredByCategory, q]);

  // Si pas de résultat dans la catégorie mais existe ailleurs, on les montre en gris
  const fallbackOthers = useMemo(() => {
    if (filtered.length > 0 || !q) return [];
    return baseList
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [baseList, q, filtered.length]);

  const exactMatch = filteredByCategory.find((p) => p.name.trim().toLowerCase() === q);
  const showCreate = q.length >= 2 && !exactMatch && providerType !== 'all';

  function pick(p: Provider) {
    setSelectedId(p.id);
    setSelectedName(p.name);
    setQuery(p.name);
    setOpen(false);
    setError(null);
  }

  function create() {
    if (q.length < 2 || providerType === 'all') return;
    setError(null);
    start(async () => {
      const r = await createProviderMinimalAction({
        name: query.trim(),
        provider_type: providerType,
        service_category: serviceCategory ?? null,
      });
      if (!r.ok) {
        setError(r.error ?? 'Erreur création');
        return;
      }
      pick({
        id: r.id,
        name: r.name,
        provider_type: providerType,
        service_category: serviceCategory,
      });
    });
  }

  const ph = placeholder ??
    (providerType === 'prestataire_service'
      ? 'Tape un nom de prestataire (architecte, géomètre…)'
      : 'Tape un nom…');

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
            if (selectedName && e.target.value !== selectedName) {
              setSelectedId(null);
              setSelectedName('');
            }
          }}
          onFocus={() => setOpen(true)}
          placeholder={ph}
          className="w-full h-10 rounded-md border border-stoniz-gray-300 bg-white pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-stoniz-black/30"
          autoComplete="off"
        />
      </div>

      <input type="hidden" name={idFieldName} value={selectedId ?? ''} />
      <input
        type="hidden"
        name={nameFieldName}
        value={selectedName || query.trim()}
        required={required}
      />

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-stoniz-gray-300 rounded-md shadow-lg max-h-80 overflow-y-auto">
          {filtered.length === 0 && fallbackOthers.length === 0 && !showCreate && (
            <div className="px-3 py-3 text-sm text-stoniz-gray-500">
              {q
                ? `Aucun ${PROVIDER_TYPE_LABELS[providerType] ?? 'résultat'} ne contient « ${query} ».`
                : 'Tape pour rechercher.'}
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
                    <span className={selectedId === p.id ? '' : 'pl-5'}>{p.name}</span>
                    {p.service_category && p.provider_type === 'prestataire_service' && (
                      <span className="ml-auto text-[10px] uppercase text-stoniz-gray-400">
                        {p.service_category.replace(/_/g, ' ')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {fallbackOthers.length > 0 && (
            <div className="border-t border-stoniz-gray-100">
              <div className="px-3 py-1.5 text-[10px] uppercase text-stoniz-gray-500 bg-stoniz-gray-50">
                Existe ailleurs (autre type / autre catégorie)
              </div>
              <ul className="py-1">
                {fallbackOthers.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => pick(p)}
                      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-stoniz-gray-50 text-stoniz-gray-500 italic"
                    >
                      <span className="pl-5">{p.name}</span>
                      <span className="ml-auto text-[10px] uppercase">
                        {PROVIDER_TYPE_LABELS[p.provider_type] ?? p.provider_type}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showCreate && (
            <div className="border-t border-stoniz-gray-100">
              <button
                type="button"
                onClick={create}
                disabled={pending}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-yellow-50 flex items-center gap-2 disabled:opacity-60"
              >
                <Plus className="w-3.5 h-3.5 text-stoniz-black" />
                <span>
                  {pending
                    ? 'Création…'
                    : <>Créer « <strong>{query.trim()}</strong> » comme {PROVIDER_TYPE_LABELS[providerType]?.toLowerCase() ?? 'prestataire'}</>}
                </span>
              </button>
              <p className="px-3 pb-2 text-[11px] text-stoniz-gray-500">
                Fiche minimum créée. Tu pourras compléter les coordonnées depuis <span className="underline">/artisans</span>.
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
