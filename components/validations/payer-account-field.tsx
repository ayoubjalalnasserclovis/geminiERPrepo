'use client';

import { Label } from '@/components/ui/input';
import { PAYER_ACCOUNT_OPTIONS, type PayerAccount } from '@/lib/finance/payer-account';

/**
 * Radio group "Compte payeur" — OBLIGATOIRE sur toute demande de virement
 * achats / travaux (CEO 2026-07-08).
 *
 * Composant partagé par les 3 points d'entrée :
 *   • <RequestApprovalButton> (demande individuelle sur un acompte)
 *   • <RequestPaymentDrawer>  (demande groupée achats/travaux)
 *   • <BulkPlanAcomptes>      (validation groupée post-planification achats)
 *
 * Défini au top-level du module (jamais dans la closure d'un parent —
 * cf. piège React field-in-closure, bug bancaire propria 2026-06-11).
 *
 * `value === null` = pas encore choisi → le parent doit bloquer l'envoi.
 */
export function PayerAccountField({
  value,
  onChange,
  name = 'payer-account',
  showError = false,
}: {
  value: PayerAccount | null;
  onChange: (v: PayerAccount) => void;
  /** Nom unique du groupe radio si plusieurs formulaires coexistent. */
  name?: string;
  /** Affiche le message "choix obligatoire" (après tentative d'envoi). */
  showError?: boolean;
}) {
  return (
    <div>
      <Label>
        Compte payeur <span className="text-red-600">*</span>
      </Label>
      <div className="flex gap-2 mt-1">
        {PAYER_ACCOUNT_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className="flex-1 border rounded-md px-3 py-2 cursor-pointer text-sm has-[:checked]:border-stoniz-black has-[:checked]:bg-stoniz-gray-50"
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
              className="mr-2"
            />
            {opt.label}
          </label>
        ))}
      </div>
      {showError && value === null && (
        <p className="text-xs text-red-700 mt-1">
          Choix obligatoire : indique depuis quel compte le virement sera émis.
        </p>
      )}
    </div>
  );
}
