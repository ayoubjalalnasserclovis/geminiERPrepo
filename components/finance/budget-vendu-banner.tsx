import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

type Pole = 'travaux' | 'achats';
type Warning = { pole: Pole; cash: boolean; recu: number };

/**
 * Bandeau « Budget vendu manquant » par pôle (QA-BUG-033, demande CEO 2026-06-14).
 * Le budget vendu (forfait) est la référence de tous les KPI financiers : s'il
 * manque sur un pôle qui a de l'activité (lot/devis/encaissement), la marge de ce
 * pôle est fausse. Rouge si du cash est déjà encaissé, orange sinon.
 * Affiché en haut de la fiche projet (les 2 pôles) et des pages travaux / achats.
 */
async function poleWarning(
  supabase: ReturnType<typeof createClient>,
  projectId: string,
  pole: Pole,
  budgetMad: number,
): Promise<Warning | null> {
  if (budgetMad > 0) return null;
  if (pole === 'travaux') {
    const [{ data: lots }, { data: enc }] = await Promise.all([
      supabase.from('travaux_lots').select('id, devis_artisan_mad').eq('project_id', projectId).is('deleted_at', null),
      supabase.from('travaux_encaissements').select('amount_mad').eq('project_id', projectId).eq('status', 'recu').is('deleted_at', null),
    ]);
    const recu = (enc ?? []).reduce((s: number, e: any) => s + Number(e.amount_mad ?? 0), 0);
    const hasActivity = (lots ?? []).length > 0 || (lots ?? []).some((l: any) => Number(l.devis_artisan_mad ?? 0) > 0) || recu > 0;
    return hasActivity ? { pole, cash: recu > 0, recu } : null;
  }
  const [{ data: lots }, { data: enc }] = await Promise.all([
    supabase.from('achats_lots').select('id, devis_fournisseur_mad').eq('project_id', projectId).is('deleted_at', null),
    supabase.from('achats_encaissements').select('amount_mad').eq('project_id', projectId).eq('status', 'recu').is('deleted_at', null),
  ]);
  const recu = (enc ?? []).reduce((s: number, e: any) => s + Number(e.amount_mad ?? 0), 0);
  const hasActivity = (lots ?? []).length > 0 || (lots ?? []).some((l: any) => Number(l.devis_fournisseur_mad ?? 0) > 0) || recu > 0;
  return hasActivity ? { pole, cash: recu > 0, recu } : null;
}

export async function BudgetVenduBanner({ projectId, poles }: { projectId: string; poles: Pole[] }) {
  const supabase = createClient();
  const { data: p } = await supabase
    .from('projects')
    .select('travaux_budget_mad, achats_budget_mad')
    .eq('id', projectId)
    .maybeSingle();
  if (!p) return null;

  const results = await Promise.all(
    poles.map((pole) =>
      poleWarning(
        supabase,
        projectId,
        pole,
        pole === 'travaux' ? Number((p as any).travaux_budget_mad ?? 0) : Number((p as any).achats_budget_mad ?? 0),
      ),
    ),
  );
  const warnings = results.filter((w): w is Warning => w !== null);
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((w) => (
        <div
          key={w.pole}
          className={`rounded-md border p-4 text-sm ${w.cash ? 'bg-red-50 border-red-300 text-red-900' : 'bg-orange-50 border-orange-200 text-orange-900'}`}
        >
          <div className="flex items-start gap-3">
            <div className="text-xl leading-none">⚠</div>
            <div className="flex-1">
              <div className="font-medium mb-0.5">Budget {w.pole} vendu manquant</div>
              <div className="text-xs">
                {w.cash
                  ? `${w.recu.toLocaleString('fr-FR')} MAD déjà encaissés sur les ${w.pole} mais aucun budget ${w.pole} vendu n'est renseigné — la marge, le reste à encaisser et la trésorerie de ce pôle sont faux tant que le forfait n'est pas saisi.`
                  : `${w.pole === 'travaux' ? 'Travaux' : 'Achats'} engagés (devis/lots) sans budget ${w.pole} vendu — la marge de ce pôle est calculée sans référence (faussée).`}{' '}
                <Link href={`/projects/${projectId}/${w.pole}`} className="underline font-medium">Renseigner le budget {w.pole}</Link>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
