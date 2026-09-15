'use client';

import { useState, useTransition } from 'react';
import { UPSELL_CATEGORIES, UPSELL_CATEGORY_LABELS } from '@/lib/propria/upsell';
import { createUpsellOrderAction } from './actions';

/**
 * Formulaire de commande voyageur (page publique /upsell/[slug]).
 * Pas de paiement en ligne (décision B6) — la commande est transmise au
 * bureau qui recontacte le voyageur. Honeypot anti-bot : champ "website"
 * caché qui doit rester vide.
 */
export function UpsellOrderForm({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
        <div className="text-3xl mb-2">✓</div>
        <p className="font-medium text-emerald-900">
          Commande envoyée, l’équipe vous contacte rapidement.
        </p>
        <p className="text-sm text-emerald-700 mt-1">
          Your order has been sent — our team will contact you shortly.
        </p>
      </div>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      slug,
      category: String(fd.get('category') ?? ''),
      message: String(fd.get('message') ?? ''),
      guest_name: String(fd.get('guest_name') ?? ''),
      guest_contact: String(fd.get('guest_contact') ?? ''),
      reservation_code: String(fd.get('reservation_code') ?? ''),
      website: String(fd.get('website') ?? ''),
    };
    start(async () => {
      const res = await createUpsellOrderAction(payload);
      if (res?.ok) setSent(true);
      else setError(res?.error ?? 'Une erreur est survenue. / Something went wrong.');
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Honeypot — invisible pour les humains, rempli par les bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Service souhaité · Service *
        </label>
        <select
          name="category"
          required
          className="w-full border border-stone-300 rounded-lg px-3 py-2.5 text-sm bg-white"
        >
          {UPSELL_CATEGORIES.map((c) => (
            <option key={c} value={c}>{UPSELL_CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Votre demande · Details
        </label>
        <textarea
          name="message"
          rows={3}
          maxLength={1000}
          placeholder="Ex : transfert depuis l’aéroport demain à 14h / e.g. airport pickup tomorrow 2pm"
          className="w-full border border-stone-300 rounded-lg px-3 py-2.5 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            Votre nom · Name *
          </label>
          <input
            name="guest_name"
            required
            maxLength={120}
            className="w-full border border-stone-300 rounded-lg px-3 py-2.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            Téléphone / WhatsApp *
          </label>
          <input
            name="guest_contact"
            required
            maxLength={120}
            placeholder="+212…"
            className="w-full border border-stone-300 rounded-lg px-3 py-2.5 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-stone-700 mb-1">
          Code de réservation · Booking code <span className="text-stone-400">(optionnel)</span>
        </label>
        <input
          name="reservation_code"
          maxLength={40}
          placeholder="Ex : HMABCDE123"
          className="w-full border border-stone-300 rounded-lg px-3 py-2.5 text-sm"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-stone-900 text-white rounded-lg py-3 text-sm font-medium hover:bg-stone-800 disabled:opacity-50"
      >
        {pending ? 'Envoi… / Sending…' : 'Envoyer ma commande · Send my order'}
      </button>
      <p className="text-[11px] text-stone-400 text-center">
        Aucun paiement en ligne — l’équipe confirme le prix avec vous avant toute prestation.
      </p>
    </form>
  );
}
