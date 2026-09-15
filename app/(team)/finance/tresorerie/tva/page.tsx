import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { getSessionUser, requireRole } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/utils/format';
import { computeMonthlyTva } from '@/lib/finance/tva';
import { TvaDetailTable } from './tva-detail-table';

type SP = { year?: string; month?: string };

const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export default async function TvaPage({ searchParams }: { searchParams: SP }) {
  await requireRole(['ceo', 'finance', 'developer']);
  const me = await getSessionUser();
  const canWrite = me?.role === 'ceo' || me?.role === 'finance';

  const now = new Date();
  const year = parseInt(searchParams.year ?? String(now.getUTCFullYear()), 10);
  const month = parseInt(searchParams.month ?? String(now.getUTCMonth() + 1), 10);

  const { societes, transactions, period } = await computeMonthlyTva(year, month);

  // Navigateur mois précédent / suivant
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  return (
    <div className="space-y-6">
      <Link
        href="/finance/tresorerie"
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black"
      >
        <ArrowLeft className="w-4 h-4" /> Retour à la trésorerie
      </Link>

      <PageHeader
        title="TVA du mois"
        description={`${MONTH_LABELS[month - 1]} ${year} · calcul automatique basé sur les relevés bancaires importés`}
        action={
          <div className="flex items-center gap-2 bg-stoniz-gray-50 border rounded-md">
            <Link
              href={`/finance/tresorerie/tva?year=${prevYear}&month=${prevMonth}`}
              className="p-2 hover:bg-stoniz-gray-100"
              aria-label="Mois précédent"
            >
              <ChevronLeft className="w-4 h-4" />
            </Link>
            <div className="px-3 py-2 text-sm font-medium min-w-[160px] text-center border-x">
              {MONTH_LABELS[month - 1]} {year}
            </div>
            <Link
              href={`/finance/tresorerie/tva?year=${nextYear}&month=${nextMonth}`}
              className="p-2 hover:bg-stoniz-gray-100"
              aria-label="Mois suivant"
            >
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        }
      />

      {societes.length === 0 && (
        <Card>
          <p className="text-sm text-stoniz-gray-500">
            Aucune transaction bancaire sur cette période. Importe un relevé
            depuis <Link href="/finance/tresorerie/import" className="underline">Trésorerie → Import</Link>.
          </p>
        </Card>
      )}

      {/* Sous-total consolidé Groupe (visible dès 2 sociétés) */}
      {societes.length > 1 && (() => {
        const tot = societes.reduce((a, s) => ({
          collectee: a.collectee + s.tva_collectee,
          deductible: a.deductible + s.tva_deductible,
          a_payer: a.a_payer + s.tva_a_payer,
        }), { collectee: 0, deductible: 0, a_payer: 0 });
        return (
          <Card className="bg-stoniz-beige border-2 border-stoniz-black">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-stoniz-gray-600">Consolidé Groupe</div>
                <div className="text-lg font-display">{societes.length} sociétés</div>
              </div>
              <div className="flex gap-6 text-sm">
                <div>
                  <div className="text-xs text-stoniz-gray-500">Collectée</div>
                  <div className="font-medium"><Money amount={tot.collectee} currency="MAD" /></div>
                </div>
                <div>
                  <div className="text-xs text-stoniz-gray-500">Déductible</div>
                  <div className="font-medium"><Money amount={tot.deductible} currency="MAD" /></div>
                </div>
                <div>
                  <div className="text-xs text-stoniz-gray-500">À payer</div>
                  <div className={`text-xl font-display ${tot.a_payer >= 0 ? 'text-stoniz-black' : 'text-green-700'}`}>
                    <Money amount={Math.abs(tot.a_payer)} currency="MAD" />
                  </div>
                </div>
              </div>
            </div>
          </Card>
        );
      })()}

      {/* Un bloc de KPIs par société */}
      {societes.map(s => (
        <Card key={s.company_id}>
          <div className="flex items-center justify-between mb-4 pb-3 border-b">
            <div>
              <h2 className="text-lg font-display">{s.company_label}</h2>
              <div className="text-xs text-stoniz-gray-500">
                {s.nb_tx_collectee} recettes assujetties · {s.nb_tx_deductible} charges déductibles
                {s.nb_tx_exoneree > 0 && <> · {s.nb_tx_exoneree} exonérées</>}
                {s.nb_tx_a_qualifier > 0 && (
                  <> · <span className="text-orange-700 font-medium">{s.nb_tx_a_qualifier} à qualifier</span></>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider">TVA à payer</div>
              <div className={`text-2xl font-display ${s.tva_a_payer >= 0 ? 'text-stoniz-black' : 'text-green-700'}`}>
                <Money amount={Math.abs(s.tva_a_payer)} currency="MAD" />
              </div>
              {s.tva_a_payer < 0 && (
                <div className="text-xs text-green-700">Crédit TVA reportable</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-green-50 border border-green-200 rounded p-4">
              <div className="text-xs uppercase tracking-wider text-green-700 mb-1">TVA collectée</div>
              <div className="text-xl font-display text-green-900">
                <Money amount={s.tva_collectee} currency="MAD" />
              </div>
              <div className="text-xs text-green-700 mt-1">
                Base HT : <Money amount={s.base_ht_collectee} currency="MAD" />
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded p-4">
              <div className="text-xs uppercase tracking-wider text-blue-700 mb-1">TVA déductible</div>
              <div className="text-xl font-display text-blue-900">
                <Money amount={s.tva_deductible} currency="MAD" />
              </div>
              <div className="text-xs text-blue-700 mt-1">
                Base HT : <Money amount={s.base_ht_deductible} currency="MAD" />
              </div>
            </div>
          </div>

          {s.nb_tx_a_qualifier > 0 && (
            <div className="mt-3 text-sm bg-orange-50 border border-orange-200 rounded p-3 text-orange-900">
              <strong>{s.nb_tx_a_qualifier} transaction(s) à qualifier</strong> pour un montant
              cumulé de <Money amount={s.montant_a_qualifier} currency="MAD" />. Utilise le
              tableau ci-dessous pour préciser leur traitement TVA.
            </div>
          )}
        </Card>
      ))}

      {/* Tableau détail transactions du mois avec barre de recherche + modale édition */}
      {transactions.length > 0 && (
        <Card>
          <TvaDetailTable transactions={transactions} canWrite={canWrite} />
        </Card>
      )}

      <Card className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600 space-y-1">
        <div><strong>Méthode :</strong> TVA calculée sur les encaissements/décaissements bancaires du mois. Taux défaut 20 %, ajustable à 14 / 10 / 7 / personnalisé par transaction ou par bénéficiaire.</div>
        <div><strong>Ordre de résolution :</strong> override manuel (✏️) &gt; règle mémorisée pour le bénéficiaire (🧠) &gt; bénéficiaire = personne physique = présumé salaire/remboursement (👤 exonéré) &gt; règles par catégorie du relevé (⚙️).</div>
        <div><strong>Mémorisation :</strong> quand tu modifies le TVA d'une transaction, coche « Mémoriser pour ce bénéficiaire » pour appliquer automatiquement la même règle aux futures transactions du même bénéficiaire (override possible transaction par transaction).</div>
      </Card>
    </div>
  );
}
