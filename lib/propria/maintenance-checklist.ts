// Checklist standard pour maintenance préventive trimestrielle (location courte durée).
// Stockée en JSONB dans propria_maintenance_visits.checklist.

export type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  observation?: string;
};

export type ChecklistSection = {
  key: string;
  title: string;
  icon: string;
  items: ChecklistItem[];
};

export function defaultChecklist(): ChecklistSection[] {
  return [
    {
      key: 'plomberie',
      title: 'Plomberie',
      icon: '🚿',
      items: [
        { key: 'robinets', label: 'Robinets : pas de fuites, débit OK', done: false },
        { key: 'wc', label: 'WC : chasse, joints', done: false },
        { key: 'chauffe_eau', label: 'Chauffe-eau : eau chaude OK', done: false },
        { key: 'evacuations', label: 'Évacuations : pas d\'odeurs, écoulement OK', done: false },
        { key: 'siphons', label: 'Siphons nettoyés', done: false },
      ],
    },
    {
      key: 'electricite',
      title: 'Électricité',
      icon: '⚡',
      items: [
        { key: 'prises', label: 'Toutes les prises fonctionnent', done: false },
        { key: 'ampoules', label: 'Ampoules : aucune grillée', done: false },
        { key: 'interrupteurs', label: 'Interrupteurs en bon état', done: false },
        { key: 'disjoncteur', label: 'Disjoncteur testé', done: false },
        { key: 'appareils', label: 'Appareils électroménagers OK', done: false },
      ],
    },
    {
      key: 'climatisation',
      title: 'Climatisation / Chauffage',
      icon: '❄️',
      items: [
        { key: 'filtre', label: 'Filtres nettoyés', done: false },
        { key: 'refroidissement', label: 'Refroidissement / chauffage testés', done: false },
        { key: 'telecommande', label: 'Télécommandes : piles OK', done: false },
      ],
    },
    {
      key: 'securite',
      title: 'Sécurité',
      icon: '🔐',
      items: [
        { key: 'serrures', label: 'Serrures fonctionnent normalement', done: false },
        { key: 'cles', label: 'Toutes les clés sont présentes', done: false },
        { key: 'boites_cles', label: 'Boîtes à clés OK et code à jour', done: false },
        { key: 'detecteur_fumee', label: 'Détecteur de fumée testé', done: false },
      ],
    },
    {
      key: 'wifi',
      title: 'Wifi & internet',
      icon: '📶',
      items: [
        { key: 'debit', label: 'Test de débit (cible ≥ 30 Mbps)', done: false },
        { key: 'box', label: 'Box redémarrée', done: false },
        { key: 'mots_de_passe', label: 'Mot de passe Wifi affiché clairement', done: false },
      ],
    },
    {
      key: 'mobilier',
      title: 'Mobilier & déco',
      icon: '🛋️',
      items: [
        { key: 'lits', label: 'État des lits, matelas, sommiers', done: false },
        { key: 'chaises', label: 'Chaises et fauteuils stables', done: false },
        { key: 'rideaux', label: 'Rideaux propres, tringles OK', done: false },
        { key: 'decoration', label: 'Décoration intacte', done: false },
        { key: 'tv', label: 'TV / écran fonctionnel', done: false },
      ],
    },
    {
      key: 'linge_cuisine',
      title: 'Linge & cuisine',
      icon: '🍽️',
      items: [
        { key: 'linge_propre', label: 'Linge propre, en quantité', done: false },
        { key: 'vaisselle', label: 'Vaisselle complète et non ébréchée', done: false },
        { key: 'ustensiles', label: 'Ustensiles cuisine OK', done: false },
        { key: 'electromenager', label: 'Frigo, four, micro-ondes nettoyés', done: false },
      ],
    },
    {
      key: 'consommables',
      title: 'Consommables',
      icon: '🧴',
      items: [
        { key: 'produits_menage', label: 'Stock produits ménage suffisant', done: false },
        { key: 'toiletries', label: 'Toiletries (savon, shampoing) OK', done: false },
        { key: 'papier_toilette', label: 'Papier toilette : stock OK', done: false },
        { key: 'sacs_poubelle', label: 'Sacs poubelle disponibles', done: false },
      ],
    },
    {
      key: 'exterieur',
      title: 'Extérieur / parties communes',
      icon: '🌿',
      items: [
        { key: 'terrasse', label: 'Terrasse / balcon propre', done: false },
        { key: 'plantes', label: 'Plantes en bon état', done: false },
        { key: 'parties_communes', label: 'Parties communes correctes', done: false },
      ],
    },
  ];
}

export function progressOf(checklist: ChecklistSection[]): { done: number; total: number; pct: number } {
  let done = 0, total = 0;
  for (const s of checklist) {
    for (const i of s.items) {
      total++;
      if (i.done) done++;
    }
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}
