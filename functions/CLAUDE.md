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

`generateSeasonBookings`, `previewSeasonBookings`, `applyClosurePeriod`, `handleMatchSlotChange`, `autoOfficialsNeededNotification`, `matchReminders`, `initiateDuesOnPlayerActivation`, `issueDuesScheduled`, `markOverdueScheduled`, `syncMemberDuesStatus`, `applyPaymentException`, `applyLicenseRequest`, `runMigrations`.

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

**Toujours repacker `shared-types` en tarball** (le buildpack Cloud Functions ne sait pas résoudre les workspace symlinks) :

```bash
cd packages/shared-types && npm pack --pack-destination ../../functions/
cd - && firebase deploy --only functions:<functionName> -P dev
```

Cf. `docs/deployment.md` section "Cloud Functions deploy — gotchas" pour le détail (Blaze obligatoire, IAM cloudbuild SA, tarball, cleanup policy).

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

## Ce qu'il NE FAUT PAS faire ici

- Hardcoder un `projectId` (toujours via env / context).
- Écrire dans `_meta/schema` depuis une Function autre que `runMigrations`.
- Supprimer une migration une fois mergée (forward-only).
