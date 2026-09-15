'use server';

import { assertRole } from '@/lib/auth/require';
import { getFinanceAuditEntries, type FinanceAuditTable } from '@/lib/finance/audit';

/**
 * Server action lue par le composant client FinanceAuditButton pour
 * charger la timeline d'une ligne (CEO 2026-06-16).
 *
 * Sécurité : on requiert un rôle staff (CEO, finance, achats, chef_projet,
 * developer, assistante). Pas de role 'client' / 'menage' / 'sourcing'.
 */
export async function fetchFinanceAuditEntries(
  table: FinanceAuditTable,
  recordId: string,
) {
  await assertRole([
    'ceo',
    'developer',
    'finance',
    'achats',
    'chef_projet',
    'assistante',
  ]);
  return getFinanceAuditEntries(table, recordId);
}
