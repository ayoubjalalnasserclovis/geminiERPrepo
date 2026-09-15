// Liste blanche des tables Propria supprimables (soft-delete + validation CEO).
// Partagée entre les Server Actions et la page de validation.
// Sécurité : seules ces tables sont acceptées par l'action de suppression.

export const DELETABLE_TABLES: Record<string, { label: string; paths: string[] }> = {
  propria_interventions:       { label: 'Intervention / tâche', paths: ['/propria/interventions', '/propria/mes-taches'] },
  propria_intervention_proofs: { label: 'Preuve',               paths: ['/propria/interventions'] },
  propria_cleanings:           { label: 'Ménage',               paths: ['/propria/menage'] },
  propria_cleaning_proofs:     { label: 'Preuve ménage',        paths: ['/propria/menage'] },
  propria_checkups:            { label: 'Check-up logement',    paths: ['/propria/checkups'] },
  propria_checkup_proofs:      { label: 'Photo check-up',       paths: ['/propria/checkups'] },
  propria_cash_reservations:   { label: 'Réservation cash',     paths: ['/propria/reservations-cash'] },
  propria_direct_reservations: { label: 'Résa directe',         paths: ['/propria/reservations-cash'] },
  propria_wallet_expenses:     { label: 'Dépense caisse',       paths: ['/propria/caisse'] },
  propria_stock_movements:     { label: 'Mouvement de stock',   paths: ['/propria/stock', '/propria/stock/mouvements'] },
  propria_transfers:           { label: 'Transfert',            paths: ['/propria/transferts'] },
  propria_inventories:         { label: 'Inventaire',           paths: ['/propria/inventaires'] },
  propria_maintenance_visits:  { label: 'Visite maintenance',   paths: ['/propria/maintenance'] },
  propria_listing_metrics:     { label: 'Note annonce',         paths: ['/propria/listings'] },
  propria_upsells:             { label: 'Upsell',               paths: ['/propria/upsell'] },
};

export const DELETER_ROLES = ['ceo', 'chef_projet', 'assistante', 'propria'] as const;
