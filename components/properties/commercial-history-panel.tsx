import Link from 'next/link';
import { Calendar, Briefcase, FileSignature, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/utils/format';

type VisitItem = {
  id: string;
  visited_at: string;
  notes: string | null;
  project_id: string;
  client_name: string;
};

type OfferItem = {
  id: string;
  offer_date: string;
  offer_amount: number | string;
  status: 'pending' | 'accepted' | 'rejected' | 'counter';
  counter_amount: number | string | null;
  notes: string | null;
  project_id: string;
  client_name: string;
};

type CompromisItem = {
  project_id: string;
  client_name: string;
  compromis_date: string;
};

const STATUS_LABELS: Record<OfferItem['status'], string> = {
  pending: 'En attente',
  accepted: 'Acceptée',
  rejected: 'Refusée',
  counter: 'Contre-offre',
};

const STATUS_VARIANTS: Record<OfferItem['status'], 'default' | 'success' | 'warning' | 'error'> = {
  pending: 'default',
  accepted: 'success',
  rejected: 'error',
  counter: 'warning',
};

/**
 * Section "Historique commercial" sur la fiche bien — lecture seule.
 * Liste toutes les visites + offres + compromis effectués par les clients
 * sur ce bien, avec lien vers le projet correspondant.
 */
export function CommercialHistoryPanel({
  visits,
  offers,
  compromis,
}: {
  visits: VisitItem[];
  offers: OfferItem[];
  compromis: CompromisItem[];
}) {
  type Event =
    | { kind: 'visit'; date: string; data: VisitItem }
    | { kind: 'offer'; date: string; data: OfferItem }
    | { kind: 'compromis'; date: string; data: CompromisItem };

  const events: Event[] = [
    ...visits.map(v => ({ kind: 'visit' as const, date: v.visited_at, data: v })),
    ...offers.map(o => ({ kind: 'offer' as const, date: o.offer_date, data: o })),
    ...compromis.map(c => ({ kind: 'compromis' as const, date: c.compromis_date, data: c })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historique commercial</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-stoniz-gray-500 mb-3">
          Toutes les activités enregistrées par les chefs de projet depuis les fiches client.
          Pour ajouter une activité, va sur la fiche du projet client concerné.
        </p>

        {events.length === 0 ? (
          <p className="text-sm text-stoniz-gray-500 italic">
            Aucune activité commerciale sur ce bien.
          </p>
        ) : (
          <ul className="space-y-3">
            {events.map((ev, i) => (
              <li key={i} className="border-l-2 border-stoniz-gray-300 pl-3 py-1">
                {ev.kind === 'visit' && (
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium flex-wrap">
                      <Calendar className="w-4 h-4 text-stoniz-blue" />
                      Visite par
                      <Link
                        href={`/projects/${ev.data.project_id}`}
                        className="hover:underline inline-flex items-center gap-1"
                      >
                        {ev.data.client_name}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                      <span className="text-stoniz-gray-500 font-normal">
                        le {formatDate(ev.data.visited_at)}
                      </span>
                    </div>
                    {ev.data.notes && (
                      <p className="text-xs text-stoniz-gray-600 mt-1 whitespace-pre-line">
                        {ev.data.notes}
                      </p>
                    )}
                  </div>
                )}
                {ev.kind === 'offer' && (
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium flex-wrap">
                      <Briefcase className="w-4 h-4 text-amber-600" />
                      Offre <Money amount={Number(ev.data.offer_amount)} /> de
                      <Link
                        href={`/projects/${ev.data.project_id}`}
                        className="hover:underline inline-flex items-center gap-1"
                      >
                        {ev.data.client_name}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                      <span className="text-stoniz-gray-500 font-normal">
                        le {formatDate(ev.data.offer_date)}
                      </span>
                      <Badge variant={STATUS_VARIANTS[ev.data.status]}>
                        {STATUS_LABELS[ev.data.status]}
                      </Badge>
                    </div>
                    {ev.data.notes && (
                      <p className="text-xs text-stoniz-gray-600 mt-1 whitespace-pre-line">
                        {ev.data.notes}
                      </p>
                    )}
                  </div>
                )}
                {ev.kind === 'compromis' && (
                  <div className="flex items-center gap-2 text-sm font-medium flex-wrap">
                    <FileSignature className="w-4 h-4 text-emerald-600" />
                    Compromis signé avec
                    <Link
                      href={`/projects/${ev.data.project_id}`}
                      className="hover:underline inline-flex items-center gap-1"
                    >
                      {ev.data.client_name}
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                    <span className="text-stoniz-gray-500 font-normal">
                      le {formatDate(ev.data.compromis_date)}
                    </span>
                    <Badge variant="success">Vente actée</Badge>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
