'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { inviteClientAction, resendClientInviteAction } from '@/app/(team)/clients/actions';

export function InviteClientButton({ clientId }: { clientId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-sm text-stoniz-gray-600">{message}</span>}
      <Button
        variant="accent"
        disabled={isPending}
        onClick={() => {
          if (!confirm('Envoyer une invitation au portail à ce client ?')) return;
          startTransition(async () => {
            const r = await inviteClientAction(clientId);
            setMessage(r.ok ? '✓ Invitation envoyée' : `Erreur : ${r.error}`);
          });
        }}
      >
        {isPending ? 'Envoi…' : 'Inviter au portail'}
      </Button>
    </div>
  );
}

// ─── Renvoi du lien d'invitation (CEO 2026-08-19, session D) ───────────────
// Affiché quand le client est invité mais ne s'est JAMAIS connecté (lien
// initial probablement expiré). Génère un nouveau lien, l'ancien devient caduc.
export function ResendInviteButton({ clientId }: { clientId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {message && <span className="text-sm text-stoniz-gray-600">{message}</span>}
      <Button
        variant="secondary"
        disabled={isPending}
        onClick={() => {
          if (!confirm('Renvoyer un nouveau lien d\'accès au portail ?\n\nL\'ancien lien devient caduc.')) return;
          startTransition(async () => {
            const r = await resendClientInviteAction(clientId);
            setMessage(r.ok ? '✓ Nouveau lien envoyé' : `Erreur : ${r.error}`);
          });
        }}
      >
        {isPending ? 'Envoi…' : '🔁 Renvoyer le lien d\'invitation'}
      </Button>
    </div>
  );
}
