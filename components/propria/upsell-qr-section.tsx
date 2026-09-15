'use client';

import { useState } from 'react';
import QRCode from 'qrcode';
import { QrCode, Download, X } from 'lucide-react';

export type UpsellQrLot = { id: string; label: string; slug: string | null };

/**
 * Section "QR codes" de la page /propria/upsell : un bouton "Voir QR" par
 * lot → modale avec le QR (généré côté client via qrcode.toDataURL) +
 * téléchargement PNG. L'impression sur support bois est gérée hors ERP.
 */
export function UpsellQrSection({ lots, baseUrl }: { lots: UpsellQrLot[]; baseUrl: string }) {
  const [active, setActive] = useState<UpsellQrLot | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function urlFor(lot: UpsellQrLot) {
    const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    return `${origin.replace(/\/$/, '')}/upsell/${lot.slug}`;
  }

  async function openQr(lot: UpsellQrLot) {
    if (!lot.slug) return;
    setErr(null);
    setActive(lot);
    setDataUrl(null);
    try {
      const url = await QRCode.toDataURL(urlFor(lot), {
        width: 480,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      setDataUrl(url);
    } catch {
      setErr('Impossible de générer le QR code.');
    }
  }

  function download() {
    if (!dataUrl || !active) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qr-upsell-${active.label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.png`;
    a.click();
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
      <h2 className="font-display text-sm uppercase tracking-wider text-stoniz-gray-700 mb-1">
        <QrCode className="w-4 h-4 inline mr-1.5 -mt-0.5" />
        QR codes par lot
      </h2>
      <p className="text-xs text-stoniz-gray-500 mb-4">
        Chaque lot a sa page de commande voyageur. Téléchargez le PNG pour l’impression
        (support bois géré hors ERP).
      </p>
      <ul className="divide-y divide-stoniz-gray-100">
        {lots.map((lot) => (
          <li key={lot.id} className="py-2 flex items-center justify-between gap-3">
            <span className="text-sm">{lot.label}</span>
            {lot.slug ? (
              <button
                type="button"
                onClick={() => openQr(lot)}
                className="text-xs border border-stoniz-gray-300 rounded px-3 py-1.5 hover:bg-stoniz-gray-50"
              >
                Voir QR
              </button>
            ) : (
              <span className="text-[11px] text-amber-700">
                Slug manquant — appliquer la migration upsell
              </span>
            )}
          </li>
        ))}
        {lots.length === 0 && (
          <li className="py-4 text-sm text-stoniz-gray-500 text-center">Aucun lot actif.</li>
        )}
      </ul>

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setActive(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6 text-center">
            <button
              type="button"
              onClick={() => setActive(null)}
              className="absolute top-3 right-3 p-1 rounded hover:bg-stoniz-gray-100"
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="font-display text-base mb-3">{active.label}</h3>
            {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={dataUrl} alt={`QR upsell ${active.label}`} className="mx-auto w-60 h-60" />
            ) : !err ? (
              <div className="w-60 h-60 mx-auto flex items-center justify-center text-sm text-stoniz-gray-400">
                Génération…
              </div>
            ) : null}
            <p className="text-[11px] text-stoniz-gray-500 break-all mt-3">{urlFor(active)}</p>
            <button
              type="button"
              onClick={download}
              disabled={!dataUrl}
              className="mt-4 inline-flex items-center gap-1.5 bg-stoniz-black text-white px-4 py-2 rounded text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> Télécharger PNG
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
