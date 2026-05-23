# Chantier — Intégration Basketplan

> Plan d'exécution en 3 PRs séquentielles pour livrer l'intégration Basketplan décrite dans `docs/basketplan-integration.md`. Lire d'abord le brief technique pour comprendre l'architecture data + services + UI. Ce document est la **checklist d'exécution**.

## Statut

- **PR 1** — Mapping (sans sync) : ⏳ pas démarré
- **PR 2** — Sync AWAY + backfill scores/arbitres : ⏳ pas démarré
- **PR 3** — Création HOME + Inbox : ⏳ pas démarré

---

## PR 1 — Mapping (sans sync)

Livre la capacité de lier une équipe à des compétitions Basketplan, sans encore créer/maj de matchs. Branche : `feat/basketplan-mapping`.

### Backend
- [ ] Ajouter `BasketplanCompetitionLink` + `team.basketplanLinks` dans `packages/shared-types/src/team.ts`.
- [ ] Ajouter `config.club.basketplan` dans `packages/shared-types/src/config.ts`.
- [ ] Créer `functions/src/basketplan/_client.ts`, `_parsers.ts`, `_authz.ts`.
- [ ] Ajouter `fast-xml-parser` à `functions/package.json` + lockfile.
- [ ] Créer les callables :
  - [ ] `listBasketplanLeagueHoldings` (signed-in, cache 1h mémoire).
  - [ ] `listClubTeamsInLeague` (signed-in).
  - [ ] `linkTeamToBasketplan` (admin OR coach-of-team).
  - [ ] `unlinkTeamBasketplan` (admin OR coach-of-team).
  - [ ] `toggleTeamBasketplanLink` (admin OR coach-of-team).
  - [ ] `testBasketplanConnection` (admin).
- [ ] Tests Vitest pour `_parsers.ts` avec fixtures XML capturées (3 fixtures min : findAllLeagueHoldings, showLeagueSchedule, showRankingForLeague).
- [ ] Tests emulator pour les callables (scope coach + admin, refus si scope manquant).

### Frontend web
- [ ] `apps/web/src/lib/basketplan-federations.ts` (liste statique des fédérations connues, voir § 2.3 du brief).
- [ ] `apps/web/src/views/Settings/IntegrationsBasketplan.vue` (intégré au router Settings split).
- [ ] `apps/web/src/components/teams/BasketplanLinkDialog.vue` (cascade 3 étapes).
- [ ] Section "Compétitions Basketplan" dans la fiche team existante (identifier la bonne vue à l'exécution — probablement `Teams.vue` détail panel).
- [ ] Store/composable pour les `listBasketplan*` callables avec cache 1h client-side.

### Frontend courtbase-app
- [ ] `apps/courtbase-app/src/views/coach/TeamCompetitions.vue` (mobile-first, BottomSheet).

### Déploiement & doc
- [ ] `firestore.rules` : pas de modif (les callables passent en Admin SDK).
- [ ] `npm run build` Functions + déployer (`firebase deploy --only functions:listBasketplanLeagueHoldings,functions:listClubTeamsInLeague,functions:linkTeamToBasketplan,functions:unlinkTeamBasketplan,functions:toggleTeamBasketplanLink,functions:testBasketplanConnection`).
- [ ] Pour chaque nouvelle callable v2 : IAM binding `run.invoker` (cf. memory `deploy_functions_v2_invoker_binding`).
- [ ] MAJ `docs/firebase.md` (champs `team.basketplanLinks`, `config.club.basketplan`).
- [ ] MAJ `docs/main.md` § "Intégrations externes" (paragraphe Basketplan).
- [ ] MAJ `functions/CLAUDE.md` (mention dossier `basketplan/`).
- [ ] MAJ ce fichier : statut PR 1 → ✅ done.

### Critères de succès PR 1
- Eliot (admin) lie l'équipe Seniors M à "2LM Saison 25/26 — Marly Basket" en < 10 sec.
- Connecté en coach U18, on peut lier l'équipe U18 mais pas Seniors M (callable refuse).
- Settings affiche `lastSyncAt = null` et "Tester la connexion" répond OK.

---

## PR 2 — Sync AWAY + backfill scores/arbitres

Livre l'automatisation : matchs AWAY créés tout seuls, scores et arbitres remontés sur tous les matchs liables. Branche : `feat/basketplan-sync-away`.

### Backend
- [ ] Ajouter les champs `external*` à `packages/shared-types/src/match.ts`.
- [ ] `functions/src/basketplan/_sync.ts` — algorithme `applyGame` (cf. § 5.3 du brief) limité à AWAY + backfill (pas encore HOME création auto).
- [ ] Callable `syncBasketplanForTeam` (admin OR coach-of-team).
- [ ] Scheduled `scheduledBasketplanSync` (`0 3 * * *`, Europe/Zurich, `europe-west6`).
- [ ] Tests Vitest pour `_sync.ts` (cas : nouveau AWAY, AWAY déjà existant, match manuel à enrichir, match homologué → status played, conflit dédup).

### Frontend
- [ ] Affichage badge `externalGameNumber` + section "Arbitres fédéraux" + section "Résultat officiel" dans `apps/web/src/views/Matches.vue`.
- [ ] Idem dans `apps/courtbase-app/src/views/coach/MatchDetail.vue` et `apps/courtbase-app/src/views/official/MatchDetail.vue`.
- [ ] Settings : afficher `lastSyncAt`, `lastSyncError`, bouton "Synchroniser maintenant".

### Déploiement & doc
- [ ] Déployer Functions + IAM binding sur les nouvelles.
- [ ] MAJ `docs/firebase.md` (champs `match.external*`).
- [ ] MAJ `docs/basketplan-integration.md` (section sync : ajouter exemples concrets de runs).
- [ ] MAJ ce fichier : statut PR 2 → ✅ done.

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
