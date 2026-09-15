import Link from 'next/link';
import { Clock, AlertCircle, AlertTriangle, FileQuestion, ChevronRight, Calendar, Wrench } from 'lucide-react';
import { collectTravauxOpsAlerts } from '@/lib/dashboard/travaux-ops-alerts';

/**
 * Bandeaux opérationnels du dashboard travaux (CEO 2026-06-17).
 *
 * 4 sections conditionnelles (cachée si vide) :
 *   - Chantiers à risque temps : > 90j ou en retard sur date fin
 *   - Acomptes artisans à payer : retards + à venir 30j
 *   - Anomalies financières : sur-paiement / sur-encaissement / perte
 *   - Data incomplète : forfait / chef / dates manquants
 */

function fmtMad(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

type ProjectRow = {
  id: string;
  reference: string;
  client_name: string;
  amount_mad?: number;
  detail?: string;
  href: string;
};

function MiniList({ rows, max = 3, showAmount }: { rows: ProjectRow[]; max?: number; showAmount?: boolean }) {
  const shown = rows.slice(0, max);
  return (
    <ul className="space-y-1 mt-1">
      {shown.map((r) => (
        <li key={r.id}>
          <Link
            href={r.href}
            className="flex items-center gap-2 text-[11px] hover:bg-white/40 px-1.5 py-0.5 rounded -mx-1"
          >
            <span className="text-stoniz-gray-500 font-mono shrink-0">{r.reference}</span>
            <span className="truncate">{r.client_name}</span>
            {showAmount && r.amount_mad != null && (
              <span className="font-mono ml-auto shrink-0">{fmtMad(r.amount_mad)}</span>
            )}
            {r.detail && (
              <span className="text-stoniz-gray-500 truncate shrink-0 ml-auto">{r.detail}</span>
            )}
          </Link>
        </li>
      ))}
      {rows.length > max && (
        <li className="text-[10px] text-stoniz-gray-500 px-1.5">
          + {rows.length - max} autre{rows.length - max > 1 ? 's' : ''}…
        </li>
      )}
    </ul>
  );
}

export async function TravauxOpsAlertsBanner() {
  const data = await collectTravauxOpsAlerts();

  const sections = {
    timeAtRisk: data.timeAtRisk.older90.length + data.timeAtRisk.overdue.length,
    artisanDue: data.artisanDueSoon.retard.length + data.artisanDueSoon.venir.length,
    anomalies:
      data.anomalies.surPaiement.length +
      data.anomalies.surEncaissement.length +
      data.anomalies.perte.length,
    dataIncomplete:
      data.dataIncomplete.sansForfait.length +
      data.dataIncomplete.sansChef.length +
      data.dataIncomplete.sansDates.length,
  };

  // Rien à signaler du tout → on n'affiche rien
  if (Object.values(sections).every((v) => v === 0)) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* ─── Chantiers à risque temps ─── */}
      {sections.timeAtRisk > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-orange-700" />
            <h3 className="text-sm font-medium text-orange-900">
              Chantiers à risque temps
            </h3>
            <span className="text-xs text-orange-700">({sections.timeAtRisk})</span>
          </div>
          {data.timeAtRisk.overdue.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] uppercase tracking-wide text-orange-800 font-medium">
                🔴 En retard sur date prévue · {data.timeAtRisk.overdue.length}
              </div>
              <MiniList rows={data.timeAtRisk.overdue} />
            </div>
          )}
          {data.timeAtRisk.older90.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-orange-800 font-medium">
                🟠 Lancés depuis &gt; 90 jours · {data.timeAtRisk.older90.length}
              </div>
              <MiniList rows={data.timeAtRisk.older90} />
            </div>
          )}
        </div>
      )}

      {/* ─── Acomptes artisans à payer ─── */}
      {sections.artisanDue > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <Wrench className="w-4 h-4 text-purple-700" />
            <h3 className="text-sm font-medium text-purple-900">
              Acomptes artisans à payer
            </h3>
          </div>
          {data.artisanDueSoon.retard.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] uppercase tracking-wide text-red-800 font-medium flex items-center justify-between">
                <span>🔴 En retard · {data.artisanDueSoon.retard.length}</span>
                <span className="font-mono normal-case">{fmtMad(data.artisanDueSoon.totalRetardMad)}</span>
              </div>
              <MiniList rows={data.artisanDueSoon.retard} showAmount />
            </div>
          )}
          {data.artisanDueSoon.venir.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-amber-800 font-medium flex items-center justify-between">
                <span>🟠 À payer dans 30j · {data.artisanDueSoon.venir.length}</span>
                <span className="font-mono normal-case">{fmtMad(data.artisanDueSoon.totalVenirMad)}</span>
              </div>
              <MiniList rows={data.artisanDueSoon.venir} showAmount />
            </div>
          )}
        </div>
      )}

      {/* ─── Anomalies financières ─── */}
      {sections.anomalies > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-700" />
            <h3 className="text-sm font-medium text-red-900">
              Anomalies financières
            </h3>
            <span className="text-xs text-red-700">({sections.anomalies})</span>
          </div>
          {data.anomalies.perte.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] uppercase tracking-wide text-red-800 font-medium">
                Projets en perte · {data.anomalies.perte.length}
              </div>
              <MiniList rows={data.anomalies.perte} showAmount />
            </div>
          )}
          {data.anomalies.surPaiement.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] uppercase tracking-wide text-red-800 font-medium">
                Sur-paiement artisan · {data.anomalies.surPaiement.length}
              </div>
              <MiniList rows={data.anomalies.surPaiement} showAmount />
            </div>
          )}
          {data.anomalies.surEncaissement.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-red-800 font-medium">
                Sur-encaissement client · {data.anomalies.surEncaissement.length}
              </div>
              <MiniList rows={data.anomalies.surEncaissement} showAmount />
            </div>
          )}
        </div>
      )}

      {/* ─── Data incomplète ─── */}
      {sections.dataIncomplete > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-2">
            <FileQuestion className="w-4 h-4 text-amber-700" />
            <h3 className="text-sm font-medium text-amber-900">
              Data projet à compléter
            </h3>
            <span className="text-xs text-amber-700">({sections.dataIncomplete})</span>
          </div>
          {data.dataIncomplete.sansForfait.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] uppercase tracking-wide text-amber-800 font-medium">
                Sans forfait vendu · {data.dataIncomplete.sansForfait.length}
              </div>
              <MiniList rows={data.dataIncomplete.sansForfait} />
            </div>
          )}
          {data.dataIncomplete.sansChef.length > 0 && (
            <div className="mb-2">
              <div className="text-[11px] uppercase tracking-wide text-amber-800 font-medium">
                Sans chef de projet · {data.dataIncomplete.sansChef.length}
              </div>
              <MiniList rows={data.dataIncomplete.sansChef} />
            </div>
          )}
          {data.dataIncomplete.sansDates.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-amber-800 font-medium">
                Sans dates chantier · {data.dataIncomplete.sansDates.length}
              </div>
              <MiniList rows={data.dataIncomplete.sansDates} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
