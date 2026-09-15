/**
 * Checklist photos/vidéos validée par le CEO 2026-06-09.
 * 5 sections : vue d'ensemble, détails propreté, dotation, équipements, incidents.
 * Chaque item peut avoir N photos (preuves) — calculé à l'usage.
 *
 * Note métier : la SDB et la chambre sont multipliées par le nb de SDB/chambres
 * de la suite (calculé à l'affichage). Ex : 2 SDB → 2 items « Cuvette WC » à valider.
 */

export type ChecklistItem = {
  /** Clé technique stable (utilisée comme `checklist_item_key` dans la BDD). */
  key: string;
  /** Libellé humain. */
  label: string;
  /** Détail optionnel sous le libellé (ex: « lit fait, couette tirée »). */
  hint?: string;
  /** Si l'item se multiplie par nb de pièces (chambres ou SDB). */
  repeatPer?: 'chambres' | 'sdb';
  /**
   * Chantier 5 marathon (U21) — équipes terrain ne lisant pas toujours le
   * français : gros emoji TOUJOURS affiché, et image « bon exemple » (IA)
   * affichée si le fichier existe dans /public/images/checklist/.
   */
  emoji?: string;
  image?: string;
};

export type ChecklistSection = {
  key: string;
  title: string;
  description?: string;
  items: ChecklistItem[];
};

export const CLEANING_CHECKLIST: ChecklistSection[] = [
  {
    key: 'vue_ensemble',
    title: 'Photos vue d’ensemble',
    description: 'Une photo par pièce — montrer que tout est rangé.',
    items: [
      { key: 'vue_salon',    label: 'Salon — vue large', emoji: '🛋️', image: '/images/checklist/vue_salon.webp' },
      { key: 'vue_cuisine',  label: 'Cuisine — vue large', hint: 'Plan de travail dégagé', emoji: '🍳', image: '/images/checklist/vue_cuisine.webp' },
      { key: 'vue_chambre',  label: 'Chambre — vue large', hint: 'Lit fait, couette tirée, oreillers alignés', repeatPer: 'chambres', emoji: '🛏️', image: '/images/checklist/vue_chambre.webp' },
      { key: 'vue_sdb',      label: 'Salle de bain — vue large', repeatPer: 'sdb', emoji: '🚿', image: '/images/checklist/vue_sdb.webp' },
    ],
  },
  {
    key: 'details',
    title: 'Photos détails sensibles — preuves de propreté',
    items: [
      { key: 'sols',             label: 'Sols toutes pièces', hint: 'Sans poussière, sans taches', emoji: '🧹', image: '/images/checklist/sols.webp' },
      { key: 'wc',               label: 'Cuvette WC vue dessus + sous la cuvette', repeatPer: 'sdb', emoji: '🚽', image: '/images/checklist/wc.webp' },
      { key: 'lavabo',           label: 'Lavabo + miroir + robinetterie', hint: 'Pas de traces de calcaire', repeatPer: 'sdb', emoji: '🪞', image: '/images/checklist/lavabo.webp' },
      { key: 'douche',           label: 'Douche / baignoire', hint: 'Joints, paroi, bonde', repeatPer: 'sdb', emoji: '🛁', image: '/images/checklist/douche.webp' },
      { key: 'evier_cuisine',    label: 'Évier cuisine + plan de travail', hint: 'Pas de miettes ni gras', emoji: '🚰', image: '/images/checklist/evier_cuisine.webp' },
      { key: 'plaques',          label: 'Plaques de cuisson', hint: 'Sans projections', emoji: '🔥', image: '/images/checklist/plaques.webp' },
      { key: 'four',             label: 'Intérieur du four', emoji: '♨️', image: '/images/checklist/four.webp' },
      { key: 'frigo',            label: 'Intérieur du frigo', hint: 'Vide ou propre selon contexte', emoji: '🧊', image: '/images/checklist/frigo.webp' },
      { key: 'micro_ondes',      label: 'Micro-ondes intérieur', emoji: '📦', image: '/images/checklist/micro_ondes.webp' },
      { key: 'poubelles',        label: 'Poubelles vidées + sacs neufs', emoji: '🗑️', image: '/images/checklist/poubelles.webp' },
    ],
  },
  {
    key: 'dotation',
    title: 'Dotation / consommables',
    items: [
      { key: 'linge_lit',        label: 'Linge de lit propre posé sur le lit', hint: 'Drap-housse, taies', repeatPer: 'chambres', emoji: '🛌', image: '/images/checklist/linge_lit.webp' },
      { key: 'linge_toilette',   label: 'Linge de toilette', hint: 'Serviettes, tapis de bain', repeatPer: 'sdb', emoji: '🧖', image: '/images/checklist/linge_toilette.webp' },
      { key: 'papier_toilette',  label: 'Stock papier toilette', hint: '2 rouleaux minimum par SDB', repeatPer: 'sdb', emoji: '🧻', image: '/images/checklist/papier_toilette.webp' },
      { key: 'savon',            label: 'Stock savon / gel douche / shampoing', repeatPer: 'sdb', emoji: '🧴', image: '/images/checklist/savon.webp' },
      { key: 'accueil_voyageur', label: 'Produits accueil voyageur', hint: 'Eau, café, sucre…', emoji: '☕', image: '/images/checklist/accueil_voyageur.webp' },
    ],
  },
  {
    key: 'equipements',
    title: 'Équipements',
    description: 'Vérifier la présence et l’état de chaque équipement.',
    items: [
      { key: 'telecommande_clim', label: 'Télécommande climatisation', emoji: '❄️', image: '/images/checklist/telecommande_clim.webp' },
      { key: 'telecommande_tv',   label: 'Télécommande TV', emoji: '📺', image: '/images/checklist/telecommande_tv.webp' },
      { key: 'cintres',           label: 'Cintres', emoji: '🧥', image: '/images/checklist/cintres.webp' },
      { key: 'seche_cheveux',     label: 'Sèche-cheveux', emoji: '💨', image: '/images/checklist/seche_cheveux.webp' },
      { key: 'fer_a_repasser',    label: 'Fer à repasser', emoji: '👕', image: '/images/checklist/fer_a_repasser.webp' },
    ],
  },
  {
    key: 'cles',
    title: 'Contrôle des clés',
    description: 'À chaque ménage — consultant 2026-06 (chantier Clés).',
    items: [
      { key: 'cle_voyageur',  label: 'Clé voyageur dans la boîte à clés', hint: 'Photo de la clé en place', emoji: '🔑', image: '/images/checklist/cle_voyageur.webp' },
      { key: 'photo_armoire', label: 'Photo de l’armoire à clés', emoji: '🗄️', image: '/images/checklist/photo_armoire.webp' },
      { key: 'jeux_reserve',  label: '2 jeux de réserve présents dans l’armoire', hint: 'Si moins de 2 : signaler un incident', emoji: '🔐', image: '/images/checklist/jeux_reserve.webp' },
    ],
  },
];

/**
 * Génère la liste effective des items à valider en multipliant ceux marqués
 * `repeatPer` par le nombre de chambres/SDB de la suite.
 * Ex : suite avec 2 chambres + 1 SDB :
 *   - vue_chambre devient 2 items (avec suffixe « (1) » et « (2) »)
 *   - vue_sdb reste 1 item
 */
export type ExpandedItem = ChecklistItem & {
  /** Clé unique après expansion (ex: "vue_chambre_1"). */
  expandedKey: string;
  /** Libellé final affiché (ex: "Chambre 2 — vue large"). */
  displayLabel: string;
  /** Section parente. */
  sectionKey: string;
};

export function expandChecklist(
  nbChambres: number | null | undefined,
  nbSdb: number | null | undefined,
): { section: ChecklistSection; items: ExpandedItem[] }[] {
  const chambres = Math.max(1, Number(nbChambres ?? 1));
  const sdb = Math.max(1, Number(nbSdb ?? 1));

  return CLEANING_CHECKLIST.map((section) => {
    const items: ExpandedItem[] = [];
    for (const item of section.items) {
      const count = item.repeatPer === 'chambres' ? chambres
                  : item.repeatPer === 'sdb'      ? sdb
                  : 1;
      if (count === 1) {
        items.push({ ...item, expandedKey: item.key, displayLabel: item.label, sectionKey: section.key });
      } else {
        for (let i = 1; i <= count; i++) {
          items.push({
            ...item,
            expandedKey: `${item.key}_${i}`,
            displayLabel: `${item.label} (${i}/${count})`,
            sectionKey: section.key,
          });
        }
      }
    }
    return { section, items };
  });
}

/** Total d'items à valider (utile pour le compteur global de progression). */
export function totalChecklistItems(nbChambres: number | null | undefined, nbSdb: number | null | undefined): number {
  return expandChecklist(nbChambres, nbSdb).reduce((n, s) => n + s.items.length, 0);
}
