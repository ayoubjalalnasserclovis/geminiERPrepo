import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Statut de l'attestation de régularité fiscale d'un artisan.
 * CEO 2026-06-18 : règle métier marocaine — validité 6 mois pile.
 *
 * INVARIANTS :
 *   - VALIDE         : document_date >= today - 6 mois ET <= today
 *   - EXPIRING_SOON  : document_date >= today - 5 mois (< 30j restants)
 *   - EXPIRED        : document_date < today - 6 mois
 *   - MISSING        : aucune attestation pour cet artisan actif
 */

export type AttestationStatus = 'valid' | 'expiring_soon' | 'expired' | 'missing';

export type ArtisanAttestationInfo = {
  artisan_id: string;
  artisan_name: string;
  status: AttestationStatus;
  last_document_date: string | null;     // date d'émission (YYYY-MM-DD)
  expires_at: string | null;             // date_émission + 6 mois
  days_remaining: number | null;         // < 0 = dépassé, >= 0 = encore valide
};

const VALIDITY_MONTHS = 6;
const SOON_THRESHOLD_DAYS = 30;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return isoDate(d);
}

function diffDays(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Fonction PURE pour tester le statut depuis une date d'émission. */
export function computeAttestationStatus(
  lastDocumentDate: string | null,
  today: string = isoDate(new Date()),
): { status: AttestationStatus; expires_at: string | null; days_remaining: number | null } {
  if (!lastDocumentDate) {
    return { status: 'missing', expires_at: null, days_remaining: null };
  }
  const expiresAt = addMonthsIso(lastDocumentDate, VALIDITY_MONTHS);
  const daysRemaining = diffDays(today, expiresAt);
  if (daysRemaining < 0) return { status: 'expired', expires_at: expiresAt, days_remaining: daysRemaining };
  if (daysRemaining <= SOON_THRESHOLD_DAYS) return { status: 'expiring_soon', expires_at: expiresAt, days_remaining: daysRemaining };
  return { status: 'valid', expires_at: expiresAt, days_remaining: daysRemaining };
}

/**
 * Scope d'activité de l'artisan (mappe sur `artisans.business_scope`).
 * - 'travaux' : artisans intervenant sur travaux (chantier)
 * - 'achats'  : artisans/fournisseurs déco-mobilier (business_scope IN ('deco','both'))
 * - 'all'     : tout (par défaut, comportement historique du bandeau travaux)
 *
 * NB : 'both' (entreprises mixtes) est inclus dans les deux scopes — un même
 * fournisseur peut apparaître sur les deux bandeaux, voulu par CEO 2026-06-24.
 */
export type AttestationScope = 'travaux' | 'achats' | 'all';

function applyScopeFilter(query: any, scope: AttestationScope) {
  if (scope === 'travaux') return query.in('business_scope', ['travaux', 'both']);
  if (scope === 'achats')  return query.in('business_scope', ['deco', 'both']);
  return query; // 'all' : pas de filtre
}

/**
 * Charge le statut d'attestation pour TOUS les artisans actifs (filtré par scope).
 * Retour : 1 ligne par artisan (même ceux sans attestation, status='missing').
 */
export async function getAllArtisansAttestationStatus(
  supabase: SupabaseClient,
  scope: AttestationScope = 'all',
): Promise<ArtisanAttestationInfo[]> {
  const today = isoDate(new Date());

  const artisansQuery = applyScopeFilter(
    supabase.from('artisans').select('id, name').eq('status', 'actif').is('deleted_at', null),
    scope,
  );

  const [artisansRes, docsRes] = await Promise.all([
    artisansQuery,
    supabase.from('documents')
      .select('artisan_id, document_date')
      .eq('type', 'attestation_regularite_fiscale')
      .not('artisan_id', 'is', null)
      .is('deleted_at', null)
      .order('document_date', { ascending: false }),
  ]);

  // Map artisan_id → date la plus récente (déjà trié desc → on prend la 1ère)
  const latestByArtisan = new Map<string, string>();
  for (const d of (docsRes.data ?? []) as any[]) {
    if (!latestByArtisan.has(d.artisan_id)) {
      latestByArtisan.set(d.artisan_id, String(d.document_date).slice(0, 10));
    }
  }

  return ((artisansRes.data ?? []) as any[]).map((a) => {
    const last = latestByArtisan.get(a.id) ?? null;
    const { status, expires_at, days_remaining } = computeAttestationStatus(last, today);
    return {
      artisan_id: a.id,
      artisan_name: a.name,
      status,
      last_document_date: last,
      expires_at,
      days_remaining,
    };
  });
}

/** Agrégat pour KPI : compte par statut. */
export function aggregateAttestationStatus(rows: ArtisanAttestationInfo[]) {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.status === 'valid').length,
    expiring_soon: rows.filter((r) => r.status === 'expiring_soon').length,
    expired: rows.filter((r) => r.status === 'expired').length,
    missing: rows.filter((r) => r.status === 'missing').length,
  };
}

/**
 * Pour un artisan unique. Utilisé par le workflow validation paiement
 * (alerte non-bloquante quand attestation expirée).
 */
export async function getArtisanAttestationStatus(
  supabase: SupabaseClient,
  artisanId: string,
): Promise<ArtisanAttestationInfo | null> {
  const today = isoDate(new Date());
  const [artisanRes, docsRes] = await Promise.all([
    supabase.from('artisans').select('id, name').eq('id', artisanId).maybeSingle(),
    supabase.from('documents')
      .select('document_date')
      .eq('type', 'attestation_regularite_fiscale')
      .eq('artisan_id', artisanId)
      .is('deleted_at', null)
      .order('document_date', { ascending: false })
      .limit(1),
  ]);
  if (!artisanRes.data) return null;
  const last = ((docsRes.data ?? [])[0] as any)?.document_date ?? null;
  const lastIso = last ? String(last).slice(0, 10) : null;
  const { status, expires_at, days_remaining } = computeAttestationStatus(lastIso, today);
  return {
    artisan_id: (artisanRes.data as any).id,
    artisan_name: (artisanRes.data as any).name,
    status,
    last_document_date: lastIso,
    expires_at,
    days_remaining,
  };
}
