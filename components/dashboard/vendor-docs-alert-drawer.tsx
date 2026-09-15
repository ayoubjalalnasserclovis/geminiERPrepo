'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { X, Search, ChevronRight, ExternalLink } from 'lucide-react';

/**
 * Drawer cliquable du bandeau d'alerte docs fournisseurs (CEO 2026-06-16).
 *
 * - Affiche la liste complète des lots à compléter
 * - Groupage par fournisseur (replié par défaut, déplie au clic)
 * - Recherche full-text
 * - Lien direct vers le projet → ouvre la fiche projet sur l'onglet
 *   achats ou travaux selon le kind
 */
export function VendorDocsAlertDrawer({
  title,
  rows,
  kind,
}: {
  title: string;
  rows: Array<{
    project_id: string;
    project_reference: string | null;
    lot_id: string;
    lot_numero: number;
    lot_desc: string | null;
    vendor_name: string | null;
  }>;
  kind: 'achats' | 'travaux';
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);

  // Group par fournisseur
  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.vendor_name ?? '(sans fournisseur)';
      const existing = map.get(k);
      if (existing) existing.push(r);
      else map.set(k, [r]);
    }
    // Filtre recherche
    if (!search.trim()) {
      return Array.from(map.entries())
        .sort((a, b) => b[1].length - a[1].length);
    }
    const q = search.toLowerCase();
    return Array.from(map.entries())
      .filter(([vendor, items]) =>
        vendor.toLowerCase().includes(q) ||
        items.some((i) =>
          (i.project_reference ?? '').toLowerCase().includes(q) ||
          (i.lot_desc ?? '').toLowerCase().includes(q) ||
          String(i.lot_numero).includes(q),
        ),
      )
      .sort((a, b) => b[1].length - a[1].length);
  }, [rows, search]);

  if (rows.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-blue-600 hover:underline mt-2 inline-flex items-center gap-1"
      >
        Voir tout ({rows.length}) <ChevronRight className="w-3 h-3" />
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex justify-end"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-stoniz-gray-200 p-4 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg">{title}</h2>
                <p className="text-xs text-stoniz-gray-500 mt-0.5">
                  {rows.length} lot{rows.length > 1 ? 's' : ''} · groupés par {kind === 'travaux' ? 'artisan' : 'fournisseur'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-stoniz-gray-500 hover:text-stoniz-black p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4">
              <div className="relative mb-4">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stoniz-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Rechercher un ${kind === 'travaux' ? 'artisan' : 'fournisseur'}, un projet, un lot…`}
                  className="pl-8 pr-3 py-2 text-sm border border-stoniz-gray-300 rounded w-full"
                />
              </div>

              {grouped.length === 0 ? (
                <div className="text-center text-sm text-stoniz-gray-500 py-8">
                  Aucun résultat.
                </div>
              ) : (
                <ul className="space-y-2">
                  {grouped.map(([vendor, items]) => {
                    const isExpanded = expandedVendor === vendor;
                    return (
                      <li
                        key={vendor}
                        className="border border-stoniz-gray-200 rounded-lg overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => setExpandedVendor(isExpanded ? null : vendor)}
                          className="w-full p-3 bg-stoniz-gray-50 hover:bg-stoniz-gray-100 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <ChevronRight
                              className={`w-3.5 h-3.5 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                            />
                            <span className="font-medium text-sm truncate">{vendor}</span>
                          </div>
                          <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full shrink-0 ml-2">
                            {items.length} lot{items.length > 1 ? 's' : ''}
                          </span>
                        </button>

                        {isExpanded && (
                          <ul className="divide-y divide-stoniz-gray-100">
                            {items.map((item) => (
                              <li key={item.lot_id} className="px-3 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="text-xs font-mono text-stoniz-gray-600">
                                      #{item.lot_numero}
                                      {item.project_reference && (
                                        <> · <span className="text-stoniz-gray-500">{item.project_reference}</span></>
                                      )}
                                    </div>
                                    <div className="text-xs text-stoniz-gray-800 mt-0.5 truncate">
                                      {item.lot_desc ?? '(sans description)'}
                                    </div>
                                  </div>
                                  <Link
                                    href={`/projects/${item.project_id}/${kind}`}
                                    className="text-[11px] text-blue-600 hover:underline inline-flex items-center gap-1 shrink-0"
                                  >
                                    Ouvrir <ExternalLink className="w-3 h-3" />
                                  </Link>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
