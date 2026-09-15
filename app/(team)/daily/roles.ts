import type { Role } from '@/lib/auth/require';

/**
 * Rôles autorisés sur le Daily Stoniz (cadrage CEO 2026-07-06) :
 * toute l'équipe interne, visibilité complète (écran de réunion partagé).
 * Exclusions : client (portail), menage (nav dédiée "Mes ménages").
 */
export const DAILY_STONIZ_ROLES: Role[] = [
  'ceo', 'developer', 'chef_projet', 'sourcing', 'commercial',
  'finance', 'marketing', 'assistante', 'achats', 'propria',
];
