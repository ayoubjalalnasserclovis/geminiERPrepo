'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Filter, Search, X, ChevronDown, RotateCcw, Download, Loader2, Bookmark } from 'lucide-react';
import { exportTransactionsXlsxAction } from '@/app/(team)/finance/tresorerie/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

/**
 * Toolbar trésorerie (CEO 2026-06-16, étendu 2026-06-24 P2.A avec SavedFilters).
 *
 * ─── Pourquoi cette toolbar custom et pas le canon `<ListToolbar>` ? ─────
 * Le canon (utilisé par /projects, /properties, /clients, /artisans, …)
 * couvre les listes "classiques" mais ne gère pas :
 *   - les 7 presets de période propres à la trésorerie (last_7d, previous_month,
 *     ytd…) — son helper `parse.ts:period()` n'en connaît que 4
 *   - la sélection de dates custom (from/to) qui doit override le preset
 *     (bug P0.3 fixé en Phase B — perdu si on retombait sur le canon)
 *   - la recherche multi-token tolérante au texte+montant
 *   - le bouton Export XLSX intégré + bandeau de troncature + SessionExpiredBanner
 *   - les quick-pills type/statut au-dessus des filtres avancés
 *   - le panneau "Plus de filtres" (compte/catégorie/fourchette MAD)
 *
 * P2.A 2026-06-24 : la seule feature manquante du canon qui apportait une vraie
 * valeur ajoutée — `SavedFilters` (localStorage) — est désormais intégrée
 * directement ici. La logique est copiée du canon (`ListToolbar`) pour rester
 * iso-comportementale.
 *
 * Source de vérité période : `lib/finance/period-helpers.ts` (et NON
 * `lib/list-filters/parse.ts:period()`, qui en est une version réduite).
 *
 * ─── Features ────────────────────────────────────────────────────────────
 * - Recherche unifiée auto-apply (debounce 250ms) :
 *   tape "OUACHAOU 4800" → trouve toutes les transactions de 4800 MAD à OUACHAOU
 *   tape "260603076072"  → trouve par référence
 *   tape "4800"          → toutes les transactions à 4800 MAD
 *
 * - Cmd+K depuis n'importe où → focus la barre de recherche
 *
 * - Filtres en chips : période presets, dates custom, fourchette montant,
 *   compte (multi), catégorie (multi), statut, type débit/crédit
 *
 * - Tous les filtres dans l'URL (partageables, bookmarkables)
 *
 * - Filtres sauvegardés (localStorage, namespaced par `moduleKey`)
 *
 * Branche côté serveur : la page lit les query params et applique.
 */

type AccountOption = { id: string; label: string };
type CategoryOption = { value: string; label: string };

export type ToolbarProps = {
  accounts: AccountOption[];
  categories: CategoryOption[];
  /** Si fourni, écrase le pathname utilisé pour push — sinon usePathname() */
  basePath?: string;
  /** Cache certaines sections (utile sur la page tresorerie principale plus dense) */
  compact?: boolean;
  /** Affiche le bouton Export XLSX (vue filtrée) — CEO 2026-06-23 */
  showExport?: boolean;
  /**
   * Identifiant module pour SavedFilters (localStorage namespacé).
   * Ex: 'tresorerie:transactions', 'tresorerie:reconciliation'.
   * Si absent → SavedFilters désactivés.
   * CEO 2026-06-24 P2.A.
   */
  moduleKey?: string;
};

export function TresorerieToolbar(props: ToolbarProps) {
  return (
    <Suspense fallback={null}>
      <TresorerieToolbarInner {...props} />
    </Suspense>
  );
}

// CEO 2026-06-23 : presets unifiés avec lib/finance/period-helpers.ts
const PERIODS: Array<{ v: string; label: string }> = [
  { v: 'last_7d', label: '7 jours' },
  { v: 'current_month', label: 'Ce mois' },
  { v: 'previous_month', label: 'Mois précédent' },
  { v: 'last_3_months', label: '3 mois' },
  { v: 'ytd', label: 'Année en cours' },
  { v: 'last_12_months', label: '12 mois' },
  { v: 'all', label: 'Tout' },
];

const STATUS_OPTIONS = [
  { v: 'unallocated', label: 'À allouer', color: 'text-orange-700 border-orange-300' },
  { v: 'partial', label: 'Partielles', color: 'text-amber-700 border-amber-300' },
  { v: 'allocated', label: 'Allouées', color: 'text-emerald-700 border-emerald-300' },
  { v: 'all', label: 'Toutes', color: 'text-stoniz-gray-700 border-stoniz-gray-300' },
];

const TYPE_OPTIONS = [
  { v: 'all', label: 'Tous' },
  { v: 'debit', label: 'Décaissements', color: 'text-red-700' },
  { v: 'credit', label: 'Encaissements', color: 'text-emerald-700' },
];

function TresorerieToolbarInner({ accounts, categories, basePath, compact, showExport, moduleKey }: ToolbarProps) {
  const router = useRouter();
  const pathnameHook = usePathname();
  const pathname = basePath ?? pathnameHook;
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [exportPending, setExportPending] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportWarning, setExportWarning] = useState<string | null>(null);

  // ─── SavedFilters (localStorage par moduleKey) — P2.A 2026-06-24 ─────────
  // Logique iso au canon `<ListToolbar>` (components/ui/list-toolbar.tsx)
  type SavedFilter = { name: string; query: string };
  const storageKey = moduleKey ? `stoniz_saved_filters_${moduleKey}` : null;
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setSaved(JSON.parse(raw));
    } catch {}
  }, [storageKey]);
  function saveSnapshot() {
    if (!storageKey) return;
    const name = prompt('Nom de ce filtre sauvegardé :');
    if (!name?.trim()) return;
    const query = params.toString();
    const next = [...saved.filter((s) => s.name !== name.trim()), { name: name.trim(), query }];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSaved(next);
    } catch {}
  }
  function loadSaved(s: SavedFilter) {
    start(() => router.push(`${pathname}${s.query ? `?${s.query}` : ''}`));
    setShowSaved(false);
  }
  function deleteSaved(name: string) {
    if (!storageKey) return;
    if (!confirm(`Supprimer le filtre "${name}" ?`)) return;
    const next = saved.filter((s) => s.name !== name);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setSaved(next);
    } catch {}
  }

  // Export XLSX de la vue filtrée — utilise les query params actuels
  async function onExport() {
    setExportError(null);
    setExportWarning(null);
    setExportPending(true);
    try {
      const spObj: Record<string, string> = {};
      params.forEach((v, k) => {
        spObj[k] = v;
      });
      const result = await exportTransactionsXlsxAction(spObj);
      if (!result || !result.ok) {
        setExportError(result?.error ?? 'Export impossible');
        return;
      }
      // Avertir si l'export a été tronqué (>5000 lignes)
      if (result.truncated) {
        setExportWarning(
          `Export tronqué : ${result.exportedCount.toLocaleString('fr-FR')} lignes sur ${result.totalCount.toLocaleString('fr-FR')} disponibles. Affine la période pour tout récupérer.`
        );
      }
      // Décode base64 → blob → download
      const bin = atob(result.base64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export impossible');
    } finally {
      setExportPending(false);
    }
  }

  // ─── Lecture initiale depuis l'URL ────────────────────────────────────
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? 'unallocated';
  const period = params.get('period') ?? 'last_3_months';
  const type = params.get('type') ?? 'all';
  const accountId = params.get('account_id') ?? '';
  const category = params.get('category') ?? '';
  const min = params.get('min') ?? '';
  const max = params.get('max') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  // ─── State local pour le champ recherche (debounce) ────────────────────
  const [searchLocal, setSearchLocal] = useState(q);
  const searchRef = useRef<HTMLInputElement>(null);

  // Sync local si l'URL change (navigation back/forward)
  useEffect(() => {
    setSearchLocal(q);
  }, [q]);

  // ─── Cmd+K → focus recherche ──────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ─── Debounce de la recherche ─────────────────────────────────────────
  useEffect(() => {
    if (searchLocal === q) return;
    const t = setTimeout(() => {
      pushParams({ q: searchLocal || null, page: null });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLocal]);

  function pushParams(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    start(() => {
      router.push(`${pathname}${qs ? `?${qs}` : ''}`);
    });
  }

  function reset() {
    setSearchLocal('');
    start(() => {
      router.push(pathname);
    });
  }

  // Affichage compact des filtres actifs (chips de réinit)
  const activeChips = useMemo(() => {
    const chips: Array<{ label: string; key: string }> = [];
    if (period && period !== 'last_3_months') chips.push({ label: PERIODS.find((p) => p.v === period)?.label ?? period, key: 'period' });
    if (status && status !== 'unallocated') chips.push({ label: STATUS_OPTIONS.find((s) => s.v === status)?.label ?? status, key: 'status' });
    if (type && type !== 'all') chips.push({ label: TYPE_OPTIONS.find((t) => t.v === type)?.label ?? type, key: 'type' });
    if (accountId) {
      const a = accounts.find((x) => x.id === accountId);
      if (a) chips.push({ label: a.label, key: 'account_id' });
    }
    if (category) {
      const c = categories.find((x) => x.value === category);
      if (c) chips.push({ label: c.label, key: 'category' });
    }
    if (min) chips.push({ label: `≥ ${min} MAD`, key: 'min' });
    if (max) chips.push({ label: `≤ ${max} MAD`, key: 'max' });
    if (from) chips.push({ label: `du ${from}`, key: 'from' });
    if (to) chips.push({ label: `au ${to}`, key: 'to' });
    return chips;
  }, [period, status, type, accountId, category, min, max, from, to, accounts, categories]);

  const hasAnyFilter = activeChips.length > 0 || q;

  return (
    <div className={`space-y-2 ${pending ? 'opacity-70' : ''}`}>
      {/* Ligne 1 : recherche + chips d'action rapide */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stoniz-gray-400" />
          <input
            ref={searchRef}
            value={searchLocal}
            onChange={(e) => setSearchLocal(e.target.value)}
            placeholder="Recherche libellé, bénéficiaire, référence ou montant (⌘K)"
            className="w-full text-sm border border-stoniz-gray-300 rounded-lg pl-8 pr-10 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-stoniz-black/10"
          />
          {searchLocal && (
            <button
              type="button"
              onClick={() => setSearchLocal('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-stoniz-gray-400 hover:text-stoniz-black"
              title="Effacer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd className="hidden md:inline-block absolute right-9 top-1/2 -translate-y-1/2 text-[10px] text-stoniz-gray-400 border border-stoniz-gray-200 rounded px-1 py-0.5 pointer-events-none">⌘K</kbd>
        </div>

        {/* Type débit/crédit en pill rapide */}
        <PillGroup
          value={type}
          options={TYPE_OPTIONS.map((o) => ({ v: o.v, label: o.label }))}
          onChange={(v) => pushParams({ type: v === 'all' ? null : v, page: null })}
        />

        {/* Statut */}
        <PillGroup
          value={status}
          options={STATUS_OPTIONS.map((o) => ({ v: o.v, label: o.label }))}
          onChange={(v) => pushParams({ status: v === 'unallocated' ? null : v, page: null })}
        />

        {/* SavedFilters : bouton "Mes filtres" si au moins 1 sauvegardé */}
        {storageKey && saved.length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSaved((s) => !s)}
              className="inline-flex items-center gap-1 text-xs text-stoniz-gray-700 hover:text-stoniz-black px-2 py-1.5 rounded border border-stoniz-gray-300 hover:bg-stoniz-gray-50"
              title="Charger un filtre sauvegardé"
            >
              <Bookmark className="w-3 h-3" />
              Mes filtres ({saved.length})
              <ChevronDown className="w-3 h-3" />
            </button>
            {showSaved && (
              <div className="absolute right-0 mt-1 bg-white border border-stoniz-gray-200 rounded-md shadow-lg p-2 z-20 min-w-[220px]">
                {saved.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-stoniz-gray-50 rounded"
                  >
                    <button
                      type="button"
                      onClick={() => loadSaved(s)}
                      className="text-sm text-left flex-1 truncate"
                    >
                      {s.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSaved(s.name)}
                      className="text-stoniz-gray-400 hover:text-red-600"
                      title="Supprimer ce filtre"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {hasAnyFilter && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 text-xs text-stoniz-gray-600 hover:text-stoniz-black px-2 py-1.5 rounded border border-stoniz-gray-200 hover:bg-stoniz-gray-50"
            title="Réinitialiser tous les filtres"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}

        {storageKey && hasAnyFilter && (
          <button
            type="button"
            onClick={saveSnapshot}
            className="inline-flex items-center gap-1 text-xs text-stoniz-gray-600 hover:text-stoniz-black px-2 py-1.5 rounded border border-stoniz-gray-200 hover:bg-stoniz-gray-50"
            title="Sauvegarder cette combinaison de filtres"
          >
            <Bookmark className="w-3 h-3" />
            Sauvegarder
          </button>
        )}

        {showExport && (
          <button
            type="button"
            onClick={onExport}
            disabled={exportPending}
            className="inline-flex items-center gap-1 text-xs text-stoniz-gray-700 hover:text-stoniz-black px-2 py-1.5 rounded border border-stoniz-gray-300 hover:bg-stoniz-gray-50 disabled:opacity-50"
            title="Exporter la vue filtrée en XLSX"
          >
            {exportPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            Export XLSX
          </button>
        )}
      </div>

      {exportError && (
        <SessionExpiredBanner error={`Export XLSX échec — ${exportError}`} />
      )}
      {exportWarning && (
        <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-center gap-2">
          <span aria-hidden="true">⚠</span>
          <span>{exportWarning}</span>
        </div>
      )}

      {/* Ligne 2 : période + plus de filtres */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-stoniz-gray-500 mr-1">Période :</span>
        {PERIODS.map((p) => (
          <button
            key={p.v}
            type="button"
            onClick={() => pushParams({ period: p.v === 'last_3_months' ? null : p.v, from: null, to: null, page: null })}
            className={`px-2.5 py-1 rounded border ${
              period === p.v && !from && !to
                ? 'bg-stoniz-black text-white border-stoniz-black'
                : 'bg-white border-stoniz-gray-300 hover:bg-stoniz-gray-50'
            }`}
          >
            {p.label}
          </button>
        ))}

        {!compact && (
          <DateRange
            from={from}
            to={to}
            onApply={(f, t) => pushParams({ from: f || null, to: t || null, period: null, page: null })}
          />
        )}

        <MoreFilters
          accounts={accounts}
          categories={categories}
          accountId={accountId}
          category={category}
          min={min}
          max={max}
          onChange={(c) => pushParams({ ...c, page: null })}
        />
      </div>

      {/* Ligne 3 : chips de filtres actifs */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((c) => (
            <span
              key={c.key}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-stoniz-black/5 border border-stoniz-gray-200 text-stoniz-gray-700"
            >
              {c.label}
              <button
                type="button"
                onClick={() => pushParams({ [c.key]: null, page: null })}
                className="hover:text-stoniz-black"
                title="Retirer ce filtre"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PillGroup({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ v: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-stoniz-gray-300 overflow-hidden bg-white text-xs">
      {options.map((o, i) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1.5 ${i > 0 ? 'border-l border-stoniz-gray-200' : ''} ${
            value === o.v ? 'bg-stoniz-black text-white' : 'hover:bg-stoniz-gray-50 text-stoniz-gray-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DateRange({
  from,
  to,
  onApply,
}: {
  from: string;
  to: string;
  onApply: (f: string, t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setF(from); setT(to);
  }, [from, to]);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const active = !!from || !!to;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border ${
          active ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white border-stoniz-gray-300 hover:bg-stoniz-gray-50'
        }`}
      >
        Dates custom
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 right-0 bg-white border border-stoniz-gray-200 rounded-lg shadow-lg p-3 w-64">
          <label className="block text-[10px] uppercase tracking-wide text-stoniz-gray-500 mb-1">Du</label>
          <input type="date" value={f} onChange={(e) => setF(e.target.value)}
            className="w-full text-sm border border-stoniz-gray-300 rounded px-2 py-1 mb-2" />
          <label className="block text-[10px] uppercase tracking-wide text-stoniz-gray-500 mb-1">Au</label>
          <input type="date" value={t} onChange={(e) => setT(e.target.value)}
            className="w-full text-sm border border-stoniz-gray-300 rounded px-2 py-1" />
          <div className="flex items-center justify-between mt-3 text-xs">
            <button type="button" onClick={() => { setF(''); setT(''); onApply('', ''); setOpen(false); }}
              className="text-stoniz-gray-500 hover:text-stoniz-black">Effacer</button>
            <button type="button" onClick={() => { onApply(f, t); setOpen(false); }}
              className="px-3 py-1 rounded bg-stoniz-black text-white">Appliquer</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MoreFilters({
  accounts, categories,
  accountId, category, min, max,
  onChange,
}: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  accountId: string; category: string; min: string; max: string;
  onChange: (c: Record<string, string | null>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [localAccount, setLocalAccount] = useState(accountId);
  const [localCategory, setLocalCategory] = useState(category);
  const [localMin, setLocalMin] = useState(min);
  const [localMax, setLocalMax] = useState(max);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setLocalAccount(accountId); setLocalCategory(category); setLocalMin(min); setLocalMax(max);
  }, [accountId, category, min, max]);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const activeCount = [accountId, category, min, max].filter(Boolean).length;

  function apply() {
    onChange({
      account_id: localAccount || null,
      category: localCategory || null,
      min: localMin || null,
      max: localMax || null,
    });
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border ${
          activeCount > 0 ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white border-stoniz-gray-300 hover:bg-stoniz-gray-50'
        }`}
      >
        <Filter className="w-3 h-3" />
        Plus de filtres
        {activeCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center text-[10px] w-4 h-4 rounded-full bg-white text-stoniz-black">{activeCount}</span>
        )}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 right-0 bg-white border border-stoniz-gray-200 rounded-lg shadow-lg p-3 w-80">
          <label className="block text-[10px] uppercase tracking-wide text-stoniz-gray-500 mb-1">Compte bancaire</label>
          <select value={localAccount} onChange={(e) => setLocalAccount(e.target.value)}
            className="w-full text-sm border border-stoniz-gray-300 rounded px-2 py-1 mb-3">
            <option value="">Tous les comptes</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>

          <label className="block text-[10px] uppercase tracking-wide text-stoniz-gray-500 mb-1">Catégorie</label>
          <select value={localCategory} onChange={(e) => setLocalCategory(e.target.value)}
            className="w-full text-sm border border-stoniz-gray-300 rounded px-2 py-1 mb-3">
            <option value="">Toutes</option>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>

          <label className="block text-[10px] uppercase tracking-wide text-stoniz-gray-500 mb-1">Fourchette montant (MAD)</label>
          <div className="flex items-center gap-2 mb-3">
            <input type="number" placeholder="Min" value={localMin} onChange={(e) => setLocalMin(e.target.value)}
              className="w-full text-sm border border-stoniz-gray-300 rounded px-2 py-1" />
            <span className="text-stoniz-gray-400">—</span>
            <input type="number" placeholder="Max" value={localMax} onChange={(e) => setLocalMax(e.target.value)}
              className="w-full text-sm border border-stoniz-gray-300 rounded px-2 py-1" />
          </div>

          <div className="flex items-center justify-between text-xs">
            <button type="button"
              onClick={() => {
                setLocalAccount(''); setLocalCategory(''); setLocalMin(''); setLocalMax('');
                onChange({ account_id: null, category: null, min: null, max: null });
                setOpen(false);
              }}
              className="text-stoniz-gray-500 hover:text-stoniz-black">Effacer</button>
            <button type="button" onClick={apply}
              className="px-3 py-1 rounded bg-stoniz-black text-white">Appliquer</button>
          </div>
        </div>
      )}
    </div>
  );
}
