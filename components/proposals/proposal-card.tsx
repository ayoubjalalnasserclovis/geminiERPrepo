'use client';

import { useState, useTransition, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { PropertyPresentation } from '@/components/properties/property-presentation';
import { formatDate } from '@/lib/utils/format';
import {
  respondToProposalAction, markProposalViewedAction,
} from '@/app/(client)/client/projects/[id]/proposals/actions';

type ProposalMedia = { id: string; type: string; url: string | null; is_cover: boolean };

export function ProposalCard({ proposal, media = [] }: { proposal: any; media?: ProposalMedia[] }) {
  const snap = proposal.property_snapshot ?? {};

  const [showRefuse, setShowRefuse] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [message, setMessage] = useState('');
  const [refusalReason, setRefusalReason] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!proposal.viewed_at) markProposalViewedAction(proposal.id);
  }, [proposal.id, proposal.viewed_at]);

  function respond(response: 'accepted'|'refused'|'more_info', refusal?: string, msg?: string) {
    setError(null);
    start(async () => {
      const r = await respondToProposalAction({
        proposal_id: proposal.id, response, refusal_reason: refusal, message: msg,
      });
      if (!r.ok) setError(r.error ?? 'Erreur');
    });
  }

  const isPending = proposal.client_response === 'pending';
  const isAccepted = proposal.client_response === 'accepted';

  return (
    <Card className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3 -mt-2 -mx-2">
        <div className="text-xs text-stoniz-gray-500">
          Proposition reçue le {formatDate(proposal.sent_at)}
        </div>
        <Badge variant={isAccepted ? 'success' : proposal.client_response === 'refused' ? 'error' : 'default'}>
          {proposal.client_response === 'pending' ? 'En attente de votre réponse'
            : proposal.client_response === 'accepted' ? '✓ Vous êtes intéressé'
            : proposal.client_response === 'refused' ? 'Pas intéressé'
            : 'Demande d\'infos'}
        </Badge>
      </div>

      <PropertyPresentation property={snap} media={media} />

      {/* Actions client */}
      {isPending && (
        <div className="pt-4 border-t">
          {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
          {!showRefuse && !showMessage ? (
            <div className="flex gap-2 flex-wrap">
              <Button variant="accent" disabled={pending} onClick={() => respond('accepted')}>
                ✓ Je suis intéressé
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => setShowRefuse(true)}>
                Pas intéressé
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => setShowMessage(true)}>
                Demander plus d'infos
              </Button>
            </div>
          ) : showRefuse ? (
            <div className="space-y-3">
              <Textarea value={refusalReason} onChange={e => setRefusalReason(e.target.value)}
                placeholder="Pourquoi refusez-vous ce bien ? (optionnel)" rows={2} />
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => respond('refused', refusalReason)}>Confirmer le refus</Button>
                <Button variant="ghost" onClick={() => setShowRefuse(false)}>Annuler</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea value={message} onChange={e => setMessage(e.target.value)}
                placeholder="Quelles informations souhaitez-vous ?" rows={2} />
              <div className="flex gap-2">
                <Button disabled={pending} onClick={() => respond('more_info', undefined, message)}>Envoyer ma demande</Button>
                <Button variant="ghost" onClick={() => setShowMessage(false)}>Annuler</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {isAccepted && (
        <div className="pt-4 border-t text-sm bg-green-50 -mx-6 -mb-6 px-6 py-3 rounded-b-xl">
          ✓ Vous avez accepté ce bien le {formatDate(proposal.client_response_at)}. Votre conseiller Stoniz va lancer la procédure d'offre d'achat.
        </div>
      )}
    </Card>
  );
}
