# Chantier — Intégration Basketplan

> Plan d'exécution en 3 PRs séquentielles pour livrer l'intégration Basketplan décrite dans `docs/basketplan-integration.md`. Lire d'abord le brief technique pour comprendre l'architecture data + services + UI. Ce document est la **checklist d'exécution**.

## Statut

- **PR 1** — Mapping (sans sync) : ✅ code livré 2026-05-24 (backend types + 6 callables + tests parsers + UI Settings + dialog cascade + section team detail). Reste pour Eliot : déployer Functions (cf. commandes ci-dessous § PR 1 — Déploiement) + IAM binding `run.invoker` sur les 6 callables v2 + tester en browser.
- **PR 2** — Sync AWAY + backfill scores/arbitres : ✅ code livré 2026-05-24 (champs `match.external*` + `_sync.ts` algo applyGame + callable `syncBasketplanForTeam` + scheduled `scheduledBasketplanSync` cron 03:00 Europe/Zurich + 34 tests + UI Matches.vue enrichi + CTA "Synchroniser maintenant" Settings). Reste pour Eliot : repack tarball shared-types + déployer Functions + IAM binding callable v2 + activer `config.basketplan.enabled = true` côté Firestore avant la 1re sync nocturne.
- **PR 3** — Création HOME + Inbox : ⏳ pas démarré

---

## PR 1 — Mapping (sans sync)

Livre la capacité de lier une équipe à des compétitions Basketplan, sans encore créer/maj de matchs. Branche : `feat/basketplan-mapping`.

### Backend
- [x] Ajouter `BasketplanCompetitionLink` + `team.basketplanLinks` dans `packages/shared-types/src/team.ts`.
- [x] Ajouter `config.club.basketplan` dans `packages/shared-types/src/config.ts` (+ `ClubConfigPatch.basketplan`).
- [x] Créer `functions/src/basketplan/_client.ts`, `_parsers.ts`, `_authz.ts`.
- [x] Ajouter `fast-xml-parser` à `functions/package.json` + lockfile (4.5.6 résolu).
- [x] Créer les callables :
  - [x] `listBasketplanLeagueHoldings` (signed-in, cache 1h mémoire).
  - [x] `listClubTeamsInLeague` (signed-in).
  - [x] `linkTeamToBasketplan` (admin OR coach-of-team).
  - [x] `unlinkTeamBasketplan` (admin OR coach-of-team).
  - [x] `toggleTeamBasketplanLink` (admin OR coach-of-team).
  - [x] `testBasketplanConnection` (admin).
- [x] Tests Vitest pour `_parsers.ts` avec 3 fixtures XML réelles (fédération 9 AFBB / leagueHoldingId 10584 Marly Basket 2LM) — 19/19 pass.
- [ ] Tests emulator pour les callables (scope coach + admin, refus si scope manquant) — reporté (à faire manuellement en browser ou en suivi).

### Frontend web
- [x] `apps/web/src/lib/basketplan-federations.ts` (3 fédérations connues : BVN, ACGBA, AFBB + TODO d'inventaire).
- [x] `apps/web/src/views/settings/IntegrationsBasketplan.vue` (intégré au router Settings split, route `/settings/integrations/basketplan` admin-only).
- [x] `apps/web/src/components/teams/BasketplanLinkDialog.vue` (cascade 3 étapes, tri `season DESC, name ASC`, auto-select si 1 équipe).
- [x] Section "Compétitions Basketplan" intégrée dans le drawer in-page de `apps/web/src/views/Teams.vue` (mode read-only, gatée `canManageBasketplan = rootAdmin || roles.admin || team.coachIds.includes(uid)`).
- [x] Wrappers callables dans `apps/web/src/services/cloudFunctions.ts` (6 wrappers typés).
- [x] Cache 1h mémoire côté serveur (callable `listBasketplanLeagueHoldings`) — client appelle à chaque ouverture du dialog, OK pour MVP. Cache client-side non implémenté (reportable).
- [x] Sidebar Settings : nouveau groupe "Intégrations" avec icône Plug dans `SettingsSidebar.vue`.

### Frontend courtbase-app
- [ ] `apps/courtbase-app/src/views/coach/TeamCompetitions.vue` (mobile-first, BottomSheet) — **hors scope de cette livraison (apps/web only demandé)** ; à faire dans une PR séparée.

### Déploiement & doc
- [x] `firestore.rules` : pas de modif (les callables passent en Admin SDK).
- [ ] **Eliot** : `npm run build` Functions + déployer :
  ```bash
  cd packages/shared-types && npm pack --pack-destination ../../functions/ && cd -
  cd functions && npm install && npm run build && cd -
  firebase deploy --only \
    functions:listBasketplanLeagueHoldings,\
  functions:listClubTeamsInLeague,\
  functions:linkTeamToBasketplan,\
  functions:unlinkTeamBasketplan,\
  functions:toggleTeamBasketplanLink,\
  functions:testBasketplanConnection \
    -P <projectId>
  ```
- [ ] **Eliot** : IAM binding `run.invoker` sur les 6 nouvelles callables v2 (cf. memory `deploy_functions_v2_invoker_binding`) :
  ```bash
  for fn in listbasketplanleagueholdings listclubteamsinleague linkteamtobasketplan unlinkteambasketplan toggleteambasketplanlink testbasketplanconnection; do
    gcloud run services add-iam-policy-binding $fn \
      --region=europe-west6 --member="allUsers" --role="roles/run.invoker" --project=<projectId>
  done
  ```
- [x] MAJ `docs/firebase.md` (champs `team.basketplanLinks`, `config.club.basketplan`).
- [x] MAJ `docs/main.md` § "Intégrations externes" (paragraphe Basketplan).
- [x] MAJ `functions/CLAUDE.md` (mention dossier `basketplan/`).
- [x] MAJ ce fichier : statut PR 1 → ✅ done.

### Critères de succès PR 1
- Eliot (admin) lie l'équipe Seniors M à "2LM Saison 25/26 — Marly Basket" en < 10 sec.
- Connecté en coach U18, on peut lier l'équipe U18 mais pas Seniors M (callable refuse).
- Settings affiche `lastSyncAt = null` et "Tester la connexion" répond OK.

---

## PR 2 — Sync AWAY + backfill scores/arbitres

Livre l'automatisation : matchs AWAY créés tout seuls, scores et arbitres remontés sur tous les matchs liables. Branche : `feat/basketplan-sync-away`.

### Backend
- [x] Ajouter les champs `external*` à `packages/shared-types/src/match.ts` (+ types `MatchExternalSource`, `MatchExternalResult`, `MatchExternalReferees`).
- [x] `functions/src/basketplan/_sync.ts` — algorithme `applyGame` 3 passes (patch existing → link manual fuzzy Levenshtein ≤ 2 → create AWAY ; HOME → `skipped-home`). Helpers : `resolveMatchTypeId` (mapping `config.basketplan.matchTypeMapping[federationCode]` + fallback création `/matchTypes` "Championnat (Basketplan)" cache process).
- [x] Callable `syncBasketplanForTeam` (admin OR coach-of-team) — `setTimeout 100ms` entre fetchs, try/catch indépendant par link, update `team.basketplanSyncedAt`.
- [x] Scheduled `scheduledBasketplanSync` (`0 3 * * *`, Europe/Zurich, `europe-west6`) — early return si `!config.basketplan.enabled`, update `config.basketplan.lastSyncAt` + `lastSyncError` (agrégé ≤ 500 chars).
- [x] Tests Vitest pour `_sync.ts` (34/34 pass — nouveau AWAY, AWAY existant, link manuel fuzzy, homologué → played, conflit dédup, HOME skip).

### Frontend
- [x] Affichage Pill `Basketplan #<gameNumber>` (colonne Adversaire) + 3 sections drawer conditionnelles ("Match officiel Basketplan", "Arbitres fédéraux", "Résultat officiel" + score "nous d'abord" + tableau quarts + placeholder en attente d'homologation) dans `apps/web/src/views/Matches.vue`.
- [ ] Idem dans `apps/courtbase-app/src/views/coach/MatchDetail.vue` et `apps/courtbase-app/src/views/official/MatchDetail.vue` — **hors scope de cette livraison (apps/web only demandé)** ; à faire dans une PR séparée.
- [x] Settings : carte "Dernière synchronisation" (date+heure FR ou placeholder, banner rose si `lastSyncError`), bouton "Synchroniser maintenant" + dialog sélection team (filtré sur teams avec `basketplanLinks.length > 0`) + banner résultat agrégé.

### Déploiement & doc
- [ ] **Eliot** : repack tarball + déployer Functions + IAM binding sur callable v2 :
  ```bash
  cd packages/shared-types && npm pack --pack-destination ../../functions/ && cd -
  cd functions && npm install && npm run build && cd -
  firebase deploy --only functions:syncBasketplanForTeam,functions:scheduledBasketplanSync -P <projectId>
  gcloud run services add-iam-policy-binding syncbasketplanforteam \
    --region=europe-west6 --member="allUsers" --role="roles/run.invoker" --project=<projectId>
  ```
- [ ] **Eliot** : activer `config.club.basketplan.enabled = true` côté Firestore (sinon le cron retourne early).
- [x] MAJ `docs/firebase.md` (champs `match.external*` + section "Sync Basketplan (PR 2)" + table Cloud Functions enrichie).
- [x] MAJ `docs/basketplan-integration.md` §5.3 (note statut PR 2 : AWAY+backfill livré, HOME différé en PR 3).
- [x] MAJ ce fichier : statut PR 2 → ✅ done.

### Critères de succès PR 2
- Le lendemain de la sync nocturne, un match Marly AWAY en 2LM apparaît dans `/matches` avec `kind:'away'`, `awayAddress` rempli, `externalGameNumber`.
- Un match HOME saisi manuellement la veille reçoit les arbitres + score après la sync, sans duplication.
- Un match homologué passe automatiquement à `status='played'`.
- Si Basketplan down : l'erreur est loguée par link, le sync continue pour les autres links, `lastSyncError` est rempli.

---

## PR 3 — Création HOME + Inbox

Complète l'automatisation pour les matchs HOME : tentative de création de booking, sinon inbox admin. Branche : `feat/basketplan-sync-home`.

### Backend
- [ ] Étendre `_sync.ts` pour gérer la création HOME (matching venue/court fuzzy, lookup timeSlot, writeBatch booking+match).
- [ ] Création des items `/basketplanInbox` quand le matching échoue.
- [ ] Tests Vitest pour les 3 raisons d'inbox (`no_court_match`, `court_busy`, `venue_unknown`) + cas créa booking auto réussie.

### Frontend
- [ ] `apps/web/src/views/BasketplanInbox.vue` + entrée menu + badge count non résolus.
- [ ] CTA "Créer le booking" qui ouvre `MatchFormDialog` pré-rempli (date, adversaire, type, externalGameNumber masqué dans le payload).
- [ ] CTA "Ignorer" qui marque l'item resolvedAction='ignored'.

### Sécurité
- [ ] `firestore.rules` : règle pour `/basketplanInbox/{id}` (read+write admin).
- [ ] `firebase deploy --only firestore:rules`.

### Déploiement & doc
- [ ] Déployer Functions + IAM binding.
- [ ] MAJ `docs/firebase.md` (collection `/basketplanInbox`).
- [ ] MAJ `docs/basketplan-integration.md` (section inbox).
- [ ] MAJ ce fichier : statut PR 3 → ✅ done.

### Critères de succès PR 3
- Si Basketplan annonce un HOME pour Marly à "Grand-Pré 3" et qu'un court correspondant existe avec un timeSlot dispo → booking + match créés automatiquement.
- Sinon → un item Inbox visible pour l'admin, CTA fonctionnel.

---

## Tableau récap des fichiers

| Fichier | Création / Modif | PR |
|---------|------------------|----|
| `packages/shared-types/src/team.ts` | modif (types lien) | PR 1 |
| `packages/shared-types/src/match.ts` | modif (champs `external*`) | PR 2 |
| `packages/shared-types/src/config.ts` | modif (`config.club.basketplan`) | PR 1 |
| `functions/src/basketplan/_client.ts` | nouveau | PR 1 |
| `functions/src/basketplan/_parsers.ts` | nouveau | PR 1 |
| `functions/src/basketplan/_authz.ts` | nouveau | PR 1 |
| `functions/src/basketplan/_sync.ts` | nouveau (AWAY+backfill PR 2, HOME PR 3) | PR 2/3 |
| `functions/src/basketplan/linkTeam.ts` (et siblings) | nouveau | PR 1 |
| `functions/src/basketplan/syncForTeam.ts` | nouveau | PR 2 |
| `functions/src/basketplan/scheduledSync.ts` | nouveau | PR 2 |
| `functions/package.json` | ajouter `fast-xml-parser` | PR 1 |
| `firestore.rules` | nouvelle collection `/basketplanInbox` | PR 3 |
| `apps/web/src/lib/basketplan-federations.ts` | nouveau (liste statique) | PR 1 |
| `apps/web/src/views/Settings/IntegrationsBasketplan.vue` | nouveau | PR 1 |
| `apps/web/src/components/teams/BasketplanLinkDialog.vue` | nouveau | PR 1 |
| `apps/web/src/views/Teams.vue` (ou TeamDetail) | section "Compétitions Basketplan" | PR 1 |
| `apps/web/src/views/Matches.vue` | badge + sections enrichies | PR 2 |
| `apps/web/src/views/BasketplanInbox.vue` | nouveau | PR 3 |
| `apps/courtbase-app/src/views/coach/TeamCompetitions.vue` | nouveau | PR 1 |
| `apps/courtbase-app/src/views/coach/MatchDetail.vue` | sections enrichies | PR 2 |
| `apps/courtbase-app/src/views/official/MatchDetail.vue` | sections enrichies | PR 2 |
| `docs/firebase.md` | MAJ schéma | PR 1+2+3 |
| `docs/main.md` | MAJ § intégrations | PR 1 |
| `functions/CLAUDE.md` | mention dossier `basketplan/` | PR 1 |

---

## Action immédiate avant d'attaquer la PR 1

1. **Inventaire fédérations** : exécuter un petit script local (ou demander à un agent) qui fait `findAllLeagueHoldings.do?federationId=N` pour N de 1 à 30, et noter les noms. Compléter la table § 2.3 du brief.
2. **Décider du matchType par défaut** pour les matchs créés par sync (générique vs mapping par pattern).
3. **Valider les noms de fédérations à afficher** dans le dropdown UI (codes AFBB / CSJC / ACNBA… à confirmer).
4. **Ordre des PRs** : si on veut commencer par PR 2 sans la PR 1 (mapping en dur sur Marly seul pour valider la sync), c'est possible mais on perd la fonctionnalité multi-fédération. Recommandation : garder l'ordre proposé.
