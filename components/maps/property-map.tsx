'use client';

import { useEffect, useRef, useState } from 'react';

// Charge Leaflet (CSS + JS) une seule fois en runtime cote client
function loadLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject('SSR');
  if ((window as any).L) return Promise.resolve((window as any).L);

  return new Promise((resolve, reject) => {
    // CSS
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.crossOrigin = '';
      link.setAttribute('data-leaflet', '1');
      document.head.appendChild(link);
    }
    // JS
    if (document.querySelector('script[data-leaflet]')) {
      // déjà en train de charger, on attend
      const wait = setInterval(() => {
        if ((window as any).L) {
          clearInterval(wait);
          resolve((window as any).L);
        }
      }, 50);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.crossOrigin = '';
    script.setAttribute('data-leaflet', '1');
    script.onload = () => resolve((window as any).L);
    script.onerror = () => reject('Leaflet failed to load');
    document.head.appendChild(script);
  });
}

// Centre par défaut : Marrakech
const MARRAKECH = { lat: 31.6295, lng: -7.9811 };

// Couleurs de pin selon statut bien
const STATUS_COLORS: Record<string, string> = {
  sourcing:   '#9CA3AF',
  disponible: '#3B82F6',
  propose:    '#A855F7',
  offre:      '#F59E0B',
  vendu:      '#10B981',
  perdu:      '#EF4444',
  a_verifier: '#EC4899',
};

export type MapProperty = {
  id: string;
  name: string;
  status?: string;
  quartier?: string | null;
  price?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  badge_label?: string | null;
  evaluation?: number | null;
  detailHref?: string;
};

declare global {
  interface Window { L: any }
}

export function PropertyMap({
  properties,
  height = 480,
  showLegend = true,
  fitBounds = true,
}: {
  properties: MapProperty[];
  height?: number;
  showLegend?: boolean;
  fitBounds?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;

    const init = (L: any) => {
      if (cancelled || !ref.current) return;
      if (mapRef.current) return; // déjà init

      const map = L.map(ref.current, { scrollWheelZoom: false })
        .setView([MARRAKECH.lat, MARRAKECH.lng], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      const markers: any[] = [];
      const withCoords = properties.filter(p => p.latitude && p.longitude);

      withCoords.forEach(p => {
        const color = STATUS_COLORS[p.status ?? 'sourcing'] ?? '#9CA3AF';
        const icon = L.divIcon({
          className: 'stoniz-pin',
          html: `<div style="
            width:32px;height:32px;background:${color};
            border:3px solid white;border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);
            box-shadow:0 2px 6px rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;
          "><span style="transform:rotate(45deg);color:white;font-weight:bold;font-size:11px;">${(p.evaluation ?? '').toString() || '·'}</span></div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -32],
        });

        const popupHtml = `
          <div style="font-family:-apple-system,system-ui,sans-serif;min-width:200px">
            <div style="font-weight:600;margin-bottom:4px">${escapeHtml(p.name)}</div>
            ${p.quartier ? `<div style="color:#666;font-size:12px;margin-bottom:6px">📍 ${escapeHtml(p.quartier)}</div>` : ''}
            ${p.badge_label ? `<div style="display:inline-block;font-size:10px;padding:2px 8px;border-radius:999px;background:#FEF3C7;color:#92400E;margin-bottom:6px">${escapeHtml(p.badge_label)}</div>` : ''}
            ${p.price ? `<div style="font-size:14px;margin-bottom:8px"><strong>${formatEur(p.price)}</strong></div>` : ''}
            ${p.detailHref ? `<a href="${p.detailHref}" style="display:inline-block;background:#1A1A1A;color:white;padding:4px 12px;border-radius:6px;text-decoration:none;font-size:12px">Voir le bien →</a>` : ''}
          </div>
        `;

        const m = L.marker([p.latitude, p.longitude], { icon }).addTo(map).bindPopup(popupHtml);
        markers.push(m);
      });

      if (fitBounds && markers.length > 0) {
        const group = L.featureGroup(markers);
        try { map.fitBounds(group.getBounds().pad(0.2)); } catch { /* single point */ }
      }

      mapRef.current = map;
    };

    loadLeaflet()
      .then(L => init(L))
      .catch(err => setLoadError(String(err)));

    return () => {
      cancelled = true;
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
      }
    };
  }, [properties, fitBounds]);

  return (
    <div className="space-y-2">
      {loadError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded-md">
          Impossible de charger la carte : {loadError}
        </div>
      )}
      <div ref={ref} style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden' }}
        className="border bg-stoniz-gray-100" />
      {showLegend && (
        <div className="flex gap-3 flex-wrap text-xs text-stoniz-gray-600">
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} className="inline-flex items-center gap-1.5">
              <span style={{ background: color, width: 12, height: 12, borderRadius: '50%' }} />
              {status}
            </div>
          ))}
        </div>
      )}
      {properties.length > 0 && properties.filter(p => !p.latitude || !p.longitude).length > 0 && (
        <p className="text-xs text-stoniz-gray-500">
          ⚠ {properties.filter(p => !p.latitude || !p.longitude).length} bien(s) sans coordonnées GPS — non affichés sur la carte.
        </p>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c] ?? c));
}

function formatEur(n: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
