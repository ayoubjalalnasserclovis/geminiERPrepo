/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== 'production';

// En dev : on autorise localhost (Supabase local) et on retire HSTS (pas de HTTPS local).
// En prod : CSP stricte, uniquement les domaines Supabase et Resend autorisés.
const SUPABASE_LOCAL = "http://localhost:54321 http://127.0.0.1:54321 ws://localhost:54321 ws://127.0.0.1:54321";
const SUPABASE_CLOUD = "https://*.supabase.co wss://*.supabase.co";

// Domaines pour la carte Leaflet (script CDN + tiles OpenStreetMap)
const LEAFLET_CDN = 'https://unpkg.com';
const OSM_TILES = 'https://*.tile.openstreetmap.org https://tile.openstreetmap.org';

const csp = [
  "default-src 'self'",
  `img-src 'self' data: blob: https://images.unsplash.com https://*.unsplash.com ${OSM_TILES} ${SUPABASE_CLOUD} ${isDev ? SUPABASE_LOCAL : ''}`,
  // `media-src` est utilisé par les balises <video> et <audio>.
  // Sans cette directive, les vidéos Supabase sont bloquées silencieusement.
  `media-src 'self' data: blob: ${SUPABASE_CLOUD} ${isDev ? SUPABASE_LOCAL : ''}`,
  // `connect-src` : ${LEAFLET_CDN} (unpkg) sert aussi à charger le core
  // ffmpeg.wasm utilisé pour la compression vidéo côté navigateur.
  `connect-src 'self' ${SUPABASE_CLOUD} https://api.resend.com ${LEAFLET_CDN} ${isDev ? SUPABASE_LOCAL : ''}`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${LEAFLET_CDN}`,
  "font-src 'self' https://fonts.gstatic.com",
  // `blob:` est requis par ffmpeg.wasm (le worker de compression est chargé
  // depuis une URL blob).
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: ${LEAFLET_CDN}`,
  // `worker-src` : ffmpeg.wasm instancie son worker via une URL blob.
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy', value: csp },
];

// HSTS uniquement en production (en dev, HTTP est requis pour localhost).
if (!isDev) {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  });
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // QA-BUG-005 : le typecheck bloque désormais le build (dette TS = 0, vérifiée
  // par `tsc --noEmit`). ESLint reste non bloquant tant que le backlog lint
  // (entités non échappées, 2 imports server dans des composants) n'est pas purgé.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Les médias d'un bien (photos/vidéos) ne transitent PLUS par les Server
    // Actions : ils sont envoyés en DIRECT navigateur → stockage Supabase via
    // une URL signée (voir app/(team)/properties/[id]/media/actions.ts +
    // lib/media/upload-direct.ts). Cette limite ne couvre donc que les petits
    // payloads de Server Actions ; le plafond réel des vidéos (1 Go) est fixé
    // sur le bucket (migration 20260531100000_property_media_bucket_1gb.sql).
    serverActions: { bodySizeLimit: '4mb' },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: '127.0.0.1' },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

module.exports = nextConfig;
