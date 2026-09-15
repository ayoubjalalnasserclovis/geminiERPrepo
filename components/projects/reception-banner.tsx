import Link from 'next/link';
import { ClipboardList, AlertTriangle, CheckCircle2, Send, Wrench } from 'lucide-react';

export type ReceptionBannerProps = {
  projectId: string;
  vct: { id: string; status: string } | null;
  pv: { id: string; status: string; client_signed_at: string | null } | null;
  openActionsCount: number;
};

function fmtDate(d: string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('fr-FR');
}

/**
 * Bandeau dynamique qui s'affiche au-dessus du "Cahier des charges" en phase
 * Livraison / Mise en location / Terminé. Affiche l'état de la réception
 * et l'action recommandée au chef projet :
 *   1. Pas de VCT → "Démarrer la VCT"
 *   2. VCT en cours → "VCT en cours · X actions ouvertes"
 *   3. VCT validée, pas de PV → "Créer le PV de réception"
 *   4. PV brouillon → "Finaliser le PV"
 *   5. PV envoyé au client → "En attente de signature client"
 *   6. PV signé → "✓ Réception signée le X"
 */
export function ReceptionBanner({
  projectId, vct, pv, openActionsCount,
}: ReceptionBannerProps) {
  const link = `/projects/${projectId}/reception`;

  // 6. PV signé → vert
  if (pv?.status === 'validated' || pv?.status === 'closed') {
    return (
      <BannerShell color="emerald" link={link}>
        <CheckCircle2 className="w-5 h-5 text-emerald-700 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-emerald-900">
            ✓ Réception signée par le client
          </div>
          <div className="text-xs text-emerald-700">
            PV signé le {fmtDate(pv.client_signed_at)} · Voir les détails de la réception →
          </div>
        </div>
      </BannerShell>
    );
  }

  // 5. PV envoyé au client → orange
  if (pv?.status === 'sent_to_client') {
    return (
      <BannerShell color="orange" link={link}>
        <Send className="w-5 h-5 text-orange-700 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-orange-900">
            ⏳ PV envoyé au client — en attente de signature
          </div>
          <div className="text-xs text-orange-700">
            Le client a reçu un email. Tu peux suivre l'avancement et relancer si besoin →
          </div>
        </div>
      </BannerShell>
    );
  }

  // 4. PV brouillon → bleu
  if (pv?.status === 'draft') {
    return (
      <BannerShell color="blue" link={link}>
        <ClipboardList className="w-5 h-5 text-blue-700 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-blue-900">
            📋 PV de réception à finaliser
          </div>
          <div className="text-xs text-blue-700">
            Complète les informations (compteurs, clés, signatures), puis envoie au client →
          </div>
        </div>
      </BannerShell>
    );
  }

  // 3. VCT validée, pas encore de PV → bleu
  if (vct?.status === 'validated' && !pv) {
    return (
      <BannerShell color="blue" link={link}>
        <ClipboardList className="w-5 h-5 text-blue-700 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-blue-900">
            VCT validée ✓ — prêt à créer le PV de réception
          </div>
          <div className="text-xs text-blue-700">
            Le contrôle technique est OK. Crée le PV pour la visite contradictoire avec le client →
          </div>
        </div>
      </BannerShell>
    );
  }

  // 2. VCT en cours (avec actions ouvertes) → orange / ambre
  if (vct && ['in_progress','with_actions'].includes(vct.status)) {
    const hasActions = openActionsCount > 0;
    return (
      <BannerShell color={hasActions ? 'orange' : 'amber'} link={link}>
        <Wrench className={`w-5 h-5 flex-shrink-0 ${hasActions ? 'text-orange-700' : 'text-amber-700'}`} />
        <div className="flex-1">
          <div className={`font-medium ${hasActions ? 'text-orange-900' : 'text-amber-900'}`}>
            🛠 VCT en cours
            {hasActions && ` — ${openActionsCount} action${openActionsCount > 1 ? 's' : ''} corrective${openActionsCount > 1 ? 's' : ''} à traiter`}
          </div>
          <div className={`text-xs ${hasActions ? 'text-orange-700' : 'text-amber-700'}`}>
            {hasActions
              ? 'Les artisans doivent corriger avant de pouvoir créer le PV de réception →'
              : 'Continue la checklist de contrôle technique →'}
          </div>
        </div>
      </BannerShell>
    );
  }

  // 2bis. VCT draft (créée mais rien coché)
  if (vct?.status === 'draft') {
    return (
      <BannerShell color="amber" link={link}>
        <ClipboardList className="w-5 h-5 text-amber-700 flex-shrink-0" />
        <div className="flex-1">
          <div className="font-medium text-amber-900">
            VCT démarrée — il reste à remplir la checklist
          </div>
          <div className="text-xs text-amber-700">
            Le chef projet doit inspecter le bien et cocher chaque point de la checklist →
          </div>
        </div>
      </BannerShell>
    );
  }

  // 1. Pas encore de VCT → rouge / ambre (action requise)
  return (
    <BannerShell color="amber" link={link}>
      <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0" />
      <div className="flex-1">
        <div className="font-medium text-amber-900">
          🛠 Visite de contrôle technique à démarrer
        </div>
        <div className="text-xs text-amber-700">
          Avant la livraison au client, le chef projet doit faire une VCT interne du bien. Démarrer maintenant →
        </div>
      </div>
    </BannerShell>
  );
}

// ─── Shell générique du bandeau ──────────────────────────────────────────
function BannerShell({
  color, link, children,
}: {
  color: 'amber' | 'orange' | 'blue' | 'emerald';
  link: string;
  children: React.ReactNode;
}) {
  const COLORS: Record<string, string> = {
    amber:   'bg-amber-50 border-amber-200 hover:bg-amber-100',
    orange:  'bg-orange-50 border-orange-200 hover:bg-orange-100',
    blue:    'bg-blue-50 border-blue-200 hover:bg-blue-100',
    emerald: 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100',
  };
  return (
    <Link
      href={link}
      className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-colors ${COLORS[color]}`}
    >
      {children}
    </Link>
  );
}
