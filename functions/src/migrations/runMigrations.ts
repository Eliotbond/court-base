/**
 * `runMigrations` — Callable Cloud Function.
 *
 * Applique les migrations en attente sur le projet client courant. Idempotente :
 * re-call sans rien à faire = no-op.
 *
 * Auth : `rootAdmin` OU `admin` (claim ou rôle dans `/users/{uid}.roles`).
 *
 * Input : `{ targetVersion?: number }`. Si absent → migre vers `latestVersion`.
 *
 * Workflow :
 *  1. Lit `_meta/schema.version` (défaut 0 si doc absent).
 *  2. Calcule le plan via `registry.planMigrations(current, target)`.
 *  3. Pour chaque step :
 *     - Exécute `migration.run(db)`.
 *     - Dans une transaction sur `_meta/schema` : vérifie que `version === migration.from`,
 *       bump `version`, append l'entrée `migrationLog`.
 *     - Refuse si la version courante ne matche plus `migration.from` (concurrence).
 *  4. Retourne `{ from, to, applied }`.
 *
 * Voir docs/firebase.md (`/_meta/schema`) et docs/deployment.md (runner workflow).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { db } from '../shared/firestore'
import { logger } from '../shared/logger'
import { migrations, latestVersion, planMigrations } from './registry'
import type { Migration, MigrationLogEntry, SchemaMetaDoc } from './types'

const SCHEMA_COLLECTION = '_meta'
const SCHEMA_DOC = 'schema'

export interface RunMigrationsInput {
  targetVersion?: number
}

export interface AppliedMigration {
  version: number
  name: string
}

export interface RunMigrationsOutput {
  from: number
  to: number
  applied: AppliedMigration[]
}

/** Lecture safe du doc `_meta/schema`. Retourne 0 si absent. */
async function readCurrentVersion(
  firestore: FirebaseFirestore.Firestore,
): Promise<number> {
  const snap = await firestore.collection(SCHEMA_COLLECTION).doc(SCHEMA_DOC).get()
  if (!snap.exists) return 0
  const data = snap.data() as Partial<SchemaMetaDoc> | undefined
  const v = data?.version
  return typeof v === 'number' ? v : 0
}

/**
 * Vérifie l'autorisation du caller. Accepte :
 *  - claim `rootAdmin: true`
 *  - claim `admin: true`
 *  - rôle "admin" dans `/users/{uid}.roles`
 */
async function assertAuthorized(
  request: CallableRequest<RunMigrationsInput>,
  firestore: FirebaseFirestore.Firestore,
): Promise<string> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.')
  }
  const token = request.auth.token
  if (token.rootAdmin === true || token.admin === true) {
    return request.auth.uid
  }
  // Fallback : rôle "admin" dans /users/{uid}.
  const userSnap = await firestore.collection('users').doc(request.auth.uid).get()
  const roles = (userSnap.data()?.roles ?? []) as unknown
  if (Array.isArray(roles) && roles.includes('admin')) {
    return request.auth.uid
  }
  throw new HttpsError(
    'permission-denied',
    'Only an admin or rootAdmin can run migrations.',
  )
}

/**
 * Applique une migration + écrit le bump de version + log dans une transaction.
 * Refuse si la version observée ne matche plus `migration.from` (drift entre
 * la lecture initiale et le moment du commit — concurrence).
 */
async function applyOneMigration(
  firestore: FirebaseFirestore.Firestore,
  migration: Migration,
  appliedBy: string,
): Promise<void> {
  // 1. Exécute la migration (idempotente, peut écrire ailleurs que /_meta).
  await migration.run(firestore)

  // 2. Commit atomique sur le doc de schéma.
  const ref = firestore.collection(SCHEMA_COLLECTION).doc(SCHEMA_DOC)
  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const current = snap.exists
      ? ((snap.data() as Partial<SchemaMetaDoc>).version ?? 0)
      : 0
    if (current !== migration.from) {
      throw new HttpsError(
        'aborted',
        `Concurrent migration detected: expected version=${migration.from}, found ${current}.`,
      )
    }
    const existingLog = snap.exists
      ? (((snap.data() as Partial<SchemaMetaDoc>).migrationLog ?? []) as MigrationLogEntry[])
      : []
    const entry: MigrationLogEntry = {
      version: migration.to,
      appliedAt: admin.firestore.Timestamp.now(),
      appliedBy,
      notes: migration.name,
    }
    tx.set(
      ref,
      {
        version: migration.to,
        migrationLog: [...existingLog, entry],
      },
      { merge: true },
    )
  })
}

/**
 * Handler interne, séparé de l'enveloppe `onCall` pour être unit-testable
 * sans avoir à instancier le runtime Cloud Functions.
 */
export async function runMigrationsHandler(
  request: CallableRequest<RunMigrationsInput>,
): Promise<RunMigrationsOutput> {
  const firestore = db()
  const callerUid = await assertAuthorized(request, firestore)

  const data = request.data ?? {}
  const target =
    typeof data.targetVersion === 'number' ? data.targetVersion : latestVersion

  if (!Number.isInteger(target) || target < 0) {
    throw new HttpsError(
      'invalid-argument',
      '`targetVersion` must be a non-negative integer.',
    )
  }
  if (target > latestVersion) {
    throw new HttpsError(
      'out-of-range',
      `targetVersion=${target} exceeds latest registered version ${latestVersion}.`,
    )
  }

  const current = await readCurrentVersion(firestore)
  if (current > target) {
    throw new HttpsError(
      'failed-precondition',
      `Cannot migrate backward: current=${current}, target=${target}.`,
    )
  }

  let plan: Migration[]
  try {
    plan = planMigrations(current, target)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new HttpsError('failed-precondition', msg)
  }

  if (plan.length === 0) {
    logger.info('runMigrations: no-op', { current, target, callerUid })
    return { from: current, to: current, applied: [] }
  }

  // Garde-fou : la première étape doit partir de `current`.
  if (plan[0].from !== current) {
    throw new HttpsError(
      'failed-precondition',
      `Plan inconsistent: first step from=${plan[0].from}, current=${current}.`,
    )
  }

  logger.info('runMigrations: starting', {
    current,
    target,
    steps: plan.map((m) => m.name),
    callerUid,
  })

  const applied: AppliedMigration[] = []
  for (const m of plan) {
    logger.info('runMigrations: applying', { name: m.name, from: m.from, to: m.to })
    try {
      await applyOneMigration(firestore, m, callerUid)
    } catch (err) {
      logger.error('runMigrations: step failed', {
        name: m.name,
        from: m.from,
        to: m.to,
        err: err instanceof Error ? err.message : String(err),
      })
      if (err instanceof HttpsError) throw err
      throw new HttpsError(
        'internal',
        `Migration "${m.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    applied.push({ version: m.to, name: m.name })
  }

  const finalVersion = applied[applied.length - 1].version
  logger.info('runMigrations: done', {
    from: current,
    to: finalVersion,
    callerUid,
    count: applied.length,
  })
  return { from: current, to: finalVersion, applied }
}

/** Wrapper Cloud Function. Voir `runMigrationsHandler` pour la logique. */
export const runMigrations = onCall(runMigrationsHandler)

// Export interne pour les tests : permet de re-exécuter le handler sans passer
// par l'enveloppe Cloud Functions.
export const __internal = {
  readCurrentVersion,
  applyOneMigration,
  assertAuthorized,
  latestVersion,
  migrations,
}
