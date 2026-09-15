'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Briefcase, FileSignature, Trash2, ChevronDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/utils/format';
import {
  createPropertyVisitAction,
  deletePropertyVisitAction,
  createProjectOfferAction,
  updateProjectOfferStatusAction,
  deleteProjectOfferAction,
} from '@/app/(team)/projects/[id]/activity-actions';

type Visit = {
  id: string;
  visited_at: string;
  notes: string | null;
  visited_by_user?: { full_name: string | null } | null;
};

type Offer = {
  id: string;
  offer_date: string;
  offer_amount: number | string;
  status: 'pending' | 'accepted' | 'rejected' | 'counter';
  counter_amount: number | string | null;
  notes: string | null;
};

type Props = {
  projectId: string;
  propertyId: string;
  visits: Visit[];
  offers: Offer[];
  compromisDate: string | null;
};

const STATUS_LABELS: Record<Offer['status'], string> = {
  pending: 'En attente',
  accepted: 'Acceptée',
  rejected: 'Refusée',
  counter: 'Contre-offre',
};

const STATUS_VARIANTS: Record<Offer['status'], 'default' | 'success' | 'warning' | 'error'> = {
  pending: 'default',
  accepted: 'success',
  rejected: 'error',
  counter: 'warning',
};

export function CommercialActivityPanel({
  projectId,
  propertyId,
  visits,
  offers,
  compromisDate,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<'visit' | 'offer' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  function submitVisit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await createPropertyVisitAction({
        project_id: projectId,
        property_id: propertyId,
        visited_at: String(fd.get('visited_at') ?? ''),
        notes: String(fd.get('notes') ?? '') || undefined,
      });
      if (!r.ok) { setErr(r.error ?? 'Erreur'); return; }
      setOpen(null);
      router.refresh();
    });
  }

  function submitOffer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get('offer_amount'));
    if (!Number.isFinite(amount) || amount < 0) { setErr('Montant invalide'); return; }
    start(async () => {
      const r = await createProjectOfferAction({
        project_id: projectId,
        property_id: propertyId,
        offer_date: String(fd.get('offer_date') ?? ''),
        offer_amount: amount,
        status: 'pending',
        notes: String(fd.get('notes') ?? '') || undefined,
      });
      if (!r.ok) { setErr(r.error ?? 'Erreur'); return; }
      setOpen(null);
      router.refresh();
    });
  }

  function deleteVisit(id: string) {
    if (!confirm('Supprimer cette visite ?')) return;
    start(async () => {
      await deletePropertyVisitAction(id);
      router.refresh();
    });
  }

  function deleteOffer(id: string) {
    if (!confirm('Supprimer cette offre ?')) return;
    start(async () => {
      await deleteProjectOfferAction(id);
      router.refresh();
    });
  }

  function updateOfferStatus(id: string, status: Offer['status']) {
    start(async () => {
      await updateProjectOfferStatusAction(id, status);
      router.refresh();
    });
  }

  // Timeline combinée chronologique (visites + offres + compromis)
  type Event =
    | { kind: 'visit'; date: string; data: Visit }
    | { kind: 'offer'; date: string; data: Offer }
    | { kind: 'compromis'; date: string };
  const events: Event[] = [
    ...visits.map(v => ({ kind: 'visit' as const, date: v.visited_at, data: v })),
    ...offers.map(o => ({ kind: 'offer' as const, date: o.offer_date, data: o })),
    ...(compromisDate ? [{ kind: 'compromis' as const, date: compromisDate }] : []),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activité commerciale</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Actions répétables uniquement. Le compromis est une date unique du
            projet → se saisit dans la carte "Dates du projet" (source unique). */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Button
            type="button"
            variant={open === 'visit' ? 'primary' : 'secondary'}
            onClick={() => { setOpen(open === 'visit' ? null : 'visit'); setErr(null); }}
          >
            <Calendar className="w-4 h-4" />
            Nouvelle visite
          </Button>
          <Button
            type="button"
            variant={open === 'offer' ? 'primary' : 'secondary'}
            onClick={() => { setOpen(open === 'offer' ? null : 'offer'); setErr(null); }}
          >
            <Briefcase className="w-4 h-4" />
            Nouvelle offre
          </Button>
        </div>

        {!compromisDate && (
          <p className="text-xs text-stoniz-gray-500 mb-3 italic">
            💡 Compromis signé ? Saisis la date dans la carte « Dates du projet »
            ci-dessous — le bien sera automatiquement considéré comme vendu dans le dashboard.
          </p>
        )}

        {/* Formulaires inline */}
        {open === 'visit' && (
          <form onSubmit={submitVisit} className="border rounded p-4 mb-4 bg-stoniz-gray-50 space-y-3">
            <h4 className="font-display text-sm">Enregistrer une visite</h4>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Date de la visite *</Label>
                <Input type="date" name="visited_at" defaultValue={today} required />
              </div>
            </div>
            <div>
              <Label>Notes (observations, retour du client, etc.)</Label>
              <textarea
                name="notes"
                rows={3}
                className="w-full px-3 py-2 border border-stoniz-gray-300 rounded text-sm"
                placeholder="Ex : le client a aimé le séjour, est revenu sur la cuisine."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(null)} disabled={pending}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        )}

        {open === 'offer' && (
          <form onSubmit={submitOffer} className="border rounded p-4 mb-4 bg-stoniz-gray-50 space-y-3">
            <h4 className="font-display text-sm">Enregistrer une offre</h4>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Date de l'offre *</Label>
                <Input type="date" name="offer_date" defaultValue={today} required />
              </div>
              <div>
                <Label>Montant de l'offre (€) *</Label>
                <Input type="number" name="offer_amount" step="0.01" min="0" required placeholder="Ex : 145 000" />
              </div>
            </div>
            <div>
              <Label>Notes (conditions, négociation…)</Label>
              <textarea
                name="notes"
                rows={3}
                className="w-full px-3 py-2 border border-stoniz-gray-300 rounded text-sm"
                placeholder="Ex : offre soumise au vendeur, en attente de retour."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(null)} disabled={pending}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        )}

        {err && (
          <div className="mb-3 text-sm text-red-700 border border-red-200 bg-red-50 rounded p-2">
            {err}
          </div>
        )}

        {/* Timeline historique */}
        {events.length === 0 ? (
          <p className="text-sm text-stoniz-gray-500 italic">
            Aucune activité commerciale pour le moment. Utilise les boutons ci-dessus pour ajouter une visite, une offre ou marquer le compromis.
          </p>
        ) : (
          <ul className="space-y-3">
            {events.map((ev, i) => (
              <li key={i} className="border-l-2 border-stoniz-gray-300 pl-3 py-1">
                {ev.kind === 'visit' && (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Calendar className="w-4 h-4 text-stoniz-blue" />
                        Visite le {formatDate(ev.data.visited_at)}
                      </div>
                      {ev.data.notes && (
                        <p className="text-xs text-stoniz-gray-600 mt-1 whitespace-pre-line">{ev.data.notes}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteVisit(ev.data.id)}
                      className="text-stoniz-gray-400 hover:text-red-600"
                      title="Supprimer"
                      disabled={pending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {ev.kind === 'offer' && (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium flex-wrap">
                        <Briefcase className="w-4 h-4 text-amber-600" />
                        Offre <Money amount={Number(ev.data.offer_amount)} /> le {formatDate(ev.data.offer_date)}
                        <Badge variant={STATUS_VARIANTS[ev.data.status]}>
                          {STATUS_LABELS[ev.data.status]}
                        </Badge>
                      </div>
                      {ev.data.notes && (
                        <p className="text-xs text-stoniz-gray-600 mt-1 whitespace-pre-line">{ev.data.notes}</p>
                      )}
                      {ev.data.status === 'pending' && (
                        <div className="flex gap-1 mt-2">
                          <button
                            type="button"
                            onClick={() => updateOfferStatus(ev.data.id, 'accepted')}
                            className="text-xs text-green-700 underline"
                            disabled={pending}
                          >
                            Acceptée
                          </button>
                          <span className="text-xs text-stoniz-gray-300">·</span>
                          <button
                            type="button"
                            onClick={() => updateOfferStatus(ev.data.id, 'rejected')}
                            className="text-xs text-red-700 underline"
                            disabled={pending}
                          >
                            Refusée
                          </button>
                          <span className="text-xs text-stoniz-gray-300">·</span>
                          <button
                            type="button"
                            onClick={() => updateOfferStatus(ev.data.id, 'counter')}
                            className="text-xs text-amber-700 underline"
                            disabled={pending}
                          >
                            Contre-offre
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteOffer(ev.data.id)}
                      className="text-stoniz-gray-400 hover:text-red-600"
                      title="Supprimer"
                      disabled={pending}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {ev.kind === 'compromis' && (
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileSignature className="w-4 h-4 text-emerald-600" />
                    Compromis signé le {formatDate(ev.date)}
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
