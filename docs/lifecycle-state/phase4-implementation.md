# Phase 4 — Implémentation UI + Server Actions

**Date :** 2026-05-29 (nuit)
**État :** terminée, prête à pousser sur prod.

## Fichiers créés

### Server actions + email (Phase 4a)
- `app/(team)/projects/[id]/lifecycle-actions.ts` — 5 server actions :
  - `requestPauseAction` (chef_projet / commercial / CEO)
  - `validateLifecycleTransitionAction` (CEO)
  - `markProjectLostAction` (CEO)
  - `resumeLifecycleAction` (CEO)
  - `resurrectFromLostAction` (CEO + 50 chars justification)
- `lib/email/templates-lifecycle.ts` — `sendCeoPauseRequestEmail` :
  email staff (PAS de project_id passé à sendEmail → ne dépend pas
  de can_notify_for_project, juste du kill switch global)

### UI fiche projet (Phase 4b)
- `components/projects/lifecycle-controls.tsx` — composant client avec :
  - Badge status visible
  - Bouton "Mettre en pause" / "Demander pause"
  - Bouton "Marquer perdu" (CEO seul)
  - Bouton "Reprendre" si pause (CEO seul)
  - Bouton "Ressusciter" si perdu (CEO seul)
  - 4 modals (PauseModal, LostModal, ResumeModal, ResurrectModal)
- Intégré dans `app/(team)/projects/[id]/page.tsx` à la place du
  badge status statique

### Page validations CEO (Phase 4c)
- `app/(team)/admin/validations/page.tsx` — file d'attente CEO
  + 10 dernières décisions historiques
- `app/(team)/admin/validations/validation-row.tsx` — composant client
  avec boutons Approuver / Rejeter (rejet demande memo optionnel)
- Lien ajouté dans `components/layout/sidebar-team.tsx`

### Timeline projet (Phase 4d)
- `components/projects/lifecycle-timeline.tsx` — server component
  qui lit `project_lifecycle_transition` et affiche frise chronologique
  avec acteurs, raisons, manque à gagner, leçons apprises
- Intégré sur la fiche projet (n'affiche rien si aucune transition)

### Cron + KPI dashboard (Phase 4e)
- `app/api/cron/weekly-stale-pauses/route.ts` — cron hebdo (lundi 9h UTC)
  qui envoie au CEO un digest des projets en pause > 30 jours
- `vercel.json` — schedule ajouté
- `components/dashboard/lifecycle-kpi-section.tsx` — section CEO
  avec 4 tuiles (en pause, perdus, manque à gagner, pause moy.) +
  Top raisons de perte + Leçons récentes
- Intégré dans `app/(team)/dashboard/page.tsx` (CEO uniquement)

## Anti-patterns respectés

- **Pas de dropdown libre** : les boutons ouvrent des modals avec menus
  déroulants enum (`PAUSE_REASONS`, `LOST_REASONS`)
- **Pas de hard delete** : les RPC font des UPDATE de status, pas
  de DELETE (cohérence avec le pattern soft delete existant via deleted_at)
- **Pas d'auto-fermeture pause à expected_resume_at** : champ indicatif
  uniquement, utilisé seulement pour le digest hebdo > 30j
- **Pas d'exposition "perdu" au client** : tout est côté staff
  uniquement (path `/admin/...` ou `/projects/...` réservé aux rôles staff)
- **Pas de calcul à la volée du manque à gagner** : snapshot
  immuable au moment de la transition (`lost_revenue_snapshot` dans
  l'audit, `lost_revenue_amount` sur projects)

## Points de vigilance pour test prod

1. **Le composant `LifecycleTimeline` est async server component** — il
   utilise `@ts-expect-error` qui peut générer un warning au build mais
   ne bloque pas (pattern utilisé dans Next 14)
2. **Le cron hebdo nécessite `CRON_SECRET` env var** — sinon Vercel
   reçoit 401 et le digest ne part pas
3. **L'email kill switch s'applique au digest hebdo aussi** — si
   `EMAIL_KILL_SWITCH=true`, le digest est logué en `skipped`
4. **L'email de notification CEO pause request ne passe PAS par
   `can_notify_for_project`** — c'est volontaire (email staff), mais il
   est soumis au kill switch global

## Ce qui reste à faire (post-déploiement)

- Phase 5 — Tests end-to-end avec vrais users sur prod : créer un
  projet test, demander pause, valider, voir le digest hebdo arriver
- Dette technique A1, A4, A5 du rapport Phase 3 si gênants au quotidien
- Polish UI (animations modal, raccourcis clavier, etc.)
