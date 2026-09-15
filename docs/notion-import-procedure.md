# Import Notion → Supabase — Procédure pas-à-pas

Cette procédure pilote l'import des données historiques Notion vers la prod
Supabase de Stoniz ERP, en mode silencieux (aucune notification client).

## Pré-requis

1. **Vague 1 + 2 mode préparation déployées** (drapeaux is_preparation,
   wrap sendEmail, RPC bypass — déjà fait).
2. **EMAIL_KILL_SWITCH=true** sur Vercel pour tous les environnements
   (déjà fait).
3. **Migration L1 notion_page_id poussée** (`20260530006000_*.sql`).
4. **Intégration Notion "STONIZ ERP IMPORT" connectée** aux 3 databases
   (Clients, Biens, Partenaires) via le menu "..." → Connections.

## Installation des dépendances

Une seule fois, à la racine du repo :

```
npm install --save-dev @notionhq/client dotenv tsx
```

## Configuration

À la racine du repo, crée un fichier `.env.local` (jamais commité) :

```
cp scripts/import-from-notion/.env.local.example .env.local
```

Édite `.env.local` et remplis les 3 variables :
- `NOTION_TOKEN` : token de ton intégration Notion
- `SUPABASE_URL` : URL de ton projet Supabase (visible dans le dashboard)
- `SUPABASE_SERVICE_ROLE_KEY` : la **service role** key (PAS l'anon)

⚠ Vérifie que `.env.local` est bien gitignored (il l'est par défaut sous
Next.js). Ne le commit JAMAIS.

## Ordre d'import (à respecter strictement)

L'ordre garantit que les FK sont résolues à chaque étape.

| Étape | Script | Dépendance amont |
|---|---|---|
| 1 | partners | aucune |
| 2 | properties | partners |
| 3 | clients | aucune (mais client → projet couplé) |
| 4 | projects | clients + properties |
| 5 | documents | projects |
| 6 | property_media | properties |
| 7 | property_proposals | projects + properties |

## Étape 1 — Partners (test pilote)

À chaque sous-script, on respecte 3 phases : dry-run, limit, full.

### 1a — Dry-run

Affiche ce qui serait écrit sans toucher à Supabase :

```
npx tsx scripts/import-from-notion/import-partners.ts --dry-run
```

Tu dois voir une liste de payloads + un SUMMARY JSON en bas avec :
- `mode: "dry-run"`
- `total_read`, `created`, `updated`, `skipped`, `errors`
- `warnings` : valeurs Notion inconnues (à corriger dans `notion-mapping.ts`
  si nécessaire avant l'étape suivante)

**Si tu vois des warnings de mapping inconnu** (ex : `valeur Notion inconnue
dans partners.status: "Brûlé"`), retourne dans `notion-mapping.ts` et ajoute
la valeur manquante au dictionnaire `NOTION_PARTNER_STATUS`. Puis relance le
dry-run jusqu'à ce que les warnings disparaissent.

### 1b — Limit (test sur 3 rows en LIVE)

Une fois le dry-run propre, importe 3 rows réelles pour vérifier le bout-en-bout :

```
npx tsx scripts/import-from-notion/import-partners.ts --limit=3
```

Vérifie dans le SQL editor Supabase :

```sql
SELECT id, agency_name, status, contract_signed, evaluation,
       last_contact_at, notion_page_id, created_at
FROM partners
WHERE notion_page_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```

Tu dois voir 3 lignes avec `notion_page_id` non null. Compare avec les
partenaires correspondants côté Notion : agency_name, statut, évaluation
doivent matcher.

### 1c — Full

Si l'échantillon est OK, lance l'import complet :

```
npx tsx scripts/import-from-notion/import-partners.ts
```

Tu peux relancer cette même commande sans risque de doublon — le UPSERT par
notion_page_id idempotent.

## Étapes 2 à 7

Mêmes 3 phases (dry-run, limit, full) pour chaque sous-script. À ajouter au
fur et à mesure :

- `import-properties.ts` (L4) — à venir
- `import-clients-projects.ts` (L5) — à venir
- `import-documents.ts` (L6) — à venir
- `import-property-media.ts` (L7) — à venir
- `import-property-proposals.ts` (L7) — à venir

## Rollback

Si tu te trompes complètement et veux tout effacer, utilise les notions_page_id
pour cibler uniquement les données importées :

```sql
-- DRY-RUN du rollback : compte ce qui serait supprimé
SELECT 'partners' AS table_name, COUNT(*) FROM partners WHERE notion_page_id IS NOT NULL
UNION ALL SELECT 'properties', COUNT(*) FROM properties WHERE notion_page_id IS NOT NULL
UNION ALL SELECT 'clients', COUNT(*) FROM clients WHERE notion_page_id IS NOT NULL
UNION ALL SELECT 'projects', COUNT(*) FROM projects WHERE notion_page_id IS NOT NULL;
```

```sql
-- Cascade descendante (à exécuter dans cet ordre)
DELETE FROM property_proposals WHERE project_id IN
  (SELECT id FROM projects WHERE notion_page_id IS NOT NULL);
DELETE FROM documents WHERE project_id IN
  (SELECT id FROM projects WHERE notion_page_id IS NOT NULL);
DELETE FROM property_media WHERE property_id IN
  (SELECT id FROM properties WHERE notion_page_id IS NOT NULL);
DELETE FROM projects   WHERE notion_page_id IS NOT NULL;
DELETE FROM clients    WHERE notion_page_id IS NOT NULL;
DELETE FROM properties WHERE notion_page_id IS NOT NULL;
DELETE FROM partners   WHERE notion_page_id IS NOT NULL;
```

## Soft-rollback (préférable)

Plutôt que supprimer, remettre les projets en is_preparation=true pour
les masquer aux clients sans perdre les données :

```sql
UPDATE projects
SET is_preparation = true, activated_at = NULL
WHERE notion_page_id IS NOT NULL;
```

## Sécurité post-import

1. **Rotate le NOTION_TOKEN** sur https://notion.so/my-integrations
   (Reset secret) après le dernier import.
2. **Désactive ou ne touche plus** la SUPABASE_SERVICE_ROLE_KEY locale.
3. Vérifie qu'aucun fichier `.env.local` n'est commit dans git :
   `git ls-files | grep env.local` (doit retourner rien).
