/**
 * Constantes et types TVA partagés entre le serveur et le navigateur.
 *
 * Ce fichier ne doit JAMAIS importer `@/lib/supabase/server` ni quoi que ce soit
 * marqué `server-only` : il est importé par des composants `'use client'`
 * (ex. tva-detail-table.tsx). Un import serveur ici embarque la connexion
 * base de données dans le bundle navigateur et casse le build Next.js.
 *
 * Toute la logique qui touche la base reste dans `./tva.ts`.
 */

export const DEFAULT_TVA_RATE = 20;
export const TVA_RATE_OPTIONS = [20, 14, 10, 7, 0] as const;

export type TvaTreatment = 'auto' | 'collectee' | 'deductible' | 'exoneree' | 'a_qualifier';

export type TvaResolved = 'collectee' | 'deductible' | 'exoneree' | 'a_qualifier';
