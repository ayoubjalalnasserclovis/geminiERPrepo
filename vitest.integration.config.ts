import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Config Vitest — tests d'INTÉGRATION (touchent une vraie base Supabase).
 *
 * Pré-requis : `npx supabase start` + migrations appliquées (`supabase db reset`),
 * et un fichier .env.test pointant vers l'instance LOCALE (cf. .env.test.example).
 *
 * Lancé par `npm run test:int`. Ces tests créent et NETTOIENT leurs propres
 * fixtures (chaque test a un test_run_id unique, cleanup en afterEach).
 *
 * Pourquoi séparé de la suite unitaire : pour que `npm test` reste exécutable
 * sans Docker (CI, machine sans Supabase) et toujours vert si le code est bon.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './') },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.itest.ts'],
    // Charge .env.test, le client Supabase de test et la garde anti-prod.
    setupFiles: ['tests/setup.ts'],
    // Les tests d'intégration partagent une base : on évite les écritures
    // concurrentes entre fichiers pour garder un cleanup déterministe.
    fileParallelism: false,
    // Création/cleanup de fixtures = quelques aller-retours réseau : marge large.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: 'default',
  },
});
