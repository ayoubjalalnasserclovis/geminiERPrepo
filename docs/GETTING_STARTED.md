# Getting Started — Stoniz Platform

## Étape 1 — Cloner et installer

```bash
cd stoniz-platform
npm install
cp .env.example .env.local
```

## Étape 2 — Démarrer Supabase local

```bash
supabase start
```

La sortie affiche les URLs et clés à copier dans `.env.local` :

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=dev-only-change-in-prod
```

## Étape 3 — Appliquer les migrations + seed

```bash
supabase db reset
```

Cela exécute tout `supabase/migrations/*.sql` dans l'ordre, puis `supabase/seed.sql`.

## Étape 4 — Créer le compte CEO

1. Ouvrir Supabase Studio : http://localhost:54323
2. Authentication → Users → "Add user" → Renseigner email + mot de passe
3. SQL Editor :
   ```sql
   UPDATE profiles
   SET role = 'ceo', full_name = 'Othmane El Azzouzi'
   WHERE email = 'votre@email.com';
   ```

## Étape 5 — Lancer Next.js

```bash
npm run dev
```

Ouvrir http://localhost:3000 et se connecter.

## Étape 6 — Flow de démo

1. **Créer un client** : `/clients/new` (Jean Dupont, jean@test.fr, budget 200 000 — 300 000 €)
2. **Créer un bien** : `/properties/new` (Riad Bahia à Gueliz, 250 000 €, 120 m², 3 suites, statut "disponible", lier au partenaire seed)
3. **Créer un projet** : `/projects/new` (sélectionner Jean Dupont).
   → L'acompte 3 000 € est créé automatiquement, ainsi que les 6 tâches d'onboarding.
4. **Envoyer une proposition** : `/projects/[id]/proposals` → cliquer "+ Envoyer une proposition" → choisir le Riad.
5. **Inviter le client au portail** : sur la fiche client → "Inviter au portail".
   → Email envoyé (ou log console si pas de Resend configuré).
6. **Se connecter en tant que client** : utiliser le magic link Supabase reçu (visible dans http://localhost:54324 inbucket en dev).
7. **Accepter la proposition** : `/client/projects/[id]/proposals` → "Accepter ce bien".
   → Le bien passe en statut "offre", le projet voit son `property_id` peuplé.

## Étape 7 — Vérifier les calculs financiers

Sur la fiche projet, cliquer "Recalculer" sur le bloc Honoraires :
- 250 000 € × 8% = 20 000 € → respecte le plancher
- 120 m² × 45 + 3 × 1 200 = 5 400 + 3 600 = 9 000 € → respecte le plancher
- Total honoraires : 29 000 €
- Acompte : 3 000 € (déjà créé)
- Restant : 26 000 € → compromis 13 000 € + livraison 13 000 €

## Tests

```bash
npm run test
```

Couvre actuellement : `lib/finance/stoniz-fees.ts`.

## Déploiement Vercel + Supabase prod

Voir le `README.md` à la racine, section "Déploiement Vercel + Supabase".
