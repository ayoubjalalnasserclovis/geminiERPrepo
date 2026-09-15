# Stoniz Platform — V1

Plateforme de gestion de projets Clé en Main pour Stoniz.

> **Statut V1** : fondation complète + modules CRUD principaux + flow propositions critiques.
> Voir la section "Roadmap" en bas pour ce qui reste à câbler.

---

## 1. Prérequis

- **Node.js** 20+ et **npm** 10+
- **Compte Supabase** (plan Pro recommandé pour PITR et MFA)
- **Compte Vercel** (Pro recommandé pour Cron + bandes preview)
- **Compte Resend** (pour les emails — optionnel en local)
- **Compte Upstash Redis** (pour rate limiting — optionnel en local)
- **CLI Supabase** : `brew install supabase/tap/supabase` (ou voir docs Supabase)

---

## 2. Setup local

```bash
# 1. Cloner & installer
cd stoniz-platform
npm install

# 2. Copier l'env example
cp .env.example .env.local
# → renseigner les valeurs (voir section 3)

# 3. Lancer Supabase local
supabase start
# → récupérer NEXT_PUBLIC_SUPABASE_URL et anon key dans la sortie

# 4. Appliquer les migrations
supabase db reset
# → applique tout supabase/migrations/* et le seed

# 5. Créer le premier utilisateur CEO
# Aller sur http://localhost:54323 (Supabase Studio)
# Auth → Users → Add user → email/password
# Puis SQL Editor :
#   UPDATE profiles SET role = 'ceo', full_name = 'Votre Nom' WHERE email = 'votre@email.com';

# 6. Lancer Next.js
npm run dev
# → http://localhost:3000
```

---

## 3. Variables d'environnement

Voir `.env.example` pour la liste complète. Minimum requis pour faire tourner l'app :

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=$(openssl rand -hex 32)
```

Optionnel (les modules concernés afficheront un warning si manquant) :

```env
RESEND_API_KEY=...           # pour envoyer des vrais emails
RESEND_WEBHOOK_SECRET=...
UPSTASH_REDIS_REST_URL=...   # pour rate limiting
UPSTASH_REDIS_REST_TOKEN=...
SENTRY_DSN=...
NEXT_PUBLIC_SENTRY_DSN=...
```

---

## 4. Déploiement Vercel + Supabase

### Supabase production

```bash
# 1. Créer un projet Supabase région eu-west-3 (Paris)
# 2. Récupérer l'access token Supabase
supabase link --project-ref <votre-project-ref>
supabase db push
# → applique toutes les migrations

# 3. Configurer Storage : créer les 3 buckets PRIVÉS dans Supabase Studio
#    - documents
#    - property-media
#    - avatars
#    Les politiques RLS sur storage.objects sont incluses dans la migration 11.

# 4. Configurer Auth (Supabase Studio → Auth → Providers)
#    - Email : enabled
#    - "Confirm email" : disabled (on invite via magic link et le mot de passe est défini ensuite)
#    - SMTP : configurer un SMTP (Resend recommandé) pour les emails Supabase Auth
#    - URL : ajouter votre domaine prod dans "Redirect URLs"
```

### Vercel

```bash
# 1. Importer le repo dans Vercel
# 2. Renseigner les variables d'environnement (cf. .env.example)
# 3. Configurer le cron quotidien :
#    Settings → Cron Jobs → Add
#    Path: /api/cron/daily
#    Schedule: 0 6 * * *  (6h UTC chaque jour)
```

---

## 5. Architecture

```
app/
├── (auth)/                    Pages d'auth (publiques)
├── (team)/                    Espace équipe — middleware vérifie role != 'client'
└── (client)/                  Portail client — middleware vérifie role = 'client'

components/
├── ui/                        shadcn/ui primitives
├── layout/                    SidebarTeam, HeaderClient
├── forms/                     Generic form helpers
└── {module}/                  Composants par module

lib/
├── supabase/                  Clients server + browser + admin
├── auth/                      Helpers de protection par rôle
├── finance/                   Calcul honoraires Stoniz
├── fx/                        Taux de change EUR/MAD
├── email/                     Templates + sender Resend (stub si pas de clé)
├── scheduler/                 Runner cron + helpers scheduled_jobs
├── validators/                Schémas zod partagés
└── utils/                     Helpers divers

supabase/migrations/           ⚠️ Cœur du système — toute la logique métier en SQL
```

---

## 6. Conventions

- **Server Actions** par défaut pour les mutations. API Routes uniquement pour webhooks et cron.
- **Server Components** par défaut. `'use client'` uniquement quand nécessaire (formulaires interactifs).
- **zod** pour valider chaque input (form ↔ action ↔ DB).
- **`'server-only'`** importé dans les fichiers qui ne doivent jamais arriver côté client.
- Tous les montants en `NUMERIC(14,2)`, EUR par défaut, MAD pour `travaux_payments`.
- Composants i18n-ready (locale stockée dans `profiles.locale`).

---

## 7. Tests

Trois étages. Détail complet et stratégie : **`docs/tests/README.md`**.

```bash
npm test               # Unitaires (Vitest) — logique pure, sans DB. Gate CI.
npm run test:watch     # Unitaires en mode watch
npm run test:int       # Intégration (Vitest) — vraie DB Supabase locale
npm run test:e2e       # E2E (Playwright) — app + Supabase locale
npm run test:e2e:ui    # E2E en mode interactif (debug)
```

### Faire tourner la suite complète en local

```bash
npm install
npx playwright install chromium      # une fois
npx supabase start                   # démarre la DB + applique les migrations
npx supabase status                  # → API URL, anon key, service_role key
cp .env.test.example .env.test       # colle-y les valeurs ci-dessus
npm test && npm run test:int && npm run test:e2e
```

### Débugger un test qui foire

- **Unitaire** : `npm run test:watch` ; un seul fichier
  `npx vitest run lib/finance/travaux-calc.test.ts` ; le diff `attendu/reçu`
  pointe la formule fautive.
- **Intégration** : message `Variable d'environnement manquante` →
  `cp .env.test.example .env.test` + `npx supabase status` ; message
  `Refus de cibler une base NON locale` = garde anti-prod, corrige
  `SUPABASE_TEST_URL`. Inspecter la base : Supabase Studio
  http://localhost:54323.
- **E2E** : `npm run test:e2e:ui` (time-travel) ; après échec, rapport HTML
  auto (`npx playwright show-report`).

### Règles

Tests isolés (chacun crée et nettoie ses fixtures via un `test_run_id`), pas de
mock de la base, on teste le comportement (la donnée résultante) pas
l'implémentation. Voir `docs/tests/README.md`.

### CI

`.github/workflows/test.yml` tourne à chaque push/PR. Le job **`quality`**
(lint + typecheck + unitaires) est le **gate bloquant** à mettre en *required
check* dans la branch protection de `main` (procédure dans
`docs/tests/README.md` §7).

---

## 8. Roadmap V1 → V1.1

| Module | V1 (livré ici) | V1.1 (à câbler) |
|---|---|---|
| Auth | ✅ Login, magic link, middleware | UI MFA, hCaptcha portail |
| Clients CRUD | ✅ Complet | Import CSV |
| Partenaires CRUD | ✅ Complet | Dashboard comparatif visuel |
| Biens CRUD | ✅ + médias upload | Galerie carrousel, vidéo player |
| Projets | ✅ + timeline + advance_phase RPC | Gantt chart |
| Tâches | ✅ Vue par projet + assignées | Vue globale équipe |
| Propositions | ✅ Envoi + acceptation atomique | Relances auto |
| Paiements | ✅ Stoniz + Travaux + devise | Export comptable CSV |
| Documents | ✅ Upload + signed URLs | Prévisualisation in-app |
| Dashboard | ⚠️ Basique (compteurs) | Charts complets, vues KPI matérialisées |
| Emails | ⚠️ Stub Resend (logs DB) | Tous les templates React Email |
| Scheduler | ⚠️ Cron + table + helpers | Runner production-grade |
| Enquêtes | ⚠️ Form rempli | Logique trigger par tâche complétée |
| Audit log | ✅ Triggers DB | UI consultation CEO |
| Tests | ✅ Infra Vitest + Playwright + fixtures + CI | Élargir la couverture (RLS, parcours E2E métier) |

---

## 9. Premiers pas après installation

1. Créer le compte CEO (cf. setup local étape 5)
2. Inviter votre équipe : `/team` → "Inviter"
3. Créer un partenaire : `/partners/new`
4. Créer un bien : `/properties/new`
5. Créer un client : `/clients/new` (puis "Inviter au portail")
6. Créer un projet : `/projects/new`
7. Envoyer une proposition au client : `/projects/[id]/proposals` → "Envoyer un bien"
8. Le client reçoit le magic link, se connecte, voit la proposition, l'accepte.

---

*Pour le détail technique, voir `CAHIER_DES_CHARGES_STONIZ_v2.md` à la racine du repo.*
