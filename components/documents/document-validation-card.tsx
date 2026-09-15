'use client';

import { useState, useTransition } from 'react';
import { FileText, CheckCircle2, XCircle, MessageSquare } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { formatDate } from '@/lib/utils/format';
import { validateDocumentAction } from '@/app/(client)/client/documents/validate-actions';

type DocToValidate = {
  id: string;
  name: string;
  type: string;
  created_at: string;
  client_validation_status: string | null;
  client_validation_at: string | null;
  client_validation_comment: string | null;
  signedUrl: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  plans_3d: 'Plans 3D',
  lots_techniques: 'Lots techniques',
  shopping_list: 'Shopping list',
  devis_travaux: 'Devis travaux',
  plan_bet: 'Plan bureau d\'études',
  compromis: 'Compromis',
  permis_travaux: 'Permis de travaux',
  contrat_mission: 'Contrat de mission',
  cahier_des_charges: 'Cahier des charges',
  pv_livraison: 'PV de livraison',
};

export function DocumentValidationCard({ doc }: { doc: DocToValidate }) {
  const [showRefuse, setShowRefuse] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [comment, setComment] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const status = doc.client_validation_status ?? 'pending';
  const isPending = status === 'pending';
  const label = TYPE_LABELS[doc.type] ?? doc.type;

  function handle(action: 'validated' | 'refused' | 'more_info', text?: string) {
    setError(null);
    start(async () => {
      const r = await validateDocumentAction(doc.id, action, text);
      if (!r.ok) setError(r.error ?? 'Erreur');
      else {
        setShowRefuse(false);
        setShowInfo(false);
        setComment('');
      }
    });
  }

  return (
    <Card className={isPending ? 'border-accent border-2' : ''}>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-stoniz-gray-500" />
            <div>
              <CardTitle>{label}</CardTitle>
              <div className="text-xs text-stoniz-gray-500 mt-1">
                Reçu le {formatDate(doc.created_at)} · {doc.name}
              </div>
            </div>
          </div>
          <Badge variant={
            status === 'validated' ? 'success' :
            status === 'refused' ? 'error' :
            status === 'more_info' ? 'warning' : 'warning'
          }>
            {status === 'validated' ? '✓ Validé' :
             status === 'refused' ? 'Refusé' :
             status === 'more_info' ? 'Infos demandées' :
             'À valider'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {doc.signedUrl && (
          <a href={doc.signedUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 mb-4 underline text-sm">
            <FileText className="w-4 h-4" />
            Ouvrir le document
          </a>
        )}

        {doc.client_validation_comment && (
          <div className="mb-4 p-3 bg-stoniz-gray-50 rounded-md text-sm">
            <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Votre message</div>
            {doc.client_validation_comment}
          </div>
        )}

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

        {isPending && !showRefuse && !showInfo && (
          <div className="flex flex-wrap gap-2 pt-3 border-t">
            <Button variant="accent" disabled={pending} onClick={() => handle('validated')}>
              <CheckCircle2 className="w-4 h-4" />
              Valider
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setShowRefuse(true)}>
              <XCircle className="w-4 h-4" />
              Demander une modification
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setShowInfo(true)}>
              <MessageSquare className="w-4 h-4" />
              Plus d'infos
            </Button>
          </div>
        )}

        {isPending && showRefuse && (
          <div className="space-y-3 pt-3 border-t">
            <Textarea rows={3} value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Décrivez ce qui doit être modifié…" />
            <div className="flex gap-2">
              <Button disabled={pending} onClick={() => handle('refused', comment)}>Confirmer la demande</Button>
              <Button variant="ghost" onClick={() => { setShowRefuse(false); setComment(''); }}>Annuler</Button>
            </div>
          </div>
        )}

        {isPending && showInfo && (
          <div className="space-y-3 pt-3 border-t">
            <Textarea rows={3} value={comment} onChange={e => setComment(e.target.value)}
              placeholder="Quelles informations complémentaires souhaitez-vous ?" />
            <div className="flex gap-2">
              <Button disabled={pending} onClick={() => handle('more_info', comment)}>Envoyer ma question</Button>
              <Button variant="ghost" onClick={() => { setShowInfo(false); setComment(''); }}>Annuler</Button>
            </div>
          </div>
        )}

        {!isPending && doc.client_validation_at && (
          <div className="pt-3 border-t text-sm text-stoniz-gray-500">
            Réponse envoyée le {formatDate(doc.client_validation_at)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
