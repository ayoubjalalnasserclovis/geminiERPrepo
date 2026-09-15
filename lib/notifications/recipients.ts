import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Source de vérité pour les destinataires des emails internes (rappels paiement,
 * alertes finance, etc.).
 *
 * CEO 2026-06-19 :
 *  - Le financier est **Nabil GANDOUL** (nabil@stoniz.co, role='finance').
 *  - L'adresse `finance@stoniz.co` n'existe PAS, ne JAMAIS l'utiliser comme
 *    destinataire (ni en fallback). Bug historique : le cron envoyait à
 *    `EMAIL_FROM ?? 'finance@stoniz.co'` → boucle from==to et Suppression Resend
 *    (67 rappels morts en 7 jours).
 *
 * Règles :
 *  - On filtre toujours `is_active=true`.
 *  - On exclut les **aliases QA** (`email LIKE '%+%@%'`) pour ne pas spammer
 *    les comptes de test `othmane+ceo@`, `othmane+finance@` en prod.
 *  - Dédup sur l'email (Set).
 *  - Fallback `nabil@stoniz.co` en dernier recours pour les rappels finance,
 *    pour qu'on n'envoie jamais à une liste vide sans alerte console.
 */

const FINANCE_FALLBACK_EMAIL = 'nabil@stoniz.co';

export type RecipientProfile = {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
};

async function fetchActiveProfiles(
  admin: SupabaseClient,
  roles: string[],
): Promise<RecipientProfile[]> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, full_name, email, role')
    .in('role', roles)
    .eq('is_active', true)
    .not('email', 'like', '%+%@%') // exclut les aliases QA
    .order('full_name');
  if (error) {
    console.error('[recipients] erreur fetch profiles', roles, error.message);
    return [];
  }
  // Dédup par email (case-insensitive)
  const seen = new Set<string>();
  const out: RecipientProfile[] = [];
  for (const p of (data ?? []) as RecipientProfile[]) {
    if (!p.email) continue;
    const k = p.email.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Destinataires "finance" (Nabil + tout role='finance' actif, hors QA). */
export async function getFinanceRecipients(admin: SupabaseClient): Promise<RecipientProfile[]> {
  const profiles = await fetchActiveProfiles(admin, ['finance']);
  if (profiles.length === 0) {
    console.error('[recipients] aucun profil finance actif — fallback', FINANCE_FALLBACK_EMAIL);
    return [{ id: 'fallback', full_name: 'Finance Stoniz', email: FINANCE_FALLBACK_EMAIL, role: 'finance' }];
  }
  return profiles;
}

/** Destinataires "CEO" (role='ceo' actif, hors QA). */
export async function getCeoRecipients(admin: SupabaseClient): Promise<RecipientProfile[]> {
  return fetchActiveProfiles(admin, ['ceo']);
}

/** Finance + CEO mergés, dédupés. Pour alertes critiques (paiements en retard, etc.). */
export async function getFinanceAndCeoRecipients(
  admin: SupabaseClient,
): Promise<RecipientProfile[]> {
  const profiles = await fetchActiveProfiles(admin, ['finance', 'ceo']);
  if (profiles.length === 0) {
    console.error('[recipients] aucun finance/ceo actif — fallback', FINANCE_FALLBACK_EMAIL);
    return [{ id: 'fallback', full_name: 'Finance Stoniz', email: FINANCE_FALLBACK_EMAIL, role: 'finance' }];
  }
  return profiles;
}

/**
 * Sujet enrichi pour les emails internes liés à un paiement / projet.
 * Format : `[STZ-2026-085] Marie Dupont — Acompte artisan (12 000 MAD)`
 *
 * Tous les champs sont best-effort : si un est manquant, on saute proprement.
 */
export function buildPaymentSubject(opts: {
  projectRef?: string | null;
  clientName?: string | null;
  label: string;                   // ex. "Rappel acompte artisan", "Paiement en retard"
  amount?: number | null;
  currency?: 'EUR' | 'MAD' | 'USD' | null;
}): string {
  const parts: string[] = [];
  if (opts.projectRef) parts.push(`[${opts.projectRef}]`);
  if (opts.clientName) parts.push(opts.clientName);
  let core = opts.label;
  if (opts.amount != null && opts.amount > 0) {
    const cur = opts.currency ?? 'EUR';
    const formatted = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 0,
    }).format(opts.amount);
    core = `${core} (${formatted})`;
  }
  parts.push(core);
  // Sépare le préfixe contexte (projet+client) du libellé par un tiret
  if (parts.length >= 3) {
    return `${parts.slice(0, -1).join(' ')} — ${parts[parts.length - 1]}`;
  }
  return parts.join(' — ');
}
