import 'server-only';
import * as XLSX from 'xlsx';
import type {
  AccompanyingPerson,
  PoliceRecord,
  PoliceRecordGender,
  PoliceRecordIdType,
  PoliceRecordMotif,
  PoliceRecordSource,
  PoliceRecordStatus,
} from './police-records';

/**
 * Génère un fichier Excel récapitulatif hebdomadaire des fiches de police.
 *
 * Format basé sur docs/propria/fiche-police-format.md § 7. Étendu côté CEO en
 * 2 feuilles :
 *  - Feuille 1 "Voyageurs" : 1 ligne par voyageur (chef + accompagnants
 *    flattenés). Permet de filtrer/trier par nationalité, statut, bien, etc.
 *  - Feuille 2 "Stats" : agrégats période, par statut, par nationalité,
 *    par bien, ratio marocains vs étrangers.
 *
 * Style :
 *  - En-têtes en gras (XLSX cell style).
 *  - Largeur colonnes auto-ajustée via `!cols`.
 *  - Feuille 1 freezée sur la 1ère ligne.
 *
 * @returns Buffer du fichier XLSX (à envoyer en réponse HTTP ou stocker).
 */
export function renderRecapWeeklyXlsx(opts: {
  records: Array<
    PoliceRecord & {
      property_name?: string | null;
      unit_label?: string | null;
    }
  >;
  weekStart: string; // YYYY-MM-DD
  weekEnd: string; // YYYY-MM-DD
}): Buffer {
  const { records, weekStart, weekEnd } = opts;

  const workbook = XLSX.utils.book_new();
  const voyageursSheet = buildVoyageursSheet(records);
  const statsSheet = buildStatsSheet(records, weekStart, weekEnd);

  XLSX.utils.book_append_sheet(workbook, voyageursSheet, 'Voyageurs');
  XLSX.utils.book_append_sheet(workbook, statsSheet, 'Stats');

  const buf = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    cellStyles: true,
  }) as Buffer;
  return buf;
}

// -----------------------------------------------------------------------------
// Feuille 1 : Voyageurs (1 ligne par personne)
// -----------------------------------------------------------------------------

const VOYAGEUR_HEADERS = [
  'N° fiche',
  'Bien',
  'Unité',
  'Statut fiche',
  'Date arrivée bien',
  'Date départ prévu',
  'Type voyageur',
  'Relation',
  'Nom',
  'Prénom',
  'Sexe',
  'Date naissance',
  'Lieu naissance',
  'Nationalité',
  'Profession',
  'Type pièce',
  'N° pièce',
  'Pays résidence',
  'Adresse résidence',
  'Motif séjour',
  'Date arrivée Maroc',
] as const;

type VoyageurRow = Record<(typeof VOYAGEUR_HEADERS)[number], string | number>;

function buildVoyageursSheet(
  records: Array<
    PoliceRecord & {
      property_name?: string | null;
      unit_label?: string | null;
    }
  >,
): XLSX.WorkSheet {
  const rows: VoyageurRow[] = [];

  for (const r of records) {
    const ref = `FP-${r.id.slice(0, 8).toUpperCase()}`;
    const propName = r.property_name ?? '';
    const unit = r.unit_label ?? '';
    const status = statusLabel(r.status);
    const arrival = r.arrival_date_property ?? '';
    const departure = r.expected_departure_date ?? '';
    const motif = motifLabel(r.motif_sejour);
    const arrivalMa = r.arrival_date_morocco ?? '';

    // Chef de famille
    rows.push({
      'N° fiche': ref,
      Bien: propName,
      Unité: unit,
      'Statut fiche': status,
      'Date arrivée bien': arrival,
      'Date départ prévu': departure,
      'Type voyageur': 'Chef',
      Relation: '',
      Nom: (r.head_last_name ?? '').toUpperCase(),
      Prénom: r.head_first_name ?? '',
      Sexe: genderLabel(r.head_gender),
      'Date naissance': r.head_birth_date ?? '',
      'Lieu naissance': r.head_birth_place ?? '',
      Nationalité: r.head_nationality ?? '',
      Profession: r.head_profession ?? '',
      'Type pièce': idTypeLabel(r.head_id_type),
      'N° pièce': r.head_id_number ?? '',
      'Pays résidence': r.head_residence_country ?? '',
      'Adresse résidence': r.head_residence_address ?? '',
      'Motif séjour': motif,
      'Date arrivée Maroc': arrivalMa,
    });

    // Accompagnants
    for (const p of r.accompanying_persons ?? []) {
      rows.push({
        'N° fiche': ref,
        Bien: propName,
        Unité: unit,
        'Statut fiche': status,
        'Date arrivée bien': arrival,
        'Date départ prévu': departure,
        'Type voyageur': 'Accompagnant',
        Relation: p.relation ?? '',
        Nom: (p.last_name ?? '').toUpperCase(),
        Prénom: p.first_name ?? '',
        Sexe: '',
        'Date naissance': p.birth_date ?? '',
        'Lieu naissance': '',
        Nationalité: p.nationality ?? '',
        Profession: '', // vide pour accompagnant
        'Type pièce': idTypeLabel(p.id_type ?? null),
        'N° pièce': p.id_number ?? '',
        'Pays résidence': '', // vide pour accompagnant
        'Adresse résidence': '',
        'Motif séjour': motif,
        'Date arrivée Maroc': arrivalMa,
      });
    }
  }

  // Construction de la feuille
  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: [...VOYAGEUR_HEADERS],
  });

  // Header en gras
  applyHeaderStyle(sheet, VOYAGEUR_HEADERS.length);

  // Largeurs colonnes auto-ajustées
  sheet['!cols'] = computeColWidths(rows, VOYAGEUR_HEADERS as unknown as string[]);

  // Freeze 1ère ligne
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  // xlsx ne lit pas '!freeze' directement, mais '!views' oui :
  (sheet as XLSX.WorkSheet & { '!views'?: unknown[] })['!views'] = [
    { state: 'frozen', ySplit: 1, xSplit: 0, topLeftCell: 'A2', activePane: 'bottomLeft' },
  ];

  return sheet;
}

// -----------------------------------------------------------------------------
// Feuille 2 : Stats agrégées
// -----------------------------------------------------------------------------

function buildStatsSheet(
  records: PoliceRecord[],
  weekStart: string,
  weekEnd: string,
): XLSX.WorkSheet {
  const aoa: unknown[][] = [];

  // Sec 1 : Période
  aoa.push(['Période']);
  aoa.push([`Du ${formatDateFr(weekStart)} au ${formatDateFr(weekEnd)}`]);
  aoa.push([]);

  // Sec 2 : Totaux
  const totalRecords = records.length;
  const totalTravelers = records.reduce(
    (sum, r) => sum + (r.total_persons_count ?? 1),
    0,
  );
  const distinctProperties = new Set(
    records.map((r) => r.property_id).filter(Boolean),
  ).size;

  aoa.push(['Totaux']);
  aoa.push(['Nb fiches', totalRecords]);
  aoa.push(['Nb voyageurs', totalTravelers]);
  aoa.push(['Nb biens concernés', distinctProperties]);
  aoa.push([]);

  // Sec 3 : Par statut
  aoa.push(['Par statut']);
  aoa.push(['Statut', 'Nb fiches']);
  const statusCounts = countBy(records, (r) => r.status);
  const allStatuses: PoliceRecordStatus[] = [
    'draft',
    'complete',
    'submitted',
    'archived',
  ];
  for (const s of allStatuses) {
    aoa.push([statusLabel(s), statusCounts.get(s) ?? 0]);
  }
  aoa.push([]);

  // Sec 4 : Par nationalité (chef + accompagnants tous comptés)
  aoa.push(['Par nationalité (tous voyageurs)']);
  aoa.push(['Nationalité', 'Nb voyageurs', '%']);
  const natCounts = new Map<string, number>();
  let natTotal = 0;
  for (const r of records) {
    if (r.head_nationality) {
      natCounts.set(
        r.head_nationality,
        (natCounts.get(r.head_nationality) ?? 0) + 1,
      );
      natTotal += 1;
    }
    for (const p of r.accompanying_persons ?? []) {
      if (p.nationality) {
        natCounts.set(p.nationality, (natCounts.get(p.nationality) ?? 0) + 1);
        natTotal += 1;
      }
    }
  }
  const natSorted = Array.from(natCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [nat, count] of natSorted) {
    aoa.push([
      nat,
      count,
      natTotal > 0 ? `${((count / natTotal) * 100).toFixed(1)}%` : '0.0%',
    ]);
  }
  if (natSorted.length === 0) {
    aoa.push(['(aucune nationalité renseignée)', 0, '0.0%']);
  }
  aoa.push([]);

  // Sec 5 : Par bien
  aoa.push(['Par bien']);
  aoa.push(['Bien', 'Nb fiches', 'Nb voyageurs']);
  const propMap = new Map<
    string,
    { name: string; records: number; travelers: number }
  >();
  for (const r of records) {
    const key = r.property_id ?? '(sans bien)';
    const name =
      ((r as unknown as { property_name?: string | null }).property_name ?? key) || '(sans bien)';
    const cur = propMap.get(key) ?? { name, records: 0, travelers: 0 };
    cur.records += 1;
    cur.travelers += r.total_persons_count ?? 1;
    propMap.set(key, cur);
  }
  const propSorted = Array.from(propMap.values()).sort(
    (a, b) => b.records - a.records,
  );
  for (const p of propSorted) {
    aoa.push([p.name, p.records, p.travelers]);
  }
  if (propSorted.length === 0) {
    aoa.push(['(aucun bien)', 0, 0]);
  }
  aoa.push([]);

  // Sec 6 : Marocains vs étrangers
  aoa.push(['Marocains vs étrangers (tous voyageurs)']);
  aoa.push(['Catégorie', 'Nb voyageurs', '%']);
  const isMoroccan = (nat: string | null | undefined): boolean => {
    if (!nat) return false;
    const n = nat.trim().toLowerCase();
    return (
      n === 'ma' ||
      n === 'mar' ||
      n === 'maroc' ||
      n === 'morocco' ||
      n === 'marocaine' ||
      n === 'marocain' ||
      n === 'moroccan'
    );
  };
  let nbMoroccan = 0;
  let nbForeign = 0;
  let nbUnknown = 0;
  for (const r of records) {
    const headNat = r.head_nationality;
    if (!headNat) nbUnknown += 1;
    else if (isMoroccan(headNat)) nbMoroccan += 1;
    else nbForeign += 1;
    for (const p of r.accompanying_persons ?? []) {
      if (!p.nationality) nbUnknown += 1;
      else if (isMoroccan(p.nationality)) nbMoroccan += 1;
      else nbForeign += 1;
    }
  }
  const denom = nbMoroccan + nbForeign + nbUnknown;
  const pct = (n: number) =>
    denom > 0 ? `${((n / denom) * 100).toFixed(1)}%` : '0.0%';
  aoa.push(['Marocains', nbMoroccan, pct(nbMoroccan)]);
  aoa.push(['Étrangers', nbForeign, pct(nbForeign)]);
  aoa.push(['Non renseignée', nbUnknown, pct(nbUnknown)]);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!cols'] = [{ wch: 38 }, { wch: 16 }, { wch: 10 }];

  // Style des en-têtes de section + colonne 1
  const sectionRows = new Set<number>();
  aoa.forEach((row, idx) => {
    if (row.length === 1 && typeof row[0] === 'string') {
      sectionRows.add(idx);
    }
  });
  for (const r of sectionRows) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    const cell = sheet[addr];
    if (cell) {
      cell.s = { font: { bold: true, sz: 12 } };
    }
  }

  return sheet;
}

// -----------------------------------------------------------------------------
// Helpers labels + agrégats
// -----------------------------------------------------------------------------

function statusLabel(s: PoliceRecordStatus): string {
  switch (s) {
    case 'draft':
      return 'Brouillon';
    case 'complete':
      return 'Complète';
    case 'submitted':
      return 'Déposée';
    case 'archived':
      return 'Archivée';
    default:
      return s;
  }
}

function motifLabel(m: PoliceRecordMotif | null): string {
  switch (m) {
    case 'tourisme':
      return 'Tourisme';
    case 'affaires':
      return 'Affaires';
    case 'famille':
      return 'Famille';
    case 'transit':
      return 'Transit';
    case 'autre':
      return 'Autre';
    default:
      return '';
  }
}

function genderLabel(g: PoliceRecordGender | null): string {
  if (g === 'M') return 'Homme';
  if (g === 'F') return 'Femme';
  if (g === 'autre') return 'Autre';
  return '';
}

function idTypeLabel(t: PoliceRecordIdType | null | undefined): string {
  if (t === 'cin') return 'CIN';
  if (t === 'passport') return 'Passeport';
  if (t === 'other') return 'Autre';
  return '';
}

// (data_source label gardé volontairement non utilisé en V1, l'agent UI peut
// l'exposer via une colonne supplémentaire s'il le souhaite.)
export function dataSourceLabel(s: PoliceRecordSource): string {
  switch (s) {
    case 'hostaway_portal':
      return 'Hostaway';
    case 'manual_checkin':
      return 'Saisie manuelle';
    case 'whatsapp':
      return 'WhatsApp';
    case 'unknown':
    default:
      return 'Inconnu';
  }
}

function formatDateFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
}

function countBy<T, K>(arr: T[], keyFn: (x: T) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const it of arr) {
    const k = keyFn(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// -----------------------------------------------------------------------------
// Style helpers
// -----------------------------------------------------------------------------

function applyHeaderStyle(sheet: XLSX.WorkSheet, nbCols: number): void {
  for (let c = 0; c < nbCols; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = sheet[addr];
    if (cell) {
      cell.s = {
        font: { bold: true },
        alignment: { horizontal: 'left', vertical: 'center' },
      };
    }
  }
}

/**
 * Calcule des largeurs de colonnes raisonnables (en caractères) basées sur la
 * longueur max du contenu + en-tête. Plafonné à 40 pour éviter les colonnes
 * démesurées (ex. adresses).
 */
function computeColWidths(
  rows: Array<Record<string, string | number>>,
  headers: string[],
): Array<{ wch: number }> {
  const widths = headers.map((h) => Math.max(8, h.length + 2));
  for (const row of rows) {
    headers.forEach((h, i) => {
      const v = row[h];
      const len = v === null || v === undefined ? 0 : String(v).length;
      if (len + 2 > widths[i]!) widths[i] = Math.min(40, len + 2);
    });
  }
  return widths.map((w) => ({ wch: w }));
}
