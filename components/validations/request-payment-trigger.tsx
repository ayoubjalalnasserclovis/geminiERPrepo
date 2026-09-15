'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RequestPaymentDrawer, type Acompte } from './request-payment-drawer';

/**
 * Bouton sticky + drawer. Servi par les pages serveur achats/travaux (Phase B4).
 * Garde la page parent en server component — toute la state vit ici.
 */
export function RequestPaymentTrigger({
  projectId, source, acomptes,
}: {
  projectId: string;
  source: 'achats' | 'travaux';
  acomptes: Acompte[];
}) {
  const [open, setOpen] = useState(false);
  const eligibleCount = acomptes.filter((a) => !a.has_active_request).length;
  const disabled = eligibleCount === 0;

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="gap-2"
        title={disabled
          ? 'Aucun acompte éligible (créer/planifier d\'abord les acomptes sur les lots).'
          : `Ouvrir la demande de paiement pour ${eligibleCount} acompte(s)`}
      >
        <ShieldCheck className="w-4 h-4" />
        Demander paiement ({eligibleCount} éligible{eligibleCount > 1 ? 's' : ''})
      </Button>

      <RequestPaymentDrawer
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        source={source}
        acomptes={acomptes}
      />
    </>
  );
}
