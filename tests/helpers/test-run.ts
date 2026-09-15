/**
 * Identité d'un "run de test" : un UUID unique par test, qui sert de tag.
 *
 * Pourquoi : si un test crashe avant son cleanup, ses données restent en base.
 * En embarquant le test_run_id dans des champs naturels (email du client,
 * référence du projet), on peut TOUJOURS retrouver et supprimer ces données —
 * soit par run (cleanupTestData), soit globalement (cleanupAllTestData).
 *
 * Aucune colonne ajoutée au schéma : le tag vit dans des champs texte existants.
 */

/** Préfixe commun à toutes les données de test (sert au cleanup global). */
export const TEST_TAG = 'STZTEST';

/** Domaine email réservé aux clients de test (jamais utilisé en vrai). */
export const TEST_EMAIL_DOMAIN = 'stoniz.test';

export type TestRun = {
  /** UUID unique de ce run de test. */
  id: string;
  /** 8 premiers caractères de l'UUID, utilisés dans les tags. */
  short: string;
  /** Email taggé unique, ex: stztest-client-<short>@stoniz.test */
  email(local?: string): string;
  /** Référence projet taggée unique, ex: STZTEST-<short>-001 */
  projectRef(seq?: number): string;
  /** Nom lisible taggé, ex: "[STZTEST <short>] Karim Zaidi" */
  label(name: string): string;
  /** Pattern SQL LIKE pour TOUS les emails de ce run. */
  emailLike(): string;
  /** Pattern SQL LIKE pour TOUTES les références projet de ce run. */
  projectRefLike(): string;
  /** Pattern SQL LIKE pour TOUS les noms taggés de ce run (biens, etc.). */
  labelLike(): string;
};

/** Crée un run de test avec un UUID unique. Un par test (dans beforeEach). */
export function newTestRun(): TestRun {
  const id = crypto.randomUUID();
  const short = id.slice(0, 8);
  return {
    id,
    short,
    email: (local = 'client') =>
      `${TEST_TAG.toLowerCase()}-${local}-${short}@${TEST_EMAIL_DOMAIN}`,
    projectRef: (seq = 1) =>
      `${TEST_TAG}-${short}-${String(seq).padStart(3, '0')}`,
    label: (name: string) => `[${TEST_TAG} ${short}] ${name}`,
    emailLike: () => `${TEST_TAG.toLowerCase()}-%-${short}@${TEST_EMAIL_DOMAIN}`,
    projectRefLike: () => `${TEST_TAG}-${short}-%`,
    labelLike: () => `[${TEST_TAG} ${short}]%`,
  };
}
