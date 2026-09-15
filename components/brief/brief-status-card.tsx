import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/format';

type Brief = {
  id: string;
  status: 'draft'|'sent_to_client'|'validated'|'rejected_by_client';
  sent_at: string | null;
  validated_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
} | null;

export function BriefStatusCard({
  projectId, brief,
}: {
  projectId: string;
  brief: Brief;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Cahier des charges</CardTitle>
            <p className="text-xs text-stoniz-gray-500 mt-1">
              Validation obligatoire avant passage en Sourcing
            </p>
          </div>
          <Link href={`/projects/${projectId}/brief`}>
            <Button size="sm" variant={brief?.status === 'validated' ? 'secondary' : undefined}>
              {!brief ? '+ Créer le brief'
                : brief.status === 'validated' ? 'Voir le brief'
                : brief.status === 'sent_to_client' ? 'Voir le brief envoyé'
                : 'Compléter / envoyer'}
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {!brief ? (
          <div className="text-sm text-stoniz-gray-600">
            <span className="inline-block px-2 py-0.5 rounded-full bg-stoniz-gray-100 text-xs mr-2">
              ⚠ Pas commencé
            </span>
            Démarrez le cahier des charges pour définir les critères du bien recherché.
          </div>
        ) : brief.status === 'draft' ? (
          <div className="text-sm text-stoniz-gray-700">
            <Badge>Brouillon</Badge>
            <span className="ml-2">Complétez et envoyez au client pour validation.</span>
          </div>
        ) : brief.status === 'sent_to_client' ? (
          <div className="text-sm text-stoniz-gray-700">
            <Badge variant="warning">En attente client</Badge>
            <span className="ml-2">Envoyé le {formatDate(brief.sent_at)} — relancez le client si besoin.</span>
          </div>
        ) : brief.status === 'validated' ? (
          <div className="text-sm text-green-700">
            <Badge variant="success">✓ Validé</Badge>
            <span className="ml-2">Validé par le client le {formatDate(brief.validated_at)}. Vous pouvez passer en Sourcing.</span>
          </div>
        ) : (
          <div className="text-sm">
            <Badge variant="error">Modifications demandées</Badge>
            <p className="text-stoniz-gray-700 mt-2">Le {formatDate(brief.rejected_at)} :</p>
            <p className="italic text-stoniz-gray-800 mt-1">« {brief.rejection_reason} »</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
