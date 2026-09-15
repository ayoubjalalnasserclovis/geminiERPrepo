import { AlertTriangle } from 'lucide-react';
import { MISSING_LABELS, type ArtisanCompleteness } from '@/lib/artisans/specialities';

/**
 * Bandeau rouge affiché sur la fiche artisan si la fiche n'est pas complète
 * pour permettre une demande de validation de paiement.
 */
export function ArtisanIncompleteBanner({ completeness }: { completeness: ArtisanCompleteness }) {
  if (completeness.is_complete_for_payment) return null;

  return (
    <div className="bg-red-50 border-2 border-red-300 rounded-md p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg text-red-900">
            Fiche incomplète pour paiement
          </h3>
          <p className="text-sm text-red-800 mt-1">
            Vous ne pourrez pas demander de validation de paiement pour cet artisan tant que les
            éléments suivants ne sont pas renseignés :
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {completeness.missing.map(m => (
              <li key={m} className="flex items-center gap-2 text-red-900">
                <span className="w-1.5 h-1.5 bg-red-700 rounded-full" />
                <strong>{MISSING_LABELS[m] ?? m}</strong>
                {(m === 'attestation_rib' || m === 'attestation_regularite_fiscale') && (
                  <span className="text-xs text-red-700 ml-1">
                    (à uploader dans la section « Documents administratifs » ci-dessous)
                  </span>
                )}
                {(m === 'bank_name' || m === 'rib') && (
                  <span className="text-xs text-red-700 ml-1">
                    (à renseigner via le bouton « Modifier » en haut)
                  </span>
                )}
              </li>
            ))}
          </ul>
          {completeness.is_indep && (
            <p className="text-xs text-red-700 mt-3 italic">
              Note : cet artisan est en auto-entrepreneur / personne physique, les attestations
              fiscales et RIB ne sont pas exigées.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
