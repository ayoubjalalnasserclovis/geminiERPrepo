# Structure du projet — inventaire des fichiers V1

## Configuration

- `package.json` — dépendances + scripts npm
- `tsconfig.json`, `next.config.js`, `tailwind.config.ts`, `postcss.config.js`, `components.json`
- `.env.example`, `.gitignore`, `.eslintrc.json`, `vitest.config.ts`, `vercel.json`
- `README.md` — installation + déploiement
- `docs/GETTING_STARTED.md` — démo end-to-end

## Base de données (`supabase/migrations/`)

13 migrations dans l'ordre d'exécution :

1. `..._extensions_and_helpers.sql` — extensions, ENUMs, `set_updated_at`, `audit_trigger`
2. `..._profiles.sql` — profiles + auth triggers + helpers RLS (`is_staff`)
3. `..._partners.sql` — partenaires + agents
4. `..._clients.sql` — clients
5. `..._properties.sql` — biens + médias + vue enrichie
6. `..._projects.sql` — projets + phases history + auto-référence
7. `..._tasks_and_proposals.sql` — tâches + templates + propositions
8. `..._payments.sql` — paiements Stoniz + travaux (EUR/MAD)
9. `..._documents_and_communications.sql` — documents, surveys, emails, jobs, notifs
10. `..._business_rpc.sql` — `advance_project_phase`, `respond_to_proposal`, `send_proposal`
11. `..._rls_policies.sql` — RLS sur toutes les tables
12. `..._storage_setup.sql` — buckets + politiques Storage
13. `..._audit_triggers.sql` — triggers d'audit sur tables sensibles
14. `..._seed_task_templates.sql` — 35 templates de tâches (6 phases)

## Lib partagée (`lib/`)

- `supabase/server.ts` — client SSR (Server Components / Server Actions)
- `supabase/browser.ts` — client navigateur
- `supabase/admin.ts` — client service_role (server-only)
- `supabase/middleware.ts` — refresh session pour middleware
- `auth/require.ts` — `getSessionUser`, `requireRole`, `assertRole`
- `finance/stoniz-fees.ts` + `.test.ts` — calcul honoraires + tests Vitest
- `fx/exchange-rate.ts` — taux EUR/MAD avec cache 24h
- `email/send.ts` — envoi Resend + log + idempotence
- `email/templates.ts` — templates HTML (bienvenue, proposition, phase, rappel paiement)
- `validators/schemas.ts` — schémas zod partagés
- `utils/cn.ts`, `utils/format.ts` — utilitaires

## Auth (`app/login`, `app/reset-password`, ...)

- `app/login/page.tsx` + `login-form.tsx` (login)
- `app/reset-password/page.tsx` (demande de reset)
- `app/update-password/page.tsx` (nouveau mot de passe)
- `app/auth/callback/route.ts` (exchange code → session après magic link)
- `app/logout/route.ts` (déconnexion)
- `middleware.ts` (protection par rôle)

## UI primitives (`components/ui/`)

- `button.tsx`, `card.tsx`, `input.tsx`, `badge.tsx`, `table.tsx`
- `empty-state.tsx`, `page-header.tsx`, `money.tsx`

## Layouts (`components/layout/`)

- `sidebar-team.tsx` — sidebar équipe noire (filtrée par rôle)
- `header-client.tsx` — header portail client

## Espace équipe (`app/(team)/`)

| Route | Fichiers | Fonctionnalités |
|---|---|---|
| `/dashboard` | `dashboard/page.tsx` | KPIs basiques |
| `/clients` | `clients/page.tsx`, `new/`, `[id]/`, `[id]/edit/`, `actions.ts` | CRUD + invitation portail |
| `/partners` | `partners/page.tsx`, `new/`, `[id]/`, `[id]/edit/`, `actions.ts` | CRUD |
| `/properties` | `properties/page.tsx`, `new/`, `[id]/`, `[id]/edit/`, `actions.ts` | CRUD + filtres statut |
| `/projects` | `projects/page.tsx`, `new/`, `[id]/`, `actions.ts` | Création + timeline + advance_phase |
| `/projects/[id]/tasks` | `tasks/page.tsx` | Vue tâches par phase |
| `/projects/[id]/proposals` | `proposals/page.tsx`, `actions.ts` | Envoi proposition (RPC `send_proposal`) |
| `/projects/[id]/payments` | `payments/page.tsx`, `actions.ts` | Stoniz + Travaux (EUR/MAD) |
| `/projects/[id]/documents` | `documents/page.tsx`, `actions.ts` | Upload Storage + signed URLs |
| `/tasks` | `tasks/page.tsx`, `actions.ts` | Vue globale tâches |
| `/team` | `team/page.tsx` | Équipe (CEO uniquement) |
| `/settings` | `settings/page.tsx` | Paramètres + taux FX |

## Portail client (`app/(client)/client/`)

- `page.tsx` — dashboard (1 projet → redirect direct, N projets → grille)
- `projects/[id]/page.tsx` — vue projet (timeline + paiements + alerte propositions)
- `projects/[id]/proposals/page.tsx` + `actions.ts` — réception et réponse propositions (RPC atomique)
- `documents/page.tsx` — docs partagés visibles
- `profile/page.tsx` — profil + mention RGPD

## API routes (`app/api/`)

- `cron/daily/route.ts` — cron quotidien Vercel (consomme `scheduled_jobs` + rappels paiements + purge logs)
- `webhooks/resend/route.ts` — webhook Resend (status emails)

## Composants métier (`components/`)

- `clients/client-form.tsx`, `clients/invite-client-button.tsx`
- `partners/partner-form.tsx`
- `properties/property-form.tsx`
- `projects/project-form.tsx`, `projects/timeline.tsx`, `projects/advance-phase-button.tsx`, `projects/recalc-fees-button.tsx`
- `tasks/task-row.tsx`
- `proposals/send-proposal-dialog.tsx`, `proposals/proposal-card.tsx`
- `finance/payment-edit-dialog.tsx`, `finance/travaux-payment-dialog.tsx`
- `documents/document-upload.tsx`, `documents/document-download-link.tsx`

## Total

~ **70 fichiers code/sql/md** créés.

## Non livré (V1.1)

- Templates emails React Email avancés (HTML inline OK pour V1)
- UI MFA setup (Supabase gère le backend)
- Tests Playwright e2e
- Suite de tests RLS dédiée
- UI audit log (les triggers fonctionnent, table accessible via Studio)
- Module enquêtes satisfaction côté client
- Galerie médias bien (upload prêt, UI à finir)
- Dashboard partenaires comparatif visuel
