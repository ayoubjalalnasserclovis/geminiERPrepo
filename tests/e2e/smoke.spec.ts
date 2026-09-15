import { test, expect } from '@playwright/test';

/**
 * SMOKE E2E — prouve que l'app boote et que la page de connexion s'affiche.
 *
 * Volontairement minimal et robuste : pas de login réel (donc pas de dépendance
 * à un utilisateur en base), juste la preuve que le serveur répond et que le
 * formulaire est rendu. Les parcours métier complets viendront enrichir tests/e2e/.
 *
 * Lancé par `npm run test:e2e` (nécessite l'app + Supabase local, cf. runbook).
 */
test('la page de connexion se charge et affiche le formulaire', async ({ page }) => {
  await page.goto('/login');

  // Le champ email du formulaire de connexion est présent.
  await expect(page.locator('input[type="email"]')).toBeVisible();

  // Le bouton de soumission affiche le bon libellé.
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
});
