import Link from 'next/link';
import { CheckCircle2, Circle, ChevronRight, AlertCircle } from 'lucide-react';
import {
  COMPLETENESS_FIELDS,
  isFieldFilled,
  type CompletenessField,
} from '@/lib/propria/completeness';

export type PropertyForCompleteness = {
  id: string;
  address: string | null;
  quartier: string | null;
  floor: string | null;
  superficie: number | null;
  propria_apartment_door: string | null;
  propria_google_maps_url: string | null;
  propria_water_contract: string | null;
  propria_water_meter: string | null;
  propria_electricity_contract: string | null;
  propria_electricity_meter: string | null;
  propria_internet_contract: string | null;
  propria_internet_provider: string | null;
  propria_wifi_ssid: string | null;
  propria_wifi_password: string | null;
  propria_lock_code: string | null;
  propria_smart_lock: boolean | null;
  propria_access_admin: string | null;
};

// Métadonnées visuelles par catégorie (les FIELDS sont importés depuis le
// helper pour rester en single source of truth avec la vue SQL).
type CategoryView = {
  category: CompletenessField['category'];
  title: string;
  expectedPhase: 'sourcing' | 'travaux' | 'livraison';
  phaseLabel: string;
  fields: CompletenessField[];
};

const CATEGORIES: CategoryView[] = [
  {
    category: 'identite',
    title: '📍 Identité & localisation',
    expectedPhase: 'sourcing',
    phaseLabel: 'Sourcing',
    fields: COMPLETENESS_FIELDS.filter(f => f.category === 'identite'),
  },
  {
    category: 'utilites',
    title: '🔌 Compteurs & contrats utilités',
    expectedPhase: 'travaux',
    phaseLabel: 'Travaux',
    fields: COMPLETENESS_FIELDS.filter(f => f.category === 'utilites'),
  },
  {
    category: 'acces',
    title: '🌐 Internet & accès',
    expectedPhase: 'livraison',
    phaseLabel: 'Livraison',
    fields: COMPLETENESS_FIELDS.filter(f => f.category === 'acces'),
  },
];

function isFilled(
  v: unknown,
  type: CompletenessField['type'] = 'string',
): boolean {
  return isFieldFilled(v, type);
}

/**
 * Widget de complétude des données du bien.
 * Visible sur la fiche projet — montre par catégorie ce qui est rempli et ce qui manque,
 * avec lien direct vers l'édition.
 *
 * Aligne le terrain sur la règle "collecter la donnée à la phase où sa source est physiquement
 * présente" (cf. méta-pattern audit).
 */
export function PropertyDataCompleteness({
  property,
  currentPhase,
}: {
  property: PropertyForCompleteness;
  currentPhase: string;
}) {
  const editUrl = `/properties/${property.id}/edit`;

  // Calcul global pour le header
  const allFields = CATEGORIES.flatMap(c => c.fields);
  const filledCount = allFields.filter(f => isFilled(property[f.key as keyof PropertyForCompleteness], f.type)).length;
  const totalCount = allFields.length;
  const globalPct = Math.round((filledCount / totalCount) * 100);

  // Catégorie "active" = celle qui correspond à la phase courante
  const PHASE_PRIORITY: Record<string, string[]> = {
    sourcing:           ['sourcing'],
    design:             ['sourcing'],
    travaux:            ['sourcing', 'travaux'],
    livraison:          ['sourcing', 'travaux', 'livraison'],
    mise_en_location:   ['sourcing', 'travaux', 'livraison'],
    termine:            ['sourcing', 'travaux', 'livraison'],
  };
  const expectedNow = PHASE_PRIORITY[currentPhase] ?? [];

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-medium">Complétude des infos bien</h3>
          <p className="text-xs text-stoniz-gray-500 mt-0.5">
            Données opérationnelles à collecter au fil du projet · {filledCount}/{totalCount} renseignées
          </p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-display ${globalPct === 100 ? 'text-emerald-700' : 'text-stoniz-black'}`}>
            {globalPct}%
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {CATEGORIES.map(cat => {
          const catFilled = cat.fields.filter(f => isFilled(property[f.key as keyof PropertyForCompleteness], f.type)).length;
          const catTotal = cat.fields.length;
          const isExpectedNow = expectedNow.includes(cat.expectedPhase);
          const isLate = isExpectedNow && catFilled < catTotal;
          const isComplete = catFilled === catTotal;

          return (
            <section
              key={cat.title}
              className={`rounded-lg border ${
                isComplete
                  ? 'bg-emerald-50/40 border-emerald-200'
                  : isLate
                    ? 'bg-amber-50/60 border-amber-300'
                    : 'bg-stoniz-gray-50/50 border-stoniz-gray-200'
              }`}
            >
              <header className="px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{cat.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    isComplete
                      ? 'bg-emerald-200 text-emerald-900'
                      : isLate
                        ? 'bg-amber-200 text-amber-900'
                        : 'bg-stoniz-gray-200 text-stoniz-gray-700'
                  }`}>
                    {catFilled}/{catTotal}
                  </span>
                  {isLate && (
                    <span className="text-[10px] text-amber-800 inline-flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      À compléter (phase {cat.phaseLabel.toLowerCase()})
                    </span>
                  )}
                </div>
              </header>
              <ul className="divide-y divide-stoniz-gray-100">
                {cat.fields.map(f => {
                  const filled = isFilled(property[f.key as keyof PropertyForCompleteness], f.type);
                  return (
                    <li key={f.key} className="px-3 py-1.5 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2">
                        {filled
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                          : <Circle className="w-3.5 h-3.5 text-stoniz-gray-300 flex-shrink-0" />}
                        <span className={filled ? 'text-stoniz-gray-700' : 'text-stoniz-gray-500'}>
                          {f.label}
                        </span>
                      </span>
                      {filled && f.key === 'propria_google_maps_url' && (
                        <span className="text-[10px] text-stoniz-gray-400 italic">auto-généré</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <Link
        href={editUrl}
        className="mt-4 inline-flex items-center gap-1 text-sm text-stoniz-black hover:underline"
      >
        Compléter les infos du bien
        <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
