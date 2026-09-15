import Link from 'next/link';
import { AlertTriangle, Clock, FileQuestion, ShieldCheck } from 'lucide-react';
import type { ArtisanAttestationInfo } from '@/lib/artisans/attestation-status';

/**
 * Bandeau alerte sur /dashboard/travaux pour les attestations de régularité
 * fiscale (CEO 2026-06-18).
 *
 * 3 catégories : EXPIRÉES (rouge), À RENOUVELER (orange, < 30j), MANQUANTES (gris).
 * Click sur une carte → détail des artisans concernés (drawer inline).
 */
export function AttestationsFiscalesBanner({ rows }: { rows: ArtisanAttestationInfo[] }) {
  const expired = rows.filter((r) => r.status === 'expired');
  const expiringSoon = rows.filter((r) => r.status === 'expiring_soon');
  const missing = rows.filter((r) => r.status === 'missing');
  const valid = rows.filter((r) => r.status === 'valid');

  // Si tout est OK : un mini-banner vert (rassurant)
  if (expired.length === 0 && expiringSoon.length === 0 && missing.length === 0) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 mb-4 text-sm text-emerald-900 inline-flex items-center gap-2">
        <ShieldCheck className="w-4 h-4" />
        ✓ Toutes les attestations de régularité fiscale sont à jour ({valid.length} artisans en règle).
      </div>
    );
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg inline-flex items-center gap-2">
          📜 Attestations de régularité fiscale
        </h2>
        <span className="text-xs text-stoniz-gray-500">{valid.length} artisans en règle sur {rows.length}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Tile
          label="Expirées (> 6 mois)"
          count={expired.length}
          color="bg-red-50 border-red-200 text-red-900"
          icon={AlertTriangle}
          rows={expired}
          hint="À renouveler immédiatement — paiement à risque"
        />
        <Tile
          label="À renouveler (< 30 j)"
          count={expiringSoon.length}
          color="bg-amber-50 border-amber-200 text-amber-900"
          icon={Clock}
          rows={expiringSoon}
          hint="Demander la nouvelle attestation à l'artisan"
        />
        <Tile
          label="Manquantes"
          count={missing.length}
          color="bg-stoniz-gray-50 border-stoniz-gray-200 text-stoniz-gray-700"
          icon={FileQuestion}
          rows={missing}
          hint="Artisan actif sans attestation au dossier"
        />
      </div>
    </div>
  );
}

function Tile({
  label, count, color, icon: Icon, rows, hint,
}: {
  label: string; count: number; color: string; icon: any;
  rows: ArtisanAttestationInfo[]; hint: string;
}) {
  return (
    <details className={`border rounded-lg p-3 ${color}`}>
      <summary className="cursor-pointer list-none flex items-center justify-between">
        <span className="inline-flex items-center gap-2 font-medium">
          <Icon className="w-4 h-4" /> {label}
        </span>
        <span className="font-display text-2xl">{count}</span>
      </summary>
      <p className="text-[11px] mt-1.5 mb-2 opacity-80">{hint}</p>
      {rows.length === 0 ? (
        <p className="text-xs italic opacity-70">Aucun artisan concerné.</p>
      ) : (
        <ul className="space-y-1 text-xs max-h-48 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.artisan_id} className="flex items-center justify-between gap-2 bg-white/60 rounded px-2 py-1">
              <Link href={`/artisans/${r.artisan_id}`} className="font-medium hover:underline truncate">
                {r.artisan_name}
              </Link>
              <span className="text-[10px] opacity-70 flex-shrink-0">
                {r.last_document_date
                  ? r.days_remaining! < 0
                    ? `Expirée depuis ${Math.abs(r.days_remaining!)} j`
                    : `Expire dans ${r.days_remaining} j`
                  : 'Jamais uploadée'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
