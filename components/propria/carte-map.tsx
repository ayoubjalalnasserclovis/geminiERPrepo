'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Crosshair, X } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import { setPropertyCoordinatesAction } from '@/app/(team)/propria/carte/actions';
import type { CarteLot, CarteProperty } from '@/components/propria/carte-types';

/**
 * Carte Leaflet des biens / lots Propria (CHANTIER 10).
 *
 * - Leaflet pur (pas react-leaflet), import dynamique côté client.
 * - Marqueurs = divIcon HTML (pastille + code) → pas de bug d'icônes
 *   Leaflet sous bundler, et plus lisible qu'un pin générique.
 * - Deux niveaux : Projet (1 marqueur / bien) et Logement (1 marqueur / lot,
 *   léger offset circulaire pour ne pas superposer les lots d'un même bien).
 * - Géolocalisation intégrée : panneau « À localiser » + clic carte,
 *   et marqueurs draggables (rôles ceo / assistante / propria).
 */

type Level = 'projet' | 'logement';

const CASA_CENTER: [number, number] = [33.57, -7.59];
const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(n: number, currency: string | null): string {
  const v = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
  return currency ? `${v} ${esc(currency)}` : v;
}

function dateFr(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
}

function kpiRowsHtml(k: {
  caMonth: number; ca12m: number; currency: string | null;
  avgRating: number | null; nbReviews: number;
  occupancy30: number; nbResas12m: number; lastCleaning: string | null;
}): string {
  const note = k.avgRating != null
    ? `${k.avgRating.toFixed(2).replace('.', ',')} /5${k.nbReviews ? ` <span style="color:#777">(${k.nbReviews} avis)</span>` : ''}`
    : '—';
  return `
    <table style="font-size:12px;line-height:1.6;border-collapse:collapse">
      <tr><td style="color:#666;padding-right:10px">CA mois en cours</td><td><b>${money(k.caMonth, k.currency)}</b></td></tr>
      <tr><td style="color:#666;padding-right:10px">CA 12 derniers mois</td><td><b>${money(k.ca12m, k.currency)}</b></td></tr>
      <tr><td style="color:#666;padding-right:10px">Note moyenne</td><td><b>${note}</b></td></tr>
      <tr><td style="color:#666;padding-right:10px">Occupation 30 j</td><td><b>${k.occupancy30} %</b></td></tr>
      <tr><td style="color:#666;padding-right:10px">Résas 12 mois</td><td><b>${k.nbResas12m}</b></td></tr>
      <tr><td style="color:#666;padding-right:10px">Dernier ménage clôturé</td><td><b>${dateFr(k.lastCleaning)}</b></td></tr>
      <tr><td style="color:#666;padding-right:10px">Dernier audit qualité</td><td><b>—</b></td></tr>
    </table>`;
}

function occBadge(occupied: boolean): string {
  return occupied
    ? '<span style="font-size:10px;background:#dbeafe;color:#1d4ed8;border:1px solid #bfdbfe;padding:1px 7px;border-radius:9999px">Occupé aujourd’hui</span>'
    : '<span style="font-size:10px;background:#d1fae5;color:#047857;border:1px solid #a7f3d0;padding:1px 7px;border-radius:9999px">Libre aujourd’hui</span>';
}

function ficheLink(propertyId: string): string {
  return `<div style="margin-top:8px;padding-top:6px;border-top:1px solid #eee">
    <a href="/propria/biens/${propertyId}" style="font-size:12px;color:#191919;text-decoration:underline">Fiche bien →</a>
  </div>`;
}

function propertyPopupHtml(p: CarteProperty): string {
  const lotLines = p.lots.map((l) => `
    <tr>
      <td style="font-family:monospace;font-size:11px;padding-right:8px">${esc(l.code)}</td>
      <td style="font-size:11px;padding-right:8px">${money(l.ca12m, l.currency)}<span style="color:#999"> /12m</span></td>
      <td style="font-size:11px;padding-right:8px">${l.avgRating != null ? l.avgRating.toFixed(1).replace('.', ',') + '/5' : '—'}</td>
      <td style="font-size:11px">${l.occupancy30}<span style="color:#999"> %/30j</span></td>
    </tr>`).join('');
  return `
    <div style="min-width:240px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
        <b style="font-size:13px">${esc(p.name)}</b>
        ${occBadge(p.agg.occupiedToday)}
      </div>
      ${p.quartier ? `<div style="font-size:11px;color:#777;margin-bottom:6px">${esc(p.quartier)}</div>` : ''}
      ${kpiRowsHtml(p.agg)}
      ${p.lots.length > 0 ? `
        <div style="margin-top:8px;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.04em">Lots (${p.lots.length})</div>
        <table style="border-collapse:collapse;margin-top:2px">${lotLines}</table>` : ''}
      ${ficheLink(p.id)}
    </div>`;
}

function lotPopupHtml(p: CarteProperty, l: CarteLot): string {
  return `
    <div style="min-width:220px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;flex-wrap:wrap">
        <b style="font-family:monospace;font-size:13px">${esc(l.code)}</b>
        ${occBadge(l.occupiedToday)}
      </div>
      <div style="font-size:11px;color:#777;margin-bottom:6px">${esc(p.name)}${p.quartier ? ' · ' + esc(p.quartier) : ''}</div>
      ${kpiRowsHtml(l)}
      ${!l.hasListing ? '<div style="margin-top:6px;font-size:11px;color:#b45309">Aucun listing Hostaway matché — KPI à 0.</div>' : ''}
      ${ficheLink(p.id)}
    </div>`;
}

function pinHtml(label: string, occupied: boolean, dark: boolean): string {
  const dot = occupied ? '#2563eb' : '#059669';
  const bg = dark ? '#191919' : '#ffffff';
  const fg = dark ? '#ffffff' : '#191919';
  const border = dark ? '#ffffff' : '#191919';
  return `<div style="display:flex;align-items:center;gap:5px;background:${bg};color:${fg};padding:3px 9px;border-radius:9999px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35);border:1.5px solid ${border};transform:translate(-50%,-50%);width:max-content;cursor:pointer">
    <span style="width:7px;height:7px;border-radius:9999px;background:${dot};flex:none"></span>${esc(label)}
  </div>`;
}

export function PropriaCarteMap({
  properties,
  canEdit,
}: {
  properties: CarteProperty[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const LRef = useRef<any>(null);
  const didFitRef = useRef(false);
  const [ready, setReady] = useState(false);

  const [level, setLevel] = useState<Level>('projet');
  const [quartierF, setQuartierF] = useState('');
  const [occF, setOccF] = useState<'tous' | 'libre' | 'occupe'>('tous');
  const [propF, setPropF] = useState('');

  const [placingId, setPlacingId] = useState<string | null>(null);
  const placingRef = useRef<string | null>(null);
  placingRef.current = placingId;
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quartiers = useMemo(
    () => Array.from(new Set(properties.map((p) => p.quartier).filter(Boolean))).sort() as string[],
    [properties],
  );
  const unplaced = useMemo(
    () => properties.filter((p) => p.lat == null || p.lng == null),
    [properties],
  );

  const saveCoords = useCallback(async (propertyId: string, lat: number, lng: number) => {
    setSavingId(propertyId);
    setError(null);
    try {
      await setPropertyCoordinatesAction(propertyId, lat, lng);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Erreur lors de l'enregistrement des coordonnées");
    } finally {
      setSavingId(null);
    }
  }, [router]);
  const saveRef = useRef(saveCoords);
  saveRef.current = saveCoords;

  // ─── Init Leaflet (import dynamique, une seule fois) ─────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView(CASA_CENTER, 12);
      L.tileLayer(OSM_URL, { attribution: OSM_ATTRIB, maxZoom: 19 }).addTo(map);
      // Mode placement : le prochain clic carte géolocalise le bien sélectionné.
      map.on('click', (e: any) => {
        const id = placingRef.current;
        if (!id) return;
        placingRef.current = null;
        setPlacingId(null);
        void saveRef.current(id, e.latlng.lat, e.latlng.lng);
      });
      LRef.current = L;
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Echap annule le mode placement.
  useEffect(() => {
    if (!placingId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlacingId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placingId]);

  // ─── Rendu des marqueurs (niveau + filtres) ──────────────────────────────
  useEffect(() => {
    const L = LRef.current;
    const layer = layerRef.current;
    if (!ready || !L || !layer || !mapRef.current) return;
    layer.clearLayers();

    const filtered = properties.filter((p) => {
      if (p.lat == null || p.lng == null) return false;
      if (quartierF && p.quartier !== quartierF) return false;
      if (propF && p.id !== propF) return false;
      if (level === 'projet' && occF !== 'tous') {
        if (occF === 'occupe' && !p.agg.occupiedToday) return false;
        if (occF === 'libre' && p.agg.occupiedToday) return false;
      }
      return true;
    });

    const bounds: [number, number][] = [];

    const addMarker = (
      lat: number, lng: number, html: string, popup: string,
      dragProperty: CarteProperty | null,
    ) => {
      const icon = L.divIcon({ html, className: '', iconSize: [0, 0] });
      const marker = L.marker([lat, lng], {
        icon,
        draggable: !!dragProperty && canEdit,
      });
      marker.bindPopup(popup, { maxWidth: 320 });
      if (dragProperty && canEdit) {
        marker.on('dragend', () => {
          const ll = marker.getLatLng();
          void saveRef.current(dragProperty.id, ll.lat, ll.lng);
        });
      }
      marker.addTo(layer);
      bounds.push([lat, lng]);
    };

    for (const p of filtered) {
      const lat = p.lat as number;
      const lng = p.lng as number;
      if (level === 'projet') {
        addMarker(
          lat, lng,
          pinHtml(p.code ?? p.name, p.agg.occupiedToday, true),
          propertyPopupHtml(p),
          p,
        );
      } else {
        const lots = p.lots.filter((l) => {
          if (occF === 'occupe') return l.occupiedToday;
          if (occF === 'libre') return !l.occupiedToday;
          return true;
        });
        // Offset circulaire léger pour que les lots d'un même bien
        // ne se superposent pas (mêmes coordonnées que le bien).
        const n = lots.length;
        lots.forEach((l, i) => {
          const r = n > 1 ? 0.00022 : 0;
          const angle = (2 * Math.PI * i) / Math.max(n, 1);
          addMarker(
            lat + r * Math.sin(angle),
            lng + r * Math.cos(angle),
            pinHtml(l.code, l.occupiedToday, false),
            lotPopupHtml(p, l),
            // Au niveau Logement on ne déplace pas le bien (les lots
            // partagent les coordonnées du bien) — drag réservé au niveau Projet.
            null,
          );
        });
      }
    }

    if (!didFitRef.current && bounds.length > 0) {
      didFitRef.current = true;
      mapRef.current.fitBounds(bounds as any, { padding: [50, 50], maxZoom: 14 });
    }
  }, [ready, properties, level, quartierF, occF, propF, canEdit]);

  const placingProperty = placingId ? properties.find((p) => p.id === placingId) : null;

  return (
    <div>
      {/* ─── Barre de contrôle : niveau + filtres ─── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="inline-flex rounded-md border border-stoniz-gray-300 overflow-hidden">
          {(['projet', 'logement'] as Level[]).map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLevel(lv)}
              className={`px-3 py-1.5 text-xs font-medium transition ${
                level === lv
                  ? 'bg-stoniz-black text-white'
                  : 'bg-white text-stoniz-gray-700 hover:bg-stoniz-gray-50'
              }`}
            >
              {lv === 'projet' ? 'Projet' : 'Logement'}
            </button>
          ))}
        </div>

        <select
          value={quartierF}
          onChange={(e) => setQuartierF(e.target.value)}
          className="border border-stoniz-gray-300 rounded-md px-2 py-1.5 text-xs bg-white"
        >
          <option value="">Tous les quartiers</option>
          {quartiers.map((q) => <option key={q} value={q}>{q}</option>)}
        </select>

        <select
          value={occF}
          onChange={(e) => setOccF(e.target.value as any)}
          className="border border-stoniz-gray-300 rounded-md px-2 py-1.5 text-xs bg-white"
        >
          <option value="tous">Libre + occupé</option>
          <option value="libre">Libre aujourd&apos;hui</option>
          <option value="occupe">Occupé aujourd&apos;hui</option>
        </select>

        <select
          value={propF}
          onChange={(e) => setPropF(e.target.value)}
          className="border border-stoniz-gray-300 rounded-md px-2 py-1.5 text-xs bg-white max-w-[220px]"
        >
          <option value="">Tous les biens</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.code ? `${p.code} — ${p.name}` : p.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-3 text-[11px] text-stoniz-gray-500 ml-auto">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" /> libre
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" /> occupé
          </span>
        </div>
      </div>

      {/* ─── Bandeaux d'état ─── */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-3 py-2 text-sm mb-3">
          {error}
        </div>
      )}
      {placingProperty && (
        <div className="bg-stoniz-black text-white rounded-md px-3 py-2 text-sm mb-3 flex items-center gap-2">
          <Crosshair className="w-4 h-4 flex-shrink-0" />
          <span>
            Clique sur la carte pour positionner <b>{placingProperty.code ?? placingProperty.name}</b>
          </span>
          <button
            type="button"
            onClick={() => setPlacingId(null)}
            className="ml-auto inline-flex items-center gap-1 text-xs underline"
          >
            <X className="w-3.5 h-3.5" /> Annuler (Échap)
          </button>
        </div>
      )}
      {savingId && (
        <div className="bg-stoniz-gray-100 border border-stoniz-gray-200 text-stoniz-gray-700 rounded-md px-3 py-2 text-sm mb-3">
          Enregistrement des coordonnées…
        </div>
      )}

      {/* ─── Carte + panneau « À localiser » ─── */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div
          ref={containerRef}
          className="flex-1 rounded-xl border border-stoniz-gray-200 overflow-hidden z-0"
          style={{
            height: 'calc(100vh - 200px)',
            minHeight: 420,
            cursor: placingId ? 'crosshair' : undefined,
          }}
        />

        {canEdit && unplaced.length > 0 && (
          <div className="lg:w-72 flex-shrink-0 bg-white border border-stoniz-gray-200 rounded-xl p-4 overflow-y-auto"
               style={{ maxHeight: 'calc(100vh - 200px)' }}>
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="w-4 h-4 text-stoniz-gray-500" />
              <div className="font-medium text-sm">À localiser ({unplaced.length})</div>
            </div>
            <p className="text-[11px] text-stoniz-gray-500 mb-3">
              Sélectionne un bien puis clique sur la carte à son emplacement.
              Les marqueurs déjà posés restent déplaçables (glisser-déposer).
            </p>
            <ul className="space-y-1.5">
              {unplaced.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setPlacingId(placingId === p.id ? null : p.id)}
                    disabled={savingId != null}
                    className={`w-full text-left px-3 py-2 rounded-md border text-xs transition ${
                      placingId === p.id
                        ? 'bg-stoniz-black text-white border-stoniz-black'
                        : 'bg-white border-stoniz-gray-200 hover:border-stoniz-black'
                    }`}
                  >
                    <div className="font-medium">{p.code ?? p.name}</div>
                    <div className={placingId === p.id ? 'text-stoniz-gray-300' : 'text-stoniz-gray-500'}>
                      {p.name}{p.quartier ? ` · ${p.quartier}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
