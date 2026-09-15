import { config as loadEnv } from 'dotenv';
import path from 'node:path';

/**
 * Setup global des tests d'INTÉGRATION (chargé par vitest.integration.config.ts).
 *
 * Rôle unique : charger les variables d'environnement de test avant tout test.
 * On charge .env.test en priorité, puis .env.local en repli (pour réutiliser
 * une config locale déjà en place).
 *
 * Les tests UNITAIRES n'utilisent PAS ce fichier : ils sont purs et ne touchent
 * ni l'environnement ni la base.
 */
const root = path.resolve(__dirname, '..');

loadEnv({ path: path.join(root, '.env.test') });
loadEnv({ path: path.join(root, '.env.local'), override: false });
