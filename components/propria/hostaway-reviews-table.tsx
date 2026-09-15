'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, AlertCircle, CheckCircle2, MessageSquare, Star, Trash2 } from 'lucide-react';
import {
  syncHostawayReviewsAction,
  markReviewInternalStatusAction,
} from '@/app/(team)/propria/integrations/hostaway/actions';

type Review = {
  id: string;
  hostaway_id: number;
  channel_name: string | null;
  guest_name: string | null;
  public_review: string | null;
  private_review: string | null;
  rating: number | null;
  rating_normalized: number | null;
  category_ratings: any;
  response_from_host: string | null;
  submitted_at: string;
  is_published: boolean;
  removed_at: string | null;
  internal_status: 'to_review' | 'reviewed' | 'resolved';
  internal_notes: string | null;
  internal_handled_by: string | null;
  internal_handled_at: string | null;
  unit_code: string | null;
  property_name: string | null;
  property_code: string | null;
};

const CHANNEL_ICON: Record<string, string> = {
  'airbnb': '🅰️',
  'booking.com': '🅱️',
  'booking': '🅱️',
  'direct': '🔗',
  'vrbo': '🏠',
};

const STATUS_LABEL: Record<string, string> = {
  to_review: 'À traiter',
  reviewed: 'Vu',
  resolved: 'Traité',
};

const STATUS_COLOR: Record<string, string> = {
  to_review: 'bg-amber-100 text-amber-800 border-amber-200',
  reviewed: 'bg-blue-100 text-blue-800 border-blue-200',
  resolved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function RatingStars({ rating }: { rating: number | null }) {
  if (rating == null) return <span className="text-stoniz-gray-400 text-xs">—</span>;
  const isFiveOfFive = rating >= 4.95;
  const isNegative = rating <= 3;
  const color = isFiveOfFive ? 'text-emerald-600' : isNegative ? 'text-red-600' : 'text-amber-600';
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${color}`}>
      <Star className="w-3.5 h-3.5 fill-current" />
      <span>{rating.toFixed(1)}/5</span>
    </span>
  );
}

export function HostawayReviewsTable({
  reviews,
  counts,
  channels,
  units,
  currentFilter,
  currentChannel,
  currentUnit,
}: {
  reviews: Review[];
  counts: { all: number; notFive: number; negative: number; removed: number; toReview: number; resolved: number };
  channels: string[];
  units: { id: string; code: string }[];
  currentFilter: string;
  currentChannel: string;
  currentUnit: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  function runSync() {
    setMsg(null);
    start(async () => {
      const r = await syncHostawayReviewsAction()
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!r?.ok) {
        setMsg({ kind: 'err', text: r?.error ?? 'Échec sync.' });
        return;
      }
      const info = (r as any).info;
      const total = (r as any).total ?? 0;
      const created = (r as any).created ?? 0;
      const updated = (r as any).updated ?? 0;
      const removed = (r as any).removed ?? 0;
      setMsg({
        kind: 'ok',
        text: info ?? `✓ ${total} avis · ${created} créé(s), ${updated} mis à jour, ${removed} marqué(s) supprimé(s).`,
      });
      router.refresh();
    });
  }

  function setStatus(reviewId: string, status: 'to_review' | 'reviewed' | 'resolved', notes?: string) {
    start(async () => {
      const r = await markReviewInternalStatusAction({ review_id: reviewId, status, notes })
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any)?.ok) {
        setMsg({ kind: 'err', text: (r as any)?.error ?? 'Échec' });
        return;
      }
      router.refresh();
    });
  }

  function chipClass(active: boolean, color: 'black' | 'red' | 'orange' | 'gray' | 'emerald' = 'black') {
    if (active) {
      const map = {
        black: 'bg-stoniz-black',
        red: 'bg-red-600',
        orange: 'bg-orange-600',
        gray: 'bg-stoniz-gray-700',
        emerald: 'bg-emerald-600',
      };
      return `${map[color]} text-white`;
    }
    return 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200 text-stoniz-gray-700';
  }

  function makeHref(params: Record<string, string | undefined>) {
    const merged: Record<string, string> = {};
    if (currentFilter && currentFilter !== 'all') merged.filter = currentFilter;
    if (currentChannel) merged.channel = currentChannel;
    if (currentUnit) merged.unit = currentUnit;
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') delete merged[k];
      else merged[k] = v;
    }
    const qs = new URLSearchParams(merged).toString();
    return `/propria/avis${qs ? `?${qs}` : ''}`;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar : filtres + sync */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={makeHref({ filter: 'not-five' })}
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'not-five' || !currentFilter, 'orange')}`}>
            ⚠ Pas 5/5 ({counts.notFive})
          </Link>
          <Link href={makeHref({ filter: 'negative' })}
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'negative', 'red')}`}>
            🔴 ≤ 3/5 ({counts.negative})
          </Link>
          <Link href={makeHref({ filter: 'to-review' })}
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'to-review', 'orange')}`}>
            À traiter ({counts.toReview})
          </Link>
          <Link href={makeHref({ filter: 'removed' })}
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'removed', 'gray')}`}>
            🗑️ Supprimés ({counts.removed})
          </Link>
          <Link href={makeHref({ filter: 'resolved' })}
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'resolved', 'emerald')}`}>
            ✓ Traités ({counts.resolved})
          </Link>
          <Link href={makeHref({ filter: 'all' })}
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'all')}`}>
            Tous ({counts.all})
          </Link>
        </div>

        <button
          type="button"
          onClick={runSync}
          disabled={pending}
          className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 disabled:opacity-50 inline-flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${pending ? 'animate-spin' : ''}`} />
          {pending ? 'Sync…' : 'Synchroniser'}
        </button>
      </div>

      {/* Filtres canal + suite */}
      <div className="flex flex-wrap gap-4">
        {channels.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Link href={makeHref({ channel: undefined })}
              className={`px-3 py-1.5 rounded-full ${chipClass(!currentChannel)}`}>
              Tous canaux
            </Link>
            {channels.map((c) => (
              <Link key={c} href={makeHref({ channel: c })}
                className={`px-3 py-1.5 rounded-full ${chipClass(currentChannel === c)}`}>
                {CHANNEL_ICON[c.toLowerCase()] ?? '·'} {c}
              </Link>
            ))}
          </div>
        )}
        {units.length > 0 && (
          <select
            value={currentUnit}
            onChange={(e) => router.push(makeHref({ unit: e.target.value || undefined }))}
            className="border border-stoniz-gray-300 rounded px-2 py-1 text-xs"
          >
            <option value="">Toutes les suites</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.code}</option>
            ))}
          </select>
        )}
      </div>

      {msg && (
        <div className={`text-sm rounded-md px-3 py-2 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {reviews.length === 0 ? (
        <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center">
          <p className="text-stoniz-gray-700 mb-2">Aucun avis pour ces filtres.</p>
          <p className="text-xs text-stoniz-gray-500">
            Si c'est la 1ère fois, clique sur <strong>« Synchroniser »</strong> pour pull les avis Hostaway des 12 derniers mois.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => {
            const isFiveOfFive = (r.rating_normalized ?? 0) >= 4.95;
            const isNegative = (r.rating_normalized ?? 99) <= 3;
            const isOpen = openId === r.id;
            const isRemoved = !!r.removed_at;
            return (
              <div
                key={r.id}
                className={`bg-white border rounded-xl p-4 ${isRemoved ? 'opacity-60 border-stoniz-gray-300' : isNegative ? 'border-red-300' : !isFiveOfFive ? 'border-amber-200' : 'border-stoniz-gray-200'}`}
              >
                <div className="flex items-start gap-3">
                  {/* Note */}
                  <div className="shrink-0 text-center">
                    <RatingStars rating={r.rating_normalized} />
                    <div className="text-[10px] text-stoniz-gray-500 mt-1">
                      {formatDate(r.submitted_at)}
                    </div>
                  </div>

                  {/* Contenu */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-xs mb-1">
                      <span className="font-medium">{r.guest_name ?? 'Voyageur'}</span>
                      {r.channel_name && (
                        <span className="text-stoniz-gray-500">
                          · {CHANNEL_ICON[r.channel_name.toLowerCase()] ?? ''} {r.channel_name}
                        </span>
                      )}
                      {r.unit_code && (
                        <span className="text-emerald-700">
                          · <span className="font-mono">{r.unit_code}</span>
                          {r.property_name && <span className="text-emerald-600"> ({r.property_name})</span>}
                        </span>
                      )}
                      {!r.unit_code && (
                        <span className="text-orange-700 inline-flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Listing non matché
                        </span>
                      )}
                      <span className={`ml-auto text-[10px] uppercase px-2 py-0.5 rounded border ${STATUS_COLOR[r.internal_status]}`}>
                        {STATUS_LABEL[r.internal_status]}
                      </span>
                      {isRemoved && (
                        <span className="text-[10px] uppercase px-2 py-0.5 rounded border bg-stoniz-gray-100 text-stoniz-gray-700 border-stoniz-gray-200 inline-flex items-center gap-1">
                          <Trash2 className="w-3 h-3" />
                          Supprimé le {formatDate(r.removed_at!)}
                        </span>
                      )}
                    </div>

                    {/* Commentaire public */}
                    {r.public_review && (
                      <p className={`text-sm text-stoniz-gray-800 ${isOpen ? '' : 'line-clamp-2'}`}>
                        {r.public_review}
                      </p>
                    )}

                    {/* Bloc déplié */}
                    {isOpen && (
                      <div className="mt-3 space-y-3">
                        {/* Category ratings */}
                        {r.category_ratings && typeof r.category_ratings === 'object' && (
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            {Object.entries(r.category_ratings).map(([k, v]: any) => {
                              const val = v?.rating ?? v;
                              if (val == null) return null;
                              return (
                                <span key={k} className="px-2 py-0.5 bg-stoniz-gray-50 border border-stoniz-gray-200 rounded">
                                  {k}: <strong>{val}</strong>
                                </span>
                              );
                            })}
                          </div>
                        )}

                        {/* Avis privé */}
                        {r.private_review && (
                          <div className="text-xs">
                            <span className="font-medium text-stoniz-gray-600">Commentaire privé : </span>
                            <span className="text-stoniz-gray-700 italic">{r.private_review}</span>
                          </div>
                        )}

                        {/* Réponse hôte */}
                        {r.response_from_host && (
                          <div className="bg-blue-50 border border-blue-100 rounded p-2 text-xs">
                            <div className="font-medium text-blue-800 mb-1">Réponse hôte :</div>
                            <p className="text-blue-900">{r.response_from_host}</p>
                          </div>
                        )}

                        {/* Workflow interne */}
                        <ReviewWorkflowForm
                          review={r}
                          onSet={(status, notes) => setStatus(r.id, status, notes)}
                          pending={pending}
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? null : r.id)}
                      className="text-xs text-blue-600 hover:underline mt-2 inline-flex items-center gap-1"
                    >
                      <MessageSquare className="w-3 h-3" />
                      {isOpen ? 'Réduire' : 'Détail / Traiter'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReviewWorkflowForm({
  review,
  onSet,
  pending,
}: {
  review: Review;
  onSet: (status: 'to_review' | 'reviewed' | 'resolved', notes?: string) => void;
  pending: boolean;
}) {
  const [notes, setNotes] = useState(review.internal_notes ?? '');
  return (
    <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded p-3">
      <div className="text-xs font-medium mb-2">Workflow interne</div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Note interne (action prise, retour voyageur…)"
        className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-xs mb-2"
        rows={2}
      />
      <div className="flex gap-2 text-xs">
        <button
          type="button"
          disabled={pending}
          onClick={() => onSet('reviewed', notes)}
          className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Marquer comme vu
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onSet('resolved', notes)}
          className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <CheckCircle2 className="w-3 h-3" /> Marquer comme traité
        </button>
        {review.internal_status !== 'to_review' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => onSet('to_review', notes)}
            className="px-3 py-1 bg-stoniz-gray-200 text-stoniz-gray-700 rounded hover:bg-stoniz-gray-300 disabled:opacity-50"
          >
            Rouvrir
          </button>
        )}
      </div>
      {review.internal_handled_at && (
        <div className="text-[10px] text-stoniz-gray-500 mt-2">
          Dernière action : {new Date(review.internal_handled_at).toLocaleString('fr-FR')}
        </div>
      )}
    </div>
  );
}
