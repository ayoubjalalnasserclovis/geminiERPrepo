'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import {
  clientValidateMoodboardAction, clientRejectMoodboardAction,
} from '@/app/(team)/projects/[id]/moodboard/actions';

export function ClientMoodboardActions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function validate() {
    if (!confirm('Confirmer la validation du moodboard ? Les plans 3D seront préparés sur cette base.')) return;
    setError(null);
    start(async () => {
      const r = await clientValidateMoodboardAction(projectId);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      router.refresh();
    });
  }

  function reject() {
    if (reason.trim().length < 5) { setError('Raison trop courte'); return; }
    setError(null);
    start(async () => {
      const r = await clientRejectMoodboardAction(projectId, reason);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      router.refresh();
    });
  }

  return (
    <Card className="border-2 border-stoniz-black space-y-3">
      <h3 className="font-display text-xl">Votre décision</h3>

      {!rejecting ? (
        <div className="flex gap-3 flex-wrap pt-2">
          <Button onClick={validate} disabled={pending} size="lg">
            ✅ {pending ? 'Validation…' : 'Valider ce moodboard'}
          </Button>
          <Button variant="secondary" onClick={() => setRejecting(true)} disabled={pending} size="lg">
            ✏️ Demander des modifications
          </Button>
        </div>
      ) : (
        <div className="space-y-3 pt-2">
          <div>
            <Label>Que souhaitez-vous modifier ?</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={4}
              placeholder="Ex: éviter le rouge, prévoir plus de plantes, garder le tadelakt existant…" />
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
