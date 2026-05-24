# Claude Code — `functions/`

> Cloud Functions partagées. **Déployées sur chaque projet client** via CI cross-projet (`docs/deployment.md`). Code identique partout, runtime = le projet appelant.

## À lire pour bosser ici

1. `docs/firebase.md` — liste des Functions requises + schéma
2. `docs/main.md` — règles métier (dues lifecycle, officials, etc.)
3. `docs/deployment.md` — migration runner, compat window
4. Ce fichier

## Stack

Cloud Functions for Firebase · Node 20 · TypeScript · Firebase Admin SDK.

## Structure

```
functions/
  src/
    index.ts                  # exports
    bookings/                 # generateSeasonBookings, applyClosurePeriod, ...
    dues/                     # initiate, issue, overdue, syncMemberStatus
    exceptions/               # applyPaymentException
    licenses/                 # applyLicenseRequest
    officials/                # autoOfficialsNeeded, matchReminders
    matches/                  # handleMatchSlotChange
    migrations/               # runMigrations + migration_NNN.ts
    shared/                   # helpers (Firestore, dates, logging)
  package.json
  tsconfig.json
```

## Functions requises (voir `docs/firebase.md` pour détails)

`generateSeasonBookings`, `previewSeasonBookings`, `applyClosurePeriod`, `handleMatchSlotChange`, `autoOfficialsNeededNotification`, `matchReminders`, `initiateDuesOnPlayerActivation`, `issueDuesScheduled`, `markOverdueScheduled`, `syncMemberDuesStatus`, `markDuePaid`, `updateDue`, `applyPaymentException`, `applyLicenseRequest`, `coachReviewLicenseDoc`, `treasurerReviewLicenseDoc`, `validateLicenseRequest`, `runMigrations`, `fanoutNotification`, `coachCreateMember`, `coachUpdateMember`, `coachDeactivateMember`, `coachCreateAwayMatch`, `syncUserRolesFromMember`, `setMemberLicensePhoto`, `removeMemberLicensePhoto`.

### `updateDue` (callable) — édition d'une cotisation

Édite une cotisation `/dues/{dueId}` hors du flux paiement. Réservée au comité.

- **Auth** : signed-in + (claim `rootAdmin` OU rôle `admin` OU `treasurer` côté `/users/{uid}`). Sinon `permission-denied`. Helper local `assertCanUpdateDue`.
- **Input** (wire) : `{ dueId: string; activatedAt?: number; issuedAt?: number | null; dueAt?: number | null; status?: CotisationStatus; notes?: string | null }`. Dates en epoch millis. Champ absent = non modifié. `null` explicite = effacer (`issuedAt`, `dueAt`, `notes` — `activatedAt` non nullable).
- **`status`** : refuse `'paid'` (`invalid-argument`) — le passage à payé passe par `markDuePaid`. Statuts acceptés : `pending_grace | issued | overdue | excepted | cancelled`.
- **Effet** : `update` du doc via Admin SDK. Le trigger `syncMemberDuesStatus` recalcule `member.duesStatus` — ne pas le recalculer ici. **Pas** d'édition du montant ; **pas** de champ `updatedBy` / `updatedAt`.
- **Retour** : `{ ok: true }`. Wrapper web : `updateCotisation` dans `apps/web/src/services/cloudFunctions.ts`.

### `confirmLicense` (callable) — confirmation d'une licence fédérale

Confirme une licence `/licenses/{licenseId}` (`pending` → `active`). Matérialise la validation Swiss Basketball + le paiement de la fédération par le club. Fichier : `licenses/confirmLicense.ts`. Region `europe-west6`.

- **Auth** : signed-in + (claim `rootAdmin` OU `/users/{uid}.roles` contient `admin` | `treasurer` | `secretary`). Sinon `permission-denied`. Helper local `assertCanConfirmLicense`.
- **Input** (wire) : `{ licenseId: string }`.
- **Effet** (transactionnel, Admin SDK — bypasse les rules du module compta : canal contrôlé et audité via `confirmedByUid`) :
  1. Lit `/licenses/{licenseId}`. Absente → `not-found`.
  2. **Idempotence** : `status === 'active'` → retourne `{ ok: true, alreadyActive: true, accountingEntryId: null }` sans rien écrire.
  3. `status !== 'pending'` (ex. `cancelled`) → `failed-precondition`.
  4. Poste une écriture `/accountingEntries` (`source: 'manual'`) en partie double équilibrée, montant = `license.feeSnapshot` : **débit** compte de charge « Licences fédérales » / **crédit** compte de trésorerie « Banque ». Comptes résolus par nom avec repli (charge → 1er compte actif de nature `charge` ; trésorerie → 1er compte actif `isTreasury`). Aucun compte → `failed-precondition` "Comptes comptables non initialisés".
  5. `update` la licence : `status: 'active'`, `confirmedAt`, `confirmedByUid`, `accountingEntryId`.
  6. `update` le membre : `role === 'official'` → pose `member.officialLicense` ; `role === 'coach'` → `member.coachLicense` (`{ licenseId, seasonId, level }`). `player` / `referee` → pas de denorm membre.
- **Retour** : `{ ok: true, alreadyActive: boolean, accountingEntryId: string | null }`. Wrapper web à créer : `confirmLicense` dans `apps/web/src/services/cloudFunctions.ts`.

### Review per-doc — `coachReviewLicenseDoc` / `treasurerReviewLicenseDoc` / `validateLicenseRequest`

3 callables qui matérialisent le workflow PR2/PR3 de `docs/licenses/parent-completion-workflow.md`. Toutes en région `europe-west6`. Helpers partagés : `licenses/_reviewHelpers.ts` (`assertCoachOfLicenseRequest`, `assertCanReviewAsTreasurer`, `computeAllCoachAccepted`, `computeAllTreasurerAccepted`, `assertReviewableKind`, `validateRefusalReason`, `parseLicenseDocKind`). Tous en Admin SDK → bypass des rules `/licenseRequests` (l'auth est re-vérifiée côté serveur).

- **`coachReviewLicenseDoc`** (`licenses/coachReviewLicenseDoc.ts`) — review per-doc côté coach (PR2). Input wire `{ requestId, kind, decision: 'accept' | 'refuse', refusalReason? }`. Auth coach scope (`teamId ∈ user.teamIds`) ou admin/rootAdmin. Pré-condition `status === 'parent_docs_submitted'`. **Refuse** → pose `coachReview: {decision:'refused', refusalReason, ...}` + status → `pending_parent_docs` + reset `coachValidatedAt/ByUid` à `null`. **Accept tous** → status → `coach_validated` + pose `coachValidatedAt/ByUid`. Accept partiel → status reste `parent_docs_submitted`. `refusalReason` validé : trim + length ∈ [5, 500]. Output `{ ok, requestId, newStatus, allCoachAccepted }`.

- **`treasurerReviewLicenseDoc`** (`licenses/treasurerReviewLicenseDoc.ts`) — review per-doc côté trésorier (PR3). Auth admin/treasurer/secretary/rootAdmin. Pré-conditions asymétriques : **Accept** `status ∈ {parent_docs_submitted, coach_validated, pending_parent_docs}` — le trésorier peut court-circuiter la review coach (cas vécu : coach absent, doc évident, urgence). **Refuse** `status ∈ {coach_validated, pending_parent_docs}` (refus enchaînés OK). **Refuse** → reset complet (`pending_parent_docs` + `coachValidatedAt/ByUid = null`). **Accept** → status inchangé ; le trésorier doit ensuite appeler `validateLicenseRequest` pour émettre la licence. Output `{ ok, requestId, newStatus, allTreasurerAccepted }`.

- **`validateLicenseRequest`** (`licenses/validateLicenseRequest.ts`) — décision finale (PR3). Input `{ requestId, decision: 'approve' | 'reject', comment? }`. Auth identique au trésorier. Pré-conditions asymétriques (bypass coach end-to-end autorisé) : **Approve** exige `status ∈ {parent_docs_submitted, coach_validated, pending_parent_docs}` ET `computeAllTreasurerAccepted` — le trésorier qui a validé chaque doc en per-doc peut émettre la licence sans attendre la review coach. **Reject** accepte `status ∈ {parent_docs_submitted, coach_validated}` — le trésorier peut couper court dès l'arrivée des docs parent (doc faux / info erronée). **Approve** : résout le 1er `/licenseTypes` joueur actif (sinon `failed-precondition` "Aucun /licenseTypes joueur actif"), crée `/licenses/{auto-id}` `status:'pending'` avec snapshot `role`/`level`/`name`/`fee` + `requestId` + `requestedByUid` (snapshot de `request.requestedBy`), met `request.status = 'approved'`. **Reject** : pas de licence créée, `request.status = 'rejected'`. La transition `pending → active` + écriture comptable reste séparée via `confirmLicense`. Output `{ ok, requestId, newStatus, licenseId }`.

**Reset des reviews au re-upload** : c'est le store `useLicenseRequestsStore` (côté `apps/courtbase-register`) qui pose `coachReview: null` + `treasurerReview: null` sur le `UploadedDocRef` au moment de l'upload — couvert par la whitelist `uploadedDocs` de la rule `/licenseRequests` update parent (pas de modif rules nécessaire).

**Schema impact** : `UploadedDocRef` étend deux sous-champs nullables (`coachReview`, `treasurerReview`) ; `LicenseData` étend `requestId: string | null` + `requestedByUid: string | null`. Voir `packages/shared-types/src/license.ts`.

### Chantier app mobile — `fanoutNotification` + callables `coach*`

Introduits par le chantier app mobile Flutter (cf. `docs/mobile-app.md`). `/members` et `/matches` sont write-admin-only dans `firestore.rules` — les callables `coach*` re-vérifient le scope coach côté serveur (Admin SDK bypasse les rules).

- **`fanoutNotification`** (`notifications/fanoutNotification.ts`) — trigger `onDocumentCreated('notifications/{id}')`. Résout `targetAudience` → officiels → tokens `/users/{uid}/fcmTokens` → `sendEachForMulticast` (chunks 500). Purge les tokens morts (`registration-token-not-registered` / `invalid-argument`). Garde idempotence : skip si `notif.pushedAt != null`, pose `pushedAt` en fin.
- **`coachCreateMember`** (`members/coachCreateMember.ts`) — callable, coach scope. Input `{ teamId, firstName, lastName, birthDate:number|null, avs, email, phone }`. Crée un joueur (dédup `findExactMemberMatch`), `arrayUnion` `team.playerIds` (déclenche `initiateDuesOnPlayerActivation`), écrit `/members/{id}/private/contact`.
- **`coachUpdateMember`** (`members/coachUpdateMember.ts`) — callable, coach scope. Whitelist d'édition : `firstName`, `lastName`, `birthDate`, contact `email`/`phone`, `comms.generalRecipients`. Tout autre champ → `permission-denied`.
- **`coachDeactivateMember`** (`members/coachDeactivateMember.ts`) — callable, coach scope. Input `{ memberId, mode:'bench'|'archive', reason? }`. `bench` → `active:false`. `archive` → `status:'archived'` + champs `archived*` (`reason` requis). Idempotent.
- **`coachCreateAwayMatch`** (`matches/coachCreateAwayMatch.ts`) — callable, coach scope. Crée `/matches` `kind:'away'`, `date` = **minuit UTC**. Libère best-effort les entraînements en conflit (`freeConflictingTrainings` dans `matches/_helpers.ts`).

- **`syncUserRolesFromMember`** (`members/syncUserRolesFromMember.ts`) — trigger `onDocumentWritten('members/{id}')`. Propage `member.roles` → `/users/{linkedUserId}.roles` (copie verbatim, **écrase**). Délien / relien / suppression du membre → roles de l'ancien user remis à `[]`. Idempotent. ⚠️ Écrase tout : un rôle posé hors-membre sur `/users.roles` (ex. `parent` via `submitRegistration`) est perdu au prochain write du membre lié — il doit figurer dans `member.roles` pour persister.

Helper de scope coach partagé : `members/_coachAuth.ts` (`assertCoachOrAdminOfMember`). Wire dates = epoch millis. I/O interfaces locales aux fichiers.

### Photo licence membre — `setMemberLicensePhoto` / `removeMemberLicensePhoto` (PR-B, 2026-05-24)

Brief produit : `docs/members/license-photo.md`. La photo passeport du membre est réutilisée par l'admin/trésorier lors de la création de la licence fédérale et constitue désormais un **pré-requis serveur** à la transition `parent_docs_submitted → coach_validated` (gate ajouté dans `coachReviewLicenseDoc` — cf. ci-dessus). Les deux callables ci-dessous écrivent sur `/members` (write-admin-only côté rules) via Admin SDK et opèrent aussi sur Storage (`getStorage().bucket().file(path)`).

- **`setMemberLicensePhoto`** (`members/setMemberLicensePhoto.ts`) — callable, scope coach OU admin/rootAdmin (`assertCoachOrAdminOfMember`). Input wire `{ memberId, storagePath, contentType, sizeBytes }`. Vérifie : `contentType ∈ {image/jpeg, image/png, image/webp}`, `sizeBytes ≤ 5 Mo`, `storagePath` commence bien par `members/{memberId}/`, fichier physiquement présent dans le bucket (`file.exists()`). Pose `member.photoStoragePath / photoUpdatedAt / photoUpdatedByUid`. **Best-effort delete** de l'ancien fichier Storage si le `storagePath` change (try/catch silencieux). Output `{ ok: true, memberId, photoStoragePath }`.

- **`removeMemberLicensePhoto`** (`members/removeMemberLicensePhoto.ts`) — callable, **admin OU rootAdmin only** (pas le coach — action plus rare et plus risquée). Input wire `{ memberId }`. Best-effort delete de l'objet Storage référencé par `member.photoStoragePath`, puis clear des 3 champs Firestore à `null`. **Idempotent** : si pas de photo → no-op (renvoie `ok` sans écriture). Output `{ ok: true, memberId }`.

**Pattern Admin SDK Storage** (à reproduire pour toute future callable qui touche Storage côté serveur) :

```ts
import { getStorage } from 'firebase-admin/storage'
const bucket = getStorage().bucket()
const file = bucket.file(storagePath)
const [exists] = await file.exists()
if (exists) await file.delete()
```

Côté Admin SDK, les erreurs Storage ne suivent pas le schéma `FirebaseError` (`.code` numérique 404/403 ou parfois absent). Le try/catch défensif extrait `err.code` quand présent et logge sans bloquer (cohérent avec la règle racine `[[firebase-error-instanceof-unreliable]]`).

### Dossier `basketplan/` — intégration Swiss Basketball (PR 1 + PR 2)

Intégration des données fédérales Basketplan (ORCA Systems). Mapping team → compétition(s) en PR 1 ; sync auto AWAY + scores/arbitres en PR 2 ; création HOME + Inbox admin en PR 3. Voir `docs/basketplan-integration.md` (brief) et `docs/chantier-basketplan.md` (checklist).

- **Helpers** :
  - `_client.ts` — fetch HTTP + `fast-xml-parser` configuré.
  - `_parsers.ts` — `parseLeagueHoldings`, `parseLeagueSchedule`, `parseRanking` + types `Game`, `GameResult`, `ClubTeamInLeague`, `LeagueHolding`.
  - `_authz.ts` — `assertAdminOnly`, `assertAdminOrCoachOfTeam`, `loadCallerUser` (pattern self-contained, ne dépend pas de `matches/_helpers`).
  - `_sync.ts` — **PR 2** — algorithme central `applyGame(team, link, game)` (3 passes : patch existing → link manual → create AWAY ; HOME différé PR 3). Helpers exportés : `levenshtein`, `fuzzyMatchOpponent` (seuil `FUZZY_MATCH_THRESHOLD = 2`), `isHomologatedState`, `basketplanDateToTimestamp`, `endTimePlusTwoHours`, `resolveMatchTypeId` (mapping explicit `config.club.basketplan.matchTypeMapping[federationCode]` puis fallback création/lookup `/matchTypes` nommé `'Championnat (Basketplan)'` avec cache process). `tallyAction` + `emptySyncActionsSummary` pour le reporting.
- **Callables PR 1** (toutes `europe-west6`) :
  - `listBasketplanLeagueHoldings({ federationId })` — signed-in, cache mémoire 1h par fédération.
  - `listClubTeamsInLeague({ leagueHoldingId })` — signed-in, lit `config/club.basketplan.clubId` pour filtrer.
  - `linkTeamToBasketplan({ teamId, federationId, leagueHoldingId, teamIdInLeague })` — admin OR coach-of-team. Génère un uuid local (`crypto.randomUUID()`), re-fetch côté serveur pour les caches `leagueHoldingName` / `federationCode` / `season` / `teamNameInLeague`.
  - `unlinkTeamBasketplan({ teamId, linkId })` — admin OR coach-of-team. Filter out.
  - `toggleTeamBasketplanLink({ teamId, linkId, active })` — admin OR coach-of-team. Idempotent.
  - `testBasketplanConnection({})` — admin only. Ping `findAllLeagueHoldings.do?federationId=<defaultFederationId>` ; retourne `{ ok, leagueCount } | { ok: false, error }`.
- **Callables / scheduled PR 2** (toutes `europe-west6`) :
  - `syncForTeam.ts` → `syncBasketplanForTeam({ teamId })` — admin OR coach-of-team. Boucle sur les links actifs (try/catch indépendant par link), `setTimeout 100ms` entre fetchs. Export `syncOneLink(team, link)` réutilisé par le cron.
  - `scheduledSync.ts` → `scheduledBasketplanSync` — `onSchedule('0 3 * * *', timeZone:'Europe/Zurich', region:'europe-west6')`. No-op si `config.club.basketplan.enabled !== true`. Itère sur toutes les teams avec liens actifs (lit `/teams` + filtre JS — petit volume) → `syncOneLink` par link → update `team.basketplanSyncedAt` puis `config.basketplan.lastSyncAt` + `lastSyncError` (message agrégé `≤ 500 chars` ou `null` si OK). Export `runScheduledBasketplanSync()` pour tests.
- **Dépendance** : `fast-xml-parser` (^4.5). `fetch` natif Node 20 (pas de `node-fetch`).
- **Tests** :
  - `__tests__/parsers.test.ts` — 19 cas couvrant les 3 endpoints, fixtures XML réelles (Marly Basket, AFBB 2LM saison 25/26) dans `__fixtures__/`.
  - `__tests__/sync.test.ts` — **PR 2** — 34 cas couvrant `applyGame` (AWAY créé, patch existant, lien manuel fuzzy, homologation → status `played`, conflit dédup, skip HOME, skip noise, ignore matchs déjà liés) + helpers `levenshtein` / `fuzzyMatchOpponent` / `endTimePlusTwoHours` / `basketplanDateToTimestamp` / `isHomologatedState` / `resolveMatchTypeId` (3 cas : mapping explicit, fallback existing, fallback create + cache). Mocks Firestore inline (`vi.fn()`), pas d'emulator.
- **Sécurité** : les écritures sur `/teams.basketplanLinks[]` (mapping) ET sur `/matches` + `/matchTypes` + `/config/club` (sync) passent en Admin SDK (bypass des rules write admin-only). Le scope coach est re-vérifié côté serveur via `assertAdminOrCoachOfTeam` pour les callables. Le cron tourne sans caller — pas de scope à vérifier.

## Migrations

- Fichiers nommés `migrations/migration_NNN_description.ts`.
- Chaque migration exporte `{ from: number, to: number, run(db): Promise<void> }`.
- **Idempotent obligatoire** : re-run safe.
- **Forward-only**. Pas de `down()`.
- Loggée dans `_meta/schema.migrationLog`.

### Compatibility window
Functions à version `N+1` doivent gérer le schéma `N` jusqu'à fin de migration. Soit migration triviale sync, soit code dual-version.

## Conventions

- **Region** par défaut : `europe-west6` (Zurich, proche Yverdon).
- **Idempotence** : tout trigger Firestore doit gérer les re-runs (Firestore peut redéclencher).
- **Logging** : utiliser le logger Firebase (`functions.logger`).
- **Transactions** : pour toute écriture multi-doc critique (génération bookings, transitions dues).
- **Pas de secrets en code** : utiliser `defineSecret` ou env vars sécurisées.

## Avant de commit

- [ ] `npm run build -w functions` passe (TSC)
- [ ] `npm run lint -w functions` passe
- [ ] Si nouvelle Function : ajoutée à `docs/firebase.md` (section Functions) **et** ajoutée comme export dans `functions/src/index.ts`
- [ ] Si touche schéma : `docs/firebase.md` + `firestore.rules` + `packages/shared-types` à jour
- [ ] Si callable côté web : wrapper typé dans `apps/web/src/services/cloudFunctions.ts` + entrée dans la table de `apps/web/CLAUDE.md`

## Avant de deploy

1. **Toujours `npm run build -w @club-app/functions` localement avant `firebase deploy`.** Le CLI Firebase recompile **toute** la lib functions avec `tsc` avant de pousser, même quand on cible `--only functions:onlyOne`. Une erreur TS dans une function hors-scope bloque le déploiement complet. Build local d'abord = catch des erreurs latentes (mémoire : `[[deploy-functions-monorepo-fix]]`).

2. **Repacker `shared-types` en tarball** (le buildpack Cloud Functions ne sait pas résoudre les workspace symlinks) :

   ```bash
   cd packages/shared-types && npm pack --pack-destination ../../functions/
   cd - && firebase deploy --only functions:<functionName> -P dev
   ```

   Cf. `docs/deployment.md` section "Cloud Functions deploy — gotchas" pour le détail (Blaze obligatoire, IAM cloudbuild SA, tarball, cleanup policy).

3. **Cleanup tarball après deploy.** Penser à supprimer le `.tgz` du dossier `functions/` une fois le deploy passé, ou l'exclure via `.gitignore` (vérifier l'état actuel : `ls functions/*.tgz` puis `cat functions/.gitignore` si présent — ajouter `*.tgz` si manque). Évite de polluer les commits / les builds futurs avec un tarball stale.

## Après deploy — binding IAM `allUsers/run.invoker` obligatoire (Functions v2)

`firebase deploy --only functions:<newFunc>` ne pose **pas** par défaut le binding Cloud Run `allUsers → roles/run.invoker` sur les nouvelles services. Conséquence : la callable rejette toutes les requêtes Firebase Auth (Cloud Run vérifie d'abord l'auth IAM avant que le code de la function ne voie le token Firebase), et le SDK client remonte l'erreur générique `internal`. Cf. `docs/deployment.md` section "Cloud Functions deploy — gotchas" §5 pour le diagnostic complet (mémoire : `[[deploy-functions-v2-invoker-binding]]`).

**Fix immédiat** (à appliquer après tout deploy de nouvelle function v2) :

```bash
gcloud run services add-iam-policy-binding <fn-name-lowercase> \
  --region=europe-west6 \
  --member="allUsers" \
  --role="roles/run.invoker" \
  --project=<projectId>
```

⚠ Le nom du service Cloud Run est l'export Function name **en lowercase** (ex. `matchExistingMember` → `matchexistingmember`).

**Diagnostic** si une callable nouvellement déployée rejette en `internal` sans logs Function :

```bash
# 1. Vérifier la policy IAM
gcloud run services get-iam-policy <fn-name-lowercase> --region=europe-west6 --project=<projectId>
# (cherche un binding allUsers / roles/run.invoker — sinon c'est le bug)

# 2. Lire les logs Cloud Run (la commande `firebase functions:log` est cassée sur certains projets)
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="<lowercase-name>"' \
  --project=<projectId> --limit=10
```

Symptôme typique dans les logs : `WARNING: The request was not authenticated. Empty Authorization header value.`

## Bootstrap du premier rootAdmin

Pour seeder le premier rootAdmin sur un nouveau projet Firebase : exécuter le script `scripts/setRootAdmin.ts` localement.

**Chemin principal (ADC)** :
```bash
gcloud auth application-default login
npm run bootstrap:root-admin -w functions -- --project <projectId> user@example.com
```

**Chemin alternatif (service account JSON)** :
```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npm run bootstrap:root-admin -w functions -- --project <projectId> user@example.com
```

**Révoquer** (n'enlève que le claim `rootAdmin`, ne touche pas `/users/{uid}`) :
```bash
npm run bootstrap:root-admin -w functions -- --project <projectId> user@example.com --revoke
```

**Aide / formes acceptées** :
```bash
npm run bootstrap:root-admin -w functions -- --help
# Équivalents :
#   --project <id> <email>            (positionnel)
#   --project=<id> --email=<email>    (formes "="; ordre libre)
```

Ce script n'est **pas** une Cloud Function déployée — c'est une opération de bootstrap unique par projet, car `setRootAdminClaim` (Function) nécessite déjà un rootAdmin existant. L'utilisateur doit avoir un compte Auth Firebase (créé via Console ou première connexion OAuth) — sinon le script échoue proprement avec un message explicite.

Le script vit volontairement dans `functions/scripts/` (hors `src/`) pour rester exclu du build TypeScript de production (`tsc` rootDir=src). Il est exécuté via `tsx` depuis le devDep — il n'est jamais déployé.

## Scripts Admin SDK de backfill (one-shot, par projet client)

Tous suivent le même pattern : `scripts/<name>.ts`, exposés via `npm run <name> -w @club-app/functions -- --project <id> [--dry-run]`. Idempotents (skip ce qui est déjà OK). Exclus du build prod. Auth via ADC ou GOOGLE_APPLICATION_CREDENTIALS.

| Script | npm run | But |
|---|---|---|
| `setRootAdmin.ts` | `bootstrap:root-admin` | Pose / retire le claim Auth `rootAdmin` sur un user. Per-projet, première utilisation. |
| `backfillUserMemberId.ts` | `backfill:user-member-id` | Pose `/users/{uid}.memberId` à partir de `/members.linkedUserId`. À jouer sur tout projet ayant reçu des inscriptions `for: 'self'` avant le 2026-05-23 (avant le forward-fix de `confirmRegistration`). Cf. mémoire `[[confirm-registration-bidirectional-binding]]`. |
| `backfillDuesRegisteredByUid.ts` | `backfill:dues-registered-by-uid` | Pose `/dues/{id}.registeredByUid` à partir de `/registrations.submittedByUid` (fallback `member.linkedUserId`/guardian). À jouer sur tout projet ayant des dues créés avant le déploiement de la version moderne de `initiateDuesOnPlayerActivation`. Cf. mémoire `[[due-registered-by-uid]]`. |
| `backfillLicenseRequestParentUserIds.ts` | `backfill:license-request-parent-user-ids` | Pose `/licenseRequests/{id}.parentUserIds` à partir de `member.linkedUserId` ∪ `member.guardianUserIds`. À jouer sur tout projet ayant des demandes créées avant l'ajout du champ (2026-05-24). Sans ce backfill, la LIST query parent (`where parentUserIds array-contains uid`) est refusée par les rules et le banner Home reste vide. Cf. mémoire `[[license_parent_workflow_real]]` + `[[firestore-list-query-dynamic-rule]]`. |

**Toujours commencer par `--dry-run`** pour valider ce qui serait modifié sans écrire. Les scripts logguent par doc avec source d'inférence.

**Quand ajouter un nouveau script de backfill** :
- Migration de schéma sur la collection (champ ajouté, sémantique modifiée).
- Forward-fix d'un trigger/callable qui ne couvre pas les docs créés avant le déploiement.
- Toute opération admin one-shot qui n'a pas vocation à devenir une callable récurrente.

## Ce qu'il NE FAUT PAS faire ici

- Hardcoder un `projectId` (toujours via env / context).
- Écrire dans `_meta/schema` depuis une Function autre que `runMigrations`.
- Supprimer une migration une fois mergée (forward-only).

## `markDuePaid` — garde "montant partiel = comité only" (2026-05-15)

La callable accepte deux niveaux de permission :

1. **Auth de base** (`assertAdminOrTreasurer`) — rôle `admin` OU `treasurer` requis, sinon `permission-denied`. C'est la garde "qui peut marquer payé".
2. **Garde "montant partiel"** (`assertCanRecordPartial`) — déclenchée **dans la transaction** après lecture de `due.amount`, si `paidAmount < due.amount`. Exige le claim `rootAdmin` OU le rôle `treasurer`. Un admin standard avec `paidAmount` plein passe → un admin standard avec `paidAmount` partiel se prend `permission-denied`. C'est la "capability comité" pour les arrangements in extremis.

Quand tu ajoutes une nouvelle callable de paiement (ou que tu touches `markDuePaid`), garde cette séparation : auth de base + garde additionnelle pour les actions "exceptionnelles" qui ne sont pas dans le périmètre admin standard. Tests existants dans `markDuePaid.test.ts` (suite *"partial amount (comité only)"*) — extends si tu ajoutes des règles similaires.
