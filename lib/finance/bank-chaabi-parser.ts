import * as XLSX from 'xlsx';
import { createHash } from 'crypto';

/**
 * Parser des relevés bancaires Banque Populaire (Chaabi Bank).
 *
 * Format CSV :
 *   - Encoding : Latin-1 / ANSI
 *   - Séparateur : ;
 *   - Décimale : virgule
 *   - Séparateur milliers : espace ("1 299,00")
 *   - Colonnes : Date d'opération | Date Valeur | LIBELLE | DEBIT | CREDIT | Référence
 *
 * Format XLSX : mêmes colonnes, mais encoding UTF-8 propre + types natifs.
 *
 * Spécificités à gérer :
 *   - Lignes "(*)" en autorisation (Date Valeur = "-", DEBIT négatif) → is_pending=true
 *   - Plusieurs lignes peuvent partager la même Référence (virement + sa commission + sa TVA)
 *   - Anti-doublons : hash sur (account_id + operation_date + reference + montant + sens)
 */

export type ChaabiRawRow = {
  operation_date: string | null;  // ISO YYYY-MM-DD
  value_date: string | null;      // ISO YYYY-MM-DD ou null si "-"
  label: string;                   // libellé brut (UTF-8)
  reference: string | null;
  debit_mad: number | null;        // positif (ou négatif si pending "(*)")
  credit_mad: number | null;       // positif
  is_pending: boolean;             // true si "(*)" en autorisation
  raw_line_index: number;          // index original dans le fichier (1-based, sans en-tête)
};

export type ParseResult = {
  rows: ChaabiRawRow[];
  errors: string[];                // erreurs de parsing non bloquantes
  bank_code: 'chaabi';
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Convertit "1 299,00" → 1299.00 ; "1.299,00 MAD" → 1299.00 ; "" → null ; "-245,00" → -245.00 ; "(245,00)" → -245.00
 * Aussi tolère les nombres déjà parsés (XLSX) et divers formats de devises / séparateurs.
 */
function parseAmount(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (s === '' || s === '-') return null;

  // Détecter notation comptable négative : (120,50) → -120.50
  let isNegative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    isNegative = true;
    s = s.slice(1, -1).trim();
  } else if (s.startsWith('-')) {
    isNegative = true;
    s = s.slice(1).trim();
  }

  // Retirer devises courantes (MAD, DH, DHS, EUR, €) et espaces
  s = s.replace(/(?:MAD|DHS|DH|EUR|€|\$)/gi, '').trim();
  s = s.replace(/\s+/g, '');

  if (s === '' || s === '-') return null;

  // Gérer séparateurs de milliers et décimaux
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');

  if (hasDot && hasComma) {
    if (s.indexOf('.') < s.indexOf(',')) {
      // "1.299,00" -> point = milliers, virgule = décimale
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // "1,299.00" -> virgule = milliers, point = décimale
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return isNegative ? -Math.abs(n) : n;
}

/**
 * Convertit "02-06-2026" ou "02/06/2026" → "2026-06-02" ; "" / "-" → null
 * Aussi tolère les serial dates Excel (number) ou les Date objects.
 */
function parseDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  // XLSX peut donner un Date object si cellType='d'
  if (raw instanceof Date) {
    return raw.toISOString().slice(0, 10);
  }
  // XLSX peut donner un serial number (jours depuis 1900-01-01)
  if (typeof raw === 'number') {
    const epoch = Date.UTC(1899, 11, 30);
    const ms = raw * 24 * 60 * 60 * 1000;
    return new Date(epoch + ms).toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (s === '' || s === '-') return null;
  // Format Chaabi : DD-MM-YYYY ou DD/MM/YYYY (avec heure optionnelle)
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  // Format ISO déjà
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  return null;
}

/**
 * Détecte les opérations en attente (suffixe "(*)" dans le libellé Chaabi).
 */
function detectPending(label: string, valueDate: string | null): boolean {
  return /\(\*\)/.test(label) || valueDate == null;
}

/**
 * Construit un hash unique pour anti-doublons.
 * Une ligne est identifiée par : compte + date d'opération + référence + montant + sens.
 */
/**
 * Anti-doublons d'import bancaire — système robuste à 2 niveaux
 * (CEO 2026-06-17, refonte profonde).
 *
 * Problème historique :
 *   Chaabi reformatte le libellé entre "pending" (autorisation) et "validé".
 *   Ex : ACHAT PAR CARTE LES EAUX MINERALES D OUL (*)
 *        → ACHAT PAR CARTE DE PAIEMENT CHEZ LES EAUX MINERALES D O
 *   Date d'opération aussi décalée (02/06 → 04/06).
 *   → Même mouvement réel stocké en double, hash différent à chaque relevé.
 *
 * Solution :
 *   1. Si la transaction porte une **référence bancaire** → signature stable.
 *      hash = sha256(account|date|amount|sens|ref_norm)
 *   2. Pour les **achats carte** (pas de référence, libellé instable),
 *      on extrait un fingerprint marchand stable et on hashe par mois
 *      (date au jour près est instable, le mois suffit pour dédup carte).
 *      hash = sha256(account|year-month|amount|sens|merchant_fingerprint)
 *   3. Sinon (commissions, virements internes sans réf) → on garde
 *      la date + label normalisé tronqué.
 *
 * Logique pending → validé gérée séparément côté server action (UPSERT).
 */

function normalizeRef(ref: string | null | undefined): string {
  if (!ref) return '';
  return ref.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

/**
 * Extrait la référence COMPLÈTE depuis le libellé Chaabi.
 *
 * ⚠️ Critique (CEO 2026-06-17) : la colonne `Référence` du CSV/XLSX Chaabi
 * est TRONQUÉE aux 6 derniers chiffres (parfois sans le zéro de tête perdu
 * en numérique), tandis que le libellé porte la référence complète.
 *
 * Exemples observés :
 *   Label "VIR. RECU DE MLE-ILHAM-TELKI REF 90100114013951 DE BMCE"
 *     → colonne CSV "13951" / BDD "013951"
 *     → extracted from label : "90100114013951" (la VRAIE ref stable)
 *
 *   Label "CHEQUE N 0835836 TIRE SUR BMCI"
 *     → colonne CSV "835836"
 *     → extracted from label : "0835836"
 *
 * Sans cette extraction, le même mouvement importé via CSV vs XLSX produit
 * deux hashes différents → faux négatifs dédup.
 *
 * Patterns reconnus :
 *   - "REF 12345..." (virements, commissions)
 *   - "CHEQUE N 12345..." (chèques)
 *   - "N° 12345..." (variantes)
 */
export function extractRefFromLabel(label: string): string | null {
  if (!label) return null;
  // Pattern principal : "REF <digits>" ou "REF: <digits>"
  let m = label.match(/\bREF[:.\s]+([A-Za-z0-9]+)/i);
  if (m) return m[1];
  // Pattern chèque : "CHEQUE N <digits>" ou "N° <digits>"
  m = label.match(/\bCHEQUE\s+N[°:.\s]+(\d+)/i);
  if (m) return m[1];
  m = label.match(/\bN[°:.\s]+(\d+)/i);
  if (m) return m[1];
  return null;
}

function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents
    .replace(/[-_.,;:'"()/\\>*]/g, ' ')                 // ponctuation → espace (inclut > et *)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extrait un "fingerprint" stable du marchand pour un achat carte.
 * Format pending  : "ACHAT PAR CARTE   {MARCHAND}     >VILLE    MA (*)"
 * Format validé   : "ACHAT PAR CARTE DE PAIEMENT CHEZ {MARCHAND}"
 *
 * Les 2 formats produisent le même fingerprint (15 premiers chars du
 * marchand normalisé), donc les 2 lignes hashent identique → dédup.
 * Retourne null si le label n'est pas un achat carte reconnu.
 */
function extractCardMerchantFingerprint(label: string): string | null {
  const norm = normalizeLabel(label);
  // Pattern validé : "achat par carte de paiement chez X"
  let m = norm.match(/^achat par carte de paiement chez\s+(.+)$/);
  if (m) return m[1].slice(0, 15).trim();
  // Pattern pending : "achat par carte X  ville ma" — extraire jusqu'au premier indicateur de ville
  m = norm.match(/^achat par carte\s+(.+)$/);
  if (m) {
    // Coupe à 15 premiers chars du marchand
    return m[1].slice(0, 15).trim();
  }
  return null;
}

export function computeDedupHash(input: {
  account_id: string;
  operation_date: string;
  reference: string | null;
  amount: number;
  is_debit: boolean;
  label: string;
}): string {
  // ⚠️ ORDRE CRITIQUE (CEO 2026-06-17) :
  // Pour les achats carte, on PRIORISE le fingerprint marchand sur la
  // référence. Chaabi attribue une référence UNIQUEMENT à la version
  // validée (pas à la pending) — utiliser la ref ferait diverger pending
  // et validée alors que c'est le même mouvement réel.
  // Le card merchant fingerprint + groupage mensuel garantit la dédup.

  const refNorm = normalizeRef(input.reference);
  const absAmountStr = Math.abs(input.amount).toFixed(2);

  // Niveau 1 : achat carte → fingerprint marchand + mois + ref optionnelle
  //
  // Si on a une ref (cas validé), elle discrimine 2 achats distincts du
  // même marchand au même montant le même mois (ex : 2 achats ANCFCC à
  // 100 MAD en avril). La pending (pas de ref) garde son hash sans ref.
  //
  // La fusion pending → validée est gérée par confirmImportAction qui
  // détecte le match via le card fingerprint et UPDATE la pending plutôt
  // que créer un doublon.
  const cardMerchant = extractCardMerchantFingerprint(input.label);
  if (cardMerchant) {
    const yearMonth = input.operation_date.slice(0, 7);
    const tail = refNorm ? `card:${cardMerchant}#${refNorm}` : `card:${cardMerchant}`;
    const key = [
      input.account_id,
      yearMonth,
      absAmountStr,
      input.is_debit ? 'D' : 'C',
      tail,
    ].join('|');
    return createHash('sha256').update(key).digest('hex');
  }

  // Niveau 2 : référence bancaire (virements, chèques, frais avec ref)
  if (refNorm) {
    const key = [
      input.account_id,
      input.operation_date,
      absAmountStr,
      input.is_debit ? 'D' : 'C',
      `ref:${refNorm}`,
    ].join('|');
    return createHash('sha256').update(key).digest('hex');
  }

  // Niveau 3 : fallback sur label normalisé tronqué
  const key = [
    input.account_id,
    input.operation_date,
    absAmountStr,
    input.is_debit ? 'D' : 'C',
    `lbl:${normalizeLabel(input.label).slice(0, 80)}`,
  ].join('|');
  return createHash('sha256').update(key).digest('hex');
}

// ─── Parser XLSX ──────────────────────────────────────────────────────────

export function parseChaabiXLSX(buffer: ArrayBuffer | Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: buffer instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], errors: ['Aucune feuille trouvée dans le fichier XLSX'], bank_code: 'chaabi' };
  }
  const sheet = workbook.Sheets[sheetName];
  // En matrix : 1 sous-tableau par ligne, 1 cellule par colonne
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true });
  return parseMatrix(matrix);
}

// ─── Parser CSV ───────────────────────────────────────────────────────────

/**
 * Parse un CSV Chaabi (encoding déjà converti en UTF-8 côté caller).
 * Pour gérer Latin-1, le caller doit décoder le buffer avec TextDecoder('iso-8859-1') ou similaire.
 */
export function parseChaabiCSV(text: string): ParseResult {
  // Détection ligne par ligne, séparateur ';'
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const matrix: unknown[][] = lines.map(line => {
    // Split sur ; en gérant les guillemets et quotes échappées ("") selon RFC 4180
    const cells: string[] = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          current += '"';
          i++; // saute le second quote
          continue;
        }
        inQuote = !inQuote;
        continue;
      }
      if (ch === ';' && !inQuote) {
        cells.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    cells.push(current);
    return cells;
  });
  return parseMatrix(matrix);
}

// ─── Parser commun (matrix) ───────────────────────────────────────────────

function parseMatrix(matrix: unknown[][]): ParseResult {
  const errors: string[] = [];
  const rows: ChaabiRawRow[] = [];

  if (matrix.length === 0) {
    return { rows, errors: ['Fichier vide'], bank_code: 'chaabi' };
  }

  // Détecter la ligne d'en-tête. CEO 2026-07-13 : on scanne les 15 premières
  // lignes (au lieu de 5) parce que Banque Populaire ajoute parfois des blocs
  // d'en-tête (RIB, période, RIB IBAN, totaux) avant l'en-tête tabulaire.
  // On accepte aussi des variantes de nom de colonne : "libellé", "libelle",
  // "libellé opération", "libelle operation".
  let headerIdx = -1;
  const HEADER_SCAN = 15;
  const normaliseCell = (v: unknown) =>
    String(v ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, ''); // supprime les accents pour matcher "libellé"/"libelle"
  for (let i = 0; i < Math.min(HEADER_SCAN, matrix.length); i++) {
    const row = matrix[i];
    if (!row) continue;
    const cells = row.map(normaliseCell);
    // Il faut au moins 4 colonnes reconnaissables : date, libellé, débit, crédit.
    // On accepte n'importe quelle position de colonne (pas juste col 0 et 2)
    // pour être tolérant à un ordre légèrement différent.
    const hasDate = cells.some(c => c.includes('date'));
    const hasLibelle = cells.some(c => c.includes('libelle') || c.includes('designation') || c.includes('description'));
    const hasDebit = cells.some(c => c.includes('debit'));
    const hasCredit = cells.some(c => c.includes('credit'));
    if (hasDate && hasLibelle && hasDebit && hasCredit) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) {
    // Message enrichi : on donne un aperçu des 3 premières lignes lues pour
    // que le CEO/Finance comprenne pourquoi le parseur n'a pas trouvé l'entête
    // (encoding, séparateur, colonnes renommées par la banque).
    const preview = matrix.slice(0, 3)
      .map((r, i) => `L${i + 1}: ${(r ?? []).slice(0, 6).map(c => String(c ?? '').slice(0, 30)).join(' | ')}`)
      .join(' — ');
    errors.push(
      `En-tête introuvable dans les ${HEADER_SCAN} premières lignes. ` +
      'Colonnes attendues (dans n\'importe quel ordre) : Date d\'opération, Date Valeur, LIBELLE, DEBIT, CREDIT, Référence. ' +
      `Aperçu du fichier : ${preview}`
    );
    return { rows, errors, bank_code: 'chaabi' };
  }

  // Résolution dynamique des index de colonnes selon la ligne d'en-tête détectée
  const headerCells = (matrix[headerIdx] ?? []).map(normaliseCell);

  let opDateIdx = headerCells.findIndex(c => c.includes('operation') || (c.includes('date') && !c.includes('valeur')));
  if (opDateIdx === -1) opDateIdx = headerCells.findIndex(c => c.includes('date'));
  if (opDateIdx === -1) opDateIdx = 0;

  let valDateIdx = headerCells.findIndex(c => c.includes('valeur'));
  if (valDateIdx === -1) valDateIdx = 1;

  let labelIdx = headerCells.findIndex(c => c.includes('libelle') || c.includes('designation') || c.includes('description'));
  if (labelIdx === -1) labelIdx = 2;

  let debitIdx = headerCells.findIndex(c => c.includes('debit'));
  if (debitIdx === -1) debitIdx = 3;

  let creditIdx = headerCells.findIndex(c => c.includes('credit'));
  if (creditIdx === -1) creditIdx = 4;

  let refIdx = headerCells.findIndex(c => c.includes('reference') || c.includes('ref'));
  if (refIdx === -1) refIdx = 5;

  // Parcourir les lignes de données
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.length === 0) continue;

    const operationRaw = row[opDateIdx];
    const valueRaw = row[valDateIdx];
    const labelRaw = row[labelIdx];
    const debitRaw = row[debitIdx];
    const creditRaw = row[creditIdx];
    const refRaw = row[refIdx];

    // Ignorer les lignes vides ou récap (solde initial, solde reporté, etc.)
    const labelStr = String(labelRaw ?? '').trim();
    if (!labelStr) continue;
    if (/^(ANCIEN SOLDE|NOUVEAU SOLDE|SOLDE A REPORTER|SOLDE REPORT)/i.test(labelStr)) continue;

    const operation_date = parseDate(operationRaw);
    const value_date = parseDate(valueRaw);
    const debit_mad = parseAmount(debitRaw);
    const credit_mad = parseAmount(creditRaw);
    const refColumn = (refRaw == null || String(refRaw).trim() === '' || String(refRaw).trim() === '-')
      ? null
      : String(refRaw).trim();
    // ⚠️ La colonne CSV `Référence` est tronquée (6 derniers chars max) par
    // Chaabi. Pour avoir un hash de dédup stable, on extrait la ref COMPLÈTE
    // depuis le libellé quand c'est possible (CEO 2026-06-17, fix import).
    const refFromLabel = extractRefFromLabel(labelStr);
    const reference = refFromLabel ?? refColumn;

    if (!operation_date) {
      errors.push(`Ligne ${i + 1} : date d'opération invalide (${operationRaw})`);
      continue;
    }

    if (debit_mad == null && credit_mad == null) {
      errors.push(`Ligne ${i + 1} : ni débit ni crédit renseigné (${labelStr})`);
      continue;
    }

    const is_pending = detectPending(labelStr, value_date);

    rows.push({
      operation_date,
      value_date,
      label: labelStr,
      reference,
      debit_mad,
      credit_mad,
      is_pending,
      raw_line_index: i - headerIdx,
    });
  }

  return { rows, errors, bank_code: 'chaabi' };
}
