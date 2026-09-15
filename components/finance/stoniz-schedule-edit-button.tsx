'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { updateStonizScheduleAction } from '@/app/(team)/projects/[id]/payments/actions';
import { STONIZ_FEE_SCHEDULE, resolveStonizLabel } from '@/lib/finance/stoniz-fees';

type PaymentRow = {
  id: string;
  type: string;
  amount_expected: number | string;
  amount_paid: number | string;
  due_date: string | null;
  label?: string | null;
  status?: string;
};

/**
 * Bouton édition échéancier honoraires Stoniz.
 * On édite uniquement les échéances DÉJÀ créées (modèle événementiel) ; les jalons
 * pas encore déclenchés sont affichés "à venir" et deviendront éditables le moment venu.
 *
 * Périmètre par rôle (CEO 2026-07-10) :
 *   - CEO / finance : montant attendu + date + libellé
 *   - chef_projet : date d'échéance uniquement (pour synchro chantier), montants
 *     et libellés en lecture seule
 *   - autres rôles : bouton caché
 */
export function StonizScheduleEditButton({
  projectId,
  payments,
  userRole,
}: {
  projectId: string;
  payments: PaymentRow[];
  userRole: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canEditAmountAndLabel = userRole === 'ceo' || userRole === 'finance';
  const canEditDueDate = canEditAmountAndLabel || userRole === 'chef_projet';

  // Les autres rôles ne voient pas le bouton.
  if (!canEditDueDate) return null;

  const byType = new Map(payments.filter(p => p.type !== 'autre').map(p => [p.type, p]));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);

    const items = Array.from(byType.values()).map(p => ({
      payment_id: p.id,
      // Pour chef_projet on renvoie les valeurs existantes ; le serveur les
      // renverra aussi en fallback mais on garde l'UI honnête.
      amount_expected: canEditAmountAndLabel
        ? Number(form.get(`amount_${p.id}`))
        : Number(p.amount_expected),
      due_date: (form.get(`due_${p.id}`) as string) || null,
      label: canEditAmountAndLabel
        ? ((form.get(`label_${p.id}`) as string) || null)
        : (p.label ?? null),
    }));

    if (items.length === 0) {
      setError('Aucune échéance modifiable pour l’instant.');
      return;
    }

    start(async () => {
      const r = await updateStonizScheduleAction({ project_id: projectId, items })
        .catch((e: any) => ({ ok: false, error: e?.message ?? 'Erreur' }));
      if (!r || !r.ok) { setError(r?.error ?? 'Échec de l’enregistrement'); return; }
      setOpen(false);
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {canEditAmountAndLabel ? 'Modifier les montants' : 'Décaler les échéances'}
      </Button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <form
            onSubmit={submit}
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div>
              <h2 className="font-display text-xl">Échéancier honoraires</h2>
              <p className="text-sm text-stoniz-gray-500">
                {canEditAmountAndLabel
                  ? 'Ajuste le montant, la date et le libellé de chaque échéance. Les jalons « à venir » deviendront modifiables lorsqu’ils seront déclenchés.'
                  : 'Décale la date d’échéance de chaque jalon pour la synchroniser avec la réalité chantier. Les montants et libellés restent gérés par le CEO / la finance.'}
              </p>
            </div>

            <div className="space-y-4">
              {STONIZ_FEE_SCHEDULE.map(milestone => {
                const p = byType.get(milestone.type);
                if (!p) {
                  return (
                    <div key={milestone.type} className="flex items-center justify-between border-b pb-2 opacity-60">
                      <span className="text-sm">{milestone.label}</span>
                      <Badge>À venir</Badge>
                    </div>
                  );
                }
                const isPaid = p.status === 'paid';
                return (
                  <div key={milestone.type} className="border-b pb-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{resolveStonizLabel(p.type, p.label)}</span>
                      {isPaid && <Badge variant="success">Payé</Badge>}
                    </div>
                    <div className={canEditAmountAndLabel ? 'grid grid-cols-2 gap-2' : ''}>
                      {canEditAmountAndLabel ? (
                        <div>
                          <Label>Montant attendu (€)</Label>
                          <Input
                            name={`amount_${p.id}`}
                            type="number"
                            step="0.01"
                            min={Number(p.amount_paid) || 0}
                            defaultValue={Number(p.amount_expected)}
                            required
                          />
                        </div>
                      ) : (
                        <div className="text-xs text-stoniz-gray-600">
                          Montant : <strong>{Number(p.amount_expected).toLocaleString('fr-FR')} €</strong>
                        </div>
                      )}
                      <div>
                        <Label>Échéance</Label>
                        <Input name={`due_${p.id}`} type="date" defaultValue={p.due_date ?? ''} />
                      </div>
                    </div>
                    {canEditAmountAndLabel && (
                      <div>
                        <Label>Libellé (optionnel)</Label>
                        <Input
                          name={`label_${p.id}`}
                          defaultValue={p.label ?? ''}
                          placeholder={milestone.label}
                          maxLength={120}
                        />
                      </div>
                    )}
                    {Number(p.amount_paid) > 0 && (
                      <p className="text-xs text-stoniz-gray-500">
                        Déjà encaissé : {Number(p.amount_paid).toLocaleString('fr-FR')} € — le montant ne peut pas descendre en dessous.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Annuler
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
