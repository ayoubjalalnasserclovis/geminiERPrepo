import type { ApprovalBreakdown, LotBreakdown } from '@/lib/finance/approval-breakdown';
import { VendorDocLink } from './vendor-doc-link';

/**
 * Panel <details> repliable affichant le détail d'une demande de validation :
 * lots concernés, devis/facture/BC cliquables (signed URL), liste des acomptes.
 *
 * Server component pur — les boutons docs sont des composants client
 * minimalistes (`VendorDocLink`). Le `<details>` HTML natif gère l'expansion
 * sans JS, donc accessible et SSR-friendly.
 *
 * CEO 2026-06-25 (Phase B1).
 */

const CATEGORY_LABELS: Record<string, string> = {
  // achats
  mobilier_salon: 'Mobilier salon',
  mobilier_chambre: 'Mobilier chambre',
  mobilier_sdb: 'Mobilier SDB',
  mobilier_cuisine: 'Mobilier cuisine',
  electromenager: 'Électroménager',
  luminaire: 'Luminaire',
  textile_decoration: 'Textile & déco',
  vaisselle_arts_table: 'Vaisselle',
  linge_maison: 'Linge maison',
  plomberie_robinetterie: 'Plomberie / robinetterie',
  sanitaires: 'Sanitaires',
  peinture_fournitures: 'Peinture (fournitures)',
  carrelage_marbre: 'Carrelage & marbre',
  menuiserie_fournitures: 'Menuiserie (fournitures)',
  jardinage_exterieur: 'Jardinage & extérieur',
  divers: 'Divers',
  // travaux
  demolition_cloisons: 'Démolition & cloisons',
  gros_oeuvre_maconnerie: 'Gros œuvre & maçonnerie',
  electricite: 'Électricité',
  plomberie_sanitaire: 'Plomberie & sanitaire',
  carrelage_revetements: 'Carrelage & revêtements',
  menuiserie_interieure: 'Menuiserie intérieure',
  menuiserie_aluminium: 'Menuiserie aluminium',
  peinture: 'Peinture',
  faux_plafond: 'Faux plafond',
  climatisation_vmc: 'Climatisation / VMC',
  ferronnerie: 'Ferronnerie',
  amenagements_exterieurs: 'Aménagements extérieurs',
  cuisine: 'Cuisine',
};

function fmtAmount(amount: number, currency: string) {
  return `${new Intl.NumberFormat('fr-FR').format(amount)} ${currency}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  // YYYY-MM-DD → DD/MM/YYYY
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

export function ApprovalBreakdownPanel({
  breakdown,
  defaultOpen = true,
}: {
  breakdown: ApprovalBreakdown;
  /** CEO 2026-06-25 : déplié par défaut sur /validations + /mes-demandes-paiement
   * (le reviewer doit voir devis/facture/BC sans cliquer). */
  defaultOpen?: boolean;
}) {
  // ─── Cas honoraires Stoniz : pas de lot ──────────────────────────
  if (breakdown.source === 'honoraires') {
    return (
      <details
        className="mt-3 rounded-lg border border-stoniz-gray-200 bg-stoniz-gray-50/40 group"
        open={defaultOpen}
      >
        <summary className="cursor-pointer select-none text-xs font-medium text-stoniz-gray-700 px-3 py-2 list-none flex items-center justify-between hover:bg-stoniz-gray-100/60 rounded-lg">
          <span>Détail · Honoraires Stoniz</span>
          <span className="text-stoniz-gray-500 group-open:rotate-180 transition-transform">▾</span>
        </summary>
        <div className="px-3 pb-3 pt-1 text-xs text-stoniz-gray-700 space-y-1">
          <div>
            <strong>{breakdown.honoraires_label ?? 'Honoraires Stoniz'}</strong>
            {' · '}
            <span>{fmtAmount(breakdown.total_amount, breakdown.currency)}</span>
          </div>
          <div className="text-stoniz-gray-500 italic">
            Honoraires cabinet — pas de lot/fournisseur associé.
          </div>
        </div>
      </details>
    );
  }

  // ─── Cas inconnu (FK manquante / batch vide) ─────────────────────
  if (breakdown.source === 'unknown' || breakdown.lots.length === 0) {
    return (
      <details
        className="mt-3 rounded-lg border border-stoniz-gray-200 bg-stoniz-gray-50/40"
        open={defaultOpen}
      >
        <summary className="cursor-pointer select-none text-xs font-medium text-stoniz-gray-700 px-3 py-2 list-none">
          Détail indisponible
        </summary>
        <div className="px-3 pb-3 pt-1 text-xs text-stoniz-gray-500 italic">
          Impossible de résoudre les lots/acomptes associés à cette demande.
        </div>
      </details>
    );
  }

  // ─── Cas achats / travaux ────────────────────────────────────────
  const totalAcomptes = breakdown.lots.reduce((s, l) => s + l.acomptes.length, 0);
  const sourceLabel = breakdown.source === 'achats' ? 'Achats' : 'Travaux';

  return (
    <details
      className="mt-3 rounded-lg border border-stoniz-gray-200 bg-stoniz-gray-50/30 group"
      open={defaultOpen}
    >
      <summary className="cursor-pointer select-none text-xs font-medium text-stoniz-gray-700 px-3 py-2 list-none flex items-center justify-between hover:bg-stoniz-gray-100/60 rounded-lg">
        <span>
          {breakdown.is_batch ? '📦 ' : ''}
          Détail · {sourceLabel} ·{' '}
          {totalAcomptes} acompte{totalAcomptes > 1 ? 's' : ''} sur{' '}
          {breakdown.lots.length} lot{breakdown.lots.length > 1 ? 's' : ''}
        </span>
        <span className="text-stoniz-gray-500 group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-3">
        {breakdown.lots.map((lot) => (
          <LotRow key={lot.lot_id} lot={lot} source={breakdown.source} />
        ))}
      </div>
    </details>
  );
}

function LotRow({
  lot,
  source,
}: {
  lot: LotBreakdown;
  source: 'achats' | 'travaux' | 'honoraires' | 'unknown';
}) {
  const categoryLabel = lot.lot_category
    ? CATEGORY_LABELS[lot.lot_category] ?? lot.lot_category
    : null;
  const isAchats = source === 'achats';
  // Somme des acomptes demandés dans CE batch sur ce lot
  const acomptesSum = lot.acomptes.reduce((s, a) => s + a.amount, 0);
  const lotCurrency = lot.acomptes[0]?.currency ?? 'MAD';

  return (
    <div className="border-l-2 border-stoniz-gray-300 pl-3 py-2">
      {/* Header lot : numéro + catégorie + fournisseur */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <strong className="text-stoniz-gray-900">
          {lot.lot_numero != null ? `Lot #${lot.lot_numero}` : 'Lot'}
        </strong>
        {categoryLabel && (
          <span className="text-stoniz-gray-600">· {categoryLabel}</span>
        )}
        {lot.supplier_name && (
          <span className="text-stoniz-gray-700 font-medium">
            · {lot.supplier_name}
          </span>
        )}
      </div>

      {/* Description du lot (en évidence) */}
      {lot.lot_description && (
        <div className="mt-1 text-sm text-stoniz-gray-800 leading-snug">
          {lot.lot_description}
        </div>
      )}

      {/* Montants : total lot + somme acomptes demandés */}
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        {lot.lot_total_amount != null && lot.lot_total_amount > 0 && (
          <span className="text-stoniz-gray-700">
            <span className="text-stoniz-gray-500">Total lot :</span>{' '}
            <strong className="text-stoniz-gray-900">
              {fmtAmount(lot.lot_total_amount, lotCurrency)}
            </strong>
          </span>
        )}
        {acomptesSum > 0 && (
          <span className="text-stoniz-gray-700">
            <span className="text-stoniz-gray-500">À payer ici :</span>{' '}
            <strong className="text-stoniz-gray-900">
              {fmtAmount(acomptesSum, lotCurrency)}
            </strong>
            {lot.acomptes.length > 1 && (
              <span className="text-stoniz-gray-500">
                {' '}
                ({lot.acomptes.length} acomptes)
              </span>
            )}
          </span>
        )}
      </div>

      {/* Badges documents */}
      <div className="flex flex-wrap gap-1.5 mt-1.5">
        {lot.quote_doc ? (
          <VendorDocLink
            docId={lot.quote_doc.id}
            label="Devis"
            icon="📄"
            title={lot.quote_doc.file_name}
          />
        ) : (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-orange-300 bg-orange-50 text-orange-700">
            <span aria-hidden>⚠</span> Devis manquant
          </span>
        )}
        {lot.invoice_doc ? (
          <VendorDocLink
            docId={lot.invoice_doc.id}
            label="Facture"
            icon="🧾"
            title={lot.invoice_doc.file_name}
          />
        ) : (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-orange-300 bg-orange-50 text-orange-700">
            <span aria-hidden>⚠</span> Facture manquante
          </span>
        )}
        {isAchats &&
          (lot.bc_doc ? (
            <VendorDocLink
              docId={lot.bc_doc.id}
              label="Bon de commande"
              icon="📋"
              title={lot.bc_doc.file_name}
            />
          ) : (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-orange-300 bg-orange-50 text-orange-700">
              <span aria-hidden>⚠</span> BC manquant
            </span>
          ))}
      </div>

      {/* Sous-liste acomptes */}
      {lot.acomptes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-stoniz-gray-700">
          {lot.acomptes.map((ac) => (
            <li key={ac.payment_id} className="flex flex-wrap gap-x-2">
              <span className="text-stoniz-gray-500">•</span>
              <span>
                Acompte{ac.acompte_number != null ? ` #${ac.acompte_number}` : ''}
                {ac.acompte_pct != null ? ` (${ac.acompte_pct}%)` : ''}
              </span>
              {ac.scheduled_date && (
                <span className="text-stoniz-gray-500">· éch. {fmtDate(ac.scheduled_date)}</span>
              )}
              <span className="font-medium text-stoniz-gray-800">
                · {fmtAmount(ac.amount, ac.currency)}
              </span>
              {ac.notes && (
                <span className="italic text-stoniz-gray-500 truncate max-w-xs">
                  « {ac.notes} »
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
