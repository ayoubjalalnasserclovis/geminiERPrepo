'use server';

import { createHash } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { propertyCreateSchema } from '@/lib/validators/schemas';
import { logDeletion } from '@/lib/audit/deletion';
import {
  isMasterErpFormat,
  mapMasterErpRow,
  findDuplicateName,
} from '@/lib/properties/master-erp-csv';

function cleanInput(data: any) {
  ['price','initial_asking_price','estimated_rent','agency_fees','notary_fees','travaux_budget_estimate','stoniz_reduction','superficie','terrasse_m2','nb_suites','nb_lots_residence','year_built','latitude','longitude','evaluation','sourcing_commission_rate','charges_mensuelles_immeuble','frais_fonctionnement_annuel','conciergerie_annuel','emprunt_mensuel','revenu_locatif_brut_annuel','taux_occupation','impots_annuel']
    .forEach(k => {
      if (data[k] === '' || data[k] == null) data[k] = null;
      else if (data[k] !== null && data[k] !== undefined) data[k] = Number(data[k]);
    });
  // La réduction Stoniz n'est plus saisie dans le formulaire → toujours 0 par défaut.
  if (data.stoniz_reduction == null) data.stoniz_reduction = 0;
  ['sourcing_date','first_visit_date','offer_date'].forEach(k => {
    if (data[k] === '') data[k] = null;
  });
  ['partner_id','partner_agent_id'].forEach(k => {
    if (data[k] === '') data[k] = null;
  });
  // drive_url, google_maps_url, video_url sont normalisés en null par optionalUrl.
  if (data.description === '') data.description = null;
  if (data.badge_label === '') data.badge_label = null;
  if (data.apartment_number === '') data.apartment_number = null;
  return data;
}

export async function createPropertyAction(input: unknown) {
  await assertRole(['ceo','chef_projet','sourcing']);
  const cleaned = cleanInput({ ...(input as any) });
  const parsed = propertyCreateSchema.safeParse(cleaned);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const payload: any = { ...parsed.data, sourced_by: user?.id };

  const { data, error } = await supabase.from('properties').insert(payload).select('id').single();
  if (error) return { ok: false, error: error.message };
  revalidatePath('/properties');
  return { ok: true, id: data.id };
}

export async function updatePropertyAction(id: string, input: unknown) {
  await assertRole(['ceo','chef_projet','sourcing']);
  const cleaned = cleanInput({ ...(input as any) });
  const parsed = propertyCreateSchema.safeParse(cleaned);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { error } = await supabase.from('properties').update(parsed.data).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/properties/${id}`);
  return { ok: true };
}

const PROPERTY_STATUSES = ['sourcing','disponible','propose','offre','vendu','perdu','a_verifier'];

export async function updatePropertyStatusAction(id: string, status: string) {
  await assertRole(['ceo','chef_projet','sourcing']);
  if (!PROPERTY_STATUSES.includes(status)) {
    return { ok: false, error: 'Statut invalide' };
  }
  const supabase = createClient();
  const { error } = await supabase.from('properties').update({ status }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/properties');
  return { ok: true };
}

export async function deletePropertyAction(id: string) {
  const user = await assertRole(['ceo','chef_projet','sourcing']);
  const supabase = createClient();
  const { data: prop } = await supabase.from('properties').select('*').eq('id', id).single();
  const { error } = await supabase
    .from('properties')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  await logDeletion({
    table: 'properties',
    recordId: id,
    actorId: user.id,
    label: prop ? `Bien ${(prop as any).reference ?? ''} - ${(prop as any).title ?? (prop as any).address_line1 ?? ''}` : 'Bien',
    snapshot: prop,
  });
  revalidatePath('/properties');
  return { ok: true };
}

// ─── Workflow publication ─────────────────────────────────────────────────

/**
 * Publie un bien (le rend visible aux équipes projet).
 * Vérifie via la fonction PL/pgSQL que toutes les étapes sont complétées :
 * sourcing_type + (partner_id OU assigned_chasseur) + au moins 1 média.
 */
export async function publishPropertyAction(id: string) {
  await assertRole(['ceo','chef_projet','sourcing']);
  const supabase = createClient();
  const { error } = await supabase.rpc('publish_property', { p_property_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/properties');
  revalidatePath(`/properties/${id}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Remet un bien en brouillon (retire de la liste équipe).
 * Utile pour corriger une fiche incomplète après publication.
 */
export async function unpublishPropertyAction(id: string) {
  await assertRole(['ceo','chef_projet','sourcing']);
  const supabase = createClient();
  const { error } = await supabase.rpc('unpublish_property', { p_property_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/properties');
  revalidatePath(`/properties/${id}`);
  return { ok: true };
}

// ─── Import CSV en masse ──────────────────────────────────────────────────

const ALLOWED_TYPES = ['Appartement', 'Riad', 'Villa', 'Terrain'];
const ALLOWED_STATUSES = ['sourcing','disponible','propose','offre','vendu','perdu','a_verifier'];

type ImportRowError = { row: number; field?: string; error: string };

/**
 * Parse minimal CSV (gère les guillemets et les virgules dans les cellules).
 * Renvoie une liste de lignes (chaque ligne = tableau de valeurs).
 */
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
  // Filtre les lignes complètement vides
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function num(v: string | undefined | null): number | null {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : null;
}

export async function importPropertiesCSVAction(formData: FormData) {
  await assertRole(['ceo','chef_projet','sourcing']);
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) return { ok: false, error: 'Aucun fichier fourni.' };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'Fichier trop volumineux (max 5 MB).' };

  const text = await file.text();

  // QA-BUG-013 — Idempotence (canon imports) : un fichier identique ne peut
  // être importé qu'une seule fois (fingerprint contenu → data_fix_log).
  const fingerprint = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const fixName = `import-properties-csv-${fingerprint}`;
  const { count: alreadyApplied } = await supabase
    .from('data_fix_log')
    .select('id', { count: 'exact', head: true })
    .eq('fix_name', fixName);
  if ((alreadyApplied ?? 0) > 0) {
    return { ok: false, error: 'Ce fichier CSV a déjà été importé (voir data_fix_log). Modifie le fichier ou contacte un dev pour rollback.' };
  }

  const rows = parseCSV(text);
  if (rows.length < 2) return { ok: false, error: 'Le CSV doit contenir au moins une ligne de données (en plus de l\'entête).' };

  const headers = rows[0].map(h => h.trim());
  const dataRows = rows.slice(1);

  // ─── Autodétection du format ────────────────────────────────────────
  // - Format MASTER ERP : présence de cost_bien + loyer_brut_mensuel + surface
  // - Format natif : présence de name + type + quartier + price + ...
  const isMasterErp = isMasterErpFormat(headers);

  // Map header → index (utilisé en format natif uniquement)
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => { idx[h] = i; });

  // ─── Préparation lignes : on construit une fonction getValue(rowIdx, field)
  // qui retourne la valeur du champ NATIF, qu'on soit en format natif ou
  // qu'on ait transformé depuis MASTER ERP en amont.
  type RowGetter = (rowIdx: number, field: string) => string;
  let getValue: RowGetter;

  if (isMasterErp) {
    // Convertit chaque ligne legacy → objet format natif via le mapper
    const legacyRows: Record<string, string>[] = dataRows.map(row => {
      const dict: Record<string, string> = {};
      headers.forEach((h, i) => { dict[h] = row[i] ?? ''; });
      return dict;
    });
    const nativeMapped = legacyRows.map(mapMasterErpRow);
    getValue = (rowIdx, field) => (nativeMapped[rowIdx] as any)?.[field] ?? '';
  } else {
    // Format natif : vérifier que les colonnes requises sont présentes
    const REQUIRED_HEADERS = [
      'name', 'type', 'quartier', 'address', 'google_maps_url',
      'superficie', 'terrasse_m2', 'floor', 'nb_suites', 'evaluation',
      'status', 'price', 'estimated_rent', 'travaux_budget_estimate',
      'description', 'charges_mensuelles_immeuble', 'taux_occupation',
      'frais_fonctionnement_annuel', 'conciergerie_annuel',
    ];
    const missingHeaders = REQUIRED_HEADERS.filter(h => !(h in idx));
    if (missingHeaders.length > 0) {
      return { ok: false, error: `Colonnes manquantes dans le CSV : ${missingHeaders.join(', ')}` };
    }
    getValue = (rowIdx, field) => (dataRows[rowIdx][idx[field]] ?? '').trim();
  }

  const errors: ImportRowError[] = [];
  const toInsert: any[] = [];

  for (let r = 0; r < dataRows.length; r++) {
    const rowNum = r + 2; // ligne réelle dans le fichier (1 = headers)
    const get = (h: string) => String(getValue(r, h) ?? '').trim();

    const name = get('name');
    const type = get('type');
    const quartier = get('quartier');
    const address = get('address');
    const gmaps = get('google_maps_url');
    const status = get('status') || 'sourcing';
    const evalRaw = get('evaluation');
    const description = get('description');

    // Validations bloquantes
    if (!name) { errors.push({ row: rowNum, field: 'name', error: 'Nom obligatoire' }); continue; }
    if (!ALLOWED_TYPES.includes(type)) {
      errors.push({ row: rowNum, field: 'type', error: `Type invalide (attendu : ${ALLOWED_TYPES.join(', ')})` });
      continue;
    }
    if (!quartier) { errors.push({ row: rowNum, field: 'quartier', error: 'Quartier obligatoire' }); continue; }
    if (!address) { errors.push({ row: rowNum, field: 'address', error: 'Adresse obligatoire' }); continue; }
    // Google Maps : strict en format natif, optionnel en MASTER ERP (à compléter ensuite)
    if (!isMasterErp) {
      if (!gmaps || !/^https?:\/\//.test(gmaps)) {
        errors.push({ row: rowNum, field: 'google_maps_url', error: 'Lien Google Maps invalide' });
        continue;
      }
    }
    if (!ALLOWED_STATUSES.includes(status)) {
      errors.push({ row: rowNum, field: 'status', error: `Statut invalide (attendu : ${ALLOWED_STATUSES.join(', ')})` });
      continue;
    }
    const evalNum = Number(evalRaw);
    if (!evalRaw || ![1, 2, 3].includes(evalNum)) {
      errors.push({ row: rowNum, field: 'evaluation', error: 'Évaluation doit être 1, 2 ou 3' });
      continue;
    }
    if (!description) { errors.push({ row: rowNum, field: 'description', error: 'Description obligatoire' }); continue; }

    const price = num(get('price'));
    if (price == null || price <= 0) {
      errors.push({ row: rowNum, field: 'price', error: 'Prix obligatoire (> 0)' });
      continue;
    }

    // Auto-calc frais notaire / agence si vides
    const fraisNotaire = num(get('notary_fees')) ?? Math.round(price * 0.07);
    const fraisAgence = num(get('agency_fees')) ?? Math.round(price * 0.03);

    const avantages = get('avantages').split('|').map(s => s.trim()).filter(Boolean);
    const pointsNegatifs = get('points_negatifs').split('|').map(s => s.trim()).filter(Boolean);

    // Champs additionnels MASTER ERP (vides en format natif)
    const empruntMensuel = num(get('emprunt_mensuel'));
    const impotsAnnuel = num(get('impots_annuel'));
    const videoUrl = get('video_url');
    const nbLotsResidence = num(get('nb_lots_residence'));

    toInsert.push({
      name,
      type,
      quartier,
      address,
      google_maps_url: gmaps || null,
      superficie: num(get('superficie')),
      terrasse_m2: num(get('terrasse_m2')) ?? 0,
      floor: get('floor'),
      nb_suites: num(get('nb_suites')) ?? 0,
      nb_lots_residence: nbLotsResidence,
      evaluation: evalNum,
      status,
      price,
      estimated_rent: num(get('estimated_rent')),
      travaux_budget_estimate: num(get('travaux_budget_estimate')),
      notary_fees: fraisNotaire,
      agency_fees: fraisAgence,
      description,
      avantages,
      points_negatifs: pointsNegatifs,
      charges_mensuelles_immeuble: num(get('charges_mensuelles_immeuble')),
      taux_occupation: num(get('taux_occupation')),
      frais_fonctionnement_annuel: num(get('frais_fonctionnement_annuel')),
      conciergerie_annuel: num(get('conciergerie_annuel')),
      emprunt_mensuel: empruntMensuel,
      impots_annuel: impotsAnnuel,
      video_url: videoUrl || null,
      sourced_by: user?.id ?? null,
      // Tous les biens importés démarrent en brouillon (non publiés)
      is_published: false,
    });
  }

  // ─── Dédoublonnage par similarité de nom (CEO 2026-06-17) ─────────────
  // Avant : exact match insensible à la casse → ratait "117 m2 anbar" vs "117 M2 Anbar".
  // Après : matching par tokens normalisés (sans m², ponctuation, accents).
  const skippedDuplicates: string[] = [];
  if (toInsert.length > 0) {
    const { data: existing } = await supabase
      .from('properties')
      .select('name')
      .is('deleted_at', null);
    const existingNames = (existing ?? []).map((e: any) => String(e.name));
    for (let i = toInsert.length - 1; i >= 0; i--) {
      const matched = findDuplicateName(toInsert[i].name, existingNames);
      if (matched) {
        errors.push({
          row: -1,
          field: 'name',
          error: `Bien déjà existant, ignoré : "${toInsert[i].name}" (match : "${matched}")`,
        });
        skippedDuplicates.push(toInsert[i].name);
        toInsert.splice(i, 1);
      }
    }
  }

  // Insertion en batch
  let inserted = 0;
  if (toInsert.length > 0) {
    const { error: insErr, count } = await supabase
      .from('properties')
      .insert(toInsert, { count: 'exact' });
    if (insErr) {
      return { ok: false, error: `Échec insertion : ${insErr.message}`, errors };
    }
    inserted = count ?? toInsert.length;
  }

  // QA-BUG-013 — Audit : snapshot de l'opération pour rollback/idempotence.
  // CEO 2026-06-19 — on ne pose le marqueur d'idempotence QUE si au moins
  // 1 bien a été inséré. Sinon Chakib se faisait bloquer alors que l'import
  // précédent n'avait rien créé (tous rejetés ou tous doublons) → "déjà
  // importé" trompeur, impossible de re-essayer même après correction du CSV.
  if (inserted > 0) {
    await supabase.from('data_fix_log').insert({
      fix_name: fixName,
      entity: 'properties',
      entity_id: fingerprint,
      snapshot: {
        imported_at: new Date().toISOString(),
        file_name: file.name,
        inserted_names: toInsert.map((t: any) => t.name),
        inserted_count: inserted,
        rejected_count: errors.length,
      } as any,
    });
  }

  revalidatePath('/properties');
  revalidatePath('/properties/incomplets');
  revalidatePath('/dashboard/sourcing');

  return {
    ok: true,
    imported: inserted,
    skipped: errors.length,
    total: dataRows.length,
    errors,
  };
}

// ─── Brouillon publication : exclusion manuelle (CEO 2026-06-18) ──────────
// Flag pour cacher un brouillon legacy qu'on ne complétera pas (sans le
// supprimer ni mentir sur son statut métier). PAS équivalent à publié :
// le bien ne sera pas listé sur les pages publiques pour autant.
export async function togglePublicationChecklistExclusionAction(
  propertyId: string,
  excluded: boolean,
) {
  await assertRole(['ceo', 'chef_projet', 'sourcing', 'developer']);
  const supabase = createClient();
  const { error } = await supabase
    .from('properties')
    .update({ excluded_from_publication_checklist: excluded } as any)
    .eq('id', propertyId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/properties');
  revalidatePath('/properties/incomplets');
  revalidatePath(`/properties/${propertyId}`);
  return { ok: true as const };
}
