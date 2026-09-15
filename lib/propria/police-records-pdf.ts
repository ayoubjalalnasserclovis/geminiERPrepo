import 'server-only';
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import type {
  AccompanyingPerson,
  PoliceRecord,
  PoliceRecordGender,
  PoliceRecordIdType,
  PoliceRecordMotif,
} from './police-records';

/**
 * Génère un PDF A4 portrait d'une fiche individuelle de police marocaine.
 *
 * Format inspiré des standards hôteliers marocains (Mansour, Mamounia, riads
 * indépendants) + article R.611-42 CESEDA. Voir docs/propria/fiche-police-format.md
 * § 6 pour le gabarit complet et les décisions CEO 2026-06-19.
 *
 * Décisions appliquées :
 *  - 1 PDF par famille (chef + tableau accompagnants).
 *  - Monochrome, qualité notaire / impression bureau standard.
 *  - En-tête avec nom du bien + référence unique FP-YYYY-NNNN.
 *  - Pied avec zones de signature voyageur + hébergeur + mention CNDP.
 *  - Si un champ est null/vide -> "—".
 *  - Si aucun accompagnant -> section masquée.
 *
 * Le helper est volontairement autonome (aucun appel BDD). L'appelant fournit
 * `propertyName` / `unitLabel` / `referenceNumber` ; il est responsable de
 * résoudre ces valeurs depuis `properties` / `propria_units` / un compteur.
 *
 * @returns Uint8Array du PDF (streamable / téléchargeable).
 */
export async function renderFichePolicePdf(opts: {
  record: PoliceRecord;
  propertyName?: string | null;
  unitLabel?: string | null;
  /** ex. "FP-2026-0042". Optionnel, fallback = 8 premiers chars de l'id. */
  referenceNumber?: string | null;
}): Promise<Uint8Array> {
  const { record, propertyName, unitLabel } = opts;
  const reference =
    opts.referenceNumber && opts.referenceNumber.trim().length > 0
      ? opts.referenceNumber.trim()
      : `FP-${record.id.slice(0, 8).toUpperCase()}`;

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Fiche de police - ${reference}`);
  pdf.setAuthor('Stoniz Propria');
  pdf.setSubject('Fiche individuelle de police voyageur');
  pdf.setCreator('Stoniz ERP');
  pdf.setProducer('Stoniz ERP - pdf-lib');

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // A4 portrait : 595.28 x 841.89 pt
  const page = pdf.addPage([595.28, 841.89]);
  const ctx: DrawCtx = {
    page,
    font,
    fontBold,
    width: page.getWidth(),
    height: page.getHeight(),
    margin: 40,
    cursorY: page.getHeight() - 40,
  };

  drawHeader(ctx, reference);
  drawHebergement(ctx, record, propertyName ?? null, unitLabel ?? null);
  drawChefDeFamille(ctx, record);
  drawPieceIdentite(ctx, record);
  drawResidence(ctx, record);
  if ((record.accompanying_persons?.length ?? 0) > 0) {
    drawAccompagnants(ctx, record.accompanying_persons);
  }
  drawFooter(ctx, record);

  return pdf.save();
}

// -----------------------------------------------------------------------------
// Helpers d'affichage (exportés pour usage UI / tests)
// -----------------------------------------------------------------------------

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  // Format YYYY-MM-DD attendu ; fallback : on tente Date() puis on découpe.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatGender(g: PoliceRecordGender | null | undefined): string {
  if (g === 'M') return 'Homme';
  if (g === 'F') return 'Femme';
  if (g === 'autre') return 'Autre';
  return EM_DASH;
}

export function formatMotif(m: PoliceRecordMotif | null | undefined): string {
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
      return EM_DASH;
  }
}

function formatIdType(t: PoliceRecordIdType | null | undefined): string {
  if (t === 'cin') return 'CIN';
  if (t === 'passport') return 'Passeport';
  if (t === 'other') return 'Autre';
  return EM_DASH;
}

function formatStr(s: string | null | undefined): string {
  if (s === null || s === undefined) return EM_DASH;
  const t = s.trim();
  return t.length > 0 ? t : EM_DASH;
}

// -----------------------------------------------------------------------------
// Drawing primitives
// -----------------------------------------------------------------------------

const EM_DASH = '—';
const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_BAND = rgb(0.9, 0.9, 0.9);
const COLOR_THIN = rgb(0.7, 0.7, 0.7);

type DrawCtx = {
  page: PDFPage;
  font: PDFFont;
  fontBold: PDFFont;
  width: number;
  height: number;
  margin: number;
  cursorY: number; // descend au fur et à mesure
};

/**
 * Helvetica de pdf-lib ne supporte que WinAnsi (Latin-1). On nettoie les
 * caractères hors plage : em dash conservé (Latin-1 0x97), autres chars
 * exotiques convertis en équivalents ASCII ou en '?'.
 */
function sanitize(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code === 0x2014 || code === 0x2013) {
      out += '—';
      continue;
    }
    if (code <= 0xff) {
      out += ch;
      continue;
    }
    if (ch === '’' || ch === '‘') {
      out += "'";
      continue;
    }
    if (ch === '“' || ch === '”') {
      out += '"';
      continue;
    }
    if (ch === ' ') {
      out += ' ';
      continue;
    }
    out += '?';
  }
  return out;
}

function drawText(
  ctx: DrawCtx,
  text: string,
  opts: {
    x: number;
    y: number;
    size: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
  },
) {
  ctx.page.drawText(sanitize(text), {
    x: opts.x,
    y: opts.y,
    size: opts.size,
    font: opts.bold ? ctx.fontBold : ctx.font,
    color: opts.color ?? COLOR_BLACK,
  });
}

function drawHLine(ctx: DrawCtx, y: number, color = COLOR_BLACK, thickness = 0.5) {
  ctx.page.drawLine({
    start: { x: ctx.margin, y },
    end: { x: ctx.width - ctx.margin, y },
    thickness,
    color,
  });
}

function drawBand(ctx: DrawCtx, y: number, height: number) {
  ctx.page.drawRectangle({
    x: ctx.margin,
    y: y - height + 2,
    width: ctx.width - 2 * ctx.margin,
    height,
    color: COLOR_BAND,
  });
}

function sectionTitle(ctx: DrawCtx, label: string) {
  ctx.cursorY -= 6;
  drawBand(ctx, ctx.cursorY, 14);
  drawText(ctx, label, {
    x: ctx.margin + 6,
    y: ctx.cursorY - 9,
    size: 11,
    bold: true,
  });
  ctx.cursorY -= 18;
}

function row2(
  ctx: DrawCtx,
  left: { label: string; value: string },
  right: { label: string; value: string } | null,
) {
  const colW = (ctx.width - 2 * ctx.margin) / 2;
  drawText(ctx, left.label, {
    x: ctx.margin,
    y: ctx.cursorY,
    size: 8,
    bold: true,
  });
  drawText(ctx, left.value, {
    x: ctx.margin + 90,
    y: ctx.cursorY,
    size: 9,
  });
  if (right) {
    drawText(ctx, right.label, {
      x: ctx.margin + colW,
      y: ctx.cursorY,
      size: 8,
      bold: true,
    });
    drawText(ctx, right.value, {
      x: ctx.margin + colW + 90,
      y: ctx.cursorY,
      size: 9,
    });
  }
  ctx.cursorY -= 14;
}

function row1Wide(ctx: DrawCtx, label: string, value: string) {
  drawText(ctx, label, {
    x: ctx.margin,
    y: ctx.cursorY,
    size: 8,
    bold: true,
  });
  drawText(ctx, value, {
    x: ctx.margin + 90,
    y: ctx.cursorY,
    size: 9,
  });
  ctx.cursorY -= 14;
}

// -----------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------

function drawHeader(ctx: DrawCtx, reference: string) {
  drawText(ctx, 'STONIZ', {
    x: ctx.margin,
    y: ctx.cursorY,
    size: 16,
    bold: true,
  });
  drawText(ctx, 'Conciergerie locative', {
    x: ctx.margin + 80,
    y: ctx.cursorY + 3,
    size: 9,
  });
  ctx.cursorY -= 18;

  drawText(ctx, 'FICHE INDIVIDUELLE DE POLICE', {
    x: ctx.margin,
    y: ctx.cursorY,
    size: 13,
    bold: true,
  });
  ctx.cursorY -= 14;

  drawText(
    ctx,
    'Police registration form - to be deposited at the Commissariat',
    {
      x: ctx.margin,
      y: ctx.cursorY,
      size: 7,
      color: rgb(0.3, 0.3, 0.3),
    },
  );
  ctx.cursorY -= 12;

  drawText(ctx, `Ref : ${reference}`, {
    x: ctx.margin,
    y: ctx.cursorY,
    size: 9,
    bold: true,
  });
  const issueDate = formatDate(new Date().toISOString().slice(0, 10));
  drawText(ctx, `Date emission : ${issueDate}`, {
    x: ctx.width - ctx.margin - 150,
    y: ctx.cursorY,
    size: 9,
  });
  ctx.cursorY -= 8;
  drawHLine(ctx, ctx.cursorY, COLOR_BLACK, 0.8);
  ctx.cursorY -= 4;
}

function drawHebergement(
  ctx: DrawCtx,
  r: PoliceRecord,
  propertyName: string | null,
  unitLabel: string | null,
) {
  sectionTitle(ctx, 'HEBERGEMENT');
  row2(
    ctx,
    { label: 'Bien :', value: formatStr(propertyName) },
    { label: 'Unite :', value: formatStr(unitLabel) },
  );
  row2(
    ctx,
    { label: 'Arrivee Maroc :', value: formatDate(r.arrival_date_morocco) },
    { label: 'Arrivee bien :', value: formatDate(r.arrival_date_property) },
  );
  row2(
    ctx,
    { label: 'Depart prevu :', value: formatDate(r.expected_departure_date) },
    { label: 'Motif sejour :', value: formatMotif(r.motif_sejour) },
  );
}

function drawChefDeFamille(ctx: DrawCtx, r: PoliceRecord) {
  sectionTitle(ctx, 'CHEF DE FAMILLE');
  row2(
    ctx,
    { label: 'Nom :', value: formatStr(r.head_last_name).toUpperCase() },
    { label: 'Prenom :', value: formatStr(r.head_first_name) },
  );
  row2(
    ctx,
    { label: 'Sexe :', value: formatGender(r.head_gender) },
    { label: 'Ne(e) le :', value: formatDate(r.head_birth_date) },
  );
  row2(
    ctx,
    { label: 'Lieu naissance :', value: formatStr(r.head_birth_place) },
    { label: 'Nationalite :', value: formatStr(r.head_nationality) },
  );
  row1Wide(ctx, 'Profession :', formatStr(r.head_profession));
}

function drawPieceIdentite(ctx: DrawCtx, r: PoliceRecord) {
  sectionTitle(ctx, "PIECE D'IDENTITE");
  row2(
    ctx,
    { label: 'Type :', value: formatIdType(r.head_id_type) },
    { label: 'Numero :', value: formatStr(r.head_id_number) },
  );
  row2(
    ctx,
    { label: 'Delivree le :', value: formatDate(r.head_id_issue_date) },
    { label: 'Expire le :', value: formatDate(r.head_id_expiry_date) },
  );
  row1Wide(ctx, 'Pays emetteur :', formatStr(r.head_id_issue_country));
}

function drawResidence(ctx: DrawCtx, r: PoliceRecord) {
  sectionTitle(ctx, 'RESIDENCE HABITUELLE');
  row1Wide(ctx, 'Pays :', formatStr(r.head_residence_country));
  row1Wide(ctx, 'Adresse :', formatStr(r.head_residence_address));
}

function drawAccompagnants(ctx: DrawCtx, persons: AccompanyingPerson[]) {
  sectionTitle(
    ctx,
    `ACCOMPAGNANTS (${persons.length} personne${persons.length > 1 ? 's' : ''})`,
  );

  const cols = [
    { x: ctx.margin, w: 18, label: '#' },
    { x: ctx.margin + 18, w: 110, label: 'Nom' },
    { x: ctx.margin + 128, w: 100, label: 'Prenom' },
    { x: ctx.margin + 228, w: 70, label: 'Ne(e)' },
    { x: ctx.margin + 298, w: 80, label: 'Nationalite' },
    { x: ctx.margin + 378, w: 65, label: 'Piece' },
    { x: ctx.margin + 443, w: 72, label: 'Relation' },
  ];
  const rowH = 12;

  for (const c of cols) {
    drawText(ctx, c.label, {
      x: c.x + 2,
      y: ctx.cursorY,
      size: 8,
      bold: true,
    });
  }
  ctx.cursorY -= 4;
  drawHLine(ctx, ctx.cursorY, COLOR_THIN, 0.5);
  ctx.cursorY -= 10;

  persons.forEach((p, i) => {
    const idTypeShort = formatIdType(p.id_type ?? null);
    const idDisplay =
      idTypeShort === EM_DASH
        ? EM_DASH
        : p.id_number
          ? `${idTypeShort} ${p.id_number}`
          : idTypeShort;
    const values = [
      String(i + 1),
      formatStr(p.last_name).toUpperCase(),
      formatStr(p.first_name),
      formatDate(p.birth_date ?? null),
      formatStr(p.nationality ?? null),
      idDisplay,
      formatStr(p.relation ?? null),
    ];
    cols.forEach((c, idx) => {
      const v = values[idx]!;
      const truncated = truncateToWidth(ctx.font, v, 8, c.w - 4);
      drawText(ctx, truncated, {
        x: c.x + 2,
        y: ctx.cursorY,
        size: 8,
      });
    });
    ctx.cursorY -= rowH;
  });
  ctx.cursorY -= 2;
  drawHLine(ctx, ctx.cursorY, COLOR_THIN, 0.4);
  ctx.cursorY -= 4;
}

function truncateToWidth(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
): string {
  const sanitized = sanitize(text);
  if (font.widthOfTextAtSize(sanitized, size) <= maxWidth) return sanitized;
  const ellipsis = '...';
  let lo = 0;
  let hi = sanitized.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const slice = sanitized.slice(0, mid) + ellipsis;
    if (font.widthOfTextAtSize(slice, size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return sanitized.slice(0, lo) + ellipsis;
}

function drawFooter(ctx: DrawCtx, r: PoliceRecord) {
  drawBand(ctx, ctx.cursorY, 14);
  drawText(ctx, `TOTAL VOYAGEURS : ${r.total_persons_count}`, {
    x: ctx.margin + 6,
    y: ctx.cursorY - 9,
    size: 10,
    bold: true,
  });
  ctx.cursorY -= 24;

  drawText(
    ctx,
    `Fait a Marrakech, le ${formatDate(new Date().toISOString().slice(0, 10))}`,
    {
      x: ctx.margin,
      y: ctx.cursorY,
      size: 9,
    },
  );
  ctx.cursorY -= 30;

  const colW = (ctx.width - 2 * ctx.margin) / 2;
  drawText(ctx, 'Signature voyageur :', {
    x: ctx.margin,
    y: ctx.cursorY,
    size: 9,
    bold: true,
  });
  drawText(ctx, 'Signature hebergeur :', {
    x: ctx.margin + colW,
    y: ctx.cursorY,
    size: 9,
    bold: true,
  });
  ctx.cursorY -= 36;

  ctx.page.drawLine({
    start: { x: ctx.margin, y: ctx.cursorY },
    end: { x: ctx.margin + colW - 20, y: ctx.cursorY },
    thickness: 0.5,
    color: COLOR_BLACK,
  });
  ctx.page.drawLine({
    start: { x: ctx.margin + colW, y: ctx.cursorY },
    end: { x: ctx.width - ctx.margin, y: ctx.cursorY },
    thickness: 0.5,
    color: COLOR_BLACK,
  });
  ctx.cursorY -= 20;

  const cndp =
    "Donnees collectees au titre de la reglementation marocaine sur l'hebergement "
    + "touristique et de l'article R.611-42, conservees par l'etablissement et "
    + "transmises aux autorites competentes.";
  drawWrappedText(ctx, cndp, {
    x: ctx.margin,
    y: 50,
    size: 7,
    maxWidth: ctx.width - 2 * ctx.margin,
    lineHeight: 9,
    color: rgb(0.3, 0.3, 0.3),
  });
}

function drawWrappedText(
  ctx: DrawCtx,
  text: string,
  opts: {
    x: number;
    y: number;
    size: number;
    maxWidth: number;
    lineHeight: number;
    bold?: boolean;
    color?: ReturnType<typeof rgb>;
  },
) {
  const sanitized = sanitize(text);
  const words = sanitized.split(' ');
  const font = opts.bold ? ctx.fontBold : ctx.font;
  let line = '';
  let y = opts.y;
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, opts.size) > opts.maxWidth && line) {
      ctx.page.drawText(line, {
        x: opts.x,
        y,
        size: opts.size,
        font,
        color: opts.color ?? COLOR_BLACK,
      });
      y -= opts.lineHeight;
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) {
    ctx.page.drawText(line, {
      x: opts.x,
      y,
      size: opts.size,
      font,
      color: opts.color ?? COLOR_BLACK,
    });
  }
}
