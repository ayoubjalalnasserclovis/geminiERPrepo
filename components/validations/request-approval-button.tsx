'use client';

import { useState, useTransition } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { requestApprovalAction } from '@/app/(team)/validations/actions';
import { PayerAccountField } from '@/components/validations/payer-account-field';
import type { PayerAccount } from '@/lib/finance/payer-account';

export function RequestApprovalButton({
  source, sourceId, projectId,
  defaultAmount, defaultCurrency, defaultBeneficiary, defaultDescription,
  small = false,
}: {
  source: 'payment' | 'travaux_payment' | 'achats_payment';
  sourceId: string;
  projectId?: string | null;
  defaultAmount: number;
  defaultCurrency: 'EUR' | 'MAD' | 'USD';
  defaultBeneficiary: string;
  defaultDescription?: string;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [errorArtisanId, setErrorArtisanId] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [urgency, setUrgency] = useState<'normal'|'urgent'>('normal');
  const [notes, setNotes] = useState('');
  // Compte payeur (CEO 2026-07-08) : OBLIGATOIRE pour achats/travaux.
  // Les demandes d'honoraires Stoniz (source 'payment') ne sont pas concernées.
  const payerRequired = source !== 'payment';
  const [payerAccount, setPayerAccount] = useState<PayerAccount | null>(null);
  const [payerError, setPayerError] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorArtisanId(null);
    if (payerRequired && !payerAccount) {
      setPayerError(true);
      return;
    }
    start(async () => {
      const r: any = await requestApprovalAction({
        source, source_id: sourceId, project_id: projectId ?? undefined,
        amount: defaultAmount, currency: defaultCurrency,
        beneficiary_name: defaultBeneficiary,
        description: defaultDescription ?? null,
        urgency, request_notes: notes || null,
        payer_account: payerRequired ? payerAccount : null,
      });
      if (!r.ok) {
        setError(r.error ?? 'Erreur');
        // Si la gate fiche artisan a échoué, on garde l'artisanId pour rendre
        // un lien direct dans le message d'erreur.
        if (r.artisanId) setErrorArtisanId(r.artisanId);
        return;
      }
      setSuccess(true);
      setTimeout(() => { setOpen(false); setSuccess(false); }, 1500);
    });
  }

  return (
    <>
      <Button size={small ? 'sm' : undefined} variant="ghost"
        onClick={() => setOpen(true)} className="text-stoniz-black">
        <ShieldCheck className="w-3.5 h-3.5" /> Demander validation
      </Button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form onSubmit={submit} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="font-display text-xl">Demande de validation de paiement</h2>

            <div className="text-sm bg-stoniz-gray-50 rounded-md p-3 border space-y-1">
              <div><span className="text-stoniz-gray-500">Bénéficiaire :</span> <strong>{defaultBeneficiary}</strong></div>
              <div><span className="text-stoniz-gray-500">Montant :</span> <strong>{new Intl.NumberFormat('fr-FR').format(defaultAmount)} {defaultCurrency}</strong></div>
              {defaultDescription && <div className="text-xs text-stoniz-gray-600">{defaultDescription}</div>}
            </div>

            <div>
              <Label>Urgence</Label>
              <div className="flex gap-2 mt-1">
                <label className={`flex-1 border rounded-md px-3 py-2 cursor-pointer text-sm has-[:checked]:border-stoniz-black has-[:checked]:bg-stoniz-gray-50`}>
                  <input type="radio" name="urgency" value="normal" checked={urgency === 'normal'}
                    onChange={() => setUrgency('normal')} className="mr-2" />
                  Normal
                </label>
                <label className={`flex-1 border rounded-md px-3 py-2 cursor-pointer text-sm has-[:checked]:border-red-500 has-[:checked]:bg-red-50`}>
                  <input type="radio" name="urgency" value="urgent" checked={urgency === 'urgent'}
                    onChange={() => setUrgency('urgent')} className="mr-2" />
                  ⚡ Urgent
                </label>
              </div>
            </div>

            {payerRequired && (
              <PayerAccountField
                value={payerAccount}
                onChange={(v) => { setPayerAccount(v); setPayerError(false); }}
                name={`payer-account-${sourceId}`}
                showError={payerError}
              />
            )}

            <div>
              <Label>Notes (optionnel)</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                placeholder="Contexte, lien devis, etc." />
            </div>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3 space-y-2">
                <div>{error}</div>
                {errorArtisanId && (
                  <a
                    href={`/artisans/${errorArtisanId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 bg-white border border-red-300 text-red-800 px-3 py-1.5 rounded text-xs hover:bg-red-100 font-medium"
                  >
                    Compléter la fiche artisan → (nouvel onglet)
                  </a>
                )}
              </div>
            )}
            {success && <div className="text-sm text-green-700">✓ Demande envoyée à Finance / CEO</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
              <Button type="submit" disabled={pending || success}>
                {pending ? 'Envoi…' : 'Envoyer la demande'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
