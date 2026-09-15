import Link from 'next/link';
import { Calculator } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { madToEur } from '@/lib/finance/fx-fixed';
import {
  getCleaningCostTodayForProperty,
  type CleaningCostBreakdown,
} from '@/lib/propria/cost-matrix';

/**
 * Sous-onglet « Coût ménage » de la fiche bien Propria (chantier 15, sujet 4).
 * Par lot : coût calculé d'un ménage standard / poussière / deep cleaning à
 * AUJOURD'HUI (paramètres en vigueur ce jour, overrides du lot inclus),
 * décomposé par composante. Composante sans paramètre = « — » (jamais de faux
 * zéro). Rien n'est stocké : tout est dérivé de propria_cost_params
 * (lib/propria/cost-matrix.ts). Server Component.
 */

function fmtMad(v: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v);
}

function CostCard({ title, icon, breakdown }: {
  title: string;
  icon: string;
  breakdown: CleaningCostBreakdown;
}) {
  return (
    <div className="border border-stoniz-gray-200 rounded-lg p-3">
      <div className="text-xs font-medium mb-1.5">{icon} {title}</div>
      {breakdown.totalMad == null ? (
        <div className="text-sm text-stoniz-gray-400" title="Aucun coût unitaire applicable — saisis-les dans /propria/couts">
          ⏳ en attente de données
        </div>
      ) : (
        <div className="text-lg font-display">
          {fmtMad(breakdown.totalMad)} <span className="text-xs text-stoniz-gray-400">MAD</span>
          <span className="text-[10px] text-stoniz-gray-400 ml-1">≈ {fmtMad(madToEur(breakdown.totalMad))} €</span>
          {breakdown.isPartial && (
            <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full align-middle">
              partiel
            </span>
          )}
        </div>
      )}
      <ul className="mt-2 space-y-0.5">
        {breakdown.components.map((c) => (
          <li key={c.key} className="flex justify-between text-[11px]" title={c.detail}>
            <span className="text-stoniz-gray-500">{c.label}</span>
            <span className={c.amountMad == null ? 'text-stoniz-gray-300' : 'tabular-nums'}>
              {c.amountMad == null ? '—' : fmtMad(c.amountMad)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function PropriaBienCleaningCostSection({ propertyId }: { propertyId: string }) {
  const supabase = createClient();
  const { units, hasCostParams } = await getCleaningCostTodayForProperty(supabase, propertyId);

  if (units.length === 0) return null;

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg inline-flex items-center gap-2">
          <Calculator className="w-4 h-4 text-stoniz-gray-500" /> Coût ménage
        </h2>
        <Link href="/propria/couts" className="text-xs text-stoniz-gray-500 hover:text-stoniz-black">
          Coûts unitaires →
        </Link>
      </div>

      {!hasCostParams && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2 text-xs mb-3">
          ⏳ En attente de données : aucun coût unitaire saisi.{' '}
          <Link href="/propria/couts" className="underline font-medium">Saisir dans /propria/couts</Link>
        </div>
      )}

      <div className="space-y-3">
        {units.map((u) => (
          <div key={u.unitId} className="border border-stoniz-gray-200 rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-sm font-medium">{u.label}</span>
              <span className="text-[10px] text-stoniz-gray-400">
                {u.nbChambres != null ? `${u.nbChambres} ch.` : 'nb chambres ?'}
                {' · '}
                {u.nbSdb != null ? `${u.nbSdb} SDB` : 'nb SDB ?'}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <CostCard title="Ménage standard" icon="🛏" breakdown={u.standard} />
              <CostCard title="Poussière" icon="🌬" breakdown={u.poussiere} />
              <CostCard title="Deep Cleaning" icon="🧽" breakdown={u.deepCleaning} />
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-stoniz-gray-400 mt-3">
        Coût d’un ménage à aujourd’hui = MO (selon catégorie) + linge (par chambre / SDB
        + amortissement) + consommables + transport + frais de gestion. « — » = paramètre
        ou nb chambres/SDB manquant. Tout est dérivé à la lecture, rien n’est stocké.
      </p>
    </div>
  );
}
