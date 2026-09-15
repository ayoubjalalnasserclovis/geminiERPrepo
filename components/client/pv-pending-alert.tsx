import Link from 'next/link';
import { ScrollText, ArrowRight, AlertCircle } from 'lucide-react';
import type { PendingPv } from '@/lib/reception/get-pending-pvs-for-client';

/**
 * Alerte persistante côté client pour signaler un PV de réception à signer.
 * Deux variants :
 *   - 'dashboard'  : affichage liste si client a plusieurs projets en attente
 *   - 'project'    : affichage compact en haut de la fiche projet
 * + 1 variant complet :
 *   - 'detailed'   : carte large + bouton CTA prominent (pour section dédiée fiche projet)
 */
export function PvPendingAlert({
  pvs,
  variant,
}: {
  pvs: PendingPv[];
  variant: 'dashboard' | 'project' | 'detailed';
}) {
  if (pvs.length === 0) return null;

  // Variant dashboard : liste de toutes les actions en attente (si multi-projets)
  if (variant === 'dashboard') {
    return (
      <div className="bg-red-50 border-2 border-red-300 rounded-xl p-5 mb-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-medium text-red-900 mb-2">
              ⏳ {pvs.length === 1 ? 'Action requise' : `${pvs.length} actions requises`} sur {pvs.length === 1 ? 'votre projet' : 'vos projets'}
            </h3>
            <ul className="space-y-2">
              {pvs.map(pv => (
                <li key={pv.pv_id}>
                  <Link
                    href={`/client/projects/${pv.project_id}/reception`}
                    className="flex items-center justify-between gap-3 bg-white rounded-lg px-4 py-3 hover:shadow-sm transition-shadow group"
                  >
                    <div className="flex items-center gap-3">
                      <ScrollText className="w-4 h-4 text-red-700 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-medium text-stoniz-black">
                          PV de réception à signer
                        </div>
                        <div className="text-xs text-stoniz-gray-600">
                          Projet {pv.project_reference}
                          {pv.days_since_sent != null && pv.days_since_sent > 0 &&
                            ` · envoyé il y a ${pv.days_since_sent}j`}
                        </div>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-stoniz-gray-400 group-hover:text-red-700 transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Variant project : bandeau compact en haut de la fiche projet
  if (variant === 'project') {
    const pv = pvs[0]; // on n'a qu'un PV par projet
    return (
      <Link
        href={`/client/projects/${pv.project_id}/reception`}
        className="flex items-center gap-3 bg-red-50 border-2 border-red-300 rounded-xl p-4 hover:bg-red-100 transition-colors group"
      >
        <AlertCircle className="w-5 h-5 text-red-700 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-red-900">
            ⏳ Votre PV de réception est à signer
          </div>
          <div className="text-xs text-red-700 mt-0.5">
            {pv.days_since_sent != null && pv.days_since_sent > 0
              ? `Envoyé il y a ${pv.days_since_sent} jour${pv.days_since_sent > 1 ? 's' : ''} — sans signature, votre projet ne peut pas être finalisé.`
              : `Sans signature, votre projet ne peut pas être finalisé.`}
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-red-700 group-hover:translate-x-0.5 transition-transform" />
      </Link>
    );
  }

  // Variant detailed : grande carte avec CTA prominent (sur section dédiée)
  const pv = pvs[0];
  return (
    <div className="bg-white border-2 border-red-300 rounded-xl p-6 shadow-sm">
      <div className="flex items-start gap-4 mb-4">
        <div className="bg-red-100 rounded-full p-3 flex-shrink-0">
          <ScrollText className="w-6 h-6 text-red-700" />
        </div>
        <div className="flex-1">
          <h3 className="font-display text-xl mb-1">PV de réception à signer</h3>
          <p className="text-sm text-stoniz-gray-600">
            Le procès-verbal de réception de votre bien est prêt. Votre signature électronique
            est nécessaire pour finaliser la livraison et déclencher les garanties contractuelles
            (parfait achèvement, biennale, décennale).
          </p>
        </div>
      </div>
      {pv.days_since_sent != null && pv.days_since_sent > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 text-sm text-orange-900">
          📅 PV envoyé il y a <strong>{pv.days_since_sent} jour{pv.days_since_sent > 1 ? 's' : ''}</strong>
          {pv.reminder_count > 0 && ` · ${pv.reminder_count} relance${pv.reminder_count > 1 ? 's' : ''} envoyée${pv.reminder_count > 1 ? 's' : ''}`}
        </div>
      )}
      <Link
        href={`/client/projects/${pv.project_id}/reception`}
        className="inline-flex items-center gap-2 bg-stoniz-black text-white px-5 py-3 rounded-md font-medium hover:bg-stoniz-gray-800 transition-colors"
      >
        Consulter et signer le PV
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
