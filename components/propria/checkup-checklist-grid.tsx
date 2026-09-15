'use client';

import { useState, useTransition, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle } from 'lucide-react';
import {
  CHECKUP_CHECKLIST,
  TOTAL_CHECKUP_ITEMS,
  type CheckupItemStatus,
} from '@/lib/propria/checkup-checklist';
import { upsertCheckupItemAction } from '@/app/(team)/propria/checkups/actions';
import { CheckupProofUploader, type CheckupProof } from './checkup-proof-uploader';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';
import { CheckupItemTransformDialog } from './checkup-item-transform-dialog';

/** Autosave debounce (chantier 5 mobile). */
const AUTOSAVE_DELAY_MS = 700;

/** Backoff exponentiel (chantier 5 mobile, réseau 4G capricieux).
 *  1s → 2s → 4s → 8s → 16s puis abandon (5 tentatives max). */
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

/** Préfixe localStorage pour les brouillons de notes (clé : `${LS_PREFIX}${checkupId}`). */
const LS_PREFIX = 'checkup-draft-';

/** État global de synchronisation affiché en bandeau sticky. */
type SyncState =
  | { kind: 'idle' }                            // ✓ Tout sauvegardé
  | { kind: 'saving' }                          // ⏳ Sauvegarde…
  | { kind: 'pending'; count: number }          // ⚠ N modifs en attente (offline / debounce)
  | { kind: 'error'; count: number; attempt: number }; // ✗ Erreur réseau, retry…

type LocalDraft = {
  items: Record<string, string>;
  timestamp: number;
};

export type CheckupItemRow = {
  item_key: string;
  status: CheckupItemStatus;
  note: string | null;
};

/**
 * Map item_key → ids déjà créés depuis ce check-up (idempotence UI Phase C1).
 * Sert à afficher le badge "✅ Transformé" + griser les checkboxes correspondantes
 * dans la modale CheckupItemTransformDialog.
 */
export type TransformedByItem = Record<
  string,
  { tache?: string; intervention?: string; litige?: string }
>;

/**
 * Checklist interactive du check-up (chantier 11.a — MVP).
 * Chaque item : boutons OK ✅ / Problème ⚠ / N/A, note + photos si Problème
 * (note ET photo obligatoires — bloquant à la soumission, vérifié serveur).
 *
 * Phase C1 (CEO 2026-06-24) : ajout d'un bouton "⚡ Transformer" inline sur
 * chaque item non-OK pour les rôles propria / ceo / assistante. Permet de
 * créer tâche / intervention / litige sans attendre la validation finale.
 */
export function CheckupChecklistGrid({
  checkupId,
  items,
  proofs,
  uploaderNames,
  canEdit,
  canDelete,
  canTransform = false,
  transformedByItem = {},
  hasHostawayContext = false,
}: {
  checkupId: string;
  items: CheckupItemRow[];
  proofs: CheckupProof[];
  uploaderNames: Record<string, string>;
  canEdit: boolean;
  canDelete: boolean;
  /** Phase C1 : autorise le bouton "⚡ Transformer" inline sur items non-OK. */
  canTransform?: boolean;
  /** Phase C1 : map item_key → ids créés (badge "Transformé" + locks modale). */
  transformedByItem?: TransformedByItem;
  /** Phase C1 : litige possible (résa Hostaway < 30j sur le lot). */
  hasHostawayContext?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // Notes en cours d'édition (clé item → texte). Autosave debounce 700ms (chantier 5).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Phase C1 : clé d'item dont la modale Transformer est ouverte (null = fermée).
  const [transformItemKey, setTransformItemKey] = useState<string | null>(null);
  const autosaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [savedFlash, setSavedFlash] = useState<Record<string, boolean>>({});

  // --- Chantier 5 P0 : backup localStorage + indicateur global de synchro ---
  //
  // Bug d'origine : autosave 700ms sur notes + immédiat sur status + on-blur sur
  // inventaire. Si la 4G coupe entre la frappe et l'envoi serveur, perte
  // silencieuse → l'équipe terrain ne s'en rend compte qu'à la soumission.
  //
  // Stratégie : mirror localStorage à chaque modif, restauration au mount si plus
  // récent que le serveur, retry exponentiel sur erreur réseau, indicateur global
  // visible en haut. Pas de Service Worker (vague 1).
  const [syncState, setSyncState] = useState<SyncState>({ kind: 'idle' });
  const pendingSavesRef = useRef<Map<string, { note: string; attempt: number }>>(new Map());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lsKey = `${LS_PREFIX}${checkupId}`;
  // Ref miroir de drafts pour lire la valeur actuelle depuis les closures de setTimeout
  // (évite que le flush autosave envoie une note stale lors d'une frappe rapide).
  const draftsRef = useRef<Record<string, string>>({});

  // Restauration des brouillons localStorage au mount.
  // Compare au plus récent updated_at *serveur* : si le brouillon est plus récent,
  // on le pousse dans le state local (= il sera renvoyé au prochain autosave).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(lsKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as LocalDraft;
      if (!parsed || typeof parsed !== 'object' || !parsed.items) return;
      // On considère le brouillon comme "à restaurer" : on ne dispose pas du
      // server updated_at par item ici → on adopte la version locale et on
      // déclenche l'autosave différé pour resynchroniser.
      const restored: Record<string, string> = {};
      let restoredCount = 0;
      for (const [k, v] of Object.entries(parsed.items)) {
        const serverNote = itemsByKey.get(k)?.note ?? '';
        if (typeof v === 'string' && v !== serverNote) {
          restored[k] = v;
          restoredCount++;
        }
      }
      if (restoredCount > 0) {
        setDrafts((d) => ({ ...restored, ...d }));
        setSyncState({ kind: 'pending', count: restoredCount });
        // Planifier la resynchro
        for (const k of Object.keys(restored)) {
          scheduleAutosaveRef.current?.(k);
        }
      } else {
        // Aucun écart : on peut nettoyer le LS proprement.
        window.localStorage.removeItem(lsKey);
      }
    } catch (e) {
      console.warn('[checkup-draft] restauration localStorage échouée', e);
    }
    // Une seule restauration au mount (checkupId stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkupId]);

  // Sync draftsRef à chaque render
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);

  // Persistance localStorage à chaque modif de drafts.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nonEmpty = Object.fromEntries(
      Object.entries(drafts).filter(([, v]) => typeof v === 'string' && v.length > 0)
    );
    if (Object.keys(nonEmpty).length === 0) {
      try { window.localStorage.removeItem(lsKey); } catch {}
      return;
    }
    try {
      const payload: LocalDraft = { items: nonEmpty, timestamp: Date.now() };
      window.localStorage.setItem(lsKey, JSON.stringify(payload));
    } catch (e) {
      console.warn('[checkup-draft] persist localStorage échoué', e);
    }
  }, [drafts, lsKey]);

  // Nettoyage des timers à l'unmount
  useEffect(() => {
    return () => {
      Object.values(autosaveTimers.current).forEach(clearTimeout);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  // Ref vers scheduleAutosave (défini plus bas) — pour pouvoir l'appeler depuis l'effet de mount
  const scheduleAutosaveRef = useRef<((itemKey: string) => void) | null>(null);

  const itemsByKey = new Map(items.map((i) => [i.item_key, i]));
  const proofsByKey = new Map<string, CheckupProof[]>();
  for (const p of proofs) {
    if (!p.itemKey) continue;
    const arr = proofsByKey.get(p.itemKey) ?? [];
    arr.push(p);
    proofsByKey.set(p.itemKey, arr);
  }

  const filledCount = items.length;
  const progressPct = Math.round((filledCount / Math.max(1, TOTAL_CHECKUP_ITEMS)) * 100);
  const problemCount = items.filter((i) => i.status === 'probleme').length;

  /** Met à jour l'état global de synchro selon les saves en attente. */
  const refreshSyncState = useCallback(() => {
    const pending = pendingSavesRef.current;
    if (pending.size === 0) {
      setSyncState({ kind: 'idle' });
      // Tout est synced → on peut purger le localStorage
      if (typeof window !== 'undefined') {
        try { window.localStorage.removeItem(lsKey); } catch {}
      }
      return;
    }
    // Si au moins une entrée est en erreur (attempt > 0), on affiche erreur
    let maxAttempt = 0;
    for (const v of pending.values()) {
      if (v.attempt > maxAttempt) maxAttempt = v.attempt;
    }
    if (maxAttempt > 0) {
      setSyncState({ kind: 'error', count: pending.size, attempt: maxAttempt });
    } else {
      setSyncState({ kind: 'pending', count: pending.size });
    }
  }, [lsKey]);

  /** Tentative réelle de save pour un item. Gère retry exponentiel sur erreur. */
  const flushSave = useCallback(async (itemKey: string) => {
    const entry = pendingSavesRef.current.get(itemKey);
    if (!entry) return;
    const existing = itemsByKey.get(itemKey);
    const status: CheckupItemStatus = existing?.status ?? 'ok';
    setSyncState({ kind: 'saving' });
    try {
      const r = await upsertCheckupItemAction({
        checkup_id: checkupId,
        item_key: itemKey,
        status,
        note: entry.note,
      });
      if (!r || !r.ok) throw new Error(r?.error ?? 'Erreur inconnue');
      // Succès : on retire l'entrée
      pendingSavesRef.current.delete(itemKey);
      setSavedFlash((f) => ({ ...f, [itemKey]: true }));
      setTimeout(() => setSavedFlash((f) => ({ ...f, [itemKey]: false })), 1500);
      refreshSyncState();
      router.refresh();
    } catch (e: any) {
      // Échec : on incrémente le compteur et on replanifie en backoff
      const attempt = entry.attempt + 1;
      pendingSavesRef.current.set(itemKey, { note: entry.note, attempt });
      if (attempt >= RETRY_DELAYS_MS.length) {
        // Plafond atteint : on laisse l'entrée en pending (le LS reste = sécurité)
        setErr(`Échec d'envoi répété pour cette note. Les modifs restent sauvegardées localement.`);
        refreshSyncState();
        return;
      }
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 16000;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        // On retente tous les pending (au cas où d'autres soient stuck)
        for (const k of Array.from(pendingSavesRef.current.keys())) {
          flushSave(k);
        }
      }, delay);
      refreshSyncState();
    }
  }, [checkupId, itemsByKey, refreshSyncState, router]);

  function setStatus(itemKey: string, status: CheckupItemStatus) {
    if (!canEdit) return;
    setErr(null);
    const existing = itemsByKey.get(itemKey);
    // setStatus est immédiat (pas debouncé) : on bypass le pending map pour rester
    // sur l'UX d'avant, mais en remontant l'erreur via syncState au lieu d'un toast.
    setSyncState({ kind: 'saving' });
    start(async () => {
      try {
        const r = await upsertCheckupItemAction({
          checkup_id: checkupId,
          item_key: itemKey,
          status,
          note: drafts[itemKey] ?? existing?.note ?? null,
        });
        if (!r || !r.ok) {
          setErr(r?.error ?? 'Erreur inconnue');
          // On marque l'item comme pending pour retry
          const noteToSave = drafts[itemKey] ?? existing?.note ?? '';
          pendingSavesRef.current.set(itemKey, { note: noteToSave, attempt: 1 });
          const delay = RETRY_DELAYS_MS[0];
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            for (const k of Array.from(pendingSavesRef.current.keys())) flushSave(k);
          }, delay);
          refreshSyncState();
          return;
        }
        refreshSyncState();
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
        refreshSyncState();
      }
    });
  }

  /** Autosave debounce : appelé à chaque frappe sur une note (chantier 5). */
  function scheduleAutosave(itemKey: string) {
    const existing = autosaveTimers.current[itemKey];
    if (existing) clearTimeout(existing);
    // Enregistre immédiatement le draft dans le pendingMap (avec attempt=0
    // = pas d'erreur). Cela permet à l'indicateur de remonter "⏳ N modifs".
    const noteNow = draftsRef.current[itemKey] ?? '';
    pendingSavesRef.current.set(itemKey, { note: noteNow, attempt: 0 });
    refreshSyncState();
    autosaveTimers.current[itemKey] = setTimeout(() => {
      // Au moment de flusher, on relit la valeur la plus récente via le ref
      const latest = draftsRef.current[itemKey] ?? noteNow;
      pendingSavesRef.current.set(itemKey, { note: latest, attempt: 0 });
      flushSave(itemKey);
    }, AUTOSAVE_DELAY_MS);
  }

  // Lier le ref pour permettre à l'effet de mount de scheduler
  scheduleAutosaveRef.current = scheduleAutosave;

  // Boutons OK/Problème/N/A : 44×44 px min (tactile mobile, chantier 5).
  const statusBtn = (active: boolean, palette: string) =>
    `min-h-[44px] px-3 py-2 rounded-md text-sm font-medium border transition-colors disabled:opacity-50 ${
      active ? palette : 'bg-white border-stoniz-gray-300 text-stoniz-gray-600 hover:bg-stoniz-gray-50'
    }`;

  // Progression par section (chantier 5 P1 collapse + TOC)
  const sectionProgress = useMemo(() => {
    return CHECKUP_CHECKLIST.map((s) => {
      const total = s.items.length;
      const done = s.items.filter((it) => itemsByKey.has(it.key)).length;
      return { key: s.key, title: s.title, emoji: s.emoji, done, total, complete: total > 0 && done === total };
    });
  }, [itemsByKey]);

  // Gestion ouverture/fermeture des sections.
  // Stratégie : ouvert par défaut, auto-close UNE FOIS quand la section devient 100%
  // (l'utilisateur peut ensuite rouvrir manuellement et on respecte son choix).
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set());
  const autoClosedOnceRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const sp of sectionProgress) {
      if (sp.complete && !autoClosedOnceRef.current.has(sp.key)) {
        autoClosedOnceRef.current.add(sp.key);
        setClosedSections((prev) => {
          const next = new Set(prev);
          next.add(sp.key);
          return next;
        });
      }
    }
  }, [sectionProgress]);

  // Scroll smooth vers une section (TOC).
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  function scrollToSection(key: string) {
    // Si la section est fermée, on la ré-ouvre avant de scroller
    if (closedSections.has(key)) {
      setClosedSections((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    setTimeout(() => {
      const el = sectionRefs.current[key];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg">📋 Checklist check-up</h2>
          <p className="text-xs text-stoniz-gray-500 mt-0.5">
            Chaque item se note OK / Problème / N/A. Problème ⚠ = note + photo obligatoires.
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-display">{filledCount}/{TOTAL_CHECKUP_ITEMS}</div>
          <div className="text-[11px] uppercase text-stoniz-gray-500">
            items renseignés{problemCount > 0 && <span className="text-orange-600"> · {problemCount} ⚠</span>}
          </div>
        </div>
      </div>

      <div className="w-full bg-stoniz-gray-100 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${progressPct === 100 ? 'bg-emerald-500' : 'bg-amber-400'}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Bandeau sticky (chantier 5 P0) : statut global de synchronisation +
          navigation entre sections. Visible en permanence pour rassurer l'équipe
          terrain qui bosse en 4G capricieuse. */}
      <div className="sticky top-0 z-10 -mx-5 px-5 py-2 bg-white/95 backdrop-blur border-b border-stoniz-gray-200 space-y-2">
        {/* Indicateur sync global */}
        <div className={`flex items-center gap-2 text-xs font-medium rounded-md px-2 py-1.5 ${
          syncState.kind === 'idle' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          : syncState.kind === 'saving' ? 'bg-amber-50 text-amber-800 border border-amber-200'
          : syncState.kind === 'pending' ? 'bg-orange-50 text-orange-800 border border-orange-200'
          : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {syncState.kind === 'idle' && <><span>✓</span><span>Tout sauvegardé</span></>}
          {syncState.kind === 'saving' && <><span>⏳</span><span>Sauvegarde…</span></>}
          {syncState.kind === 'pending' && <><span>⚠</span><span>{syncState.count} modif{syncState.count > 1 ? 's' : ''} en attente</span></>}
          {syncState.kind === 'error' && <><span>✗</span><span>Erreur réseau, retry… (tentative {syncState.attempt}/{RETRY_DELAYS_MS.length})</span></>}
        </div>
        {/* TOC compact : 8 boutons avec progression par section */}
        <nav className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1" aria-label="Navigation sections">
          {sectionProgress.map((sp) => (
            <button
              key={sp.key}
              type="button"
              onClick={() => scrollToSection(sp.key)}
              className={`flex-shrink-0 px-2 py-1.5 rounded-md text-[11px] font-medium border whitespace-nowrap min-h-[36px] transition-colors ${
                sp.complete
                  ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                  : sp.done > 0
                    ? 'bg-amber-50 border-amber-300 text-amber-800'
                    : 'bg-white border-stoniz-gray-300 text-stoniz-gray-700 hover:bg-stoniz-gray-50'
              }`}
              title={sp.title}
            >
              <span className="mr-1">{sp.emoji}</span>
              <span className="hidden xs:inline">{sp.title}</span>
              <span className="ml-1 tabular-nums">{sp.done}/{sp.total}</span>
              {sp.complete && <span className="ml-0.5">✓</span>}
            </button>
          ))}
        </nav>
      </div>

      {err && <SessionExpiredBanner error={err} />}

      {CHECKUP_CHECKLIST.map((section) => {
        const sp = sectionProgress.find((s) => s.key === section.key)!;
        const isOpen = !closedSections.has(section.key);
        return (
        // <details> natif HTML (chantier 5 P1) : ouvert par défaut, auto-close
        // quand 100 % complété (une fois), réouvrable manuellement. On force open
        // via la prop pour pouvoir aussi le piloter via le TOC.
        <details
          key={section.key}
          open={isOpen}
          onToggle={(e) => {
            const opened = (e.target as HTMLDetailsElement).open;
            setClosedSections((prev) => {
              const next = new Set(prev);
              if (opened) next.delete(section.key); else next.add(section.key);
              return next;
            });
          }}
          ref={(el) => { sectionRefs.current[section.key] = el; }}
          className="space-y-2 group/sec scroll-mt-32"
        >
          <summary className="cursor-pointer list-none flex items-center justify-between gap-2 select-none">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-stoniz-gray-800 flex items-center gap-1.5">
                <span className="inline-block w-3 text-stoniz-gray-400 transition-transform group-open/sec:rotate-90">▶</span>
                {section.emoji} {section.title}
                <span className={`ml-1 text-[11px] px-1.5 py-0.5 rounded ${
                  sp.complete ? 'bg-emerald-100 text-emerald-800' : 'bg-stoniz-gray-100 text-stoniz-gray-700'
                }`}>
                  {sp.done}/{sp.total}{sp.complete ? ' ✓' : ''}
                </span>
              </h3>
              {section.description && (
                <p className="text-xs text-stoniz-gray-500 ml-4">{section.description}</p>
              )}
            </div>
          </summary>
          <div className="space-y-2">
            {section.items.map((item) => {
              const row = itemsByKey.get(item.key);
              const itemProofs = proofsByKey.get(item.key) ?? [];
              const isProblem = row?.status === 'probleme';
              const done = !!row;
              const noteValue = drafts[item.key] ?? row?.note ?? '';
              const missingNote = isProblem && !(noteValue ?? '').trim();
              const missingPhoto = isProblem && itemProofs.length === 0;
              // Phase C1 : bouton Transformer visible uniquement sur items non-OK
              // (status renseigné ET différent de 'ok'). On exclut volontairement
              // les items 'na' (non applicable) car ils ne génèrent pas d'action.
              const isNonOk = !!row && row.status !== 'ok' && row.status !== 'na';
              const transformed = transformedByItem[item.key];
              const alreadyTransformed = !!(transformed && (transformed.tache || transformed.intervention || transformed.litige));
              return (
                <div
                  key={item.key}
                  className={`border rounded-lg p-3 ${
                    isProblem
                      ? 'border-orange-300 bg-orange-50/40'
                      : done
                        ? 'border-emerald-300 bg-emerald-50/40'
                        : 'border-stoniz-gray-200 bg-stoniz-gray-50/30'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="text-3xl leading-none flex-shrink-0">{item.emoji}</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium flex items-center gap-1.5">
                          {done
                            ? <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${isProblem ? 'text-orange-600' : 'text-emerald-600'}`} />
                            : <Circle className="w-4 h-4 text-stoniz-gray-400 flex-shrink-0" />}
                          {item.label}
                        </div>
                        {item.hint && (
                          <div className="text-[11px] text-stoniz-gray-500">{item.hint}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        disabled={!canEdit || pending}
                        onClick={() => setStatus(item.key, 'ok')}
                        className={statusBtn(row?.status === 'ok', 'bg-emerald-600 border-emerald-600 text-white')}
                      >
                        ✅ OK
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit || pending}
                        onClick={() => setStatus(item.key, 'probleme')}
                        className={statusBtn(row?.status === 'probleme', 'bg-orange-500 border-orange-500 text-white')}
                      >
                        ⚠ Problème
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit || pending}
                        onClick={() => setStatus(item.key, 'na')}
                        className={statusBtn(row?.status === 'na', 'bg-stoniz-gray-600 border-stoniz-gray-600 text-white')}
                      >
                        N/A
                      </button>
                    </div>
                  </div>

                  {/* Phase C1 — Bouton "⚡ Transformer" + badge "✅ Transformé"
                      inline. Affiché uniquement aux rôles habilités (canTransform)
                      sur les items non-OK. Lit transformedByItem côté server
                      pour distinguer "à transformer" vs "déjà transformé". */}
                  {canTransform && isNonOk && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {alreadyTransformed ? (
                        <>
                          <span className="text-[11px] bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-1 rounded-md font-medium">
                            ✅ Transformé
                            {[
                              transformed?.tache && '📌',
                              transformed?.intervention && '🔧',
                              transformed?.litige && '⚖️',
                            ].filter(Boolean).join(' ')}
                          </span>
                          <button
                            type="button"
                            onClick={() => setTransformItemKey(item.key)}
                            className="text-[11px] border border-blue-300 bg-blue-50 text-blue-800 px-2 py-1 rounded-md hover:bg-blue-100"
                          >
                            ↻ Re-transformer / compléter
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTransformItemKey(item.key)}
                          className="text-xs border border-blue-300 bg-blue-50 text-blue-800 px-3 py-1.5 rounded-md hover:bg-blue-100 font-medium"
                        >
                          ⚡ Transformer en tâche / intervention / litige
                        </button>
                      )}
                    </div>
                  )}

                  {/* Note (obligatoire si Problème) + photos par item */}
                  {isProblem && (
                    <div className="mt-3 space-y-2">
                      <div>
                        <label className="text-[11px] font-medium text-orange-800 flex items-center gap-2">
                          Note (obligatoire) {missingNote && <span className="text-red-600">— à remplir</span>}
                          {savedFlash[item.key] && <span className="text-emerald-600 text-[10px]">✓ enregistré</span>}
                        </label>
                        {/* text-base sur mobile (chantier 5 P0) : <16px déclenche le zoom
                            auto Safari iOS au focus — perte d'orientation pour l'équipe terrain. */}
                        <textarea
                          rows={2}
                          value={noteValue}
                          disabled={!canEdit || pending}
                          onChange={(e) => {
                            setDrafts((d) => ({ ...d, [item.key]: e.target.value }));
                            if (canEdit && itemsByKey.has(item.key)) scheduleAutosave(item.key);
                          }}
                          placeholder="Décris le problème constaté… (sauvegarde auto)"
                          className="w-full mt-1 border border-orange-300 rounded-md px-2 py-2 text-base sm:text-sm bg-white min-h-[60px]"
                        />
                      </div>
                      {missingPhoto && (
                        <div className="text-[11px] text-red-700">
                          📸 Photo obligatoire pour cet item en Problème.
                        </div>
                      )}
                      <CheckupProofUploader
                        checkupId={checkupId}
                        proofs={itemProofs}
                        uploaderNames={uploaderNames}
                        canUpload={canEdit}
                        canDelete={canDelete}
                        itemKey={item.key}
                        compact
                        title={`Photos du problème (${itemProofs.length})`}
                      />
                    </div>
                  )}

                  {/* Photos optionnelles : disponibles aussi sur OK/N/A (chantier 5) */}
                  {!isProblem && canEdit && (
                    <div className="mt-3">
                      <CheckupProofUploader
                        checkupId={checkupId}
                        proofs={itemProofs}
                        uploaderNames={uploaderNames}
                        canUpload={canEdit}
                        canDelete={canDelete}
                        itemKey={item.key}
                        compact
                        title={itemProofs.length > 0 ? `Photos (${itemProofs.length})` : 'Photo facultative (référence)'}
                      />
                    </div>
                  )}
                  {!isProblem && !canEdit && itemProofs.length > 0 && (
                    <div className="mt-3">
                      <CheckupProofUploader
                        checkupId={checkupId}
                        proofs={itemProofs}
                        uploaderNames={uploaderNames}
                        canUpload={false}
                        canDelete={canDelete}
                        itemKey={item.key}
                        compact
                        title={`Photos (${itemProofs.length})`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
        );
      })}

      {/* Phase C1 — Modale Transformer (1 instance, pilotée par transformItemKey) */}
      {transformItemKey && (() => {
        // Recherche l'item dans le canon CHECKUP_CHECKLIST pour récupérer label + emoji
        let label = transformItemKey;
        let emoji = '⚠️';
        for (const sec of CHECKUP_CHECKLIST) {
          const found = sec.items.find((it) => it.key === transformItemKey);
          if (found) { label = found.label; emoji = found.emoji; break; }
        }
        const row = itemsByKey.get(transformItemKey);
        const noteForDialog = drafts[transformItemKey] ?? row?.note ?? null;
        return (
          <CheckupItemTransformDialog
            open
            onClose={() => setTransformItemKey(null)}
            checkupId={checkupId}
            itemKey={transformItemKey}
            itemLabel={label}
            itemEmoji={emoji}
            itemNote={noteForDialog}
            hasHostawayContext={hasHostawayContext}
            alreadyTransformed={transformedByItem[transformItemKey]}
          />
        );
      })()}
    </div>
  );
}
