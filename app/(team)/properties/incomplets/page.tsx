import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/money';
import { requireRole } from '@/lib/auth/require';
import { ExcludeFromChecklistButton } from '@/components/properties/exclude-from-checklist-button';

const MISSING_LABELS: Record<string, string> = {
  sourcing_type: 'Type de sourcing (partenaire ou direct)',
  partner_id: 'Partenaire (agence)',
  assigned_chasseur: 'Chasseur Stoniz',
  medias: 'Au moins 1 média (photo ou vidéo)',
};

type PropertyRow = {
  id: string;
  name: string;
  quartier: string | null;
  price: number | null;
  status: string;
  created_at: string;
  is_published: boolean;
  published_at: string | null;
  sourcing_type: string | null;
  assigned_chasseur: string | null;
  chasseur_name: string | null;
  partner_id: string | null;
  partner_name: string | null;
  step2_sourcing_done: boolean;
  step3_media_done: boolean;
  missing_for_publication: string[] | null;
};

export default async function PropertiesIncompletsPage() {
  await requireRole(['ceo','chef_projet','developer','sourcing','assistante']);
  const supabase = createClient();

  const { data: rows } = await supabase
    .from('properties_publication_status')
    .select('*')
    .order('created_at', { ascending: false });

  const all = (rows ?? []) as PropertyRow[];
  const incomplets = all.filter(p => !p.is_published);

  // Compteurs par étape manquante
  const noSourcing = incomplets.filter(p => !p.step2_sourcing_done).length;
  const noMedia = incomplets.filter(p => p.step2_sourcing_done && !p.step3_media_done).length;
  const readyToPublish = incomplets.filter(p => p.step2_sourcing_done && p.step3_media_done).length;

  return (
    <div className="space-y-6">
      <Link href="/properties" className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" /> Retour aux biens
      </Link>

      <PageHeader
        title="Biens en cours d'import"
        description={`${incomplets.length} bien${incomplets.length > 1 ? 's' : ''} à finaliser avant publication`}
      />

      {/* Récap par étape */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-xs uppercase tracking-wider text-red-700 mb-1">Sourcing manquant</p>
          <p className="font-display text-2xl text-red-900">{noSourcing}</p>
          <p className="text-xs text-red-700 mt-1">À assigner à un partenaire ou un chasseur</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-md p-4">
          <p className="text-xs uppercase tracking-wider text-orange-700 mb-1">Sans média</p>
          <p className="font-display text-2xl text-orange-900">{noMedia}</p>
          <p className="text-xs text-orange-700 mt-1">À compléter avec photos / vidéo</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-md p-4">
          <p className="text-xs uppercase tracking-wider text-green-700 mb-1">Prêts à publier</p>
          <p className="font-display text-2xl text-green-900">{readyToPublish}</p>
          <p className="text-xs text-green-700 mt-1">Toutes les étapes complétées</p>
        </div>
      </div>

      {incomplets.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              title="🎉 Tous les biens sont publiés"
              description="Aucun bien en cours d'import. Pour ajouter un nouveau bien, va sur la page Biens."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {incomplets.map(p => (
            <Card key={p.id} className={`border-l-4 ${
              p.step2_sourcing_done && p.step3_media_done
                ? 'border-l-green-500 border-green-200'
                : !p.step2_sourcing_done
                  ? 'border-l-red-500 border-red-200'
                  : 'border-l-orange-500 border-orange-200'
            }`}>
              <CardContent>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Link href={`/properties/${p.id}`} className="font-display text-lg hover:underline">
                        {p.name}
                      </Link>
                      {p.quartier && (
                        <span className="flex items-center gap-1 text-xs text-stoniz-gray-500">
                          <MapPin className="w-3 h-3" /> {p.quartier}
                        </span>
                      )}
                      {p.price && (
                        <span className="text-xs text-stoniz-gray-500">
                          · <Money amount={p.price} />
                        </span>
                      )}
                      <Badge variant="default">Draft</Badge>
                    </div>

                    <p className="text-xs text-stoniz-gray-500">
                      Importé le {new Date(p.created_at).toLocaleDateString('fr-FR', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </p>

                    {/* Étapes */}
                    <div className="mt-3 flex items-center gap-4 flex-wrap text-xs">
                      <StepBadge done={true} label="1. Import" />
                      <StepBadge done={p.step2_sourcing_done} label="2. Sourcing" />
                      <StepBadge done={p.step3_media_done} label="3. Médias" />
                      <StepBadge done={p.is_published} label="4. Publié" />
                    </div>

                    {/* Détail manquant */}
                    {p.missing_for_publication && p.missing_for_publication.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {p.missing_for_publication.map(m => (
                          <span
                            key={m}
                            className="inline-flex items-center gap-1.5 text-xs bg-red-50 text-red-900 border border-red-200 rounded-full px-2.5 py-1"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {MISSING_LABELS[m] ?? m}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Link href={`/properties/${p.id}`}>
                      <Button variant="secondary" size="sm">
                        {p.step2_sourcing_done && p.step3_media_done ? 'Publier →' : 'Compléter →'}
                      </Button>
                    </Link>
                    {/* Bouton "exclure de la checklist" pour brouillons legacy
                        qu'on ne complétera pas (CEO 2026-06-18 — Q3) */}
                    <ExcludeFromChecklistButton propertyId={p.id} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StepBadge({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${done ? 'text-green-700' : 'text-stoniz-gray-400'}`}>
      {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5 rounded-full border-2 border-stoniz-gray-300 inline-block" />}
      <span className="font-medium">{label}</span>
    </span>
  );
}
