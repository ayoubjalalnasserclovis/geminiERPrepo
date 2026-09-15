import { CheckCircle2 } from 'lucide-react';

/**
 * Bandeau de clôture projet — visible dès que current_phase = 'termine'.
 * Pattern simplifié du ReceptionBanner : pas de CTA, pas de lien, juste un marqueur
 * visuel emerald pour acter le moment de clôture.
 *
 * 2 variants :
 *   - 'staff'  : "✓ Projet clôturé le [date]"
 *   - 'client' : "✓ Votre projet Stoniz est terminé. Merci pour votre confiance."
 */
export function ProjectClosedBanner({
  variant,
  closedAt,
}: {
  variant: 'staff' | 'client';
  closedAt: string | null;
}) {
  const formattedDate = closedAt
    ? new Date(closedAt).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  if (variant === 'staff') {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl border-2 bg-emerald-50 border-emerald-300">
        <CheckCircle2 className="w-5 h-5 text-emerald-700 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-emerald-900">
            ✓ Projet clôturé
            {formattedDate && <span className="text-emerald-700 font-normal"> · le {formattedDate}</span>}
          </div>
          <div className="text-xs text-emerald-700 mt-0.5">
            Toutes les phases sont terminées. Le projet reste consultable en lecture.
          </div>
        </div>
      </div>
    );
  }

  // Variant client : ton chaleureux
  return (
    <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-700 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-display text-xl text-emerald-900 mb-1">
            ✓ Votre projet Stoniz est terminé
          </h3>
          <p className="text-sm text-emerald-800">
            Merci pour votre confiance.
            {formattedDate && (
              <>
                {' '}Projet officiellement clôturé le <strong>{formattedDate}</strong>.
              </>
            )}
          </p>
          <p className="text-xs text-emerald-700 mt-2">
            Toute l'équipe Stoniz reste à votre disposition pour la suite (gestion locative,
            optimisations, futurs projets).
          </p>
        </div>
      </div>
    </div>
  );
}
