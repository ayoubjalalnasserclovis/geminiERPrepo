/**
 * Helpers HTML mail-safe partagés par les 6 briefs hebdo Stoniz.
 * (CEO 2026-08-19)
 *
 * Contraintes :
 *   - Aucun flex / grid / CSS externe. Tables layout uniquement.
 *   - Couleurs Stoniz : cream #f5efe6, black #1a1a1a, emerald #0F6E56,
 *     danger #A32D2D, warning #BA7517.
 *   - Sur fonds sombres, forcer `color:#ffffff` inline explicite (le
 *     `.font-display` de globals.css force color:var(--black), donc
 *     dans certains clients mail le titre resterait noir sinon).
 *   - Devise : MAD partout (honoraires EUR × 10).
 *   - Aucun crash si les data sont vides — afficher un message positif.
 */

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://studio.stoniz.co';

export const COLORS = {
  cream: '#f5efe6',
  creamBorder: '#e5e0d5',
  black: '#1a1a1a',
  white: '#ffffff',
  emerald: '#0F6E56',
  danger: '#A32D2D',
  warning: '#BA7517',
  warningBg: '#FFF3CD',
  warningBorder: '#F0D48B',
  warningText: '#7a5c0a',
  muted: '#666666',
  mutedSoft: '#888888',
};

/** Formatte un nombre en MAD (locale française). */
export function fmtMad(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  return `${v.toLocaleString('fr-FR').replace(/ /g, ' ')} MAD`;
}

/** Formatte un nombre en EUR. */
export function fmtEur(n: number | null | undefined): string {
  const v = Math.round(Number(n ?? 0));
  return `${v.toLocaleString('fr-FR').replace(/ /g, ' ')} €`;
}

/** Formatte un nombre nu (sans devise) avec espaces. */
export function fmtNum(n: number | null | undefined): string {
  return Math.round(Number(n ?? 0)).toLocaleString('fr-FR').replace(/ /g, ' ');
}

/** Formatte un pourcentage avec signe si positif. */
export function fmtPct(n: number | null | undefined, digits = 0): string {
  const v = Number(n ?? 0);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

/** Formatte une date ISO en DD/MM. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

/** Formatte une date ISO en DD MMM YYYY. */
export function fmtDateLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Formatte YYYY-MM en "MMM YYYY". */
export function fmtMonth(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m] = String(iso).slice(0, 7).split('-').map(Number);
  if (!y || !m) return '—';
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
}

/** Nombre de jours entiers écoulés depuis une date ISO (positif si passée). */
export function daysAgo(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

/** Escape HTML pour insérer une string user-provided. */
export function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Retourne les bornes de la semaine passée (lundi-dimanche) et à venir. */
export function weekWindows(now: Date = new Date()): {
  lastWeekStart: Date;
  lastWeekEnd: Date;
  nextWeekStart: Date;
  nextWeekEnd: Date;
  today: Date;
  labelLast: string;
  labelNext: string;
} {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Aujourd'hui = lundi (jour de l'envoi). On regarde J-7 → J-1.
  const lastWeekEnd = new Date(today);
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
  const lastWeekStart = new Date(lastWeekEnd);
  lastWeekStart.setDate(lastWeekStart.getDate() - 6);
  const nextWeekStart = new Date(today);
  const nextWeekEnd = new Date(today);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  return {
    lastWeekStart,
    lastWeekEnd,
    nextWeekStart,
    nextWeekEnd,
    today,
    labelLast: `${fmt(lastWeekStart)} au ${fmt(lastWeekEnd)}`,
    labelNext: `${fmt(nextWeekStart)} au ${fmt(nextWeekEnd)}`,
  };
}

/** Retourne YYYY-MM-DD d'une date. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Blocs HTML réutilisables ────────────────────────────────────────────

export function htmlHeader(subject: string, subtitle: string): string {
  const now = new Date();
  const dateFR = now.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `
  <tr><td style="padding:28px 32px 20px;border-bottom:1px solid ${COLORS.creamBorder};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="font-family:'Manrope',sans-serif;font-size:22px;font-weight:800;color:${COLORS.black};letter-spacing:-0.02em;">
          stoniz
        </td>
        <td align="right" style="font-size:12px;color:${COLORS.mutedSoft};">
          ${esc(dateFR)} · 08:00
        </td>
      </tr>
    </table>
    <div style="margin-top:16px;font-size:11px;color:${COLORS.mutedSoft};text-transform:uppercase;letter-spacing:0.08em;">
      Rapport hebdomadaire · ${esc(subtitle)}
    </div>
    <h1 style="margin:6px 0 0;font-family:'Manrope',sans-serif;font-size:24px;font-weight:800;color:${COLORS.black};letter-spacing:-0.02em;">
      ${esc(subject)}
    </h1>
  </td></tr>`;
}

export function htmlFooter(linkPath: string, linkLabel: string): string {
  const href = `${APP_URL}${linkPath}`;
  return `
  <tr><td style="padding:24px 32px 28px;border-top:1px solid ${COLORS.creamBorder};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td>
          <a href="${esc(href)}" style="display:inline-block;background:${COLORS.black};color:${COLORS.cream};text-decoration:none;font-size:13px;font-weight:500;padding:10px 18px;border-radius:8px;">
            ${esc(linkLabel)} &rarr;
          </a>
        </td>
        <td align="right" style="font-size:11px;color:${COLORS.mutedSoft};">
          Généré automatiquement chaque lundi 8h<br>
          <a href="mailto:contact@stoniz.co" style="color:${COLORS.mutedSoft};">contact@stoniz.co</a>
        </td>
      </tr>
    </table>
  </td></tr>`;
}

export function wrapPage(bodySections: string, subject: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.black};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.cream};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="620" style="max-width:620px;width:100%;background:${COLORS.white};border-radius:12px;overflow:hidden;">
${bodySections}
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Cartes KPI ──────────────────────────────────────────────────────────

export type KpiVariant = 'dark' | 'emerald' | 'light' | 'danger' | 'warning';

export function kpiCard(opts: {
  label: string;
  value: string;
  subValue?: string;
  variant?: KpiVariant;
}): string {
  const variant = opts.variant ?? 'light';
  let bg = COLORS.white;
  let border = `border:1px solid ${COLORS.creamBorder};`;
  let labelColor = COLORS.muted;
  let valueColor = COLORS.black;
  let subColor = COLORS.mutedSoft;
  if (variant === 'dark') {
    bg = COLORS.black;
    border = '';
    labelColor = 'rgba(255,255,255,0.7)';
    valueColor = COLORS.white;
    subColor = 'rgba(255,255,255,0.7)';
  } else if (variant === 'emerald') {
    bg = COLORS.emerald;
    border = '';
    labelColor = 'rgba(255,255,255,0.85)';
    valueColor = COLORS.white;
    subColor = 'rgba(255,255,255,0.8)';
  } else if (variant === 'danger') {
    bg = '#FBEAEA';
    border = `border:1px solid #F2C7C7;`;
    labelColor = COLORS.danger;
    valueColor = COLORS.danger;
    subColor = COLORS.danger;
  } else if (variant === 'warning') {
    bg = COLORS.warningBg;
    border = `border:1px solid ${COLORS.warningBorder};`;
    labelColor = COLORS.warningText;
    valueColor = COLORS.warningText;
    subColor = COLORS.warningText;
  }
  return `
    <div style="background:${bg};${border}border-radius:10px;padding:16px 18px;">
      <div style="font-size:11px;color:${labelColor};text-transform:uppercase;letter-spacing:0.06em;">${esc(opts.label)}</div>
      <div style="margin-top:4px;font-family:'Manrope',sans-serif;font-size:22px;font-weight:800;color:${valueColor};letter-spacing:-0.02em;">${opts.value}</div>
      ${opts.subValue ? `<div style="margin-top:2px;font-size:12px;color:${subColor};">${opts.subValue}</div>` : ''}
    </div>`;
}

/** Rangée de 2 ou 3 cartes KPI côte-à-côte. */
export function kpiRow(cards: string[]): string {
  const n = cards.length;
  if (n === 0) return '';
  const w = Math.floor(100 / n);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>${cards
      .map(
        (c, i) => `<td width="${w}%" style="padding:${i === 0 ? '0 6px 0 0' : i === n - 1 ? '0 0 0 6px' : '0 3px'};vertical-align:top;">${c}</td>`,
      )
      .join('')}</tr>
  </table>`;
}

// ─── Titre section ───────────────────────────────────────────────────────

export function sectionTitle(title: string): string {
  return `<div style="font-size:14px;font-weight:600;color:${COLORS.black};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;">${esc(title)}</div>`;
}

/** Sous-info sous un titre (compteur, période, etc.). */
export function sectionMuted(text: string): string {
  return `<div style="margin-top:-6px;margin-bottom:8px;font-size:12px;color:${COLORS.muted};">${esc(text)}</div>`;
}

/** Wrap une section dans une ligne de la table root. */
export function section(inner: string, opts: { padding?: string } = {}): string {
  const p = opts.padding ?? '16px 32px 8px';
  return `<tr><td style="padding:${p};">${inner}</td></tr>`;
}

// ─── Alertes ─────────────────────────────────────────────────────────────

export function alertBox(opts: {
  level: 'info' | 'warning' | 'danger';
  content: string;
}): string {
  let bg = '#EEF6F3';
  let border = '#B7DBD0';
  let color = COLORS.emerald;
  if (opts.level === 'warning') {
    bg = COLORS.warningBg;
    border = COLORS.warningBorder;
    color = COLORS.warningText;
  } else if (opts.level === 'danger') {
    bg = '#FBEAEA';
    border = '#F2C7C7';
    color = COLORS.danger;
  }
  return `<div style="background:${bg};border:1px solid ${border};border-radius:8px;padding:12px 14px;font-size:13px;color:${color};">${opts.content}</div>`;
}

// ─── Table simple ────────────────────────────────────────────────────────

export type TableCell = { text: string; align?: 'left' | 'right' | 'center'; color?: string; bold?: boolean };
export type TableRow = Array<TableCell | string>;

export function dataTable(opts: {
  headers: string[];
  rows: TableRow[];
  emptyLabel?: string;
}): string {
  if (opts.rows.length === 0) {
    return alertBox({
      level: 'info',
      content: esc(opts.emptyLabel ?? 'Aucune donnée à signaler cette semaine.'),
    });
  }
  const headerRow = `<tr style="background:${COLORS.cream};font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:${COLORS.muted};">
    ${opts.headers.map((h, i) => `<td align="${i === opts.headers.length - 1 && opts.headers.length > 1 ? 'right' : 'left'}" style="padding:10px 12px;">${esc(h)}</td>`).join('')}
  </tr>`;
  const bodyRows = opts.rows
    .map((row) => {
      const cells = (row as any[]).map((cell) => {
        if (typeof cell === 'string') {
          return { text: cell, align: 'left' as const };
        }
        return cell as TableCell;
      });
      return `<tr style="border-top:1px solid ${COLORS.creamBorder};">
        ${cells
          .map((c) => {
            const style = [
              'padding:9px 12px',
              `font-size:13px`,
              c.color ? `color:${c.color}` : '',
              c.bold ? 'font-weight:600' : '',
            ]
              .filter(Boolean)
              .join(';');
            return `<td align="${c.align ?? 'left'}" style="${style};">${c.text}</td>`;
          })
          .join('')}
      </tr>`;
    })
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;border:1px solid ${COLORS.creamBorder};border-radius:8px;overflow:hidden;">
    ${headerRow}
    ${bodyRows}
  </table>`;
}

/** Message positif (aucune anomalie) — utilisé quand une section serait vide. */
export function emptyOk(msg: string = 'Aucun retard, tout est à jour.'): string {
  return alertBox({ level: 'info', content: `&#10003; ${esc(msg)}` });
}
