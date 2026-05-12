# Deployment

> Multi-projet, control-plane éditeur, provisioning client, deploys cross-projet, migrations. Voir `firebase.md` pour le schéma intra-client.

## Topologie

| Type de projet | Rôle |
|---|---|
| **Client** | Un par customer. Firestore, Auth, Storage, Functions, FCM. Billé sur le compte GCP du client. |
| **Editor control-plane** | Un seul, qu'on héberge. Registre clients, tooling admin éditeur, orchestration deploys. |

Un user Auth ne traverse jamais les projets. L'editor global root opère via Google Cloud IAM.

## Schéma control-plane

```
/registry/clients/{clientId}
/registry/deployments/{deploymentId}
/registry/migrations/{migrationRunId}
/registry/incidents/{incidentId}
```

### `/registry/clients/{clientId}`
```ts
{
  displayName: string
  firebaseProjectId: string
  firebaseProjectNumber: string
  region: string                  // ex "europe-west6"
  status: "provisioning" | "active" | "suspended" | "archived"
  schemaVersion: number           // mirror de /_meta/schema.version du client
  appVersion: string | null
  contact: { email, phone: string | null }
  billingAccountId: string
  createdAt: Timestamp
  createdBy: string
  lastDeployAt: Timestamp | null
  lastDeployVersion: string | null
  notes: string | null
}
```

### `/registry/deployments/{deploymentId}`
```ts
{
  clientId: string
  artifact: "rules" | "indexes" | "functions" | "hosting"
  version: string                 // git sha ou tag
  status: "pending" | "success" | "failed"
  startedAt: Timestamp
  finishedAt: Timestamp | null
  triggeredBy: string
  errorLog: string | null
}
```
Append-only. Audit + rollback.

### `/registry/migrations/{migrationRunId}`
```ts
{
  clientId: string
  fromVersion: number
  toVersion: number
  status: "pending" | "running" | "success" | "failed"
  startedAt: Timestamp
  finishedAt: Timestamp | null
  triggeredBy: string
  errorLog: string | null
}
```

### `/registry/incidents/{incidentId}`
```ts
{
  clientId: string | null         // null si fleet-wide
  severity: "info" | "warning" | "critical"
  summary, details: string
  openedAt: Timestamp
  openedBy: string
  resolvedAt: Timestamp | null
}
```

## Provisioning d'un client

Script idempotent run par l'editor global root.

**Inputs** : displayName, billingAccountId, region (défaut `europe-west6`), email + nom root admin.

**Steps (automatisés)** :
1. `gcloud projects create clubapp-<slug>-<rand>`
2. `gcloud billing projects link` au billing du client
3. Enable APIs : Firestore, Auth, Functions, Storage, FCM, Scheduler, Build
4. Create Firestore (Native mode, region choisie)
5. Deploy `firestore.rules` + `firestore.indexes.json` (version current du repo)
6. Deploy Cloud Functions (version current)
7. Seed `/config/club` (singleton, defaults)
8. Seed `/_meta/schema` (version = current)
9. Seed `/roles/` (system: player, official, coach, referee)
10. Create root admin Auth account → reset email + claim `rootAdmin: true`
11. IAM binding : grant editor service account Owner
12. Register `/registry/clients/{id}` (status `active`)

Steps 1–4 requièrent perms org-level. Reprise possible : chaque step check prior completion. Registry → `active` uniquement quand tout OK.

## Cross-project deploy

Tout changement de rules / indexes / Functions → déploiement sur **tous** les projets clients via CI.

### Workflow
1. **Tag release** dans le repo éditeur (ex. `v1.4.2`). CI build artifacts.
2. **Dry-run staging** — projet `clubapp-staging` registered avec marker. Always deployed first, smoke tests.
3. **Fan-out** — CI itère sur `/registry/clients` où `status == "active"` et `firebaseProjectId != staging`.
4. **Per-client** :
   - Write `/registry/deployments/{id}` (`pending`).
   - `firebase deploy --only firestore:rules,firestore:indexes,functions --project <id>` avec service account.
   - Update deployment → `success` ou `failed`.
   - Update `client.lastDeployAt` + `.lastDeployVersion`.
5. **Failure** d'un client ne bloque pas le reste. Surface dans `/registry/incidents/`. Retries manuels.

### Concurrence
- Deploys parallèles entre projets.
- Même projet : lease `clients/{id}.deployLock` (timestamp + uid, expire 10 min).

### Rollback
- Rules / indexes : trivialement revertibles (redeploy tag précédent).
- Functions : redeploy bundle ancien.
- **Schéma** : pas auto-revertible — nouvelle migration forward qui défait.

## Schema versioning & migrations

Chaque projet a `_meta/schema.version`. Repo éditeur définit la target.

### Règles
- Migrations numérotées et ordonnées (`migration_001`, ...). Chaque migration sait `from` → `to`.
- **Idempotentes** : re-runner = no-op si déjà appliquée.
- **Forward-only**. Pas d'auto-down. Rollback = nouvelle migration forward.
- Migrations run comme **Cloud Functions** dans le projet client (`runMigrations` callable). Évite timeouts / quotas éditeur.

### Runner workflow
1. Editor release version `N+1` avec nouvelles migrations bundlées dans Functions.
2. Cross-project deploy ship les Functions partout. À ce stade : code présent, `schema.version` toujours `N`.
3. Editor itère sur `/registry/clients` :
   - Write `/registry/migrations/{id}` (`pending`).
   - Call `runMigrations` sur le projet avec target `N+1`.
   - Function applique en order, transactions Firestore où possible, update `_meta/schema.version` + `migrationLog`.
   - Update migration → `success` ou `failed`.
4. Failure d'un client ne bloque pas le reste.

### Compatibility window
Functions à `N+1` doivent être **backward-compatible** avec `N` pendant le rollout. Soit :
- Migration triviale sync immédiate après deploy.
- Functions gèrent les deux versions jusqu'à fin migration.

## Editor global root — accès opérationnel

**Pas un user Firebase Auth**. Identité Google Cloud (personnel Owner sur tous les projets, ou service account — préféré pour automation).

Capabilities IAM :
- R/W Firestore (Admin SDK) sur tout projet
- Deploy rules, indexes, Functions, Hosting
- Manage Auth users (create, delete, custom claims)
- Logs, billing, métriques

Ne se connecte jamais à l'app cliente. Interface = dashboard control-plane + `gcloud` / `firebase` CLI.

### Editor dashboard (MVP)
Petit Vue app dans le control-plane :
- Liste clients (status, schema version, last deploy, alerts)
- Wizard provisioning
- Bouton "Deploy release to fleet" (staged rollout)
- Bouton "Run migration to vN" per-client / fleet-wide
- Live deployments + migration runs
- Incidents

Access : IAM + claim `editorRoot: true` dans le control-plane.

## Per-project root admin

Distinct de l'editor global root. **Dans** le projet client, user Auth normal + claim `rootAdmin: true`.

- Créé au provisioning. Promotions futures par un root existant ou editor global root.
- Rules : unrestricted R/W sur toutes les collections.
- UI : même que admin + badge "Root".
- Limite : viser 1/projet, max 2.

## Open questions

- **Backups** : export Firestore schedule ? GCS bucket éditeur, client, both ? Rétention ?
- **Quota & cost monitoring** : surface per-project reads/writes + invocations Functions. Source GCP Monitoring + Function périodique.
- **Hosting** : single déploiement éditeur + tenant-by-subdomain (`<client>.clubapp.ch`), ou Hosting per-project ? Subdomain = simpler ops mais couple notre bill à la croissance client. À décider Phase 1.
- **Decommissioning** : handover GCP project au client (clean) ou archive + delete après rétention ?
