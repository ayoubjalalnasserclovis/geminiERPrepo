import type { PoliceRecordStatus } from '@/lib/propria/police-records';

/**
 * Badge statut de fiche police — server component pur.
 *
 * Réutilisable :
 *   - liste fiches-police
 *   - fiche réservation propria (afficher si la fiche existe + son statut)
 *   - fiche bien (cumul rapide)
 *
 * Conventions visuelles canon (mémoire stoniz_ux_canon) :
 *   - rouge = perte / urgence → réservé "aucune fiche" pour signaler un manque légal
 *   - orange = à traiter
 *   - bleu = en cours / complet pas encore déposé
 *   - vert = déposé OK
 *   - gris = archivé
 */
export function PoliceRecordBadge({
  status,
  className = '',
}: {
  status: PoliceRecordStatus | null;
  className?: string;
}) {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap';

  if (!status) {
    return (
      <span className={`${base} bg-red-100 text-red-800 ${className}`} title="Aucune fiche police créée pour cette réservation">
        ✗ Aucune fiche
      </span>
    );
  }

  switch (status) {
    case 'draft':
      return (
        <span className={`${base} bg-amber-100 text-amber-800 ${className}`} title="Fiche en cours de remplissage">
          📋 Brouillon
        </span>
      );
    case 'complete':
      return (
        <span className={`${base} bg-blue-100 text-blue-800 ${className}`} title="Tous les champs sont remplis — prêt à imprimer et déposer">
          ✓ Complète
        </span>
      );
    case 'submitted':
      return (
        <span className={`${base} bg-emerald-100 text-emerald-800 ${className}`} title="Déposée au commissariat">
          🔒 Déposée
        </span>
      );
    case 'archived':
      return (
        <span className={`${base} bg-stoniz-gray-200 text-stoniz-gray-600 ${className}`} title="Fiche archivée">
          📦 Archivée
        </span>
      );
    default:
      return (
        <span className={`${base} bg-stoniz-gray-100 text-stoniz-gray-700 ${className}`}>
          {status}
        </span>
      );
  }
}
