'use client';

import { useTransition } from 'react';
import {
  UPSELL_STATUSES,
  UPSELL_STATUS_LABELS,
  UPSELL_STATUS_BADGE,
  type UpsellStatus,
} from '@/lib/propria/upsell';

/** Sélecteur de statut inline (pattern transfer-status-select). */
export function UpsellStatusSelect({
  id,
  current,
  setStatusAction,
}: {
  id: string;
  current: string;
  setStatusAction: (id: string, status: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      defaultValue={current}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        start(async () => { await setStatusAction(id, v); });
      }}
      className={`text-[10px] px-2 py-0.5 rounded-full ${UPSELL_STATUS_BADGE[current as UpsellStatus] ?? 'bg-stoniz-gray-100'} border-0 disabled:opacity-50`}
    >
      {UPSELL_STATUSES.map((k) => (
        <option key={k} value={k}>{UPSELL_STATUS_LABELS[k]}</option>
      ))}
    </select>
  );
}

/**
 * Montant cliquable : les commandes QR arrivent à 0 MAD, le bureau chiffre
 * après contact voyageur (décision B6 — pas de paiement en ligne).
 */
export function UpsellAmountButton({
  id,
  amountMad,
  setAmountAction,
}: {
  id: string;
  amountMad: number;
  setAmountAction: (id: string, amountMad: number) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const display = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amountMad) + ' DH';

  function onClick() {
    const raw = window.prompt('Montant du service (MAD) :', String(amountMad || ''));
    if (raw === null) return;
    const val = Number(raw.replace(',', '.'));
    if (!Number.isFinite(val) || val < 0) return;
    start(async () => { await setAmountAction(id, val); });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title="Modifier le montant"
      className={`text-xs font-medium underline decoration-dotted underline-offset-2 hover:text-stoniz-black disabled:opacity-50 ${amountMad === 0 ? 'text-amber-700' : ''}`}
    >
      {pending ? '…' : amountMad === 0 ? 'À chiffrer' : display}
    </button>
  );
}
