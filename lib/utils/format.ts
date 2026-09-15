export function formatMoney(amount: number | null | undefined, currency: string = 'EUR', locale: string = 'fr-FR'): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Formate un montant en dirhams marocains style "1 234 MAD". */
export function formatMad(amount: number | null | undefined): string {
  if (amount == null) return '—';
  const rounded = Math.round(Number(amount));
  return `${rounded.toLocaleString('fr-FR')} MAD`;
}

export function formatDate(d: string | Date | null | undefined, locale: string = 'fr-FR'): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function formatPhase(phase: string): string {
  const map: Record<string, string> = {
    onboarding: 'Onboarding',
    sourcing: 'Sourcing',
    design: 'Design',
    travaux: 'Travaux',
    livraison: 'Livraison',
    mise_en_location: 'Mise en location',
    termine: 'Terminé',
  };
  return map[phase] ?? phase;
}

export function formatPaymentType(type: string): string {
  const map: Record<string, string> = {
    acompte_stoniz: 'Acompte',
    honoraires_compromis: 'Signature compromis',
    honoraires_3d: 'Présentation 3D & lots techniques',
    honoraires_chantier: 'Lancement de chantier',
    honoraires_livraison: 'Livraison de chantier',
    autre: 'Autre',
  };
  return map[type] ?? type;
}

export function formatStatus(status: string): string {
  const map: Record<string, string> = {
    actif: 'Actif',
    pause: 'En pause',
    termine: 'Terminé',
    perdu: 'Perdu',
    pending: 'En attente',
    partial: 'Partiel',
    paid: 'Payé',
    overdue: 'En retard',
    todo: 'À faire',
    in_progress: 'En cours',
    done: 'Fait',
    blocked: 'Bloqué',
    disponible: 'Disponible',
    propose: 'Proposé',
    offre: 'Offre faite',
    vendu: 'Vendu',
    perdu_bien: 'Perdu',
    a_verifier: 'À vérifier',
    accepted: 'Accepté',
    refused: 'Refusé',
    more_info: 'Plus d\'infos',
  };
  return map[status] ?? status;
}
