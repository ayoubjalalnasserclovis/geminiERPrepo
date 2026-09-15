/**
 * Checklist Check-up logement — chantier 11.a marathon (consultant U26, CEO A2).
 * MVP : liste fixe, mêmes principes que la checklist ménage
 * (lib/propria/cleaning-checklist.ts) — clés stables stockées dans
 * propria_checkup_items.item_key, libellés jamais en BDD.
 *
 * Chaque item se note : OK ✅ / Problème ⚠ / N/A.
 * Si Problème : note ET au moins une photo obligatoires (bloquant à la soumission).
 */

export type CheckupItemStatus = 'ok' | 'probleme' | 'na';

export type CheckupItem = {
  /** Clé technique stable (propria_checkup_items.item_key). */
  key: string;
  /** Libellé humain. */
  label: string;
  /** Détail optionnel sous le libellé. */
  hint?: string;
  /** Gros emoji toujours affiché (équipes terrain — même principe que ménage U21). */
  emoji: string;
};

export type CheckupSection = {
  key: string;
  title: string;
  emoji: string;
  description?: string;
  items: CheckupItem[];
};

export const CHECKUP_CHECKLIST: CheckupSection[] = [
  {
    key: 'etat_general',
    title: 'État général',
    emoji: '🏠',
    items: [
      { key: 'murs_peinture',      label: 'Murs / peinture',        hint: 'Traces, écaillage, trous, retouches à prévoir', emoji: '🖌️' },
      { key: 'sols',               label: 'Sols',                   hint: 'Carrelage fissuré, parquet abîmé, plinthes',    emoji: '🧱' },
      { key: 'plafonds_humidite',  label: 'Plafonds / humidité',    hint: 'Auréoles, moisissures, infiltrations',          emoji: '💧' },
      { key: 'odeurs',             label: 'Odeurs',                 hint: 'Humidité, canalisation, tabac',                 emoji: '👃' },
    ],
  },
  {
    key: 'equipements',
    title: 'Équipements',
    emoji: '🔌',
    items: [
      { key: 'clim_telecommande',       label: 'Climatisation + télécommande', hint: 'Froid/chaud OK, télécommande présente avec piles', emoji: '❄️' },
      { key: 'tv_telecommande',         label: 'TV + télécommande',            hint: 'Allumage, chaînes/apps, télécommande présente',    emoji: '📺' },
      { key: 'iptv_guide',              label: 'Guide IPTV voyageurs',         hint: 'Instructions IPTV présentes et claires',           emoji: '📡' },
      { key: 'electromenager_cuisine',  label: 'Électroménager cuisine',       hint: 'Frigo, plaques, four, micro-ondes (plaque tournante), bouilloire', emoji: '🍳' },
      { key: 'chauffe_eau',             label: 'Chauffe-eau',                  hint: 'Eau chaude rapide, pas de fuite au ballon',        emoji: '🔥' },
      { key: 'wifi_debit',              label: 'Wifi + débit',                 hint: 'Connexion OK, mesure de débit (Mbps), couverture toutes pièces', emoji: '📶' },
    ],
  },
  {
    key: 'securite_acces',
    title: 'Sécurité & accès',
    emoji: '🔐',
    items: [
      { key: 'serrure_smartlock', label: 'Serrure / smart lock', hint: 'Ouverture fluide, piles smart lock, code fonctionnel', emoji: '🔑' },
      { key: 'boite_a_cles',      label: 'Boîte à clés',         hint: 'État, code, clés présentes à l’intérieur',             emoji: '🗝️' },
      { key: 'detecteur_fumee',   label: 'Détecteur de fumée',   hint: 'Présent, test bouton, piles',                          emoji: '🚨' },
      { key: 'extincteur',        label: 'Extincteur',           hint: 'Présent, goupille, date de validité',                  emoji: '🧯' },
      { key: 'electricite_sdb',   label: 'Électricité salle de bain', hint: 'Prises intactes, pas de câble apparent (SÉCURITÉ critique)', emoji: '⚡' },
    ],
  },
  {
    key: 'salle_de_bain',
    title: 'Salle de bain',
    emoji: '🚿',
    items: [
      { key: 'robinetterie_fuites', label: 'Robinetterie / fuites',  hint: 'Pression, gouttes, flexibles, siphons',  emoji: '🚰' },
      { key: 'joints_moisissures',  label: 'Joints / moisissures',   hint: 'Joints silicone noircis, carrelage',     emoji: '🦠' },
      { key: 'evacuations',         label: 'Évacuations',            hint: 'Douche, lavabo, WC — écoulement rapide', emoji: '🌀' },
      { key: 'murs_sdb',            label: 'Murs salle de bain',     hint: 'Dégradations esthétiques, peinture à retoucher', emoji: '🧱' },
    ],
  },
  {
    key: 'literie_mobilier',
    title: 'Literie & mobilier',
    emoji: '🛏️',
    items: [
      { key: 'matelas',          label: 'Matelas',            hint: 'Taches, affaissement, protège-matelas',  emoji: '🛏️' },
      { key: 'sommier',          label: 'Sommier',            hint: 'Lattes cassées, grincements, stabilité', emoji: '🪵' },
      { key: 'oreillers_linge',  label: 'Oreillers / linge',  hint: 'Quantité, état, propreté',               emoji: '🛌' },
      { key: 'cintres',          label: 'Cintres / rangements', hint: 'Nombre suffisant, état des armoires',  emoji: '🧥' },
      { key: 'canape',           label: 'Canapé',             hint: 'Taches, déchirures, coussins, assise',   emoji: '🛋️' },
      { key: 'rideaux',          label: 'Rideaux',            hint: 'Tringles, occultation, état du tissu',   emoji: '🪟' },
      { key: 'tables_chevet',    label: 'Tables de nuit / lampes', hint: 'Stabilité, menuiserie, ampoules', emoji: '🪑' },
    ],
  },
  {
    key: 'menuiseries_stores',
    title: 'Menuiseries & stores',
    emoji: '🪟',
    items: [
      { key: 'fenetres_reglages', label: 'Fenêtres / réglages', hint: 'Ouverture, fermeture, joints, poignées', emoji: '🪟' },
      { key: 'stores_salon',      label: 'Stores salon',        hint: 'Mécanisme, état du tissu',                emoji: '🪟' },
      { key: 'stores_chambre',    label: 'Stores chambre',      hint: 'Mécanisme, occultation',                  emoji: '🪟' },
      { key: 'menuiseries_div',   label: 'Menuiseries diverses', hint: 'Portes, placards, tablettes',           emoji: '🚪' },
    ],
  },
  {
    key: 'consommables',
    title: 'Consommables & présentation',
    emoji: '🧴',
    items: [
      { key: 'distrib_savon',     label: 'Distributeurs savon', hint: 'Présents, remplis, étiquetés',             emoji: '🧼' },
      { key: 'etiquettes_uniform', label: 'Étiquetage harmonisé', hint: 'Style uniforme sur tous les distributeurs', emoji: '🏷️' },
      { key: 'presentation_glob',  label: 'Présentation globale', hint: 'Cohérence visuelle des consommables et accessoires', emoji: '✨' },
    ],
  },
  {
    key: 'exterieur',
    title: 'Extérieur',
    emoji: '🌤️',
    items: [
      { key: 'balcon_terrasse', label: 'Balcon / terrasse', hint: 'Mobilier extérieur, garde-corps, propreté', emoji: '🪴' },
      { key: 'balcon_peinture', label: 'Peinture balcon',   hint: 'Retouches, écaillages, garde-corps',        emoji: '🎨' },
      { key: 'facade_entree',   label: 'Façade / entrée',   hint: 'Porte d’entrée, sonnette, éclairage palier', emoji: '🚪' },
    ],
  },
];

// ─── Inventaire chiffré (chantier 3 — CEO 2026-06-18) ────────────────────────
// Liste des items inventaires chiffrés (table propria_checkup_inventory).
// Quantité attendue par défaut = 6 (paramétrable par bien plus tard).
export type InventoryItem = {
  key: string;
  label: string;
  emoji: string;
  defaultExpected: number;
};

export const CHECKUP_INVENTORY_ITEMS: InventoryItem[] = [
  { key: 'assiettes',       label: 'Assiettes',         emoji: '🍽️', defaultExpected: 6 },
  { key: 'bols',            label: 'Bols',              emoji: '🥣', defaultExpected: 6 },
  { key: 'mugs',            label: 'Mugs',              emoji: '☕', defaultExpected: 6 },
  { key: 'verres',          label: 'Verres',            emoji: '🥛', defaultExpected: 6 },
  { key: 'verres_a_vin',    label: 'Verres à vin',      emoji: '🍷', defaultExpected: 6 },
  { key: 'fourchettes',     label: 'Fourchettes',       emoji: '🍴', defaultExpected: 6 },
  { key: 'couteaux',        label: 'Couteaux table',    emoji: '🔪', defaultExpected: 6 },
  { key: 'cuilleres',       label: 'Cuillères',         emoji: '🥄', defaultExpected: 6 },
  { key: 'petites_cuilleres', label: 'Petites cuillères', emoji: '🥄', defaultExpected: 6 },
];

export const CHECKUP_INVENTORY_KEYS = new Set(CHECKUP_INVENTORY_ITEMS.map((i) => i.key));

// ─── Mesures chiffrées (chantier 3) ──────────────────────────────────────────
// Liste des mesures attendues (table propria_checkup_measurements).
export type MeasurementItem = {
  key: string;
  label: string;
  emoji: string;
  unit: string;
  hint?: string;
};

export const CHECKUP_MEASUREMENT_ITEMS: MeasurementItem[] = [
  { key: 'wifi_debit_mbps', label: 'Débit wifi (Mbps)', emoji: '📶', unit: 'Mbps', hint: 'Test sur fast.com ou speedtest, depuis la pièce la plus éloignée' },
];

export const CHECKUP_MEASUREMENT_KEYS = new Set(CHECKUP_MEASUREMENT_ITEMS.map((i) => i.key));

/** Liste plate de tous les items (ordre d'affichage). */
export const ALL_CHECKUP_ITEMS: (CheckupItem & { sectionKey: string; sectionTitle: string })[] =
  CHECKUP_CHECKLIST.flatMap((s) =>
    s.items.map((i) => ({ ...i, sectionKey: s.key, sectionTitle: s.title })),
  );

/** Nombre total d'items à renseigner (soumission bloquée tant que < total). */
export const TOTAL_CHECKUP_ITEMS = ALL_CHECKUP_ITEMS.length;

/** Set des clés valides — garde-fou côté Server Action. */
export const CHECKUP_ITEM_KEYS = new Set(ALL_CHECKUP_ITEMS.map((i) => i.key));

/** Retrouve un item par sa clé (libellé pour descriptions de tâches, rapport…). */
export function findCheckupItem(key: string) {
  return ALL_CHECKUP_ITEMS.find((i) => i.key === key) ?? null;
}

export const CHECKUP_STATUS_META: Record<CheckupItemStatus, { label: string; icon: string }> = {
  ok:       { label: 'OK',       icon: '✅' },
  probleme: { label: 'Problème', icon: '⚠️' },
  na:       { label: 'N/A',      icon: '➖' },
};
