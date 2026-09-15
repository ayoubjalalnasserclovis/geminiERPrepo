import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type Role =
  | 'ceo' | 'chef_projet' | 'sourcing' | 'commercial'
  | 'finance' | 'marketing' | 'assistante'
  | 'propria'
  | 'developer'
  | 'achats'
  | 'menage'
  | 'client';

/**
 * Rôles "team" (hors clients) — utilisés pour les layouts, la nav, et
 * les pages qui doivent s'ouvrir à toute l'équipe.
 *
 * Note : 'menage' fait partie de l'équipe mais a un layout/sidebar minimal
 * (uniquement /propria/menage). On le garde dans TEAM_ROLES pour les RLS,
 * mais la sidebar le détecte et n'affiche qu'un seul lien.
 */
export const TEAM_ROLES = [
  'ceo', 'chef_projet', 'sourcing', 'commercial',
  'finance', 'marketing', 'assistante', 'propria', 'developer', 'achats',
  'menage',
] as const satisfies readonly Role[];

export const ROLE_LABELS: Record<Role, string> = {
  ceo: 'CEO',
  chef_projet: 'Chef de projet',
  sourcing: 'Sourcing',
  commercial: 'Commercial',
  finance: 'Finance',
  marketing: 'Marketing',
  assistante: 'Assistante',
  propria: 'Propria',
  menage: 'Ménage',
  developer: 'Développeur',
  achats: 'Achats',
  client: 'Client',
};

/**
 * Le rôle developer voit tout ce que voit le CEO en lecture, mais ne peut
 * pas écrire sur les actions sensibles. Le rôle finance voit aussi les
 * écrans financiers (dashboard cabinet, marges).
 */
export function canSeeFinancials(role: Role | undefined | null): boolean {
  return role === 'ceo' || role === 'developer' || role === 'finance';
}

/**
 * Peut voir le dashboard travaux (vue cross-projets des marges artisans).
 * Chef de projet voit ses propres projets mais pas la vue agrégée.
 */
export function canSeeTravauxDashboard(role: Role | undefined | null): boolean {
  return role === 'ceo' || role === 'developer' || role === 'finance';
}

/**
 * Peut voir le dashboard achats (vue cross-projets fournisseurs).
 * Le rôle 'achats' est créé exprès pour ça.
 */
export function canSeeAchatsDashboard(role: Role | undefined | null): boolean {
  return role === 'ceo' || role === 'developer' || role === 'finance' || role === 'achats';
}

/**
 * Peut accéder à la trésorerie + projection + synthèse + reconciliation.
 * Chef de projet exclu volontairement (décision CEO 2026-06-03 launch day).
 */
export function canSeeTresorerie(role: Role | undefined | null): boolean {
  return role === 'ceo' || role === 'finance' || role === 'developer';
}

/**
 * Peut accéder à Propria (dashboard + biens + lots + interventions + caisses + listings).
 * Chef de projet et achats exclus volontairement.
 */
export function canSeePropria(role: Role | undefined | null): boolean {
  return role === 'ceo' || role === 'finance' || role === 'developer'
    || role === 'propria' || role === 'assistante';
}

/**
 * Peut entrer sur une fiche projet client (au moins en lecture).
 * Achats : oui, accès limité aux écrans achats.
 * Sourcing : oui, en lecture pour le contexte.
 */
export function canAccessProjects(role: Role | undefined | null): boolean {
  return role === 'ceo' || role === 'finance' || role === 'developer'
    || role === 'chef_projet' || role === 'commercial' || role === 'sourcing'
    || role === 'achats' || role === 'assistante' || role === 'marketing';
}

/**
 * À utiliser pour gérer l'affichage des actions destructrices (suppressions,
 * modifs honoraires). Le developer est strictement bloqué.
 * Note : les imports CSV projet (travaux/achats) sont désormais ouverts au chef
 * de projet + achats — voir canImportProjectCsv.
 */
export function canDoAdminActions(role: Role | undefined | null): boolean {
  return role === 'ceo';
}

/**
 * Rôles autorisés à importer un CSV sur les modules Travaux et Achats d'un projet.
 *
 * CEO 2026-09-02 : ouvert à chef_projet + achats pour délester le CEO du travail
 * de saisie initiale. L'import reste idempotent (data_fix_log) et ces rôles ont
 * déjà l'écriture sur travaux/achats en usage normal.
 *
 * CEO 2026-09-14 : ajout de finance + assistante. Même raisonnement — ces deux
 * rôles créent et éditent déjà acomptes et paiements travaux/achats à la main
 * (voir les assertRole de projects/[id]/{travaux,achats}/actions.ts). L'import
 * ne leur ouvre aucun droit nouveau, il leur évite la saisie ligne à ligne.
 *
 * Source de vérité unique : utiliser cette constante dans les gardes de page et
 * d'action, et canImportProjectCsv() pour l'affichage du bouton. Ne jamais
 * réécrire la liste en dur — elle a déjà dérivé dans 6 endroits par le passé.
 */
export const PROJECT_CSV_IMPORT_ROLES: Role[] = [
  'ceo', 'chef_projet', 'achats', 'finance', 'assistante',
];

export function canImportProjectCsv(role: Role | undefined | null): boolean {
  return !!role && PROJECT_CSV_IMPORT_ROLES.includes(role);
}

export type SessionUser = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  locale: string;
  is_active: boolean;
  mfa_required: boolean;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, locale, is_active, mfa_required')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active) return null;
  return profile as SessionUser;
}

/** Lance redirect si pas connecté ou si rôle non autorisé. */
export async function requireRole(allowed: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!allowed.includes(user.role)) {
    // QA-BUG-017 : routage de repli par rôle pour éviter les boucles de
    // redirection. menage n'a accès qu'à /propria/menage ; client à son
    // portail ; le reste de l'équipe au dashboard.
    if (user.role === 'client') redirect('/client');
    if (user.role === 'menage') redirect('/propria/menage');
    redirect('/dashboard');
  }
  return user;
}

/** Pour les Server Actions — throw au lieu de redirect */
export async function assertRole(allowed: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error('Non authentifié');
  if (!allowed.includes(user.role)) throw new Error('Permission refusée');
  return user;
}
