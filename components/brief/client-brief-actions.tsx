'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import { clientValidateBriefAction, clientRejectBriefAction } from '@/app/(client)/client/projects/[id]/brief/actions';

export function ClientBriefActions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  function validate() {
    if (!confirm('Confirmer la validation du cahier des charges ? Cette action démarrera la recherche du bien.')) return;
    setError(null);
    start(async () => {
      const r = await clientValidateBriefAction(projectId);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      router.refresh();
    });
  }

  function reject() {
    if (reason.trim().length < 5) {
      setError('Merci d\'indiquer une raison (au moins 5 caractères)');
      return;
    }
    setError(null);
    start(async () => {
      const r = await clientRejectBriefAction(projectId, reason);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      router.refresh();
    });
  }

  return (
    <Card className="border-2 border-stoniz-black space-y-3">
      <h3 className="font-display text-xl">Votre décision</h3>
      <p className="text-sm text-stoniz-gray-600">
        En validant, vous autorisez votre conseiller Stoniz à démarrer la recherche du bien selon ces critères.
      </p>

      {!rejecting ? (
        <div className="flex gap-3 flex-wrap pt-2">
          <Button onClick={validate} disabled={pending} size="lg">
            ✅ {pending ? 'Validation…' : 'Valider le cahier des charges'}
          </Button>
          <Button variant="secondary" onClick={() => setRejecting(true)} disabled={pending} size="lg">
            ✏️ Demander des modifications
          </Button>
        </div>
      ) : (
        <div className="space-y-3 pt-2">
          <div>
            <Label>Quelles modifications souhaitez-vous ?</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={4}
              placeholder="Ex: augmenter le budget travaux à 60k €, ajouter le quartier Targa, exclure les RDC…" />
            <p className="text-xs text-stoniz-gray-500 mt-1">
              Votre conseiller recevra ce message et mettra à jour le cahier des charges.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => { setRejecting(false); setReason(''); setError(null); }} disabled={pending}>
              Annuler
            </Button>
            <Button onClick={reject} disabled={pending || reason.trim().length < 5}>
              {pending ? 'Envoi…' : 'Envoyer les modifications demandées'}
            </Button>
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded-md">{error}</div>}
    </Card>
  );
}
