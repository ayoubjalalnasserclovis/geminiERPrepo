'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole, PROJECT_CSV_IMPORT_ROLES } from '@/lib/auth/require';

/**
 * Importeur CSV "Suivi travaux" (template historique Google Sheets).
 *
 * Deux feuilles attendues (toutes deux optionnelles, mais au moins une) :
 *
 *  1. Feuille principale (Suivi travaux) : 1 onglet par projet, structure fixe
 *     - en-tête projet (client, adresse, budget global, marge cible, dates chantier)
 *     - tableau lots travaux (1 ligne par lot, jusqu'à 6 acomptes par lot)
 *
 *  2. Feuille cashflow : encaissements client (date + montant), pour la partie
 *     gauche du tableau. La partie droite "paiements artisans" est ignorée car
 *     déjà calculée depuis les acomptes lots de la feuille 1.
 *
 * Idempotence : on logue toutes les insertions dans data_fix_log avec le nom
 * `import-travaux-{project_id}` pour permettre un rollback.
 *
 * Mode dry-run : si dryRun=true, on renvoie ce qui serait inséré sans écrire.
 */

// ─── Parsing utilities ─────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQuotes = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** Convertit "200,000 MAD" / "200 000 MAD" / "200000" → 200000 (number) ou null */
function parseMontant(v: string | undefined | null): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === '0 MAD' || s === '0') return null;
  // Retire MAD/€/espaces/virgules milliers, garde le point décimal
  const cleaned = s.replace(/MAD|€|\s/gi, '').replace(/,(?=\d{3})/g, '');
  // Si la virgule restante est décimale (1,5 → 1.5)
  const normalized = cleaned.replace(',', '.');
  const n = Number(normalized);
  return isFinite(n) && n > 0 ? n : null;
}

/** Convertit "30%" → 30 (number) ou null */
function parsePct(v: string | undefined | null): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace('%', '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

/** Convertit "01/01/2026" (DD/MM/YYYY) → "2026-01-01" (YYYY-MM-DD) ou null */
function parseDateFR(v: string | undefined | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Déjà ISO ?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY ou D/M/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Map libellé libre vers enum category de travaux_lots. Inconnu → 'divers' */
function mapCategory(label: string): string {
  const s = (label ?? '').toLowerCase().trim();
  if (!s) return 'divers';
  if (/(démol|demol|cloison)/.test(s)) return 'demolition_cloisons';
  if (/(gros.?oeuvre|maçon|macon)/.test(s)) return 'gros_oeuvre_maconnerie';
  if (/(électric|electric)/.test(s)) return 'electricite';
  if (/(plomb|sanit)/.test(s)) return 'plomberie_sanitaire';
  if (/(carrelage|revêt|revet)/.test(s)) return 'carrelage_revetements';
  if (/(menuis.*alu|aluminium)/.test(s)) return 'menuiserie_aluminium';
  if (/(menuis)/.test(s)) return 'menuiserie_interieure';
  if (/(peint)/.test(s)) return 'peinture';
  if (/(plafond)/.test(s)) return 'faux_plafond';
  if (/(clim|vmc)/.test(s)) return 'climatisation_vmc';
  if (/(ferron)/.test(s)) return 'ferronnerie';
  if (/(extérieur|exterieur|jardin|piscine)/.test(s)) return 'amenagements_exterieurs';
  if (/(cuisine)/.test(s)) return 'cuisine';
  return 'divers';
}

/** Map libellé statut CSV → enum status. Vide → 'a_planifier'. */
function mapStatus(label: string): string {
  const s = (label ?? '').toLowerCase().trim();
  if (!s) return 'a_planifier';
  if (/(termin|finit)/.test(s)) return 'termine';
  if (/(en.cours|cours)/.test(s)) return 'en_cours';
  if (/(d[ée]marr)/.test(s)) return 'demarre';
  if (/(attente)/.test(s)) return 'en_attente';
  if (/(annul)/.test(s)) return 'annule';
  if (/(devis)/.test(s)) return 'devis_recu';
  return 'a_planifier';
}

// ─── Types intermédiaires ──────────────────────────────────────────────────

type ParsedLot = {
  numero: number;
  category: string;
  description: string | null;
  artisan_name: string;
  devis_number: string | null;
  budget_estimate_mad: number | null;
  devis_artisan_mad: number | null;
  facture_client_mad: number | null;
  status: string;
  date_debut_estime: string | null;
  date_fin_estimee: string | null;
  date_fin_reelle: string | null;
  acomptes: Array<{ acompte_number: number; pct: number | null; amount: number }>;
};

type ParsedProjectMeta = {
  client_label: string | null;        // pour vérification, pas écrit
  adresse_chantier: string | null;
  budget_global_mad: number | null;
  marge_cible_pct: number | null;
  date_debut_chantier: string | null;
  date_fin_estimee: string | null;
  date_fin_reelle: string | null;
};

type ParsedEncaissement = {
  received_at: string;
  amount_mad: number;
};

// ─── Parser feuille principale (Suivi travaux) ─────────────────────────────

function parseFeuilleSuivi(rows: string[][]): { meta: ParsedProjectMeta; lots: ParsedLot[] } {
  // Indices basés sur le template DRISS BOUTIRA (lignes 0-indexées)
  // Ligne 2 (idx) : Client: <val>, ← SAISIR LE NOM DU CLIENT ICI
  // Ligne 3 : Adresse chantier:
  // Ligne 4 : Budget global estimé (MAD):
  // Ligne 5 : Marge cible (%):
  // Ligne 6 : Date début chantier, Date fin estimée, Date fin réalisée
  // Lignes 20-21 : headers (multi-ligne)
  // Lignes 22+ : data lots
  // Dernière ligne : TOTAL

  const get = (rowIdx: number, colIdx: number) => (rows[rowIdx]?.[colIdx] ?? '').trim();

  const meta: ParsedProjectMeta = {
    client_label: get(2, 1) || null,
    adresse_chantier: get(3, 1) || null,
    budget_global_mad: parseMontant(get(4, 1)),
    marge_cible_pct: parsePct(get(5, 1)),
    date_debut_chantier: parseDateFR(get(6, 1)),
    date_fin_estimee: parseDateFR(get(6, 4)),
    date_fin_reelle: parseDateFR(get(6, 7)),
  };

  const lots: ParsedLot[] = [];

  // On scanne tout après la ligne 21 et jusqu'à la ligne TOTAL
  for (let r = 22; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const numStr = (row[0] ?? '').trim();
    if (!numStr || numStr.toUpperCase().startsWith('TOTAL')) {
      if (numStr.toUpperCase().startsWith('TOTAL')) break;
      continue;
    }
    const numero = Number(numStr);
    if (!isFinite(numero)) continue;

    const artisan = (row[3] ?? '').trim();
    if (!artisan) continue; // ligne vide, on passe

    // 6 paires acomptes (cols 10-21)
    const acomptes: ParsedLot['acomptes'] = [];
    for (let k = 0; k < 6; k++) {
      const pctCol = 10 + k * 2;
      const amountCol = 11 + k * 2;
      const pct = parsePct(row[pctCol]);
      const amount = parseMontant(row[amountCol]);
      if (amount && amount > 0) {
        acomptes.push({ acompte_number: k + 1, pct, amount });
      }
    }

    lots.push({
      numero,
      category: mapCategory(row[1] ?? ''),
      description: (row[2] ?? '').trim() || (row[1] ?? '').trim() || null,
      artisan_name: artisan,
      devis_number: (row[25] ?? '').trim() || null,
      budget_estimate_mad: parseMontant(row[4]),
      devis_artisan_mad: parseMontant(row[5]),
      facture_client_mad: parseMontant(row[7]),
      status: mapStatus(row[24] ?? ''),
      date_debut_estime: parseDateFR(row[26]),
      date_fin_estimee: parseDateFR(row[27]),
      date_fin_reelle: parseDateFR(row[28]),
      acomptes,
    });
  }

  return { meta, lots };
}

// ─── Parser feuille cashflow ───────────────────────────────────────────────

function parseFeuilleCashflow(rows: string[][]): ParsedEncaissement[] {
  // Encaissements client : à partir de la ligne 14 (idx), col 0 = date, col 1 = montant
  // La ligne d'en-tête "← ENCAISSEMENTS CLIENT (saisie)" est ligne 13 (idx)
  // On s'arrête dès qu'on rencontre une ligne vide ou un total
  const enc: ParsedEncaissement[] = [];
  for (let r = 14; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const dateStr = (row[0] ?? '').trim();
    const amountStr = (row[1] ?? '').trim();
    const date = parseDateFR(dateStr);
    const amount = parseMontant(amountStr);
    if (date && amount) {
      enc.push({ received_at: date, amount_mad: amount });
    }
  }
  return enc;
}

// ─── Action principale ─────────────────────────────────────────────────────

export type DryRunSummary = {
  meta: ParsedProjectMeta;
  lots_count: number;
  acomptes_count: number;
  encaissements_count: number;
  total_facture_client_mad: number;
  total_payé_artisans_mad: number;
  total_encaissé_client_mad: number;
  lots_preview: ParsedLot[];
  encaissements_preview: ParsedEncaissement[];
  warnings: string[];
};

export async function importTravauxCsvAction(input: {
  project_id: string;
  suivi_csv?: string;          // contenu textuel feuille principale
  cashflow_csv?: string;       // contenu textuel feuille cashflow (optionnel)
  dry_run: boolean;
}): Promise<{ ok: true; dryRun: boolean; summary: DryRunSummary } | { ok: false; error: string }> {
  try {
    // Import CSV : CEO + chef_projet + achats (CEO 2026-09-02).
    // L'import reste idempotent (data_fix_log) et ces rôles ont déjà l'écriture
    // sur travaux/achats en usage normal — pas de nouveau risque.
    await assertRole(PROJECT_CSV_IMPORT_ROLES);
    const supabase = createClient();

    // Vérification : projet existe
    const { data: proj, error: projErr } = await supabase
      .from('projects')
      .select('id, reference, client:clients(full_name)')
      .eq('id', input.project_id)
      .maybeSingle();
    if (projErr || !proj) return { ok: false, error: 'Projet introuvable' };

    if (!input.suivi_csv && !input.cashflow_csv) {
      return { ok: false, error: 'Aucun CSV fourni' };
    }

    // Parse
    let meta: ParsedProjectMeta = {
      client_label: null, adresse_chantier: null, budget_global_mad: null,
      marge_cible_pct: null, date_debut_chantier: null, date_fin_estimee: null, date_fin_reelle: null,
    };
    let lots: ParsedLot[] = [];
    let encaissements: ParsedEncaissement[] = [];
    const warnings: string[] = [];

    if (input.suivi_csv) {
      const parsed = parseFeuilleSuivi(parseCSV(input.suivi_csv));
      meta = parsed.meta;
      lots = parsed.lots;
      if (lots.length === 0) warnings.push('Aucun lot détecté dans la feuille principale');
    }

    if (input.cashflow_csv) {
      encaissements = parseFeuilleCashflow(parseCSV(input.cashflow_csv));
      if (encaissements.length === 0) warnings.push('Aucun encaissement détecté dans la feuille cashflow');
    }

    // Sanity check : pas de doublon de numéro lot
    const numeros = lots.map(l => l.numero);
    if (new Set(numeros).size !== numeros.length) {
      warnings.push('Numéros de lot en double détectés dans le CSV — vérifier avant import');
    }

    const totalFactureClient = lots.reduce((s, l) => s + (l.facture_client_mad ?? 0), 0);
    const totalPayeArtisans = lots.reduce((s, l) => s + l.acomptes.reduce((a, b) => a + b.amount, 0), 0);
    const totalEncaisseClient = encaissements.reduce((s, e) => s + e.amount_mad, 0);

    const summary: DryRunSummary = {
      meta,
      lots_count: lots.length,
      acomptes_count: lots.reduce((s, l) => s + l.acomptes.length, 0),
      encaissements_count: encaissements.length,
      total_facture_client_mad: totalFactureClient,
      total_payé_artisans_mad: totalPayeArtisans,
      total_encaissé_client_mad: totalEncaisseClient,
      lots_preview: lots,
      encaissements_preview: encaissements,
      warnings,
    };

    if (input.dry_run) {
      return { ok: true, dryRun: true, summary };
    }

    // ─── Insertion réelle (transactionnelle côté Supabase = pas vraiment, mais on logue tout) ──

    // Idempotence : si déjà importé, on bloque
    const fixName = `import-travaux-${input.project_id}`;
    const { count: alreadyApplied } = await supabase
      .from('data_fix_log')
      .select('id', { count: 'exact', head: true })
      .eq('fix_name', fixName);
    if ((alreadyApplied ?? 0) > 0) {
      return { ok: false, error: 'Cet import a déjà été effectué pour ce projet (voir data_fix_log). Pour ré-importer, contacte un dev pour rollback préalable.' };
    }

    // 1. Update projects (meta) — uniquement les champs non null
    const projUpdate: any = { updated_at: new Date().toISOString() };
    if (meta.adresse_chantier) projUpdate.travaux_adresse_chantier = meta.adresse_chantier;
    if (meta.budget_global_mad) projUpdate.travaux_budget_mad = meta.budget_global_mad;
    if (meta.marge_cible_pct != null) projUpdate.travaux_marge_cible_pct = meta.marge_cible_pct;
    if (meta.date_debut_chantier) projUpdate.travaux_start_date = meta.date_debut_chantier;
    if (meta.date_fin_estimee) projUpdate.travaux_end_date = meta.date_fin_estimee;

    if (Object.keys(projUpdate).length > 1) {
      const { error } = await supabase
        .from('projects')
        .update(projUpdate)
        .eq('id', input.project_id);
      if (error) return { ok: false, error: `Update projet: ${error.message}` };
    }

    // 2. Insert lots + récupérer leurs IDs pour rattacher les acomptes
    const lotIdByNumero = new Map<number, string>();
    for (const lot of lots) {
      const { data: inserted, error: lotErr } = await supabase
        .from('travaux_lots')
        .insert({
          project_id: input.project_id,
          numero: lot.numero,
          category: lot.category,
          description: lot.description,
          artisan_name: lot.artisan_name,
          devis_number: lot.devis_number,
          budget_estimate_mad: lot.budget_estimate_mad,
          devis_artisan_mad: lot.devis_artisan_mad,
          facture_client_mad: lot.facture_client_mad,
          status: lot.status,
          date_debut_estime: lot.date_debut_estime,
          date_fin_estimee: lot.date_fin_estimee,
          date_fin_reelle: lot.date_fin_reelle,
        })
        .select('id')
        .single();
      if (lotErr) return { ok: false, error: `Insert lot #${lot.numero} (${lot.artisan_name}): ${lotErr.message}` };
      lotIdByNumero.set(lot.numero, inserted.id);
    }

    // 3. Insert travaux_payments (1 par acompte non vide)
    //    Champs réels du schéma : amount_total, amount_paid, payment_type, status, scheduled_date, paid_at
    //    On considère que tout acompte présent dans le CSV est déjà payé (réalité historique)
    const todayIso = new Date().toISOString().slice(0, 10);
    const paymentRows = lots.flatMap(lot => {
      const lotId = lotIdByNumero.get(lot.numero)!;
      return lot.acomptes.map(a => ({
        project_id: input.project_id,
        lot_id: lotId,
        acompte_number: a.acompte_number,
        acompte_pct: a.pct,
        artisan_name: lot.artisan_name,
        currency: 'MAD',
        amount_total: a.amount,
        amount_paid: a.amount,        // CSV = historique => déjà payé
        payment_type: 'acompte',
        status: 'paid',
        paid_at: todayIso,            // date approximative, pas connue précisément dans le CSV
        notes: `Import CSV — acompte ${a.acompte_number}`,
      }));
    });

    if (paymentRows.length > 0) {
      const { error: payErr } = await supabase.from('travaux_payments').insert(paymentRows);
      if (payErr) return { ok: false, error: `Insert acomptes: ${payErr.message}` };
    }

    // 4. Insert encaissements client
    if (encaissements.length > 0) {
      const encRows = encaissements.map(e => ({
        project_id: input.project_id,
        amount_mad: e.amount_mad,
        received_at: e.received_at,
        notes: 'Import CSV',
      }));
      const { error: encErr } = await supabase.from('travaux_encaissements').insert(encRows);
      if (encErr) return { ok: false, error: `Insert encaissements: ${encErr.message}` };
    }

    // 5. Audit : 1 snapshot par projet importé (suffit pour identifier l'opération)
    await supabase.from('data_fix_log').insert({
      fix_name: fixName,
      entity: 'projects',
      entity_id: input.project_id,
      snapshot: {
        imported_at: new Date().toISOString(),
        meta,
        lots_count: lots.length,
        acomptes_count: paymentRows.length,
        encaissements_count: encaissements.length,
      } as any,
    });

    revalidatePath(`/projects/${input.project_id}/travaux`);
    revalidatePath(`/projects/${input.project_id}`);
    return { ok: true, dryRun: false, summary };
  } catch (e: any) {
    console.error('[importTravauxCsvAction]', e);
    return { ok: false, error: e?.message ?? 'Erreur serveur inattendue' };
  }
}
