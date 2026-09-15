import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Config Vitest — tests UNITAIRES (purs, sans base de données).
 *
 * Ce qui tourne ici : toute la logique pure (calculs finance, KPIs, validators…).
 * C'est CETTE suite que `npm test` lance, et que la CI exécute à chaque push.
 * Elle ne dépend d'AUCUN service externe → toujours verte si le code est correct.
 *
 * Les tests qui touchent Supabase vivent dans tests/integration/*.itest.ts et
 * sont lancés séparément (`npm run test:int`) avec vitest.integration.config.ts,
 * car ils exigent une instance Supabase locale (`npx supabase start`).
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './') },
  },
  test: {
    environment: 'node',
    globals: true,
    // On exclut explicitement les tests d'intégration de la suite unitaire :
    // ils ont besoin d'une vraie base et ne doivent pas casser `npm test`.
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: [
      'node_modules/**',
      '.next/**',
      'tests/e2e/**',
      'tests/integration/**',
      '**/*.itest.ts',
    ],
    // Sortie lisible : une ligne par fichier, détail seulement sur les échecs.
    reporters: 'default',
  },
});
