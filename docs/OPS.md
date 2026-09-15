# Ops — Backup, Monitoring, Disaster Recovery

Document de référence pour exploiter Stoniz en production. À garder à jour.

---

## 1. Backup

### 1.1 Base de données Supabase

**En place automatiquement** (selon le plan Supabase) :
- **Plan Free** : pas de backup automatique. Si tu es en prod, **upgrade obligatoire** (au minimum Pro à 25 $/mois).
- **Plan Pro** : daily backups pendant 7 jours, restauration point-in-time disponible 24h en arrière.
- **Plan Team** : daily backups pendant 14 jours + PITR 7 jours.

**À configurer en plus** (recommandé) :
1. Aller dans Supabase Dashboard → Settings → Database → Backups
2. Vérifier que le backup quotidien est activé
3. Test de restauration trimestriel obligatoire (voir §3.3)

**Backup additionnel manuel via `pg_dump`** (sécurité) :

```bash
# Récupère l'URL de connexion depuis Supabase Dashboard → Settings → Database
export SUPABASE_DB_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"

# Dump complet quotidien (à brancher sur un cron externe — ex : GitHub Actions)
pg_dump --no-owner --no-acl --clean --if-exists "$SUPABASE_DB_URL" > "backup-$(date +%Y%m%d).sql"

# Compresser et uploader sur un S3 externe (Cloudflare R2, Backblaze B2, etc.)
gzip backup-$(date +%Y%m%d).sql
aws s3 cp backup-$(date +%Y%m%d).sql.gz s3://stoniz-backups/db/
```

Garde 30 jours de daily, 12 mois de monthly, indéfiniment de yearly.

### 1.2 Storage (documents, médias, preuves de virement)

Supabase Storage n'est PAS inclus dans les backups DB automatiques. **À sauvegarder séparément.**

**Script de sync vers S3 externe** (à brancher sur cron quotidien) :

```bash
#!/bin/bash
# Liste tous les buckets et leurs objets, télécharge en local, push vers S3 externe
BUCKETS="documents property-media avatars"
for bucket in $BUCKETS; do
  npx supabase storage download --recursive "$bucket" "./storage-backup/$bucket"
done
aws s3 sync ./storage-backup/ s3://stoniz-backups/storage/ --delete
rm -rf ./storage-backup
```

### 1.3 Vault / secrets / .env

À **JAMAIS** committer dans Git. Stocker dans :
- 1Password / Bitwarden (équipe partagée)
- Une note coffre-fort chiffrée

Variables critiques à archiver :
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `CRON_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Stripe / autre keys si ajoutés

---

## 2. Monitoring

### 2.1 Sentry (erreurs applicatives)

**Setup** :
1. Créer un compte sur https://sentry.io (gratuit jusqu'à 5k events/mois)
2. Créer un projet "Next.js"
3. Récupérer le DSN

**Intégration Next.js** (à faire la prochaine fois que tu peux installer un package) :

```bash
npx @sentry/wizard@latest -i nextjs
```

En attendant l'install, **intégration manuelle via CDN** dans `app/layout.tsx` :

```tsx
<Script
  src="https://browser.sentry-cdn.com/8.45.0/bundle.tracing.min.js"
  crossOrigin="anonymous"
  strategy="afterInteractive"
/>
<Script id="sentry-init">{`
  if (window.Sentry) {
    Sentry.init({
      dsn: "${process.env.NEXT_PUBLIC_SENTRY_DSN}",
      tracesSampleRate: 0.1,
      environment: "${process.env.NODE_ENV}",
    });
  }
`}</Script>
```

Et `NEXT_PUBLIC_SENTRY_DSN` dans Vercel env vars.

### 2.2 Vercel Analytics

Activer dans Vercel Dashboard → Project → Analytics → Enable Web Analytics. Gratuit jusqu'à 2500 events/mois.

Ajouter au layout :
```tsx
import { Analytics } from '@vercel/analytics/react';
// dans <body> :
<Analytics />
```

(Nécessite `npm install @vercel/analytics`)

### 2.3 Uptime monitoring

**UptimeRobot** (gratuit, 50 monitors, ping 5 min) — https://uptimerobot.com

URLs à monitorer :
- `https://stoniz.co/` (landing)
- `https://app.stoniz.co/login` (app)
- `https://app.stoniz.co/api/cron/daily-reminders` (cron endpoint — utiliser keyword monitor sur "ok":)
- Endpoint Supabase REST (pour détecter une panne DB)

Notifs Slack + email + SMS sur down > 2 min.

### 2.4 Logs

- **Vercel** : logs des 1h dernières dans Dashboard → Logs (gratuit), 7 jours sur Pro
- **Supabase** : Dashboard → Logs → Postgres / API / Auth / Storage
- **Resend** : Dashboard → Logs → emails envoyés / bounce / spam
- **email_logs** (DB) : table interne qui trace tous nos envois avec idempotency

Consulter régulièrement (1× par semaine en début de prod, puis sur alerte).

---

## 3. Disaster Recovery

### 3.1 Scénarios prévus

| Scénario | Probabilité | Impact | Plan |
|---|---|---|---|
| App down (déploiement raté) | Moyenne | Court (utilisateurs bloqués) | Rollback Vercel (instantané) |
| Bug critique en prod | Moyenne | Variable | Hotfix + redéploiement |
| Compromission compte CEO/Finance | Faible | Critique | Reset password + révocation MFA + audit |
| Suppression accidentelle de données | Moyenne | Variable | PITR Supabase (< 24h) ou restore backup |
| Crash total Supabase | Très faible | Critique | Restore complet sur nouveau projet Supabase |
| Crash Vercel | Très faible | Critique | Déploiement urgence sur Netlify/Railway |

### 3.2 Procédure de rollback (déploiement raté)

1. Vercel Dashboard → Project → Deployments
2. Identifier le dernier déploiement stable
3. Clic "..." → "Promote to Production"
4. Vérifier `https://app.stoniz.co/` redevient OK
5. Investiguer le bug en local sur le commit fautif

### 3.3 Procédure de restore DB

**Restauration point-in-time** (Pro plan, < 24h en arrière) :
1. Supabase Dashboard → Database → Backups → Restore
2. Choisir le timestamp (ex: 2 heures avant l'incident)
3. Cliquer "Restore" — ⚠ écrase toute la DB actuelle
4. Vérifier que les données reviennent
5. Avertir l'équipe : "tout ce qui a été créé depuis [timestamp] est perdu"

**Restauration depuis backup pg_dump** (si > 24h ou Free plan) :
```bash
psql "$SUPABASE_DB_URL" < backup-YYYYMMDD.sql
```

⚠ Préalable : **arrêter l'app** (mettre en mode maintenance via Vercel Pause) pour éviter les nouvelles écritures pendant le restore.

### 3.4 Test de restauration (à faire 1× par trimestre)

Indispensable. Un backup non testé n'est pas un backup.

1. Créer un projet Supabase "stoniz-restore-test"
2. Restorer le dernier backup dessus
3. Vérifier que :
   - Les tables existent toutes (`\dt` en SQL)
   - Les comptes utilisateurs sont là (`SELECT count(*) FROM auth.users`)
   - Quelques projets random sont consultables
   - Le storage est aussi restauré (sync depuis S3 externe)
4. Documenter le résultat dans `docs/restore-tests/YYYY-Q.md`
5. Supprimer le projet de test

---

## 4. Sécurité opérationnelle

### 4.1 Rotation des secrets

Tous les 6 mois minimum :
- `SUPABASE_SERVICE_ROLE_KEY` (Supabase Dashboard → Settings → API)
- `RESEND_API_KEY` (Resend Dashboard → API Keys)
- `CRON_SECRET` (Vercel env vars)
- Mots de passe des comptes CEO + Finance + chefs de projet

### 4.2 Accès

| Qui | Niveau | Justification |
|---|---|---|
| CEO | super-admin | Validation finale + accès complet |
| Finance | admin partiel | Validation virements + comptabilité |
| Chefs projet | staff | Projets assignés |
| Dev externe / freelance | accès lecture DB temporaire | Via Supabase read-only role |

### 4.3 Logs d'audit

La table `audit_logs` (créée par les triggers `audit_*`) trace toutes les modifications sensibles. À consulter :
- En cas de litige client
- Après un incident sécurité
- Pour valider une action ambiguë

Page de consultation à construire (cf. mon audit dans la conversation précédente).

---

## 5. Checklist Go-Live

Avant d'ouvrir Stoniz à des vrais clients :

- [ ] Plan Supabase Pro activé (backups + PITR)
- [ ] Backups Storage configurés sur S3 externe
- [ ] Sentry installé et reçoit des erreurs de test
- [ ] UptimeRobot configuré sur les 4 URLs critiques
- [ ] Vercel Analytics activé
- [ ] `CRON_SECRET` défini et long (> 32 caractères aléatoires)
- [ ] `RESEND_API_KEY` configuré + domaine `stoniz.co` vérifié dans Resend
- [ ] 2FA activé sur les comptes CEO + Finance Supabase
- [ ] Test de restauration DB fait + documenté
- [ ] Logs Vercel + Supabase consultables par le CEO
- [ ] Liste de tous les secrets dans le coffre-fort 1Password
- [ ] Plan de rollback testé (déploiement volontairement cassé en staging)

---

## 6. Contacts d'urgence

| Service | Plan | Support |
|---|---|---|
| Supabase | Pro | https://supabase.com/support (24h business) |
| Vercel | Pro | https://vercel.com/help (24h business) |
| Resend | Free/Pro | https://resend.com/support |
| Sentry | Free | https://sentry.io/support |
| Cloudflare (DNS) | — | https://dash.cloudflare.com |

En cas de panne majeure (> 30 min downtime), prévenir directement les clients impactés par email avec une estimation de retour.

---

*Document à relire tous les 3 mois et mettre à jour.*
