import { AlertTriangle } from 'lucide-react';

const SOFT_FIELDS: { key: string; label: string }[] = [
  { key: 'propria_owner_phone',   label: 'Téléphone du propriétaire' },
  { key: 'propria_owner_email',   label: 'Email du propriétaire' },
  { key: 'propria_mandate_start', label: 'Date de début de mandat' },
];

/**
 * Bandeau "Infos à compléter" qui apparaît sur la fiche bien Propria
 * tant qu'au moins un champ optionnel-mais-recommandé reste vide.
 */
export function PropriaBienWarningsBanner({ bien }: { bien: Record<string, any> }) {
  const missing = SOFT_FIELDS.filter(f => {
    const v = bien[f.key];
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  });

  if (missing.length === 0) return null;

  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-md p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg text-amber-900">
            {missing.length} information{missing.length > 1 ? 's' : ''} à compléter
          </h3>
          <p className="text-sm text-amber-800 mt-0.5">
            Ces champs ne sont pas obligatoires pour créer le bien, mais on en a besoin pour faire tourner la conciergerie sereinement.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {missing.map(f => (
              <li key={f.key} className="flex items-center gap-2 text-amber-900">
                <span className="w-1.5 h-1.5 bg-amber-700 rounded-full" />
                {f.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
