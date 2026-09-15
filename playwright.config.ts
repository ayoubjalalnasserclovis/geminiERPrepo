import { defineConfig, devices } from '@playwright/test';

/**
 * Config Playwright — tests end-to-end.
 *
 * Pré-requis pour `npm run test:e2e` :
 *   1. Supabase local démarré + migrations appliquées (npx supabase start)
 *   2. .env.local renseigné (l'app a besoin des clés Supabase pour booter)
 *
 * Le webServer démarre Next automatiquement. En local on réutilise un serveur
 * déjà lancé (npm run dev) ; en CI on le démarre puis on l'arrête proprement.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  // Échoue vite si un test laisse traîner un `.only` en CI.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Sortie lisible : résumé en ligne + rapport HTML navigable (logs lisibles
  // par un non-dev en cas d'échec).
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'on-failure' }]],
  use: {
    baseURL: BASE_URL,
    // Trace + capture uniquement quand un test échoue : debugging facile, CI légère.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
