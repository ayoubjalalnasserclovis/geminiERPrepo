'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Download, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { importPropertiesCSVAction } from '@/app/(team)/properties/actions';

type ImportResult = {
  ok: true;
  imported: number;
  skipped: number;
  total: number;
  errors: { row: number; field?: string; error: string }[];
} | {
  ok: false;
  error: string;
  errors?: { row: number; field?: string; error: string }[];
};

export function PropertyCSVImport() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await importPropertiesCSVAction(fd);
      setResult(r as ImportResult);
      if (r.ok && (r.imported ?? 0) > 0) {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Étape 1 — Choisir un format */}
      <Card>
        <div className="flex items-start gap-3">
          <div className="bg-cream-soft rounded-md p-3">
            <FileSpreadsheet className="w-5 h-5 text-stoniz-black" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg">1. Deux formats CSV acceptés</h3>
            <p className="text-sm text-stoniz-gray-600 mt-1">
              Le système détecte automatiquement le format de ton fichier — pas besoin
              de te poser la question. Tu peux utiliser celui que tu préfères.
            </p>
            <div className="mt-3 grid md:grid-cols-2 gap-3">
              <div className="border rounded-md p-3 bg-white">
                <div className="font-medium text-sm">📋 Format Stoniz natif</div>
                <p className="text-xs text-stoniz-gray-600 mt-1">
                  Modèle officiel avec colonnes nettoyées : <code>name</code>, <code>type</code>,
                  <code>quartier</code>, <code>superficie</code>, <code>price</code>, etc.
                </p>
                <a
                  href="/templates/biens-import-template.csv"
                  download="biens-import-template.csv"
                  className="inline-flex items-center gap-2 mt-2 text-xs text-stoniz-black underline underline-offset-4 hover:text-stoniz-black/70"
                >
                  <Download className="w-3 h-3" />
                  biens-import-template.csv
                </a>
              </div>
              <div className="border rounded-md p-3 bg-white">
                <div className="font-medium text-sm">📊 Format MASTER ERP (Google Sheets)</div>
                <p className="text-xs text-stoniz-gray-600 mt-1">
                  Export direct de ton MASTER ERP : <code>cost_bien</code>, <code>surface</code>,
                  <code>loyer_brut_mensuel</code>, <code>number_division</code>, etc.
                </p>
                <p className="text-xs text-stoniz-gray-500 mt-2 italic">
                  Détecté auto. Les champs calculés (rendement, frais notaire/agence, travaux) sont
                  ignorés — l'ERP les recalcule via ses formules.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Étape 2 — Guide rapide */}
      <Card>
        <h3 className="font-display text-lg mb-3">2. Règles à respecter</h3>
        <ul className="space-y-2 text-sm text-stoniz-gray-700">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Format natif — colonnes obligatoires</strong> : name, type, quartier, address, google_maps_url,
              superficie, terrasse_m2, floor, nb_suites, evaluation, status, price, estimated_rent,
              travaux_budget_estimate, description, charges_mensuelles_immeuble, taux_occupation,
              frais_fonctionnement_annuel, conciergerie_annuel.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Format MASTER ERP — minimum requis</strong> : nom_bien (ou name), cost_bien, surface, quartier,
              loyer_brut_mensuel, number_division (nb suites). Les champs address / floor / type seront pré-remplis avec
              des valeurs par défaut à compléter ensuite sur la fiche bien.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Détection des doublons</strong> : si un bien avec un nom similaire existe déjà
              (ex. "117 m2 anbar" vs "117 M2 Anbar"), il est ignoré automatiquement.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
            <span>
              <strong>type</strong> : <code>Appartement</code>, <code>Riad</code>, <code>Villa</code> ou <code>Terrain</code>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
            <span>
              <strong>status</strong> : <code>sourcing</code> (par défaut), <code>disponible</code>, <code>propose</code>,
              <code>offre</code>, <code>vendu</code>, <code>perdu</code>, <code>a_verifier</code>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
            <span><strong>evaluation</strong> : <code>1</code>, <code>2</code> ou <code>3</code> (étoiles)</span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
            <span>
              <strong>avantages / points_negatifs</strong> : plusieurs valeurs séparées par <code>|</code> (pipe)
              <br />
              <span className="text-xs text-stoniz-gray-500">Ex : <code>Vue dégagée|Ascenseur|Parking</code></span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
            <span>
              <strong>notary_fees</strong> et <strong>agency_fees</strong> : laissez vides → auto-calculés (7% et 3% TTC du prix)
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Tous les biens importés sont en brouillon</strong>. À compléter ensuite avec sourcing
              (partenaire/direct) et médias avant publication.
            </span>
          </li>
        </ul>
      </Card>

      {/* Étape 3 — Upload */}
      <Card>
        <h3 className="font-display text-lg mb-3">3. Uploade ton CSV rempli</h3>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              className="block w-full text-sm text-stoniz-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-sm file:border-[1.5px] file:border-stoniz-black file:bg-white file:text-stoniz-black file:font-semibold hover:file:bg-stoniz-black/5"
            />
            {fileName && (
              <p className="text-xs text-stoniz-gray-500 mt-2">Fichier sélectionné : <strong>{fileName}</strong></p>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={pending}>
              <Upload className="w-4 h-4" />
              {pending ? 'Import en cours…' : 'Importer les biens'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Résultat */}
      {result && (
        result.ok ? (
          <Card className={result.skipped === 0 ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}>
            <div className="flex items-start gap-3">
              {result.skipped === 0 ? (
                <CheckCircle2 className="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-orange-700 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <h3 className="font-display text-lg">
                  {result.imported} bien{result.imported > 1 ? 's' : ''} importé{result.imported > 1 ? 's' : ''} en brouillon
                </h3>
                <p className="text-sm mt-1">
                  {result.skipped > 0
                    ? `${result.skipped} ligne${result.skipped > 1 ? 's' : ''} ignorée${result.skipped > 1 ? 's' : ''} sur ${result.total} (voir détails ci-dessous).`
                    : `Toutes les ${result.total} lignes ont été importées avec succès.`}
                </p>
                {result.errors.length > 0 && (
                  <div className="mt-3 bg-white border border-orange-200 rounded-sm p-3 max-h-64 overflow-y-auto">
                    <p className="text-xs font-semibold uppercase tracking-wider mb-2 text-orange-900">
                      Lignes en erreur
                    </p>
                    <ul className="space-y-1 text-xs">
                      {result.errors.map((e, i) => (
                        <li key={i} className="font-mono">
                          <span className="text-orange-700">Ligne {e.row}</span>
                          {e.field && <span className="text-stoniz-gray-500"> · {e.field}</span>}
                          {' '}: {e.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.imported > 0 && (
                  <div className="mt-4 flex gap-2">
                    <a href="/properties/incomplets" className="text-sm underline underline-offset-4 text-stoniz-black">
                      Voir les biens en cours d'import →
                    </a>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ) : (
          <Card className="bg-red-50 border-red-200">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-display text-lg text-red-900">Import échoué</h3>
                <p className="text-sm text-red-800 mt-1">{result.error}</p>
              </div>
            </div>
          </Card>
        )
      )}
    </div>
  );
}
