'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, RotateCw } from 'lucide-react';
import { sendTestEmailAction, resendQueuedEmailsAction } from '@/app/(team)/admin/emails/actions';

export function TestEmailButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [to, setTo] = useState('');

  function run() {
    setMsg(null);
    start(async () => {
      try {
        const r = await sendTestEmailAction(to);
        setMsg(`✓ Email de test envoyé. Vérifie ta boîte (et ton spam).`);
        setTimeout(() => router.refresh(), 1500);
      } catch (e: any) {
        setMsg(`✗ Erreur : ${e?.message ?? 'inconnue'}`);
      }
    });
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
      <h3 className="font-display text-sm mb-2 inline-flex items-center gap-2">
        <Mail className="w-4 h-4" /> Envoyer un email de test
      </h3>
      <p className="text-xs text-stoniz-gray-500 mb-3">
        Vérifie que la chaîne Resend + webhook fonctionne en envoyant un mail à ton adresse (ou une autre).
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Laisser vide pour ton email"
          className="flex-1 text-xs border border-stoniz-gray-300 rounded px-2 py-1.5"
        />
        <button
          onClick={run}
          disabled={pending}
          className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs hover:bg-stoniz-gray-800 disabled:opacity-50"
        >
          {pending ? 'Envoi…' : 'Envoyer test'}
        </button>
      </div>
      {msg && (
        <div className={`mt-2 text-xs px-2 py-1 rounded ${msg.startsWith('✓') ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {msg}
        </div>
      )}
    </div>
  );
}

export function ResendQueuedButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    if (count === 0) {
      setMsg('Aucun email en attente.');
      return;
    }
    if (!confirm(`Relancer ${count} email(s) en attente ?\n\nUn HTML générique sera utilisé (le template original n'est pas re-rendu fidèlement). Continuer ?`)) return;
    setMsg(null);
    start(async () => {
      try {
        const r = await resendQueuedEmailsAction({ hours: 48 });
        if ((r as any).ok === false) {
          setMsg(`✗ ${(r as any).error}`);
          return;
        }
        setMsg(`✓ ${(r as any).sent} envoyé(s), ${(r as any).failed} échoué(s) sur ${(r as any).total}.`);
        setTimeout(() => router.refresh(), 1500);
      } catch (e: any) {
        setMsg(`✗ Erreur : ${e?.message ?? 'inconnue'}`);
      }
    });
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
      <h3 className="font-display text-sm mb-2 inline-flex items-center gap-2">
        <RotateCw className="w-4 h-4" /> Relancer les emails en attente
      </h3>
      <p className="text-xs text-stoniz-gray-500 mb-3">
        {count > 0
          ? `${count} email(s) bloqué(s) en file d'attente (48h dernières). Cliquer pour les renvoyer.`
          : 'Aucun email en attente sur les 48 dernières heures.'}
      </p>
      <button
        onClick={run}
        disabled={pending || count === 0}
        className="bg-amber-500 text-white px-3 py-1.5 rounded text-xs hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? 'Renvoi…' : `Renvoyer ${count} email(s)`}
      </button>
      {msg && (
        <div className={`mt-2 text-xs px-2 py-1 rounded ${msg.startsWith('✓') ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {msg}
        </div>
      )}
    </div>
  );
}
