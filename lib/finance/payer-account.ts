/**
 * Compte payeur des demandes de virement (CEO 2026-07-08).
 *
 * Canon : helper centralisé — TOUTE référence au compte payeur (UI, emails,
 * audit, Zod) passe par ce fichier. Si un 3e compte apparaît un jour
 * (ex: STZ CLUB), on l'ajoute ICI + migration du CHECK constraint, et tout
 * le reste suit.
 *
 * Périmètre : demandes achats + travaux uniquement (décision CEO 2026-07-08).
 * Les demandes d'honoraires Stoniz (source 'payment') ne sont pas concernées.
 */

export const PAYER_ACCOUNTS = ['personnel', 'stz_oj'] as const;

export type PayerAccount = (typeof PAYER_ACCOUNTS)[number];

export const PAYER_ACCOUNT_LABELS: Record<PayerAccount, string> = {
  personnel: 'Compte personnel',
  stz_oj: 'Compte société STZ OJ',
};

/** Options prêtes pour un radio group / select. */
export const PAYER_ACCOUNT_OPTIONS = PAYER_ACCOUNTS.map((value) => ({
  value,
  label: PAYER_ACCOUNT_LABELS[value],
}));

/** Libellé sûr pour l'affichage (badge, email, audit). NULL → null. */
export function payerAccountLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return PAYER_ACCOUNT_LABELS[value as PayerAccount] ?? value;
}
