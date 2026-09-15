import { Receipt, FileText, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { VendorDocsAlertDrawer } from './vendor-docs-alert-drawer';

/**
 * Bandeau d'alerte CEO 2026-06-16 : repère les lots achats/travaux qui
 * n'ont pas de devis et/ou pas de facture, groupés par fournisseur.
 *
 * Permet de boucler sur les fournisseurs concernés en quelques clics :
 *   → "5 lots Maison Azar sans facture" → on filtre + bulk attach en 1 fois
 *
 * kind :
 *   - 'achats'  : 2 cards (sans devis + sans facture)
 *   - 'travaux' : 1 card (sans devis — pas de facture sur travaux_lots)
 *   - 'all'     : consolide les 2 modules
 */
export async function VendorDocsAlertBanner({
  kind,
  projectId,
}: {
  kind: 'achats' | 'travaux' | 'all';
  /** Si fourni, on filtre sur ce projet uniquement. Sinon vue globale (dashboards) */
  projectId?: string;
}) {
  const supabase = createClient();

  // ─── Lots achats sans devis / sans facture ──────────────────────────
  type AchatRow = {
    id: string; numero: number; description: string | null;
    supplier_id: string | null; supplier_name: string | null;
    project_id: string; project_reference: string | null;
    quote_doc_id: string | null; invoice_doc_id: string | null;
  };

  let achatsRows: AchatRow[] = [];
  if (kind === 'achats' || kind === 'all') {
    let q = supabase
      .from('achats_lots')
      .select(`
        id, numero, description, supplier_name,
        supplier_id, quote_doc_id, invoice_doc_id,
        project_id,
        supplier:artisans ( name ),
        project:projects ( reference, status )
      `)
      .is('deleted_at', null);
    if (projectId) q = q.eq('project_id', projectId);
    const { data, error } = await q;
    if (error) {
      console.warn('[vendor-docs-banner] achats query failed', error.message);
    }
    achatsRows = ((data ?? []) as any[])
      // Exclure projets perdus pour ne pas polluer le bandeau
      .filter((r) => r.project?.status !== 'perdu')
      .map((r) => ({
        id: r.id,
        numero: r.numero,
        description: r.description,
        supplier_id: r.supplier_id,
        // Bug fix CEO 2026-06-16 : supplier_id pointe vers artisans (pas partners).
        // On fallback sur supplier_name dénormalisé du lot si la jointure est vide.
        supplier_name: r.supplier?.name ?? r.supplier_name ?? null,
        project_id: r.project_id,
        project_reference: r.project?.reference ?? null,
        quote_doc_id: r.quote_doc_id,
        invoice_doc_id: r.invoice_doc_id,
      }));
  }

  // ─── Lots travaux sans devis ────────────────────────────────────────
  type TravauxRow = {
    id: string; numero: number; description: string | null;
    artisan_id: string | null; artisan_name: string | null;
    project_id: string; project_reference: string | null;
    quote_doc_id: string | null;
  };

  let travauxRows: TravauxRow[] = [];
  if (kind === 'travaux' || kind === 'all') {
    let q = supabase
      .from('travaux_lots')
      .select(`
        id, numero, description,
        artisan_id, quote_doc_id,
        project_id,
        artisan:artisans ( name ),
        project:projects ( reference, status )
      `)
      .is('deleted_at', null);
    if (projectId) q = q.eq('project_id', projectId);
    const { data } = await q;
    travauxRows = ((data ?? []) as any[])
      .filter((r) => r.project?.status !== 'perdu')
      .map((r) => ({
        id: r.id,
        numero: r.numero,
        description: r.description,
        artisan_id: r.artisan_id,
        artisan_name: r.artisan?.name ?? null,
        project_id: r.project_id,
        project_reference: r.project?.reference ?? null,
        quote_doc_id: r.quote_doc_id,
      }));
  }

  // ─── Paiements artisans payés sans facture (CEO 2026-06-17, P2) ─────
  // Détecte tous les `travaux_payments.status = paid` qui n'ont pas de
  // facture artisan rattachée (`invoice_doc_id IS NULL`) — risque fiscal.
  type PaidPaymentRow = {
    id: string;
    project_id: string;
    project_reference: string | null;
    lot_id: string | null;
    artisan_name: string | null;
    amount_paid: number;
    paid_at: string | null;
  };
  let travauxPaidSansFacture: PaidPaymentRow[] = [];
  if (kind === 'travaux' || kind === 'all') {
    let q = supabase
      .from('travaux_payments')
      .select(`
        id, project_id, lot_id, artisan_name, amount_paid, paid_at, status, invoice_doc_id,
        project:projects ( reference, status )
      `)
      .is('deleted_at', null)
      .eq('status', 'paid')
      .is('invoice_doc_id', null);
    if (projectId) q = q.eq('project_id', projectId);
    const { data, error: payErr } = await q;
    if (payErr) {
      console.warn('[vendor-docs-banner] travaux_payments query failed', payErr.message);
    }
    travauxPaidSansFacture = ((data ?? []) as any[])
      .filter((r) => r.project?.status !== 'perdu')
      .map((r) => ({
        id: r.id,
        project_id: r.project_id,
        project_reference: r.project?.reference ?? null,
        lot_id: r.lot_id,
        artisan_name: r.artisan_name,
        amount_paid: Number(r.amount_paid ?? 0),
        paid_at: r.paid_at,
      }));
  }

  // ─── Compteurs ──────────────────────────────────────────────────────
  const achatsSansDevis = achatsRows.filter((r) => !r.quote_doc_id);
  const achatsSansFacture = achatsRows.filter((r) => !r.invoice_doc_id);
  const travauxSansDevis = travauxRows.filter((r) => !r.quote_doc_id);

  const totalProblems =
    (kind !== 'travaux' ? achatsSansDevis.length + achatsSansFacture.length : 0) +
    (kind !== 'achats' ? travauxSansDevis.length + travauxPaidSansFacture.length : 0);

  // Si tout est OK, on cache le bandeau
  if (totalProblems === 0) {
    return null;
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700" />
          <span className="text-sm font-medium text-amber-900">
            Documents fournisseurs manquants
          </span>
          <span className="text-xs text-amber-700">
            ({totalProblems} lot{totalProblems > 1 ? 's' : ''} à compléter)
          </span>
        </div>
      </div>

      <div className={`grid gap-3 ${kind === 'all' ? 'md:grid-cols-4' : kind === 'achats' ? 'md:grid-cols-2' : 'md:grid-cols-2'}`}>
        {(kind === 'achats' || kind === 'all') && (
          <>
            <AlertCard
              title="Achats sans devis"
              icon={<FileText className="w-3.5 h-3.5 text-purple-700" />}
              count={achatsSansDevis.length}
              accent="purple"
              rows={achatsSansDevis.map((r) => ({
                project_id: r.project_id,
                project_reference: r.project_reference,
                lot_id: r.id,
                lot_numero: r.numero,
                lot_desc: r.description,
                vendor_name: r.supplier_name,
              }))}
              kind="achats"
            />
            <AlertCard
              title="Achats sans facture"
              icon={<Receipt className="w-3.5 h-3.5 text-blue-700" />}
              count={achatsSansFacture.length}
              accent="blue"
              rows={achatsSansFacture.map((r) => ({
                project_id: r.project_id,
                project_reference: r.project_reference,
                lot_id: r.id,
                lot_numero: r.numero,
                lot_desc: r.description,
                vendor_name: r.supplier_name,
              }))}
              kind="achats"
            />
          </>
        )}

        {(kind === 'travaux' || kind === 'all') && (
          <>
            <AlertCard
              title="Travaux sans devis"
              icon={<FileText className="w-3.5 h-3.5 text-purple-700" />}
              count={travauxSansDevis.length}
              accent="purple"
              rows={travauxSansDevis.map((r) => ({
                project_id: r.project_id,
                project_reference: r.project_reference,
                lot_id: r.id,
                lot_numero: r.numero,
                lot_desc: r.description,
                vendor_name: r.artisan_name,
              }))}
              kind="travaux"
            />
            {/* P2 CEO 2026-06-17 : factures artisans manquantes sur paiements payés */}
            <AlertCard
              title="Factures artisans manquantes"
              icon={<Receipt className="w-3.5 h-3.5 text-blue-700" />}
              count={travauxPaidSansFacture.length}
              accent="blue"
              rows={travauxPaidSansFacture.map((r) => ({
                project_id: r.project_id,
                project_reference: r.project_reference,
                lot_id: r.lot_id ?? r.id,
                lot_numero: 0,
                lot_desc: `Paiement ${new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(r.amount_paid)} MAD du ${r.paid_at ?? ''}`,
                vendor_name: r.artisan_name,
              }))}
              kind="travaux"
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Card compacte d'une catégorie (avec drawer client) ─────────────────

function AlertCard({
  title,
  icon,
  count,
  accent,
  rows,
  kind,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  accent: 'purple' | 'blue';
  rows: Array<{
    project_id: string;
    project_reference: string | null;
    lot_id: string;
    lot_numero: number;
    lot_desc: string | null;
    vendor_name: string | null;
  }>;
  kind: 'achats' | 'travaux';
}) {
  // Group rapide par fournisseur pour aperçu top-3
  const byVendor = new Map<string, number>();
  for (const r of rows) {
    const k = r.vendor_name ?? '(sans fournisseur)';
    byVendor.set(k, (byVendor.get(k) ?? 0) + 1);
  }
  const top3 = Array.from(byVendor.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const accentClasses = {
    purple: 'border-purple-200 bg-purple-50/40',
    blue: 'border-blue-200 bg-blue-50/40',
  }[accent];

  return (
    <div className={`bg-white border rounded-lg p-3 ${accentClasses}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-stoniz-gray-700 inline-flex items-center gap-1.5">
          {icon}
          {title}
        </div>
        <span className="text-xl font-display">{count}</span>
      </div>
      {top3.length > 0 && (
        <ul className="space-y-1 text-[11px] text-stoniz-gray-600">
          {top3.map(([vendor, n]) => (
            <li key={vendor} className="flex items-center justify-between">
              <span className="truncate">{vendor}</span>
              <span className="ml-2 font-mono text-stoniz-gray-500">{n}</span>
            </li>
          ))}
        </ul>
      )}
      <VendorDocsAlertDrawer
        title={title}
        rows={rows}
        kind={kind}
      />
    </div>
  );
}
