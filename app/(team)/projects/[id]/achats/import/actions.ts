'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole, PROJECT_CSV_IMPORT_ROLES } from '@/lib/auth/require';

/**
 * Importeur CSV "Suivi achats" (template historique Google Sheets Stoniz).
 *
 * Structure CSV attendue (validée sur KARIM ZAIDI) :
 *  - Ligne 1 : titre projet
 *  - Ligne 2 : Client (vide possible, le nom client vient du projet ERP)
 *  - Ligne 3 : Collaborateur : <nom>
 *  - Ligne 4 : Budget global estimé (MAD) : <montant>
 *  - Ligne 5 : Marge cible (%) : <pct>
 *  - Ligne 6 : Date livraison estimée : <date> / Date livraison réalisée : <date>
 *  - Lignes 8-19 : KPIs récap (ignorés à l'import)
 *  - Lignes 20-35 : Headers multi-lignes du tableau
 *  - Ligne 36 : "SUITE 1" séparateur
 *  - Lignes suivantes : data lots
 *  - "SUITE 2", "SUITE 3" séparateurs intermédiaires
 *  - Ligne TOTAL PROJET en fin
 *
 * Colonnes du tableau lots :
 *   0 N°        1 Catégorie   2 Produit/Description   3 Fournisseur
 *   4 Collaborateur            5 Quantité              6 Prix unitaire
 *   7 Budget estimé MAD       (8 Budget collab ignoré)
 *   9 Écart budget (ignoré)
 *  10 Prix achat réel (= devis fournisseur MAD)
 *  11-12 Marges (ignorés, calculés)
 *  13 % acompte 1   14 Montant acompte 1
 *  15 % acompte 2   16 Montant acompte 2
 *  17 Total payé (ignoré)   18 Reste à payer (ignoré)
 *  19 Statut commande   20 N° BDC
 *  21 Livr. estimée    22 Livr. réalisée
 *
 * Stratégie fournisseurs (validée CEO 2026-05-30) : auto-create avec
 * confirmation au dry-run. Match case-insensitive + trim sur artisans.name.
 */

// ─── Parsing CSV ──────────────────────────────────────────────────────────

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

function parseMontant(v: string | undefined | null): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === '0 MAD' || s === '0') return null;
  const cleaned = s.replace(/MAD|€|\s/gi, '').replace(/,(?=\d{3})/g, '');
  const normalized = cleaned.replace(',', '.');
  const n = Number(normalized);
  return isFinite(n) && n > 0 ? n : null;
}

function parsePct(v: string | undefined | null): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace('%', '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function parseDateFR(v: string | undefined | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseQuantity(v: string | undefined | null): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return isFinite(n) && n > 0 ? n : null;
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mapAchatCategory(label: string): string {
  const s = (label ?? '').toLowerCase().trim();
  if (!s) return 'divers';
  if (/mobilier.*salon|salon/.test(s)) return 'mobilier_salon';
  if (/mobilier.*chambre|chambre/.test(s)) return 'mobilier_chambre';
  if (/sdb|salle.*bain/.test(s)) return 'mobilier_sdb';
  if (/mobilier.*cuisine/.test(s)) return 'mobilier_cuisine';
  if (/électroménager|electromenager/.test(s)) return 'electromenager';
  if (/luminaire|éclairage|eclairage|lustre|suspension/.test(s)) return 'luminaire';
  if (/textile|décoration|decoration|déco|deco/.test(s)) return 'textile_decoration';
  if (/vaisselle|arts.*table/.test(s)) return 'vaisselle_arts_table';
  if (/literie|linge/.test(s)) return 'linge_maison';
  if (/plomberie|robinet/.test(s)) return 'plomberie_robinetterie';
  if (/sanitaire/.test(s)) return 'sanitaires';
  if (/peinture/.test(s)) return 'peinture_fournitures';
  if (/carrelage|marbre/.test(s)) return 'carrelage_marbre';
  if (/menuiserie/.test(s)) return 'menuiserie_fournitures';
  if (/jardin|extérieur|exterieur/.test(s)) return 'jardinage_exterieur';
  if (/accessoire|cuisine/.test(s)) return 'mobilier_cuisine';
  return 'divers';
}

function mapAchatStatus(label: string): string {
  const s = (label ?? '').toLowerCase().trim();
  if (!s) return 'a_commander';
  if (/livré|livre$|installé|installe$/.test(s)) return 'livre';
  if (/transit|en.*livraison/.test(s)) return 'en_livraison';
  if (/commandé|commande$/.test(s)) return 'commande';
  if (/devis/.test(s)) return 'devis_recu';
  if (/annul/.test(s)) return 'annule';
  if (/à.*command|a.*command/.test(s)) return 'a_commander';
  return 'a_commander';
}

// ─── Types intermédiaires ─────────────────────────────────────────────────

type ParsedLot = {
  original_ref: string;          // N° du CSV (pour traçabilité, peut être dupliqué)
  suite_label: string | null;    // "SUITE 1" / "SUITE 2" / null = bien global
  category: string;
  description: string | null;
  supplier_name: string;
  collaborator_name: string | null;
  quantity: number | null;
  unit_price_mad: number | null;
  budget_estimate_mad: number | null;
  devis_fournisseur_mad: number | null;
  status: string;
  devis_number: string | null;
  date_livraison_estimee: string | null;
  date_livraison_reelle: string | null;
  acomptes: Array<{ acompte_number: number; pct: number | null; amount: number }>;
};

type ParsedMeta = {
  collaborateur_label: string | null;
  budget_global_mad: number | null;
  marge_cible_pct: number | null;
  date_livraison_estimee: string | null;
  date_livraison_reelle: string | null;
};

function parseFeuilleAchats(rows: string[][]): { meta: ParsedMeta; lots: ParsedLot[] } {
  const get = (r: number, c: number) => (rows[r]?.[c] ?? '').trim();

  const meta: ParsedMeta = {
    collaborateur_label: get(2, 1) || null,
    budget_global_mad: parseMontant(get(3, 1)),
    marge_cible_pct: parsePct(get(4, 1)),
    date_livraison_estimee: parseDateFR(get(5, 1)),
    date_livraison_reelle: parseDateFR(get(5, 4)),
  };

  const lots: ParsedLot[] = [];
  let currentSuite: string | null = null;

  // Auto-détection du début de la zone data : on cherche la 1re section "SUITE X".
  // Si introuvable, fallback sur r=10 (après les rows meta + KPIs + 2 lignes header).
  // C'est robuste face aux variantes du template (en-têtes multi-lignes qui changent
  // d'une feuille à l'autre).
  let startIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    const col0 = (rows[r]?.[0] ?? '').trim();
    if (/^SUITE\s*\d+/i.test(col0)) { startIdx = r; break; }
  }
  if (startIdx === -1) startIdx = 10;

  // Mots-clés indiquant une row d'en-tête (à skipper, pas à importer comme lot)
  const HEADER_KEYWORDS = new Set(['REF', 'N°', 'IDENTIFICATION', 'BUDGET', 'CATÉGORIE', 'CATEGORIE',
    'FOURNISSEUR', 'COLLABORATEUR', 'PAIEMENTS', 'STATUT', 'SECTION']);

  for (let r = startIdx; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const col0 = (row[0] ?? '').trim();
    const col0Upper = col0.toUpperCase();

    if (col0Upper.startsWith('TOTAL')) break;
    if (/^SUITE\s*\d+/i.test(col0)) {
      currentSuite = col0Upper;
      continue;
    }

    // Skip rows d'en-tête (par mot-clé col0 ou par col3 contenant "Fournisseur"/"Artisan")
    const supplier = (row[3] ?? '').trim();
    if (HEADER_KEYWORDS.has(col0Upper)) continue;
    if (supplier === 'Fournisseur' || supplier === 'Artisan / Entreprise') continue;

    const product = (row[2] ?? '').trim();
    const category = (row[1] ?? '').trim();
    if (!supplier && !product && !category) continue;

    // Acomptes (2 max)
    const acomptes: ParsedLot['acomptes'] = [];
    for (let k = 0; k < 2; k++) {
      const pctCol = 13 + k * 2;
      const amountCol = 14 + k * 2;
      const pct = parsePct(row[pctCol]);
      const amount = parseMontant(row[amountCol]);
      if (amount && amount > 0) {
        acomptes.push({ acompte_number: k + 1, pct, amount });
      }
    }

    lots.push({
      original_ref: col0,
      suite_label: currentSuite,
      category: mapAchatCategory(category),
      description: product || category || null,
      supplier_name: supplier || '(non renseigné)',
      collaborator_name: (row[4] ?? '').trim() || null,
      quantity: parseQuantity(row[5]),
      unit_price_mad: parseMontant(row[6]),
      budget_estimate_mad: parseMontant(row[7]),
      devis_fournisseur_mad: parseMontant(row[10]),
      status: mapAchatStatus(row[19]),
      devis_number: (row[20] ?? '').trim() || null,
      date_livraison_estimee: parseDateFR(row[21]),
      date_livraison_reelle: parseDateFR(row[22]),
      acomptes,
    });
  }

  return { meta, lots };
}

// ─── Dry-run summary ──────────────────────────────────────────────────────

export type SupplierDecision = {
  csv_name: string;          // nom tel qu'écrit dans le CSV
  matched_id: string | null; // FK artisans si match trouvé (case-insensitive)
  matched_name: string | null;
  will_create: boolean;      // true si à créer en option B
};

export type CollaboratorDecision = {
  csv_name: string;
  matched_id: string | null;
  matched_full_name: string | null;
};

export type SuiteMapping = {
  suite_label: string;        // "SUITE 1"
  matched_unit_id: string | null;
  matched_unit_name: string | null;
  lots_count: number;
};

export type DryRunSummary = {
  meta: ParsedMeta;
  lots_count: number;
  acomptes_count: number;
  total_budget_estime: number;
  total_devis_fournisseur: number;
  total_paye_acomptes: number;
  suppliers: SupplierDecision[];
  collaborators: CollaboratorDecision[];
  suites: SuiteMapping[];
  lots_preview: ParsedLot[];
  warnings: string[];
};

// ─── Action principale ────────────────────────────────────────────────────

export async function importAchatsCsvAction(input: {
  project_id: string;
  csv_text: string;
  dry_run: boolean;
  create_missing_suppliers?: boolean;  // option B confirmation
}): Promise<{ ok: true; dryRun: boolean; summary: DryRunSummary } | { ok: false; error: string }> {
  try {
    // Import CSV : CEO + chef_projet + achats (CEO 2026-09-02).
    // Rôles ayant déjà l'écriture achats en usage normal — pas de nouveau risque.
    await assertRole(PROJECT_CSV_IMPORT_ROLES);
    const supabase = createClient();

    // Projet existe ?
    const { data: proj, error: projErr } = await supabase
      .from('projects')
      .select('id, reference, property_id')
      .eq('id', input.project_id)
      .maybeSingle();
    if (projErr || !proj) return { ok: false, error: 'Projet introuvable' };
    if (!input.csv_text) return { ok: false, error: 'Aucun CSV fourni' };

    // Parse
    const parsed = parseFeuilleAchats(parseCSV(input.csv_text));
    const meta = parsed.meta;
    const lots = parsed.lots;
    const warnings: string[] = [];

    if (lots.length === 0) {
      return { ok: false, error: 'Aucun lot d\'achat détecté dans le CSV' };
    }

    // ─── Résolution fournisseurs ────────────────────────────────────────
    const supplierNames = Array.from(new Set(
      lots.map(l => l.supplier_name).filter(n => n && n !== '(non renseigné)')
    ));
    const { data: existingArtisans } = await supabase
      .from('artisans')
      .select('id, name')
      .is('deleted_at', null);
    const artisanByNorm = new Map<string, { id: string; name: string }>();
    for (const a of existingArtisans ?? []) {
      artisanByNorm.set(normalizeName(a.name), { id: a.id, name: a.name });
    }
    const suppliers: SupplierDecision[] = supplierNames.map(name => {
      const m = artisanByNorm.get(normalizeName(name));
      return {
        csv_name: name,
        matched_id: m?.id ?? null,
        matched_name: m?.name ?? null,
        will_create: !m,
      };
    });

    // ─── Résolution collaborateurs (best-effort, jamais bloquant) ───────
    const collabNames = Array.from(new Set(
      lots.map(l => l.collaborator_name).filter((n): n is string => !!n)
    ));
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('is_active', true);
    const profileByNorm = new Map<string, { id: string; full_name: string }>();
    for (const p of profiles ?? []) {
      if (p.full_name) profileByNorm.set(normalizeName(p.full_name), { id: p.id, full_name: p.full_name });
    }
    const collaborators: CollaboratorDecision[] = collabNames.map(name => {
      const m = profileByNorm.get(normalizeName(name));
      return {
        csv_name: name,
        matched_id: m?.id ?? null,
        matched_full_name: m?.full_name ?? null,
      };
    });

    // ─── Résolution suites ──────────────────────────────────────────────
    // Colonnes réelles : id, order_index (INTEGER), code (TEXT). Pas de "name"/"numero".
    let propriaUnits: Array<{ id: string; code: string | null; order_index: number }> = [];
    if (proj.property_id) {
      const { data: units, error: unitsErr } = await supabase
        .from('propria_units')
        .select('id, order_index, code')
        .eq('property_id', proj.property_id)
        .is('deleted_at', null)
        .order('order_index', { ascending: true });
      if (unitsErr) console.error('[importAchatsCsvAction] propria_units fetch error:', unitsErr);
      propriaUnits = (units ?? []) as any;
    }
    const suiteLabels = Array.from(new Set(
      lots.map(l => l.suite_label).filter((s): s is string => !!s)
    )).sort();
    const suites: SuiteMapping[] = suiteLabels.map((label) => {
      // "SUITE 1" → unit avec order_index=1, "SUITE 2" → order_index=2, etc.
      const matchNum = parseInt(label.replace(/[^\d]/g, ''), 10);
      const unit = isFinite(matchNum) ? propriaUnits.find(u => u.order_index === matchNum) : undefined;
      const lots_count = lots.filter(l => l.suite_label === label).length;
      return {
        suite_label: label,
        matched_unit_id: unit?.id ?? null,
        matched_unit_name: unit ? (unit.code ?? `Suite ${unit.order_index}`) : null,
        lots_count,
      };
    });

    if (suiteLabels.length > 0 && propriaUnits.length === 0) {
      warnings.push(`${suiteLabels.length} suite(s) détectée(s) dans le CSV mais le bien n'a aucune unit Propria → les achats seront rattachés au bien global.`);
    }
    if (suiteLabels.length > propriaUnits.length && propriaUnits.length > 0) {
      warnings.push(`${suiteLabels.length} suites dans le CSV vs ${propriaUnits.length} units créées sur le bien → les suites en excès ne seront pas rattachées.`);
    }

    // ─── Totaux ─────────────────────────────────────────────────────────
    const total_budget_estime = lots.reduce((s, l) => s + (l.budget_estimate_mad ?? 0), 0);
    const total_devis_fournisseur = lots.reduce((s, l) => s + (l.devis_fournisseur_mad ?? 0), 0);
    const total_paye_acomptes = lots.reduce((s, l) => s + l.acomptes.reduce((a, b) => a + b.amount, 0), 0);

    const summary: DryRunSummary = {
      meta,
      lots_count: lots.length,
      acomptes_count: lots.reduce((s, l) => s + l.acomptes.length, 0),
      total_budget_estime,
      total_devis_fournisseur,
      total_paye_acomptes,
      suppliers,
      collaborators,
      suites,
      lots_preview: lots,
      warnings,
    };

    if (input.dry_run) {
      return { ok: true, dryRun: true, summary };
    }

    // ─── Insertion réelle ───────────────────────────────────────────────
    const fixName = `import-achats-${input.project_id}`;
    const { count: alreadyApplied } = await supabase
      .from('data_fix_log')
      .select('id', { count: 'exact', head: true })
      .eq('fix_name', fixName);
    if ((alreadyApplied ?? 0) > 0) {
      return { ok: false, error: 'Cet import achats a déjà été effectué pour ce projet. Pour ré-importer, contacte un dev pour rollback préalable.' };
    }

    // 1. Update projet (meta livraison + budget global)
    const projUpdate: any = { updated_at: new Date().toISOString() };
    if (meta.budget_global_mad) projUpdate.achats_budget_mad = meta.budget_global_mad;
    if (meta.marge_cible_pct != null) projUpdate.achats_marge_cible_pct = meta.marge_cible_pct;
    if (Object.keys(projUpdate).length > 1) {
      const { error } = await supabase.from('projects').update(projUpdate).eq('id', input.project_id);
      if (error) return { ok: false, error: `Update projet: ${error.message}` };
    }

    // 2. Auto-create fournisseurs manquants (si option activée)
    const newSupplierIdByName = new Map<string, string>();
    if (input.create_missing_suppliers) {
      const toCreate = suppliers.filter(s => s.will_create);
      for (const s of toCreate) {
        const { data: created, error: createErr } = await supabase
          .from('artisans')
          .insert({
            name: s.csv_name,
            type: 'fournisseur',
            status: 'actif',
            notes: `Auto-créé depuis import CSV achats — projet ${proj.reference}`,
          })
          .select('id')
          .single();
        if (createErr) return { ok: false, error: `Création fournisseur "${s.csv_name}": ${createErr.message}` };
        newSupplierIdByName.set(normalizeName(s.csv_name), created.id);
      }
    }
    // Refresh map artisan : existant + nouvellement créés
    const resolveSupplierId = (name: string): string | null => {
      const norm = normalizeName(name);
      return artisanByNorm.get(norm)?.id ?? newSupplierIdByName.get(norm) ?? null;
    };
    const resolveCollaboratorId = (name: string | null): string | null => {
      if (!name) return null;
      return profileByNorm.get(normalizeName(name))?.id ?? null;
    };
    const resolveSuiteUnitId = (label: string | null): string | null => {
      if (!label) return null;
      const m = suites.find(s => s.suite_label === label);
      return m?.matched_unit_id ?? null;
    };

    // 3. Insert lots avec auto-renumérotation séquentielle
    const lotIdByIndex = new Map<number, string>();
    let nextNumero = 1;
    // Trouve le max existant pour ne pas écraser
    const { data: maxRow } = await supabase
      .from('achats_lots')
      .select('numero')
      .eq('project_id', input.project_id)
      .order('numero', { ascending: false })
      .limit(1)
      .maybeSingle();
    nextNumero = (maxRow?.numero ?? 0) + 1;

    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      const collabId = resolveCollaboratorId(lot.collaborator_name);
      const notesPieces: string[] = [`Import CSV — N° original ${lot.original_ref || '(vide)'}`];
      if (lot.suite_label) notesPieces.push(`Section : ${lot.suite_label}`);
      if (lot.collaborator_name && !collabId) notesPieces.push(`Collaborateur (non rattaché) : ${lot.collaborator_name}`);

      const insertPayload: any = {
        project_id: input.project_id,
        numero: nextNumero++,
        propria_unit_id: resolveSuiteUnitId(lot.suite_label),
        category: lot.category,
        description: lot.description,
        supplier_name: lot.supplier_name,
        supplier_id: resolveSupplierId(lot.supplier_name),
        collaborator_id: collabId,
        devis_number: lot.devis_number,
        quantity: lot.quantity,
        unit_price_mad: lot.unit_price_mad,
        budget_estimate_mad: lot.budget_estimate_mad,
        devis_fournisseur_mad: lot.devis_fournisseur_mad,
        // Achats : on assume facture_client = budget_estimate (canon : prévisionnel = facturé par défaut)
        facture_client_mad: lot.budget_estimate_mad,
        status: lot.status,
        date_livraison_estimee: lot.date_livraison_estimee,
        date_livraison_reelle: lot.date_livraison_reelle,
        notes: notesPieces.join(' · '),
      };

      const { data: inserted, error: lotErr } = await supabase
        .from('achats_lots')
        .insert(insertPayload)
        .select('id')
        .single();
      if (lotErr) return { ok: false, error: `Insert lot ${lot.original_ref || `#${i + 1}`} (${lot.supplier_name}): ${lotErr.message}` };
      lotIdByIndex.set(i, inserted.id);
    }

    // 4. Insert acomptes
    const todayIso = new Date().toISOString().slice(0, 10);
    const paymentRows = lots.flatMap((lot, i) => {
      const lotId = lotIdByIndex.get(i);
      if (!lotId) return [];
      const supplierId = resolveSupplierId(lot.supplier_name);
      return lot.acomptes.map(a => ({
        project_id: input.project_id,
        lot_id: lotId,
        supplier_name: lot.supplier_name,
        supplier_id: supplierId,
        category: lot.category,
        description: lot.description,
        currency: 'MAD',
        amount_total: a.amount,
        amount_paid: a.amount,
        payment_type: 'acompte',
        status: 'paid',
        acompte_number: a.acompte_number,
        acompte_pct: a.pct,
        paid_at: todayIso,
        notes: `Import CSV — acompte ${a.acompte_number}`,
      }));
    });
    if (paymentRows.length > 0) {
      const { error: payErr } = await supabase.from('achats_payments').insert(paymentRows);
      if (payErr) return { ok: false, error: `Insert acomptes: ${payErr.message}` };
    }

    // 5. Audit
    await supabase.from('data_fix_log').insert({
      fix_name: fixName,
      entity: 'projects',
      entity_id: input.project_id,
      snapshot: {
        imported_at: new Date().toISOString(),
        meta,
        lots_count: lots.length,
        acomptes_count: paymentRows.length,
        suppliers_created: input.create_missing_suppliers ? suppliers.filter(s => s.will_create).length : 0,
        suppliers_matched: suppliers.filter(s => !s.will_create).length,
      } as any,
    });

    revalidatePath(`/projects/${input.project_id}/achats`);
    revalidatePath(`/projects/${input.project_id}`);
    revalidatePath('/dashboard/achats');

    return { ok: true, dryRun: false, summary };
  } catch (e: any) {
    console.error('[importAchatsCsvAction]', e);
    return { ok: false, error: e?.message ?? 'Erreur serveur inattendue' };
  }
}
