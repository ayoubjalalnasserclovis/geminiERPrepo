import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ClientBriefActions } from '@/components/brief/client-brief-actions';
import { formatDate } from '@/lib/utils/format';

const FINANCING_LABELS: Record<string, string> = {
  fonds_propres: 'Fonds propres',
  banque_classique: 'Banque traditionnelle',
  banque_islamique: 'Banque islamique',
  mixte: 'Mixte',
};
const RENTAL_LABELS: Record<string, string> = {
  courte_duree: 'Courte durée (Airbnb)',
  moyenne_duree: 'Moyenne durée (1-12 mois)',
  longue_duree: 'Longue durée (bail classique)',
  mixte: 'Mixte',
  indecis: 'À discuter',
};

export default async function ClientBriefPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: brief } = await supabase
    .from('project_briefs').select('*').eq('project_id', params.id).maybeSingle();

  if (!brief) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="font-display text-3xl">Votre cahier des charges</h1>
        <Card>
          <p className="text-stoniz-gray-600">
            Le cahier des charges n'a pas encore été préparé. Votre conseiller Stoniz vous l'enverra prochainement pour validation.
          </p>
        </Card>
      </div>
    );
  }

  const isPending = brief.status === 'sent_to_client';
  const isValidated = brief.status === 'validated';
  const isRejected = brief.status === 'rejected_by_client';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link href={`/client/projects/${params.id}`} className="text-sm text-stoniz-gray-500 hover:text-stoniz-black">
          ← Retour au projet
        </Link>
        <h1 className="font-display text-3xl mt-2">Votre cahier des charges</h1>
        <p className="text-stoniz-gray-500 mt-1">
          Critères de sélection définis avec votre conseiller. Validez-les pour démarrer la recherche du bien.
        </p>
      </div>

      {isPending && (
        <Card className="bg-accent-light border-accent border-2">
          <h2 className="font-display text-xl">⏳ En attente de votre validation</h2>
          <p className="text-sm text-stoniz-gray-700 mt-2">
            Veuillez relire les critères ci-dessous, puis cliquez sur <strong>Valider</strong> en bas de page si tout
            vous convient. Si vous souhaitez des modifications, utilisez <strong>Demander des modifications</strong>.
          </p>
        </Card>
      )}

      {isValidated && (
        <Card className="bg-green-50 border-green-200">
          <h2 className="font-display text-xl">✅ Validé le {formatDate(brief.validated_at)}</h2>
          <p className="text-sm text-stoniz-gray-700 mt-2">
            Votre conseiller peut maintenant démarrer la recherche du bien.
          </p>
        </Card>
      )}

      {isRejected && (
        <Card className="bg-red-50 border-red-200">
          <h2 className="font-display text-xl">❌ Modifications demandées le {formatDate(brief.rejected_at)}</h2>
          <p className="text-sm text-stoniz-gray-700 mt-2">Votre retour :</p>
          <p className="text-sm italic mt-2 bg-white p-3 rounded border">« {brief.rejection_reason} »</p>
          <p className="text-xs text-stoniz-gray-600 mt-3">
            Votre conseiller va le mettre à jour et vous le renverra.
          </p>
        </Card>
      )}

      {/* Récap */}
      <Section title="Type de bien & localisation">
        <Row label="Types acceptés" value={(brief.property_types ?? []).join(', ') || '—'} />
        <Row label="Quartiers ciblés" value={(brief.quartiers ?? []).join(', ') || '—'} />
      </Section>

      <Section title="Budget">
        <Row label="Budget total max" value={fmtEur(brief.budget_total_max)} />
        <Row label="Acquisition max" value={fmtEur(brief.budget_acquisition_max)} />
        <Row label="Travaux max" value={fmtEur(brief.budget_travaux_max)} />
        <Row label="Déco / mobilier max" value={fmtEur(brief.budget_deco_max)} />
        <Row label="Épargne disponible" value={fmtEur(brief.available_savings)} />
        <Row label="Mode de financement" value={FINANCING_LABELS[brief.financing_type] ?? '—'} />
      </Section>

      <Section title="Caractéristiques">
        <Row label="Surface (m²)"
          value={brief.superficie_min || brief.superficie_max
            ? `${brief.superficie_min ?? '?'} – ${brief.superficie_max ?? '?'}`
            : '—'} />
        <Row label="Suites minimum" value={brief.nb_suites_min ?? '—'} />
        <Row label="Étage" value={brief.floor_preference ?? '—'} />
        <Row label="Terrasse" value={brief.needs_terrace ? 'Exigée' : '—'} />
        <Row label="Ascenseur" value={brief.needs_elevator ? 'Exigé' : '—'} />
        <Row label="Parking"   value={brief.needs_parking ? 'Exigé' : '—'} />
        <Row label="Piscine"   value={brief.needs_pool ? 'Souhaitée' : '—'} />
        <Row label="Vue dégagée" value={brief.needs_view ? 'Souhaitée' : '—'} />
      </Section>

      <Section title="Stratégie locative & objectifs">
        <Row label="Stratégie" value={RENTAL_LABELS[brief.rental_strategy] ?? '—'} />
        <Row label="Loyer cible / mois" value={fmtEur(brief.expected_rent_monthly)} />
        <Row label="Rendement brut cible" value={brief.expected_gross_yield_pct ? `${brief.expected_gross_yield_pct}%` : '—'} />
        <Row label="Rendement net cible"  value={brief.expected_net_yield_pct  ? `${brief.expected_net_yield_pct}%`  : '—'} />
      </Section>

      <Section title="Travaux & contraintes">
        <Row label="Travaux lourds acceptés" value={brief.accept_heavy_works ? 'Oui' : 'Non'} />
        <Row label="Division acceptée" value={brief.accept_division ? 'Oui' : 'Non'} />
        <Row label="Mise en location souhaitée" value={brief.delivery_deadline ? formatDate(brief.delivery_deadline) : '—'} />
      </Section>

      {(brief.specificities || brief.exclusions) && (
        <Section title="Demandes spécifiques">
          {brief.specificities && (
            <div className="text-sm">
              <div className="text-stoniz-gray-500 mb-1">Spécifications</div>
              <p className="whitespace-pre-wrap">{brief.specificities}</p>
            </div>
          )}
          {brief.exclusions && (
            <div className="text-sm mt-4">
              <div className="text-stoniz-gray-500 mb-1">Exclusions</div>
              <p className="whitespace-pre-wrap">{brief.exclusions}</p>
            </div>
          )}
        </Section>
      )}

      {isPending && <ClientBriefActions projectId={params.id} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">{children}</dl>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-1 last:border-0">
      <dt className="text-stoniz-gray-500">{label}</dt>
      <dd className="font-medium text-right">{value ?? '—'}</dd>
    </div>
  );
}

function fmtEur(v: number | string | null | undefined): string {
  if (v == null || v === '') return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(v));
}
