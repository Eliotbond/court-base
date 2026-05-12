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
- [ ] Si nouvelle Function : ajoutée à `docs/firebase.md` (section Functions)
- [ ] Si touche schéma : `docs/firebase.md` + `firestore.rules` + `packages/shared-types` à jour

## Bootstrap du premier rootAdmin

Pour seeder le premier rootAdmin sur un nouveau projet Firebase : exécuter le script `scripts/setRootAdmin.ts` localement avec les credentials d'un compte de service.

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
npx ts-node scripts/setRootAdmin.ts user@example.com
```

Ce script n'est **pas** une Cloud Function déployée — c'est une opération de bootstrap unique par projet, car `setRootAdminClaim` (Function) nécessite déjà un rootAdmin existant.

Pour révoquer : ajouter le flag `--revoke`.

## Ce qu'il NE FAUT PAS faire ici

- Hardcoder un `projectId` (toujours via env / context).
- Écrire dans `_meta/schema` depuis une Function autre que `runMigrations`.
- Supprimer une migration une fois mergée (forward-only).
