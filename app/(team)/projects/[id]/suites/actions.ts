'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

/**
 * Initialise / synchronise les suites (propria_units) d'un projet.
 *
 * Règle métier CEO 2026-05-31 :
 *   - properties.nb_suites = INTENTION saisie au sourcing
 *   - propria_units actifs = RÉALISATION matérialisée
 *   - Convention de code : "{LIBELLÉ_BUSINESS} {order_index}"
 *     Exemples réels en base : "WARDA 1", "ZAIDI 1", "BEJ GUENI 2", "PATRICK 3"
 *   - Le libellé est SAISI à l'init (modale UI), pré-rempli avec le nom de
 *     famille du client en majuscules. Jamais d'auto-slug-technique.
 *
 * Idempotente. Ne supprime jamais. La suppression passe par un wizard dédié.
 */
export async function initializePropriaUnitsAction(input: {
  project_id: string;
  libelle: string;  // ex: "ZAIDI" → crée "ZAIDI 1", "ZAIDI 2"...
}) {
  try {
    await assertRole(['ceo', 'chef_projet']);
    const supabase = createClient();

    // 1. Validation libellé
    const libelle = (input.libelle ?? '').trim().toUpperCase();
    if (!libelle) {
      return { ok: false, error: 'Libellé requis (ex: ZAIDI, WARDA, MEHDY)' };
    }
    if (libelle.length > 30) {
      return { ok: false, error: 'Libellé trop long (max 30 caractères)' };
    }
    // Caractères autorisés : lettres, chiffres, espaces, tirets (pas de caractère
    // spécial qui pourrait casser une URL ou un export)
    if (!/^[A-ZÀ-Ý0-9 \-]+$/.test(libelle)) {
      return { ok: false, error: 'Libellé : seulement lettres, chiffres, espaces et tirets' };
    }

    // 2. Récup projet + bien
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .select('id, property_id, reference, property:properties(id, nb_suites, name)')
      .eq('id', input.project_id)
      .maybeSingle();
    if (projErr || !project) return { ok: false, error: 'Projet introuvable' };
    if (!project.property_id) return { ok: false, error: 'Projet sans bien rattaché' };

    const property = project.property as any;
    const nbSuites = Number(property?.nb_suites ?? 0);
    if (!nbSuites || nbSuites < 1) {
      return { ok: false, error: 'Le bien n\'a pas de nb_suites renseigné (à compléter sur la fiche bien)' };
    }

    // 3. Compte les units actives existantes
    const { data: existing } = await supabase
      .from('propria_units')
      .select('id, order_index')
      .eq('property_id', project.property_id)
      .is('deleted_at', null);

    const currentCount = (existing ?? []).length;
    if (currentCount >= nbSuites) {
      return { ok: true, created: 0, total: currentCount, message: 'Suites déjà initialisées' };
    }

    // 4. Pré-calcule les codes + vérifie l'unicité globale (contrainte
    // propria_units_code_uniq sur deleted_at IS NULL)
    const startIdx = currentCount + 1;
    const codes = [];
    for (let i = startIdx; i <= nbSuites; i++) {
      codes.push(`${libelle} ${i}`);
    }

    const { data: conflicts } = await supabase
      .from('propria_units')
      .select('code')
      .in('code', codes)
      .is('deleted_at', null);
    if (conflicts && conflicts.length > 0) {
      return {
        ok: false,
        error: `Code(s) déjà utilisé(s) ailleurs en base : ${conflicts.map((c: any) => c.code).join(', ')}. Choisis un autre libellé.`,
      };
    }

    // 5. INSERT (le trigger respecte le code fourni puisqu'on le passe explicitement)
    // Pré-remplissage métier 2026-06-09 : par défaut 1 chambre + 1 SDB par suite
    // (concept hôtel/Airbnb standard). L'équipe ajuste à la main si nécessaire.
    const toCreate = codes.map((code, idx) => ({
      property_id: project.property_id,
      order_index: startIdx + idx,
      code,
      is_active: true,
      propria_nb_chambres: 1,
      propria_nb_sdb: 1,
    }));

    const { error: insertErr } = await supabase.from('propria_units').insert(toCreate);
    if (insertErr) return { ok: false, error: `Création units : ${insertErr.message}` };

    revalidatePath(`/projects/${input.project_id}`);
    revalidatePath(`/properties/${project.property_id}`);

    return { ok: true, created: toCreate.length, total: nbSuites };
  } catch (e: any) {
    console.error('[initializePropriaUnitsAction]', e);
    return { ok: false, error: e?.message ?? 'Erreur serveur inattendue' };
  }
}
