'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { createArtisanMinimalAction } from '@/app/(team)/artisans/actions';

type Artisan = { id: string; name: string };

/**
 * Combobox de recherche + création inline d'un artisan.
 *
 * - Tape pour filtrer la liste des artisans existants
 * - Clique pour sélectionner un artisan → renseigne artisan_id (hidden) + artisan_name (hidden)
 * - Si aucun match → bouton "+ Créer 'XXX'" qui crée l'artisan en BDD et le sélectionne dans la foulée
 *
 * Anti-doublon : la création minimale vérifie l'existence par nom (ilike) avant insert.
 */
export function ArtisanCombobox({
  artisans,
  defaultArtisanId = null,
  defaultArtisanName = '',
  required = true,
  idFieldName = 'artisan_id',
  nameFieldName = 'artisan_name',
  placeholder = 'Rechercher ou créer un artisan…',
  createLabel = 'artisan',
}: {
  artisans: Artisan[];
  defaultArtisanId?: string | null;
  defaultArtisanName?: string;
  required?: boolean;
  /** Nom du hidden input pour l'ID (ex: 'artisan_id' ou 'supplier_id') */
  idFieldName?: string;
  /** Nom du hidden input pour le nom (ex: 'artisan_name' ou 'supplier_name') */
  nameFieldName?: string;
  /** Placeholder du champ de recherche */
  placeholder?: string;
  /** Mot affiché dans le bouton "Créer le X 'XXX'" (ex: 'artisan', 'fournisseur') */
  createLabel?: string;
}) {
  const [query, setQuery] = useState<string>(defaultArtisanName);
  const [selectedId, setSelectedId] = useState<string | null>(defaultArtisanId);
  const [selectedName, setSelectedName] = useState<string>(defaultArtisanName);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
  const filtered = q
    ? artisans.filter(a => a.name.toLowerCase().includes(q))
    : artisans.slice(0, 20);

  const exactMatch = artisans.find(a => a.name.trim().toLowerCase() === q);
  const showCreate = q.length >= 2 && !exactMatch;

  function pick(a: Artisan) {
    setSelectedId(a.id);
    setSelectedName(a.name);
    setQuery(a.name);
    setOpen(false);
    setError(null);
  }

  function create() {
    if (q.length < 2) return;
    setError(null);
    start(async () => {
      const r = await createArtisanMinimalAction(query.trim());
      if (!r.ok) {
        setError(r.error ?? 'Erreur création artisan');
        return;
      }
      pick({ id: r.id, name: r.name });
    });
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
            // Si le user édite le texte, on désélectionne (sauf si le texte matche pile)
            if (selectedName && e.target.value !== selectedName) {
              setSelectedId(null);
              setSelectedName('');
            }
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full h-10 rounded-md border border-grey-line bg-white pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-stoniz-black/30"
          autoComplete="off"
        />
      </div>

      {/* Hidden inputs pour la soumission du form parent (compat actions inchangées) */}
      <input type="hidden" name={idFieldName} value={selectedId ?? ''} />
      <input
        type="hidden"
        name={nameFieldName}
        value={selectedName || query.trim()}
        required={required}
      />

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-grey-line rounded-md shadow-lg max-h-72 overflow-y-auto">
          {filtered.length === 0 && !showCreate && (
            <div className="px-3 py-3 text-sm text-stoniz-gray-500">
              {q ? `Aucun ${createLabel} ne contient « ${query} ».` : `Aucun ${createLabel} dans la base.`}
            </div>
          )}

          {filtered.length > 0 && (
            <ul className="py-1">
              {filtered.map(a => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => pick(a)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-cream-soft ${
                      selectedId === a.id ? 'bg-cream-soft font-medium' : ''
                    }`}
                  >
                    {selectedId === a.id && <Check className="w-3.5 h-3.5 text-stoniz-black" />}
                    <span className={selectedId === a.id ? '' : 'pl-5'}>{a.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {showCreate && (
            <div className="border-t border-grey-line">
              <button
                type="button"
                onClick={create}
                disabled={pending}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-yellow/20 flex items-center gap-2 disabled:opacity-60"
              >
                <Plus className="w-3.5 h-3.5 text-stoniz-black" />
                <span>
                  {pending ? 'Création…' : <>Créer {createLabel === 'fournisseur' ? 'le' : "l'"}{createLabel} « <strong>{query.trim()}</strong> »</>}
                </span>
              </button>
              <p className="px-3 pb-2 text-[11px] text-stoniz-gray-500">
                Une fiche minimum sera créée. Vous pourrez compléter les coordonnées plus tard
                depuis <span className="underline">/artisans</span>.
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
