import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ArrowLeft, FileUp, Info } from 'lucide-react';
import { ImportFlow } from './import-flow';

/**
 * Page d'import des relevés bancaires Chaabi (XLSX ou CSV).
 * Accessible à CEO + finance.
 *
 * Flow :
 *   1. L'utilisateur choisit un compte cible + uploade un fichier
 *   2. Server Action dryRunImport() parse, catégorise, détecte les doublons
 *   3. L'UI affiche un résumé : nombre de lignes, totaux, anomalies, libellés à qualifier
 *   4. Bouton "Confirmer l'import" → insert en BDD
 */

export default async function TresoreriImportPage() {
  await requireRole(['ceo', 'finance']);
  const supabase = createClient();

  // Liste des comptes actifs pour le sélecteur
  const { data: accounts } = await supabase
    .from('bank_accounts')
    .select(`
      id, account_label, bank_label, bank_code, currency,
      company:bank_companies(name, business_unit)
    `)
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('account_label');

  const accountsList = (accounts ?? []) as any[];

  // Nombre de mappings sauvegardés (pour info)
  const { count: mappingsCount } = await supabase
    .from('bank_category_mappings')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null);

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          title="Importer un relevé bancaire"
          description="Upload un fichier XLSX ou CSV exporté depuis Chaabi Net. Le système parse, catégorise automatiquement et signale les doublons."
        />
        <Link
          href="/finance/tresorerie"
          className="inline-flex items-center gap-2 text-sm border border-stoniz-gray-300 rounded-md px-4 py-2 hover:bg-stoniz-gray-50"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour à la trésorerie
        </Link>
      </div>

      {/* Info contextuelle */}
      <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm text-blue-900 flex items-start gap-3">
        <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium mb-1">Comment ça marche</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Le fichier doit être au format Chaabi Bank (XLSX recommandé, CSV accepté).</li>
            <li>Le système détecte automatiquement les achats CB, virements, chèques, DGI, CNSS, télécoms, frais bancaires.</li>
            <li>Les doublons (lignes déjà importées) sont signalés et ne seront pas réinsérés.</li>
            <li>Les libellés inconnus (ex : nouveau salaire, artisan) sont à qualifier — la qualification est mémorisée pour les imports suivants.</li>
            <li><strong>Mappings actuels :</strong> {mappingsCount ?? 0} qualification{(mappingsCount ?? 0) > 1 ? 's' : ''} mémorisée{(mappingsCount ?? 0) > 1 ? 's' : ''}.</li>
          </ul>
        </div>
      </div>

      {accountsList.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <FileUp className="w-12 h-12 mx-auto mb-4 text-stoniz-gray-300" />
            <p className="text-sm text-stoniz-gray-600">
              Aucun compte bancaire actif. Crée d'abord un compte depuis la page Trésorerie.
            </p>
            <Link
              href="/finance/tresorerie"
              className="inline-block mt-4 text-sm underline text-stoniz-black"
            >
              Aller à la page Trésorerie
            </Link>
          </div>
        </Card>
      ) : (
        <ImportFlow accounts={accountsList} />
      )}
    </div>
  );
}
